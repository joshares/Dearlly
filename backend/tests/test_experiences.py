"""Stage 4 core loop: write a love note, open it by link, seal a reply; sender sees the result."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from .conftest import AuthClient

SENDER = "ada_demo@example.com"

NOTE: dict[str, Any] = {
    "type": "love_note",
    "sender_name": "Ada",
    "recipient_name": "Tolu",
    "recipient_title": "my love",
    "theme": "cream",
    "content": {"quote_title": "Na you", "quote_text": "Out of everybody for this Lagos,\nna you."},
}


def _token(url: str) -> str:
    assert "/l/" in url
    return url.rsplit("/l/", 1)[1]


def _create(client: AuthClient, **changes: Any) -> dict[str, Any]:
    response = client.post("/experiences", json={**NOTE, **changes})
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def _become_recipient(client: AuthClient) -> None:
    """Same browser, logged out: like the person who got the link on WhatsApp."""
    client.replace_cookies()


# --- catalogue -------------------------------------------------------------------------------


def test_types_and_quotes_are_public(auth_client: AuthClient) -> None:
    types = auth_client.get("/experience-types").json()
    love = next(t for t in types if t["key"] == "love_note")
    assert love["fields"]["quote_text"]["required"] is True
    assert [r["key"] for r in love["reactions"]][:2] == ["love_it", "aww"]
    quotes = auth_client.get("/quotes").json()
    assert len(quotes) >= 40
    assert all(q["mood"] == "naija" for q in auth_client.get("/quotes?mood=naija").json())


# --- writing (account required) --------------------------------------------------------------


def test_writing_needs_an_account(auth_client: AuthClient) -> None:
    assert auth_client.post("/experiences", json=NOTE).status_code == 401


def test_create_gives_a_long_private_link(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    created = _create(auth_client)
    assert created["url"].startswith("http://localhost:3100/l/")
    assert len(_token(created["url"])) >= 32  # 192 bits, base64url
    assert created["content"]["quote_text"] == "Out of everybody for this Lagos,\nna you."
    assert created["open_count"] == 0 and created["reply"] is None


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"content": {"quote_text": ""}}, "required"),
        ({"content": {"quote_text": "Visit www.scam.com now"}}, "links"),
        ({"content": {"quote_text": "Send to 0123456789 GTB"}}, "account numbers"),
        ({"content": {"quote_text": "hi", "secret_field": "x"}}, "Unknown fields"),
        ({"theme": "neon"}, "theme"),
        ({"type": "spaceship"}, "type"),
        ({"recipient_name": "   "}, "required"),
        ({"opens_at": (datetime.now(UTC) - timedelta(hours=1)).isoformat()}, "future"),
    ],
)
def test_bad_letters_are_refused(
    auth_client: AuthClient, changes: dict[str, Any], message: str
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    response = auth_client.post("/experiences", json={**NOTE, **changes})
    assert response.status_code == 400
    assert message in response.json()["detail"]


# --- receiving (no account) ------------------------------------------------------------------


def test_recipient_opens_and_seals_a_reply(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    token = _token(_create(auth_client)["url"])

    _become_recipient(auth_client)
    letter = auth_client.get(f"/letters/{token}")
    assert letter.status_code == 200
    assert letter.headers["X-Robots-Tag"] == "noindex, nofollow"
    assert letter.headers["Cache-Control"] == "no-store"
    body = letter.json()
    assert body["status"] == "ready" and body["is_sender"] is False
    assert body["content"]["quote_title"] == "Na you"

    assert auth_client.post(f"/letters/{token}/open").status_code == 204
    assert auth_client.post(f"/letters/{token}/reply", json={"reaction": "nope"}).status_code == 400
    sealed = auth_client.post(
        f"/letters/{token}/reply", json={"reaction": "aww", "note": "You made my day ❤️"}
    )
    assert sealed.status_code == 200
    assert sealed.json()["reaction"] == "aww"
    again = auth_client.post(f"/letters/{token}/reply", json={"reaction": "love_it"})
    assert again.status_code == 409

    # The sender logs back in and sees Opened + the reply.
    code = auth_client.request_code(SENDER)
    auth_client.post("/auth/verify", json={"email": SENDER, "code": code})
    mine = auth_client.get("/me/experiences").json()[0]
    assert mine["open_count"] == 1 and mine["first_opened_at"] is not None
    assert mine["reply"]["reaction"] == "aww"
    assert mine["reply"]["note"] == "You made my day ❤️"


def test_sender_previews_do_not_count(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    token = _token(_create(auth_client)["url"])
    assert auth_client.get(f"/letters/{token}").json()["is_sender"] is True
    auth_client.post(f"/letters/{token}/open")
    assert auth_client.get("/me/experiences").json()[0]["open_count"] == 0
    own_reply = auth_client.post(f"/letters/{token}/reply", json={"reaction": "aww"})
    assert own_reply.status_code == 409


def test_viewing_alone_is_not_opening(auth_client: AuthClient) -> None:
    """Link previews (WhatsApp, etc.) load the page; only breaking the seal counts."""
    auth_client.sign_up(SENDER, "ada_demo")
    token = _token(_create(auth_client)["url"])
    _become_recipient(auth_client)
    auth_client.get(f"/letters/{token}")
    code = auth_client.request_code(SENDER)
    auth_client.post("/auth/verify", json={"email": SENDER, "code": code})
    assert auth_client.get("/me/experiences").json()[0]["open_count"] == 0


def test_scheduled_letters_stay_sealed(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    midnight = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0)
    token = _token(_create(auth_client, opens_at=midnight.isoformat())["url"])
    _become_recipient(auth_client)
    letter = auth_client.get(f"/letters/{token}").json()
    assert letter["status"] == "sealed_until" and letter["content"] is None
    assert letter["recipient_name"] == "Tolu"  # the envelope shows who it's for
    assert auth_client.post(f"/letters/{token}/reply", json={"reaction": "aww"}).status_code == 409


def test_unknown_or_taken_back_letters_look_the_same(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    created = _create(auth_client)
    token = _token(created["url"])
    revoked = auth_client.post(f"/me/experiences/{created['id']}/revoke").json()
    assert revoked["revoked"] is True and revoked["url"] is None
    _become_recipient(auth_client)
    gone = auth_client.get(f"/letters/{token}")
    missing = auth_client.get("/letters/" + "x" * 32)
    assert gone.status_code == missing.status_code == 404
    assert gone.json() == missing.json()


def test_only_the_owner_can_take_a_letter_back(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    created = _create(auth_client)
    auth_client.post("/auth/logout")
    auth_client.use_csrf()
    auth_client.sign_up("bola_demo@example.com", "bola_demo")
    assert auth_client.post(f"/me/experiences/{created['id']}/revoke").status_code == 404
    assert auth_client.get("/me/experiences").json() == []


def test_deleting_the_account_deletes_its_letters(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    token = _token(_create(auth_client)["url"])
    auth_client.post("/me/delete", json={"confirm_username": "ada_demo"})
    _become_recipient(auth_client)
    assert auth_client.get(f"/letters/{token}").status_code == 404
