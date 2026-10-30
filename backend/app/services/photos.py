"""Photos on letters: clean them, check them, store them privately, hand them out by signed link.

- Cleaning: every upload is decoded and re-saved as fresh JPEGs: 1600 px for saving and big
  screens, 960 px for phones. Nothing from the original file survives, so GPS location, camera
  details and other hidden data are gone.
- Checking: an on-server model (Marqo nsfw-image-detection-384, Apache-2.0) scores the photo before
  it's stored. Anything at or over the threshold is refused and never saved.
- Storage: a private Cloudflare R2 bucket in production (a folder locally). Nothing is public; the
  API hands photos out itself, behind links signed with SECRET_KEY that expire within two hours.
- Sweeping: photos never attached to a letter, and files whose row is gone (deleted accounts), are
  removed by a daily task.
"""

import base64
import hashlib
import hmac
import io
import logging
import secrets
import uuid
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.models import Photo

logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 40_000_000  # bigger than any phone photo; stops "decompression bomb" files
MAX_SIDE = 1600  # saved letters and big screens
SMALL_SIDE = 960  # what phones show: about a third of the bytes
JPEG_QUALITY = 85
SMALL_QUALITY = 80
NSFW_THRESHOLD = 0.5
UNATTACHED_FOR = timedelta(days=1)
ACCEPTED_TYPES = {"image/jpeg", "image/png", "image/webp"}
_FORMATS = {"JPEG", "PNG", "WEBP"}

Image.MAX_IMAGE_PIXELS = MAX_PIXELS

NOT_A_PHOTO = "That file isn't a photo we can use. Try a JPG or PNG under 10 MB."
REFUSED = (
    "This photo can't be used: Dearlly doesn't allow nudity or sexual content. "
    "If that's a mistake, try a different photo."
)


class PhotoError(ValueError):
    pass


@dataclass(frozen=True)
class Cleaned:
    jpeg: bytes
    small_jpeg: bytes
    width: int
    height: int
    image: Image.Image  # the cleaned picture, for the nudity check


def _jpeg(image: Image.Image, quality: int) -> bytes:
    out = io.BytesIO()
    # No exif= or icc_profile= passed: the new file carries none of the original's metadata.
    # Progressive: on slow data the whole picture appears at once and sharpens as it loads.
    image.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
    return out.getvalue()


def clean(raw: bytes) -> Cleaned:
    """Decode, turn upright, shrink and re-save as JPEG: a new file with no hidden data."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            source = Image.open(io.BytesIO(raw))
            if source.format not in _FORMATS:
                raise PhotoError(NOT_A_PHOTO)
            source.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, Warning, OSError) as exc:
        raise PhotoError(NOT_A_PHOTO) from exc
    upright = ImageOps.exif_transpose(source)
    if upright.mode in ("RGBA", "LA", "P"):
        rgba = upright.convert("RGBA")
        image = Image.new("RGB", rgba.size, (251, 246, 238))  # letter-paper cream behind cut-outs
        image.paste(rgba, mask=rgba.getchannel("A"))
    else:
        image = upright.convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    small = image.copy()
    small.thumbnail((SMALL_SIDE, SMALL_SIDE), Image.Resampling.LANCZOS)
    return Cleaned(
        jpeg=_jpeg(image, JPEG_QUALITY),
        small_jpeg=_jpeg(small, SMALL_QUALITY),
        width=image.width,
        height=image.height,
        image=image,
    )


class NsfwChecker:
    """Scores how likely a photo is to contain nudity or sexual content (0 to 1)."""

    SIZE = 384

    def __init__(self, model_path: str) -> None:
        import onnxruntime as ort  # loaded only where photos are switched on

        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        self._session = ort.InferenceSession(
            model_path, sess_options=options, providers=["CPUExecutionProvider"]
        )

    def __call__(self, image: Image.Image) -> float:
        # As the model was trained: shortest side to 384 (bicubic), centre crop, scale to [-1, 1].
        scale = self.SIZE / min(image.size)
        resized = image.resize(
            (
                max(self.SIZE, round(image.width * scale)),
                max(self.SIZE, round(image.height * scale)),
            ),
            Image.Resampling.BICUBIC,
        )
        left = (resized.width - self.SIZE) // 2
        top = (resized.height - self.SIZE) // 2
        square = resized.crop((left, top, left + self.SIZE, top + self.SIZE))
        pixels = (np.asarray(square, dtype=np.float32) / 255.0 - 0.5) / 0.5
        batch = pixels.transpose(2, 0, 1)[np.newaxis]
        logits = self._session.run(None, {"pixel_values": batch})[0][0]
        odds = np.exp(logits - logits.max())
        return float(odds[0] / odds.sum())  # index 0 is "NSFW"


Checker = Callable[[Image.Image], float]


# --- storage ----------------------------------------------------------------------------------


class Storage(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes | None: ...
    def delete(self, key: str) -> None: ...
    def keys_older_than(self, cutoff: datetime) -> list[str]: ...


class LocalStorage:
    """A folder: development and tests only (production refuses it)."""

    def __init__(self, folder: str) -> None:
        self.root = Path(folder)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise PhotoError("Bad photo key.")
        return path

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key: str) -> bytes | None:
        path = self._path(key)
        return path.read_bytes() if path.is_file() else None

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def keys_older_than(self, cutoff: datetime) -> list[str]:
        folder = self.root / "photos"
        if not folder.is_dir():
            return []
        return [
            f"photos/{p.name}"
            for p in folder.iterdir()
            if p.is_file() and datetime.fromtimestamp(p.stat().st_mtime, UTC) < cutoff
        ]


class R2Storage:
    """The private Cloudflare R2 bucket (S3-compatible)."""

    def __init__(self, settings: Settings) -> None:
        import boto3
        from botocore.config import Config

        secret = settings.r2_photos_secret_access_key
        self.bucket = settings.r2_photos_bucket
        self._s3: Any = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint,
            aws_access_key_id=settings.r2_photos_access_key_id,
            aws_secret_access_key=secret.get_secret_value() if secret else "",
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )

    def put(self, key: str, data: bytes) -> None:
        self._s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType="image/jpeg")

    def get(self, key: str) -> bytes | None:
        try:
            body: bytes = self._s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except self._s3.exceptions.NoSuchKey:
            return None
        return body

    def delete(self, key: str) -> None:
        self._s3.delete_object(Bucket=self.bucket, Key=key)

    def keys_older_than(self, cutoff: datetime) -> list[str]:
        keys: list[str] = []
        for page in self._s3.get_paginator("list_objects_v2").paginate(
            Bucket=self.bucket, Prefix="photos/"
        ):
            keys += [o["Key"] for o in page.get("Contents", []) if o["LastModified"] < cutoff]
        return keys


def storage_for(settings: Settings) -> Storage | None:
    if not settings.photos_enabled:
        return None
    if settings.photo_storage == "r2":
        return R2Storage(settings)
    return LocalStorage(settings.photo_dir)


def new_key() -> str:
    return f"photos/{secrets.token_hex(16)}.jpg"


def small_key(key: str) -> str:
    """The lighter copy sits next to the full one: photos/abc.jpg -> photos/abc-sm.jpg."""
    return key.removesuffix(".jpg") + "-sm.jpg"


def all_keys(keys: list[str]) -> list[str]:
    return [k for key in keys for k in (key, small_key(key))]


# --- signed view links -------------------------------------------------------------------------


def _sign(settings: Settings, photo_id: uuid.UUID, expires: int) -> str:
    key = hashlib.sha256(b"dearlly-photo-links:" + settings.secret_key.get_secret_value().encode())
    mac = hmac.new(key.digest(), f"{photo_id}:{expires}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac[:24]).decode().rstrip("=")


def view_url(
    settings: Settings, photo_id: uuid.UUID, now: datetime | None = None, *, small: bool = False
) -> str:
    """A link that works for one to two hours. Rounded to the hour so browsers can cache it."""
    now = now or datetime.now(UTC)
    expires = (int(now.timestamp()) // 3600 + 2) * 3600
    signature = _sign(settings, photo_id, expires)
    api = settings.public_api_url.rstrip("/")
    size = "&size=small" if small else ""
    return f"{api}/photos/{photo_id}.jpg?e={expires}&s={signature}{size}"


def valid_link(settings: Settings, photo_id: uuid.UUID, expires: int, signature: str) -> bool:
    if expires < datetime.now(UTC).timestamp():
        return False
    return hmac.compare_digest(_sign(settings, photo_id, expires), signature)


# --- removal --------------------------------------------------------------------------------


def delete_files(storage: Storage | None, keys: list[str]) -> None:
    if storage is None:
        return
    for key in keys:
        try:
            storage.delete(key)
        except Exception:  # the daily sweep tries again
            logger.warning("photo delete failed", exc_info=True)


async def owned_keys(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    """Every file of the user's photos (full and small copies)."""
    rows = await db.execute(select(Photo.storage_key).where(Photo.owner_id == user_id))
    return all_keys(list(rows.scalars()))


async def sweep(
    sessionmaker: async_sessionmaker[AsyncSession], storage: Storage, now: datetime | None = None
) -> int:
    """Removes photos never attached to a letter, and files with no row (deleted accounts)."""
    now = now or datetime.now(UTC)
    async with sessionmaker() as db:
        stale = (
            await db.execute(
                delete(Photo)
                .where(Photo.experience_id.is_(None), Photo.created_at < now - UNATTACHED_FOR)
                .returning(Photo.storage_key)
            )
        ).scalars()
        removed = all_keys(list(stale))
        await db.commit()
        known = set(all_keys(list((await db.execute(select(Photo.storage_key))).scalars())))
    orphans = [k for k in storage.keys_older_than(now - timedelta(hours=1)) if k not in known]
    delete_files(storage, removed + orphans)
    return len(set(removed + orphans))
