"""Photos: cleaned of hidden data, checked before storing, private, and removed when not needed."""

import asyncio
import io
import os
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from PIL import Image
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import Settings
from app.models import Photo
from app.services import photos

from .conftest import AuthClient, production_settings
from .test_experiences import NOTE, SENDER, _become_recipient, _token

MODEL = Path(__file__).resolve().parents[1] / "models" / "marqo-nsfw-384.onnx"


def _jpeg(width: int = 1200, height: int = 800, *, exif: bool = True) -> bytes:
    image = Image.new("RGB", (width, height), (200, 120, 90))
    data = Image.Exif()
    if exif:
        data[0x010F] = "SnoopCam"  # camera make
        data[0x0112] = 6  # "rotate 90°": phones store portrait photos this way
        data[0x8825] = {1: "N", 2: (6.0, 27.0, 1.5), 3: "E", 4: (3.0, 23.0, 40.0)}  # GPS
    out = io.BytesIO()
    image.save(out, "JPEG", exif=data)
    return out.getvalue()


class Checker:
    def __init__(self) -> None:
        self.score = 0.02
        self.calls = 0

    def __call__(self, _image: Image.Image) -> float:
        self.calls += 1
        return self.score


@pytest.fixture
def checker(auth_client: AuthClient, tmp_path: Path) -> Iterator[Checker]:
    fake = Checker()
    auth_client.app.state.photo_storage = photos.LocalStorage(str(tmp_path))  # type: ignore[attr-defined]
    auth_client.app.state.photo_checker = fake  # type: ignore[attr-defined]
    yield fake


def _settings(client: AuthClient) -> Settings:
    settings: Settings = client.app.state.settings  # type: ignore[attr-defined]
    return settings


def _upload(client: AuthClient, data: bytes, kind: str = "image/jpeg") -> Any:
    return client.post("/photos", content=data, headers={"Content-Type": kind})


def _files(tmp_path: Path) -> list[Path]:
    return list((tmp_path / "photos").glob("*.jpg")) if (tmp_path / "photos").exists() else []


# --- cleaning ---------------------------------------------------------------------------------


def test_cleaning_removes_location_and_camera_and_turns_it_upright() -> None:
    raw = _jpeg()
    assert b"SnoopCam" in raw
    cleaned = photos.clean(raw)
    assert b"SnoopCam" not in cleaned.jpeg
    again = Image.open(io.BytesIO(cleaned.jpeg))
    assert dict(again.getexif()) == {}
    assert again.info.get("icc_profile") is None
    # Turned upright from the "rotate 90°" tag, and no side over 1600 px.
    assert (cleaned.width, cleaned.height) == (800, 1200)
    assert max(photos.clean(_jpeg(4000, 3000, exif=False)).width, 0) == 1600


@pytest.mark.parametrize(
    "raw",
    [b"not an image", b"GIF89a" + b"\x00" * 100],
)
def test_things_that_arent_photos_are_refused(raw: bytes) -> None:
    with pytest.raises(photos.PhotoError):
        photos.clean(raw)


def test_transparent_pngs_get_a_paper_background() -> None:
    out = io.BytesIO()
    Image.new("RGBA", (40, 40), (0, 0, 0, 0)).save(out, "PNG")
    cleaned = photos.clean(out.getvalue())
    assert cleaned.image.getpixel((5, 5)) == (251, 246, 238)


@pytest.mark.skipif(not MODEL.is_file(), reason="model not downloaded (models/fetch_nsfw_model.py)")
def test_the_real_model_passes_an_ordinary_picture() -> None:
    check = photos.NsfwChecker(str(MODEL))
    picture = Image.new("RGB", (900, 600), (120, 170, 220))
    assert check(picture) < photos.NSFW_THRESHOLD


# --- uploading --------------------------------------------------------------------------------


def test_upload_view_and_links_expire(
    auth_client: AuthClient, checker: Checker, tmp_path: Path
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    assert auth_client.get("/photos/status").json()["enabled"] is True
    created = _upload(auth_client, _jpeg())
    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["width"], body["height"]) == (800, 1200)
    [stored] = _files(tmp_path)
    assert b"SnoopCam" not in stored.read_bytes()

    path = body["url"].removeprefix("http://localhost:8100")
    shown = auth_client.get(path)
    assert shown.status_code == 200
    assert shown.headers["content-type"] == "image/jpeg"
    assert "noindex" in shown.headers["x-robots-tag"]
    # A changed signature, an expired link or another photo's id: nothing.
    assert auth_client.get(path[:-3] + "AAA").status_code == 404
    expired = photos.view_url(
        _settings(auth_client), body["id"], datetime.now(UTC) - timedelta(hours=3)
    )
    assert auth_client.get(expired.removeprefix("http://localhost:8100")).status_code == 404


def test_flagged_photos_are_never_stored(
    auth_client: AuthClient, checker: Checker, tmp_path: Path
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    checker.score = 0.93
    refused = _upload(auth_client, _jpeg())
    assert refused.status_code == 422
    assert "doesn't allow nudity" in refused.json()["detail"]
    assert _files(tmp_path) == []


def test_bad_uploads(auth_client: AuthClient, checker: Checker) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    assert _upload(auth_client, b"hello", "text/plain").status_code == 415
    assert _upload(auth_client, b"not really a jpeg").status_code == 400
    too_big = b"\xff\xd8" + b"\x00" * photos.MAX_UPLOAD_BYTES
    assert _upload(auth_client, too_big).status_code == 413
    assert checker.calls == 0


def test_uploading_needs_an_account_and_photos_switched_on(auth_client: AuthClient) -> None:
    # No model in this test app: photos are off.
    assert auth_client.get("/photos/status").json()["enabled"] is False
    assert _upload(auth_client, _jpeg()).status_code in (401, 503)
    auth_client.sign_up(SENDER, "ada_demo")
    assert _upload(auth_client, _jpeg()).status_code == 503


def test_photos_stay_off_in_production_until_r2_is_set() -> None:
    assert production_settings().photos_enabled is False
    assert production_settings(photo_storage="local").photos_enabled is False
    on = production_settings(
        photo_storage="r2",
        r2_endpoint="https://example.r2.cloudflarestorage.com",
        r2_photos_bucket="dearlly-photos",
        r2_photos_access_key_id="id",
        r2_photos_secret_access_key="secret",
    )
    assert on.photos_enabled is True


# --- on letters -------------------------------------------------------------------------------


def test_a_photo_goes_on_one_letter_and_shows_once_open(
    auth_client: AuthClient, checker: Checker
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    photo_id = _upload(auth_client, _jpeg()).json()["id"]
    letter = auth_client.post(
        "/experiences", json={**NOTE, "content": {**NOTE["content"], "photo": photo_id}}
    )
    assert letter.status_code == 201, letter.text
    # The same photo can't go on a second letter.
    again = auth_client.post(
        "/experiences", json={**NOTE, "content": {**NOTE["content"], "photo": photo_id}}
    )
    assert again.status_code == 400

    later = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    sealed_photo = _upload(auth_client, _jpeg()).json()["id"]
    sealed = auth_client.post(
        "/experiences",
        json={**NOTE, "opens_at": later, "content": {**NOTE["content"], "photo": sealed_photo}},
    ).json()

    _become_recipient(auth_client)
    shown = auth_client.get(f"/letters/{_token(letter.json()['url'])}").json()
    assert shown["photo_url"].startswith("http://localhost:8100/photos/")
    assert (
        auth_client.get(shown["photo_url"].removeprefix("http://localhost:8100")).status_code == 200
    )
    # Still sealed: no photo yet.
    assert auth_client.get(f"/letters/{_token(sealed['url'])}").json()["photo_url"] is None


def test_someone_elses_photo_cant_be_used(auth_client: AuthClient, checker: Checker) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    photo_id = _upload(auth_client, _jpeg()).json()["id"]
    auth_client.post("/auth/logout")
    auth_client.use_csrf()
    auth_client.sign_up("bola_demo@example.com", "bola_demo")
    stolen = auth_client.post(
        "/experiences", json={**NOTE, "content": {**NOTE["content"], "photo": photo_id}}
    )
    assert stolen.status_code == 400
    assert auth_client.get(f"/photos/{photo_id}/link").status_code == 404


def test_deleting_the_account_deletes_the_photo_files(
    auth_client: AuthClient, checker: Checker, tmp_path: Path
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    _upload(auth_client, _jpeg())
    assert len(_files(tmp_path)) == 1
    deleted = auth_client.post("/me/delete", json={"confirm_username": "ada_demo"})
    assert deleted.status_code == 204
    assert _files(tmp_path) == []


def test_the_sweep_removes_unused_and_orphaned_photos(
    auth_client: AuthClient, checker: Checker, tmp_path: Path
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    unused = _upload(auth_client, _jpeg()).json()["id"]
    used = _upload(auth_client, _jpeg()).json()["id"]
    auth_client.post("/experiences", json={**NOTE, "content": {**NOTE["content"], "photo": used}})
    orphan = tmp_path / "photos" / "leftover.jpg"
    orphan.write_bytes(b"x")
    old = time.time() - 3 * 3600
    for path in _files(tmp_path):
        os.utime(path, (old, old))
    settings = _settings(auth_client)

    async def run() -> tuple[int, set[str]]:
        engine = create_async_engine(settings.database_url.get_secret_value(), poolclass=NullPool)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            await db.execute(update(Photo).values(created_at=datetime.now(UTC) - timedelta(days=2)))
            await db.commit()
        removed = await photos.sweep(sessions, photos.LocalStorage(str(tmp_path)))
        async with sessions() as db:
            left = {str(i) for i in (await db.execute(select(Photo.id))).scalars()}
        await engine.dispose()
        return removed, left

    removed, left = asyncio.run(run())
    assert removed == 2  # the unused photo and the leftover file
    assert left == {used}
    assert unused not in left and len(_files(tmp_path)) == 1
