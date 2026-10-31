"""The admin page's API: only admins, and each tool does what it says."""

import asyncio
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app import admin as admin_cli
from app.core.config import Settings
from app.games.bank import bank
from app.models import GameQuestionStat

from .conftest import AuthClient
from .test_experiences import SENDER, _become_recipient, _create, _token

FOUNDER = "founder_demo@example.com"


def _settings(client: AuthClient) -> Settings:
    settings: Settings = client.app.state.settings  # type: ignore[attr-defined]
    return settings


def _make_admin(client: AuthClient, monkeypatch: pytest.MonkeyPatch, email: str) -> None:
    monkeypatch.setattr(admin_cli, "get_settings", lambda: _settings(client))
    assert admin_cli.main(["make-admin", email]) == 0


def _log_in(client: AuthClient, email: str) -> None:
    client.cookies.clear()
    client.use_csrf()
    code = client.request_code(email)
    client.post("/auth/verify", json={"email": email, "code": code})
    client.use_csrf()


@pytest.fixture
def founder(auth_client: AuthClient, monkeypatch: pytest.MonkeyPatch) -> AuthClient:
    """Ada sends a letter; a recipient reports it; the founder (admin) is logged in."""
    auth_client.sign_up(SENDER, "ada_demo")
    letter = _create(auth_client)
    _become_recipient(auth_client)
    auth_client.use_csrf()
    assert (
        auth_client.post(
            f"/letters/{_token(letter['url'])}/report",
            json={"reason": "scam", "note": "Asked for money"},
        ).status_code
        == 204
    )
    auth_client.cookies.clear()
    auth_client.use_csrf()
    auth_client.sign_up(FOUNDER, "founder_demo")
    _make_admin(auth_client, monkeypatch, FOUNDER)
    _log_in(auth_client, FOUNDER)
    return auth_client


def test_only_admins_get_in(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    assert auth_client.get("/me").json()["is_admin"] is False
    for path in ("/admin/overview", "/admin/reports", "/admin/questions", "/admin/users?q=ad"):
        assert auth_client.get(path).status_code == 404
    auth_client.post("/auth/logout")
    assert auth_client.get("/admin/overview").status_code == 401


def test_overview(founder: AuthClient) -> None:
    assert founder.get("/me").json()["is_admin"] is True
    data = founder.get("/admin/overview").json()
    assert data["users"]["total"] == 2
    assert data["letters"]["total"] == 1 and data["letters"]["by_type"] == {"love_note": 1}
    assert data["open_reports"] == 1


def test_take_down_a_reported_letter(founder: AuthClient) -> None:
    [report] = founder.get("/admin/reports").json()
    assert report["reason"] == "scam" and report["sender"] == "@ada_demo"
    assert report["letter"]["content"]["quote_text"].startswith("Out of everybody")
    assert founder.post(f"/admin/reports/{report['id']}/takedown").status_code == 204
    assert founder.get("/admin/reports").json() == []
    [done] = founder.get("/admin/reports?show=resolved").json()
    assert done["resolution"] == "taken_down" and done["letter"]["taken_down"] is True


def test_dismiss_a_report(founder: AuthClient) -> None:
    [report] = founder.get("/admin/reports").json()
    assert founder.post(f"/admin/reports/{report['id']}/dismiss").status_code == 204
    [done] = founder.get("/admin/reports?show=resolved").json()
    assert done["resolution"] == "dismissed" and done["letter"]["taken_down"] is False


def test_questions_can_be_found_and_retired(founder: AuthClient) -> None:
    page = founder.get("/admin/questions").json()
    assert page["total"] == len(bank().questions) and len(page["items"]) == 50
    found = founder.get(
        "/admin/questions", params={"q": "best day of the week", "game": "same_page"}
    ).json()
    key = found["items"][0]["key"]
    assert (
        founder.post(f"/admin/questions/{key}/retired", json={"retired": True}).status_code == 204
    )
    retired = founder.get("/admin/questions?sort=retired").json()["items"]
    assert [q["key"] for q in retired] == [key]
    assert founder.post("/admin/questions/nope/retired", json={"retired": True}).status_code == 404

    settings = _settings(founder)

    async def flag() -> Any:
        engine = create_async_engine(settings.database_url.get_secret_value(), poolclass=NullPool)
        async with async_sessionmaker(engine)() as db:
            row = await db.get(GameQuestionStat, key)
        await engine.dispose()
        return row

    assert asyncio.run(flag()).retired is True


def test_find_an_account(founder: AuthClient) -> None:
    [ada] = founder.get("/admin/users", params={"q": "@ada"}).json()
    assert ada["email"] == SENDER and ada["letters"] == 1 and ada["reports_against"] == 1
    assert founder.get("/admin/users", params={"q": "zzz"}).json() == []


def test_make_admin_command(auth_client: AuthClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(admin_cli, "get_settings", lambda: _settings(auth_client))
    assert admin_cli.main(["make-admin", "nobody_demo@example.com"]) == 0  # explains, no crash
    assert admin_cli.main(["make-admin", "not-an-email"]) == 2
    auth_client.sign_up(SENDER, "ada_demo")
    assert admin_cli.main(["make-admin", SENDER.upper()]) == 0
    assert auth_client.get("/me").json()["is_admin"] is True
    assert admin_cli.main(["remove-admin", SENDER]) == 0
    assert auth_client.get("/me").json()["is_admin"] is False
