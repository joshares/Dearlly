"""Two players, two connections: a whole game played live, plus who may join and connect."""

import asyncio
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from starlette.testclient import WebSocketTestSession

from app.api import games as games_api
from app.models import Game, GameSeen

from .conftest import AuthClient

ORIGIN = "http://localhost:3100"
ADA, TOLU, BISI = "ada_demo@example.com", "tolu_demo@example.com", "bisi_demo@example.com"


def _login(client: AuthClient, email: str, username: str | None = None) -> str:
    """Logs in (signing up if needed) and returns that person's access cookie."""
    client.cookies.clear()
    client.use_csrf()
    if username:
        client.sign_up(email, username)
    else:
        code = client.request_code(email)
        client.post("/auth/verify", json={"email": email, "code": code})
    client.use_csrf()
    return str(client.cookies.get("dl_access"))


def _as(client: AuthClient, access: str) -> None:
    client.replace_cookies(dl_access=access)
    client.use_csrf()


@contextmanager
def _connect(client: AuthClient, code: str, access: str, origin: str = ORIGIN) -> Iterator[Any]:
    client.cookies.clear()
    headers = {"origin": origin, "cookie": f"dl_access={access}"}
    with client.websocket_connect(f"/games/{code}/live", headers=headers) as ws:
        yield ws


def until(ws: WebSocketTestSession, check: Callable[[dict[str, Any]], bool]) -> dict[str, Any]:
    """Reads messages until one passes the check (live games send many small updates)."""
    for _ in range(50):
        message: dict[str, Any] = ws.receive_json()
        if check(message):
            return message
    raise AssertionError("expected message never came")


def state_where(check: Callable[[dict[str, Any]], bool]) -> Callable[[dict[str, Any]], bool]:
    return lambda m: m.get("t") == "state" and check(m["state"])


def _game_rows(client: AuthClient) -> tuple[int, int, dict[str, Any] | None]:
    settings = client.app.state.settings  # type: ignore[attr-defined]

    async def run() -> tuple[int, int, dict[str, Any] | None]:
        engine = create_async_engine(settings.database_url.get_secret_value(), poolclass=NullPool)
        async with async_sessionmaker(engine)() as db:
            seen = (await db.execute(select(func.count()).select_from(GameSeen))).scalar_one()
            games = (await db.execute(select(Game).order_by(Game.created_at))).scalars().all()
        await engine.dispose()
        return seen, len(games), games[0].result if games else None

    return asyncio.run(run())


def _new_game(client: AuthClient, host: str, guest: str, **body: Any) -> str:
    _as(client, host)
    created = client.post(
        "/games", json={"format": "same_page", "intensity": "romantic", "rounds": 3, **body}
    )
    assert created.status_code == 201, created.text
    code: str = created.json()["code"]
    _as(client, guest)
    joined = client.post(f"/games/{code}/join", json={"intense_ok": True})
    assert joined.status_code == 200, joined.text
    assert joined.json()["you"] == "guest"
    return code


def _play_through(client: AuthClient, code: str, ada: str, tolu: str) -> list[str]:
    """Both ready, both answer every round, the host moves on. Returns the questions played."""
    played = []
    with _connect(client, code, ada) as host, _connect(client, code, tolu) as guest:
        until(host, lambda m: m.get("t") == "chat_history")
        until(guest, lambda m: m.get("t") == "chat_history")
        host.send_json({"t": "ready"})
        guest.send_json({"t": "ready"})
        until(host, state_where(lambda s: s["status"] == "playing"))
        for number in range(1, 4):
            at_round = state_where(lambda s, n=number: (s["round"] or {}).get("number") == n)
            seen = until(guest, at_round)["state"]["round"]
            played.append(seen["text"])
            host.send_json({"t": "answer", "value": 0})
            waiting = until(guest, state_where(lambda s: bool(s["round"]["answered"])))
            # Tolu sees that Ada answered, but not what.
            assert waiting["state"]["round"]["answers"] is None
            guest.send_json({"t": "answer", "value": 0})
            shown = until(host, state_where(lambda s: s["round"]["revealed"]))["state"]["round"]
            assert shown["match"] is True and len(shown["answers"]) == 2
            host.send_json({"t": "next"})
        ended = until(guest, state_where(lambda s: s["status"] == "ended"))
        assert ended["state"]["summary"]["matched"] == 3
    return played


def test_a_whole_game_live_with_chat(auth_client: AuthClient) -> None:
    ada = _login(auth_client, ADA, "ada_demo")
    tolu = _login(auth_client, TOLU, "tolu_demo")
    code = _new_game(auth_client, ada, tolu)

    with _connect(auth_client, code, ada) as host, _connect(auth_client, code, tolu) as guest:
        lobby = until(
            host,
            state_where(
                lambda s: len(s["players"]) == 2 and all(p["online"] for p in s["players"])
            ),
        )
        assert lobby["state"]["status"] == "lobby"
        # The keep-alive is quietly accepted (no error back).
        host.send_json({"t": "ping"})
        # Chat goes to both, from the one who sent it.
        host.send_json({"t": "chat", "text": "Ready when you are 😊"})
        said = until(guest, lambda m: m.get("t") == "chat")
        assert until(host, lambda m: m.get("t") in ("chat", "error"))["t"] == "chat"
        assert said["text"] == "Ready when you are 😊" and said["name"] == "ada_demo"
        guest.send_json({"t": "chat", "text": "visit www.scam.example"})
        assert "links" in until(guest, lambda m: m.get("t") == "error")["detail"]
        # Only the host moves on.
        guest.send_json({"t": "ready"})
        host.send_json({"t": "ready"})
        until(guest, state_where(lambda s: s["status"] == "playing"))
        guest.send_json({"t": "next"})
        assert "Only the host" in until(guest, lambda m: m.get("t") == "error")["detail"]
        host.send_json({"t": "end"})
        until(guest, state_where(lambda s: s["status"] == "ended"))


def test_a_pair_gets_new_questions_next_game(auth_client: AuthClient) -> None:
    ada = _login(auth_client, ADA, "ada_demo")
    tolu = _login(auth_client, TOLU, "tolu_demo")
    first = _play_through(auth_client, _new_game(auth_client, ada, tolu), ada, tolu)
    second = _play_through(auth_client, _new_game(auth_client, ada, tolu), ada, tolu)
    assert not set(first) & set(second)
    seen, games, result = _game_rows(auth_client)
    assert seen == 6 and games == 2
    assert result and result["matched"] == 3


def test_who_can_join_and_connect(auth_client: AuthClient) -> None:
    ada = _login(auth_client, ADA, "ada_demo")
    tolu = _login(auth_client, TOLU, "tolu_demo")
    bisi = _login(auth_client, BISI, "bisi_demo")

    _as(auth_client, ada)
    intense = auth_client.post(
        "/games", json={"format": "same_page", "intensity": "intense", "rounds": 3}
    )
    code = intense.json()["code"]
    _as(auth_client, tolu)
    refused = auth_client.post(f"/games/{code}/join", json={})
    assert refused.status_code == 400 and "Intense" in refused.json()["detail"]
    assert auth_client.post(f"/games/{code}/join", json={"intense_ok": True}).status_code == 200
    _as(auth_client, bisi)
    assert auth_client.post(f"/games/{code}/join", json={"intense_ok": True}).status_code == 409
    assert auth_client.get(f"/games/{code}").json()["you"] == "visitor"
    assert auth_client.get("/games/ZZZZZZ").status_code == 404

    # Not a player, another site, or not logged in: no live connection.
    for access, origin, closed_with in (
        (bisi, ORIGIN, 4403),
        (ada, "https://evil.example", 4403),
        ("not-a-token", ORIGIN, 4401),
    ):
        try:
            with _connect(auth_client, code, access, origin) as ws:
                ws.receive_json()
        except Exception as exc:  # noqa: BLE001 - the test client raises on a refused connection
            assert getattr(exc, "code", None) == closed_with, exc
        else:
            raise AssertionError("connection should have been refused")


def test_library_lists_every_game_and_creating_needs_enough_questions(
    auth_client: AuthClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    formats = auth_client.get("/games/formats").json()
    assert formats[0]["key"] == "mix"
    assert {f["key"] for f in formats} >= {
        "same_page",
        "truth_dare",
        "love_language",
        "get_to_know",
    }
    ada = _login(auth_client, ADA, "ada_demo")
    _as(auth_client, ada)
    # The real bank has plenty everywhere; pretend this game only has 10 questions.
    monkeypatch.setattr(games_api, "_pool_size", lambda *_: 10)
    too_many = auth_client.post(
        "/games", json={"format": "love_language", "intensity": "romantic", "rounds": 20}
    )
    assert too_many.status_code == 400 and "fewer rounds" in too_many.json()["detail"]
