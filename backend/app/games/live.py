"""Live games: the state in Redis, one move at a time, and news sent to both phones.

- The state lives in Redis (`game:<id>:state`, kept 24 hours) and only changes under a per-game
  lock, so two moves can never trample each other.
- After every move, a note goes out on the game's channel; each connected phone then loads the state
  and sends its own player their own view (see engine.view). Chat goes out the same way.
- Questions a pair has played are saved in the database, so the next game deals new ones.
"""

import asyncio
import json
import random
import secrets
import time
import uuid
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any, cast

from redis.asyncio import Redis
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.games.bank import Bank, Question
from app.games.engine import Game as Rules
from app.games.engine import GameState, MoveError, summary
from app.models import Game, GameQuestionStat, GameSeen

TTL = 24 * 3600
CHAT_KEEP = 100
CHAT_SEND = 50

_pick_random = random.SystemRandom()


async def _wait[T](result: Awaitable[T] | T) -> T:
    """redis-py's types cover its normal and async clients at once; ours is always async."""
    return await cast(Awaitable[T], result)


def _key(game_id: uuid.UUID, part: str) -> str:
    return f"game:{game_id}:{part}"


def channel(game_id: uuid.UUID) -> str:
    return f"game:{game_id}"


async def load(redis: Redis, game_id: uuid.UUID) -> GameState | None:
    raw = await redis.get(_key(game_id, "state"))
    return GameState.model_validate_json(raw) if raw else None


async def save(redis: Redis, game_id: uuid.UUID, state: GameState) -> None:
    await redis.set(_key(game_id, "state"), state.model_dump_json(), ex=TTL)


class Busy(RuntimeError):
    """The game was busy for too long (a move got stuck); the player can simply try again."""


@asynccontextmanager
async def locked(redis: Redis, game_id: uuid.UUID) -> AsyncIterator[None]:
    """One move at a time per game. The lock frees itself after 10 seconds if a server dies
    mid-move, and only its holder releases it."""
    key, token = _key(game_id, "lock"), secrets.token_hex(8)
    deadline = time.monotonic() + 5
    while not await redis.set(key, token, nx=True, px=10_000):
        if time.monotonic() > deadline:
            raise Busy("The game is busy. Try again.")
        await asyncio.sleep(0.02)
    try:
        yield
    finally:
        held = await redis.get(key)
        if held in (token, token.encode()):
            await redis.delete(key)


async def announce(redis: Redis, game_id: uuid.UUID, event: dict[str, Any]) -> None:
    await redis.publish(channel(game_id), json.dumps(event))


# --- who's connected ---------------------------------------------------------------------------


async def came_online(redis: Redis, game_id: uuid.UUID, player_id: str) -> None:
    key = _key(game_id, "online")
    await _wait(redis.hincrby(key, player_id, 1))
    await redis.expire(key, TTL)


async def went_offline(redis: Redis, game_id: uuid.UUID, player_id: str) -> None:
    key = _key(game_id, "online")
    if await _wait(redis.hincrby(key, player_id, -1)) <= 0:
        await _wait(redis.hdel(key, player_id))


async def online(redis: Redis, game_id: uuid.UUID) -> set[str]:
    found: dict[bytes | str, Any] = await _wait(redis.hgetall(_key(game_id, "online")))
    return {k.decode() if isinstance(k, bytes) else k for k in found}


# --- chat ------------------------------------------------------------------------------------


async def add_chat(redis: Redis, game_id: uuid.UUID, message: dict[str, Any]) -> None:
    key = _key(game_id, "chat")
    await _wait(redis.rpush(key, json.dumps(message)))
    await _wait(redis.ltrim(key, -CHAT_KEEP, -1))
    await redis.expire(key, TTL)


async def recent_chat(redis: Redis, game_id: uuid.UUID) -> list[dict[str, Any]]:
    raw = await _wait(redis.lrange(_key(game_id, "chat"), -CHAT_SEND, -1))
    return [json.loads(item) for item in raw]


async def forget(redis: Redis, game_id: uuid.UUID) -> None:
    """Once a game is over, its chat and live state stay an hour (to talk about the results),
    then go. Only the result is kept, in the database."""
    for part in ("state", "chat", "online"):
        await redis.expire(_key(game_id, part), 3600)


# --- dealing ---------------------------------------------------------------------------------


def pair(a: uuid.UUID, b: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    return (a, b) if str(a) < str(b) else (b, a)


async def seen_by_pair(db: AsyncSession, players: list[str]) -> set[str]:
    if len(players) != 2:
        return set()
    low, high = pair(uuid.UUID(players[0]), uuid.UUID(players[1]))
    rows = await db.execute(
        select(GameSeen.question_key).where(GameSeen.user_low == low, GameSeen.user_high == high)
    )
    return set(rows.scalars())


async def retired(db: AsyncSession) -> set[str]:
    rows = await db.execute(
        select(GameQuestionStat.question_key).where(GameQuestionStat.retired.is_(True))
    )
    return set(rows.scalars())


def make_picker(bank: Bank, intensity: str, seen: set[str], retired_keys: set[str]) -> Any:
    """New questions first; the pair only sees repeats once every question has been played.
    Within those, the one closest to the depth this round wants (ties broken at random)."""

    def pick(fmt: str, kind: str | None, depth: int, avoid: set[str]) -> Question | None:
        pool = [
            q
            for q in bank.pool(fmt, intensity)  # type: ignore[arg-type]
            if q.kind == kind and q.key not in avoid and q.key not in retired_keys
        ]
        fresh = [q for q in pool if q.key not in seen]
        candidates = fresh or pool
        if not candidates:
            return None
        best = min(abs(q.depth - depth) for q in candidates)
        return _pick_random.choice([q for q in candidates if abs(q.depth - depth) == best])

    return pick


async def record_dealt(db: AsyncSession, players: list[str], keys: list[str]) -> None:
    if not keys:
        return
    if len(players) == 2:
        low, high = pair(uuid.UUID(players[0]), uuid.UUID(players[1]))
        await db.execute(
            insert(GameSeen)
            .values([{"user_low": low, "user_high": high, "question_key": k} for k in keys])
            .on_conflict_do_update(
                index_elements=["user_low", "user_high", "question_key"],
                set_={"seen_at": datetime.now(UTC)},
            )
        )
    await db.execute(
        insert(GameQuestionStat)
        .values([{"question_key": k, "shown": 1} for k in keys])
        .on_conflict_do_update(
            index_elements=["question_key"],
            set_={"shown": GameQuestionStat.shown + 1},
        )
    )


async def record_skipped(db: AsyncSession, keys: list[str]) -> None:
    for key in keys:
        await db.execute(
            update(GameQuestionStat)
            .where(GameQuestionStat.question_key == key)
            .values(skipped=GameQuestionStat.skipped + 1)
        )


async def play_move(
    redis: Redis,
    sessionmaker: async_sessionmaker[AsyncSession],
    bank: Bank,
    game_id: uuid.UUID,
    move: str,
    player_id: str,
    value: Any = None,
) -> GameState:
    """Makes one move under the game's lock, saves it, records what was dealt, tells both phones.

    Raises engine.MoveError for a move that isn't allowed (nothing is changed then).
    """
    async with locked(redis, game_id):
        state = await load(redis, game_id)
        if state is None:
            raise MoveError("This game has expired.")
        before_used, before_history = len(state.used), len(state.history)
        before_status = state.status
        async with sessionmaker() as db:
            picker = make_picker(
                bank,
                state.intensity,
                await seen_by_pair(db, list(state.players)),
                await retired(db),
            )
            rules = Rules(state, bank, picker, now=time.time())
            version = state.version
            if move == "tick":
                rules.tick()
            elif move == "join":
                rules.join(player_id, str(value))
            elif move in ("answer", "pick"):
                getattr(rules, move)(player_id, value)
            elif move in ("ready", "skip", "next", "end"):
                getattr(rules, move)(player_id)
            else:
                raise MoveError("Unknown move.")
            if state.version == version:
                return state
            await save(redis, game_id, state)
            await record_dealt(db, list(state.players), state.used[before_used:])
            await record_skipped(
                db, [r.key for r in state.history[before_history:] if r.skipped and r.key]
            )
            row = await db.get(Game, game_id)
            if row is not None:
                if before_status == "lobby" and state.status == "playing":
                    row.status, row.started_at = "playing", datetime.now(UTC)
                if state.status == "ended" and row.status != "ended":
                    row.status, row.ended_at = "ended", datetime.now(UTC)
                    row.result = summary(state, bank)
            await db.commit()
    await announce(redis, game_id, {"t": "changed", "version": state.version})
    if state.status == "ended":
        await forget(redis, game_id)
    return state
