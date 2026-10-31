"""Emailing letters: delivery, schedules, "stop" requests, the daily cap, reports."""

import asyncio
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app import admin
from app.api import experiences as experiences_api
from app.core.config import Settings
from app.models import Experience, Report
from app.services import letter_mail
from app.services.email import Email, EmailDeliveryError

from .conftest import AuthClient
from .test_experiences import SENDER, _become_recipient, _create, _token

TOLU = "tolu_demo@example.com"


class Outbox:
    def __init__(self) -> None:
        self.sent: list[Email] = []
        self.fail = False

    async def send(self, _http: object, _settings: Settings, email: Email) -> None:
        if self.fail:
            raise EmailDeliveryError
        self.sent.append(email)


@pytest.fixture
def outbox(monkeypatch: pytest.MonkeyPatch) -> Outbox:
    box = Outbox()
    monkeypatch.setattr(letter_mail, "send_email", box.send)
    monkeypatch.setattr(experiences_api, "send_email", box.send)
    return box


def _run_worker(settings: Settings, now: datetime | None = None) -> int:
    """What the Celery task does every 30 seconds."""

    async def run() -> int:
        engine = create_async_engine(settings.database_url.get_secret_value(), poolclass=NullPool)
        try:
            async with httpx.AsyncClient() as http:
                return await letter_mail.send_due_letter_emails(
                    async_sessionmaker(engine, expire_on_commit=False), http, settings, now
                )
        finally:
            await engine.dispose()

    return asyncio.run(run())


def _row(settings: Settings, experience_id: str) -> Experience:
    async def run() -> Experience:
        engine = create_async_engine(settings.database_url.get_secret_value(), poolclass=NullPool)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                found = await db.get(Experience, uuid.UUID(experience_id))
                assert found is not None
                return found
        finally:
            await engine.dispose()

    return asyncio.run(run())


def _stop_token(email: Email) -> str:
    match = re.search(r"/unsubscribe\?t=([\w.-]+)", email.text)
    assert match
    return match.group(1)


@pytest.fixture
def settings(auth_client: AuthClient) -> Settings:
    app_settings: Settings = auth_client.app.state.settings  # type: ignore[attr-defined]
    return app_settings


def test_the_letter_is_emailed_and_the_address_forgotten(
    auth_client: AuthClient, outbox: Outbox, settings: Settings
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    created = _create(auth_client, recipient_email=" Tolu_Demo@Example.com ")
    assert created["email_status"] == "scheduled"
    assert _run_worker(settings) == 1

    [email] = outbox.sent
    assert email.to == TOLU
    assert email.subject == "Ada sealed a letter for you 💌"
    assert created["url"] in email.text and created["url"] in email.html
    # The words stay behind the seal.
    assert "Na you" not in email.text and "Na you" not in email.html
    for label in ("Report this letter", "Stop messages from this sender", "Never email me again"):
        assert label in email.text and label in email.html
    assert "/privacy" in email.text and "/privacy" in email.html
    assert "@ada_demo" in email.text
    assert email.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert email.headers["List-Unsubscribe"].startswith("<http://localhost:8100/email/one-click/")

    row = _row(settings, created["id"])
    assert row.email_status == "sent" and row.email_sent_at is not None
    assert row.recipient_email_encrypted is None  # used once, then deleted
    mine = auth_client.get("/me/experiences").json()["items"][0]
    assert mine["email_status"] == "sent"
    assert _run_worker(settings) == 0  # never twice


def test_scheduled_letters_are_emailed_when_they_open(
    auth_client: AuthClient, outbox: Outbox, settings: Settings
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    opens = (datetime.now(UTC) + timedelta(hours=5)).replace(microsecond=0)
    _create(auth_client, recipient_email=TOLU, opens_at=opens.isoformat())
    assert _run_worker(settings) == 0
    assert _run_worker(settings, now=opens + timedelta(seconds=1)) == 1
    assert outbox.sent[0].to == TOLU


def test_stop_messages_from_one_sender(
    auth_client: AuthClient, outbox: Outbox, settings: Settings
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    _create(auth_client, recipient_email=TOLU)
    _run_worker(settings)
    stop = _stop_token(outbox.sent[0])
    later = (datetime.now(UTC) + timedelta(hours=5)).replace(microsecond=0)
    waiting = _create(auth_client, recipient_email=TOLU, opens_at=later.isoformat())

    _become_recipient(auth_client)
    auth_client.use_csrf()
    assert auth_client.get(f"/email/unsubscribe/{stop}").json() == {"sender": "@ada_demo"}
    assert (
        auth_client.post(f"/email/unsubscribe/{stop}", json={"scope": "sender"}).status_code == 204
    )
    # The letter already waiting is cancelled, and new ones aren't emailed.
    assert _row(settings, waiting["id"]).email_status == "blocked"
    assert _row(settings, waiting["id"]).recipient_email_encrypted is None

    code = auth_client.request_code(SENDER)
    auth_client.post("/auth/verify", json={"email": SENDER, "code": code})
    assert _create(auth_client, recipient_email=TOLU)["email_status"] == "blocked"
    # Someone else can still email them.
    auth_client.post("/auth/logout")
    auth_client.use_csrf()
    auth_client.sign_up("bola_demo@example.com", "bola_demo")
    assert _create(auth_client, recipient_email=TOLU)["email_status"] == "scheduled"


def test_never_email_me_and_one_click(
    auth_client: AuthClient, outbox: Outbox, settings: Settings
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    _create(auth_client, recipient_email=TOLU)
    _create(auth_client, recipient_email="kemi_demo@example.com")
    _run_worker(settings)
    tolu = next(e for e in outbox.sent if e.to == TOLU)
    kemi = next(e for e in outbox.sent if e.to != TOLU)

    _become_recipient(auth_client)
    auth_client.headers.pop("X-CSRF-Token", None)
    # Never: no CSRF token needed (the signed link is the key).
    assert (
        auth_client.post(
            f"/email/unsubscribe/{_stop_token(tolu)}", json={"scope": "all"}
        ).status_code
        == 204
    )
    # One-click from the mail app, exactly as Gmail sends it.
    one_click = kemi.headers["List-Unsubscribe"].strip("<>").removeprefix("http://localhost:8100")
    response = auth_client.post(
        one_click,
        content="List-Unsubscribe=One-Click",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 204
    assert auth_client.get("/email/unsubscribe/not-a-token").status_code == 404

    auth_client.use_csrf()
    auth_client.sign_up("bola_demo@example.com", "bola_demo")
    assert _create(auth_client, recipient_email=TOLU)["email_status"] == "blocked"  # nobody
    assert (
        _create(auth_client, recipient_email="kemi_demo@example.com")["email_status"] == "scheduled"
    )


def test_daily_cap_and_bad_addresses(auth_client: AuthClient, outbox: Outbox) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    bad = auth_client.post("/experiences", json={**_note(), "recipient_email": "tolu@"})
    assert bad.status_code == 400
    for i in range(letter_mail.EMAILS_PER_DAY):
        _create(auth_client, recipient_email=f"friend{i}_demo@example.com")
    over = auth_client.post("/experiences", json={**_note(), "recipient_email": TOLU})
    assert over.status_code == 400
    assert "10 letters a day" in over.json()["detail"]
    # Sharing the link has no cap.
    assert _create(auth_client)["email_status"] is None


def _note() -> dict[str, Any]:
    from .test_experiences import NOTE

    return dict(NOTE)


def test_taking_back_cancels_the_email(
    auth_client: AuthClient, outbox: Outbox, settings: Settings
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    created = _create(auth_client, recipient_email=TOLU)
    revoked = auth_client.post(f"/me/experiences/{created['id']}/revoke").json()
    assert revoked["email_status"] == "cancelled"
    assert _run_worker(settings) == 0 and outbox.sent == []
    assert _row(settings, created["id"]).recipient_email_encrypted is None


def test_failed_deliveries_retry_then_give_up(
    auth_client: AuthClient, outbox: Outbox, settings: Settings
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    created = _create(auth_client, recipient_email=TOLU)
    outbox.fail = True
    for _ in range(letter_mail.MAX_ATTEMPTS - 1):
        _run_worker(settings)
    assert _row(settings, created["id"]).email_status == "scheduled"  # still trying
    _run_worker(settings)
    row = _row(settings, created["id"])
    assert row.email_status == "failed" and row.recipient_email_encrypted is None


def test_reports_are_saved_and_sent_to_the_founder(
    auth_client: AuthClient, outbox: Outbox, settings: Settings
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    created = _create(auth_client)
    token = _token(created["url"])
    _become_recipient(auth_client)
    assert auth_client.post(f"/letters/{token}/report", json={"reason": "nope"}).status_code == 400
    response = auth_client.post(
        f"/letters/{token}/report", json={"reason": "scam", "note": "Asked me for money"}
    )
    assert response.status_code == 204

    [email] = outbox.sent
    assert email.to == settings.reports_to and email.subject == "Dearlly report: scam"
    assert "Asked me for money" in email.text and "@ada_demo" in email.text
    assert f"python -m app.admin takedown {created['id']}" in email.text
    assert "http://localhost:3100/admin" in email.text

    async def saved() -> list[Report]:
        engine = create_async_engine(settings.database_url.get_secret_value(), poolclass=NullPool)
        async with async_sessionmaker(engine)() as db:
            rows = list((await db.execute(select(Report))).scalars())
        await engine.dispose()
        return rows

    [report] = asyncio.run(saved())
    assert report.reason == "scam" and str(report.experience_id) == created["id"]


def test_founder_can_take_a_letter_down(
    auth_client: AuthClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    created = _create(auth_client)
    monkeypatch.setattr(admin, "get_settings", lambda: settings)
    assert admin.main(["takedown", created["id"]]) == 0
    assert admin.main(["takedown", "nonsense"]) == 2
    _become_recipient(auth_client)
    assert auth_client.get(f"/letters/{_token(created['url'])}").status_code == 404
