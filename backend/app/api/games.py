"""Games: the library, creating and joining a game, and the live connection both phones play on.

Both players need an account (so a pair never gets the same question twice, and "Intense" is only
ever for two adults who both opted in). The live connection checks the login and the site the page
came from, then carries moves and chat both ways.
"""

import contextlib
import json
import logging
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import anyio
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import CurrentUser, DbSession, Limiter, user_from_cookies
from app.core.csrf import require_csrf
from app.core.ratelimit import Limit
from app.games import live
from app.games.bank import INTENSITIES, Bank, Intensity, bank
from app.games.engine import MIX, GameState, MoveError, view
from app.models import Game, User
from app.services.experiences import ExperienceError, clean_text

logger = logging.getLogger(__name__)

router = APIRouter(tags=["games"])

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no O/0 or I/1: easy to read out
CODE_LENGTH = 6
GAME_LIFETIME = timedelta(hours=24)
CREATE_PER_USER = Limit("game-create-user", max_requests=30, window_seconds=24 * 3600)
CHAT_MAX = 300
MOVES_PER_10S = 40
NOT_FOUND = "No game with that code. Check it, or ask for a new link."

# Live-connection close codes the page understands.
CLOSE_LOGIN = 4401  # log in (or refresh the login) and reconnect
CLOSE_NOT_ALLOWED = 4403
CLOSE_NOT_FOUND = 4404


class IntensityOut(BaseModel):
    key: str
    questions: int


class FormatOut(BaseModel):
    key: str
    name: str
    blurb: str
    answer: str
    seconds: int
    skips: int
    levels: list[IntensityOut]


class CreateIn(BaseModel):
    format: str = Field(max_length=32)
    intensity: Intensity
    rounds: int = Field(default=10, ge=3, le=20)


class GameOut(BaseModel):
    code: str
    format: str
    format_name: str
    intensity: str
    rounds: int
    status: str
    host_name: str
    you: str  # "host", "guest" or "visitor"
    full: bool


def _redis(conn: Request | WebSocket) -> Redis:
    redis: Redis = conn.app.state.redis
    return redis


def _sessions(conn: Request | WebSocket) -> async_sessionmaker[AsyncSession]:
    sessions: async_sessionmaker[AsyncSession] = conn.app.state.sessionmaker
    return sessions


def _name(user: User) -> str:
    return user.display_name or user.username


def _pool_size(questions: Bank, fmt: str, intensity: Intensity) -> int:
    keys = [k for k, f in questions.formats.items() if f.in_mix] if fmt == MIX else [fmt]
    return sum(len(questions.pool(k, intensity)) for k in keys)


@router.get("/games/formats")
async def list_formats() -> list[FormatOut]:
    questions = bank()
    formats = [
        FormatOut(
            key=f.key,
            name=f.name,
            blurb=f.blurb,
            answer=f.answer,
            seconds=f.seconds,
            skips=f.skips,
            levels=[
                IntensityOut(key=i, questions=_pool_size(questions, f.key, i)) for i in INTENSITIES
            ],
        )
        for f in questions.formats.values()
    ]
    mix = FormatOut(
        key=MIX,
        name="Mix",
        blurb="A bit of everything, building from light to deep.",
        answer="mix",
        seconds=0,
        skips=0,
        levels=[IntensityOut(key=i, questions=_pool_size(questions, MIX, i)) for i in INTENSITIES],
    )
    return [mix, *formats]


async def _by_code(db: DbSession, code: str) -> Game:
    game = (
        await db.execute(select(Game).where(Game.code == code.strip().upper()))
    ).scalar_one_or_none()
    if game is None or (
        game.status == "lobby" and game.created_at < datetime.now(UTC) - GAME_LIFETIME
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return game


async def _out(db: DbSession, game: Game, user: User) -> GameOut:
    host = await db.get(User, game.host_id)
    questions = bank()
    you = "host" if user.id == game.host_id else "guest" if user.id == game.guest_id else "visitor"
    return GameOut(
        code=game.code,
        format=game.format,
        format_name="Mix" if game.format == MIX else questions.formats[game.format].name,
        intensity=game.intensity,
        rounds=game.rounds,
        status=game.status,
        host_name=_name(host) if host else "Someone",
        you=you,
        full=game.guest_id is not None,
    )


@router.post("/games", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_csrf)])
async def create_game(
    body: CreateIn, request: Request, user: CurrentUser, db: DbSession, limiter: Limiter
) -> GameOut:
    await limiter.hit(CREATE_PER_USER, str(user.id))
    questions = bank()
    if body.format != MIX and body.format not in questions.formats:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick a game.")
    if _pool_size(questions, body.format, body.intensity) < body.rounds:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "There aren't enough questions for that many rounds yet. Pick fewer rounds.",
        )
    code = ""
    for _ in range(5):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        taken = await db.execute(select(func.count()).select_from(Game).where(Game.code == code))
        if not taken.scalar_one():
            break
    game = Game(
        code=code,
        host_id=user.id,
        format=body.format,
        intensity=body.intensity,
        rounds=body.rounds,
    )
    db.add(game)
    await db.commit()
    state = GameState(
        format=body.format,
        intensity=body.intensity,
        total=body.rounds,
        host=str(user.id),
        seed=secrets.token_hex(8),
    )
    await live.save(_redis(request), game.id, state)
    await live.play_move(
        _redis(request), _sessions(request), questions, game.id, "join", str(user.id), _name(user)
    )
    return await _out(db, game, user)


class JoinIn(BaseModel):
    # "Intense" games: the joining player confirms they're in (the host chose it).
    intense_ok: bool = False


@router.get("/games/{code}")
async def game_info(code: str, user: CurrentUser, db: DbSession) -> GameOut:
    return await _out(db, await _by_code(db, code), user)


@router.post("/games/{code}/join", dependencies=[Depends(require_csrf)])
async def join_game(
    code: str, body: JoinIn, request: Request, user: CurrentUser, db: DbSession
) -> GameOut:
    game = await _by_code(db, code)
    if user.id in (game.host_id, game.guest_id):
        return await _out(db, game, user)
    if game.guest_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This game already has two players.")
    if game.status != "lobby":
        raise HTTPException(status.HTTP_409_CONFLICT, "This game has already finished.")
    if game.intensity == "intense" and not body.intense_ok:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This is an Intense game: deep and flirty, never explicit. Confirm you're in to join.",
        )
    try:
        await live.play_move(
            _redis(request), _sessions(request), bank(), game.id, "join", str(user.id), _name(user)
        )
    except MoveError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    game.guest_id = user.id
    await db.commit()
    return await _out(db, game, user)


# --- the live connection ----------------------------------------------------------------------


@router.websocket("/games/{code}/live")
async def live_game(ws: WebSocket, code: str) -> None:
    settings = ws.app.state.settings
    # Only pages from our own site may connect (stops other sites riding on a player's login).
    if ws.headers.get("origin") not in settings.cors_origins:
        await ws.close(code=CLOSE_NOT_ALLOWED)
        return
    async with _sessions(ws)() as db:
        try:
            user = await user_from_cookies(ws, db, settings)
            game = await _by_code(db, code)
        except HTTPException as exc:
            close = CLOSE_LOGIN if exc.status_code == 401 else CLOSE_NOT_FOUND
            await ws.close(code=close)
            return
    if user.id not in (game.host_id, game.guest_id):
        await ws.close(code=CLOSE_NOT_ALLOWED)
        return
    await ws.accept()
    await _play(ws, game.id, str(user.id), _name(user))


async def _send_view(ws: WebSocket, game_id: uuid.UUID, me: str) -> None:
    redis = _redis(ws)
    state = await live.load(redis, game_id)
    if state is None:
        await ws.send_json({"t": "gone"})
        return
    await ws.send_json(
        {
            "t": "state",
            "state": view(state, bank(), me, await live.online(redis, game_id), time.time()),
        }
    )


async def _play(ws: WebSocket, game_id: uuid.UUID, me: str, name: str) -> None:
    redis, sessions = _redis(ws), _sessions(ws)
    pubsub = redis.pubsub()
    await pubsub.subscribe(live.channel(game_id))
    await live.came_online(redis, game_id, me)
    await live.announce(redis, game_id, {"t": "changed"})
    await _send_view(ws, game_id, me)
    await ws.send_json({"t": "chat_history", "messages": await live.recent_chat(redis, game_id)})

    async def listen() -> None:
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message is None:
                continue
            event = json.loads(message["data"])
            if event.get("t") == "changed":
                await _send_view(ws, game_id, me)
            elif event.get("t") == "chat":
                await ws.send_json(event)

    async def ticker() -> None:
        """Timed questions: reveal when time is up, even if nobody makes a move."""
        while True:
            await anyio.sleep(1)
            state = await live.load(redis, game_id)
            round_ = state.round if state else None
            if (
                round_
                and round_.deadline
                and not round_.revealed
                and time.time() >= round_.deadline
            ):
                # A reveal racing a player's move is fine: whichever comes first wins.
                with contextlib.suppress(MoveError, live.Busy):
                    await live.play_move(redis, sessions, bank(), game_id, "tick", me)

    async def receive() -> None:
        recent: list[float] = []
        last_chat = 0.0
        while True:
            try:
                raw = await ws.receive_text()
            except WebSocketDisconnect:
                return
            now = time.monotonic()
            recent = [t for t in recent if now - t < 10] + [now]
            if len(raw) > 2000 or len(recent) > MOVES_PER_10S:
                await ws.send_json({"t": "error", "detail": "Slow down a little."})
                continue
            try:
                message: dict[str, Any] = json.loads(raw)
                kind = str(message.get("t", ""))
            except (ValueError, AttributeError):
                continue
            if kind == "ping":
                # The phone's keep-alive: Cloudflare closes connections quiet for ~100 seconds.
                continue
            if kind == "chat":
                if now - last_chat < 0.4:
                    continue
                last_chat = now
                await _chat(ws, game_id, me, name, message.get("text"))
                continue
            try:
                await live.play_move(
                    redis, sessions, bank(), game_id, kind, me, message.get("value")
                )
            except (MoveError, live.Busy) as exc:
                await ws.send_json({"t": "error", "detail": str(exc)})

    try:
        async with anyio.create_task_group() as jobs:
            jobs.start_soon(listen)
            jobs.start_soon(ticker)
            await receive()  # until the player leaves
            jobs.cancel_scope.cancel()
    finally:
        # Always tell the other phone they've gone, even if the server is shutting down.
        with anyio.CancelScope(shield=True):
            await live.went_offline(redis, game_id, me)
            await live.announce(redis, game_id, {"t": "changed"})
            await pubsub.unsubscribe()
            await pubsub.aclose()  # type: ignore[no-untyped-call]  # redis-py leaves it untyped


async def _chat(ws: WebSocket, game_id: uuid.UUID, me: str, name: str, text: object) -> None:
    try:
        clean = clean_text(
            text if isinstance(text, str) else None,
            label="Message",
            max_len=CHAT_MAX,
            required=True,
        )
    except ExperienceError as exc:
        await ws.send_json({"t": "error", "detail": str(exc)})
        return
    message = {
        "t": "chat",
        "id": uuid.uuid4().hex,
        "from": me,
        "name": name,
        "text": clean,
        "at": datetime.now(UTC).isoformat(),
    }
    redis = _redis(ws)
    await live.add_chat(redis, game_id, message)
    await live.announce(redis, game_id, message)
