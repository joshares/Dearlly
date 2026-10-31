"""Secret admirer: hidden name until revealed, tight limits, no photos, one-tap block."""

import re
from typing import Any

from .conftest import AuthClient
from .test_experiences import NOTE, SENDER, _become_recipient, _create, _token
from .test_letter_mail import Outbox, _run_worker, outbox, settings  # noqa: F401 (fixtures)

TOLU = "tolu_demo@example.com"


def _secret(client: AuthClient, **changes: Any) -> Any:
    return client.post("/experiences", json={**NOTE, "secret": True, **changes})


def test_the_name_stays_hidden_until_revealed(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    created = _secret(auth_client)
    assert created.status_code == 201, created.text
    mine = created.json()
    assert (mine["secret"], mine["revealed"], mine["blocked"]) == (True, False, False)
    token = _token(mine["url"])

    # The sender sees their own name (and that it's secret).
    own = auth_client.get(f"/letters/{token}").json()
    assert own["sender_name"] == "Ada" and own["secret"] is True

    _become_recipient(auth_client)
    shown = auth_client.get(f"/letters/{token}").json()
    assert shown["sender_name"] == "A secret admirer"
    assert shown["secret"] is True
    assert "Ada" not in str(shown)

    code = auth_client.request_code(SENDER)
    auth_client.post("/auth/verify", json={"email": SENDER, "code": code})
    auth_client.use_csrf()
    revealed = auth_client.post(f"/me/experiences/{mine['id']}/reveal").json()
    assert revealed["revealed"] is True
    _become_recipient(auth_client)
    shown = auth_client.get(f"/letters/{token}").json()
    assert shown["sender_name"] == "Ada" and shown["secret"] is False


def test_limits_love_notes_only_no_photos_three_a_day(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    date = {"type": "date_invite", "content": {"message": "Hi", "city": "lagos"}}
    assert "Only love notes" in _secret(auth_client, **date).json()["detail"]
    photo = {"content": {**NOTE["content"], "photo": "6f1c8f9e-0000-4000-8000-000000000000"}}
    assert "can't have photos" in _secret(auth_client, **photo).json()["detail"]
    for _ in range(3):
        assert _secret(auth_client).status_code == 201
    over = _secret(auth_client)
    assert over.status_code == 400 and "3 secret admirer letters a day" in over.json()["detail"]
    # Letters with their name aren't limited by this.
    assert _create(auth_client)["secret"] is False


def test_one_tap_block(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    named = _token(_create(auth_client)["url"])
    tokens = [_token(_secret(auth_client).json()["url"]) for _ in range(3)]
    # The sender can't block their own letter.
    assert auth_client.post(f"/letters/{tokens[0]}/block").status_code == 409

    _become_recipient(auth_client)
    auth_client.use_csrf()
    assert auth_client.post(f"/letters/{named}/block").status_code == 400  # not secret: report it
    for token in tokens:
        assert auth_client.post(f"/letters/{token}/block").status_code == 204
        assert auth_client.get(f"/letters/{token}").status_code == 404  # gone for good

    # Three blocks: secret admirer is switched off for Ada; named letters still work.
    code = auth_client.request_code(SENDER)
    auth_client.post("/auth/verify", json={"email": SENDER, "code": code})
    auth_client.use_csrf()
    off = _secret(auth_client)
    assert off.status_code == 400 and "switched off" in off.json()["detail"]
    mine = auth_client.get("/me/experiences").json()["items"]
    assert sum(1 for m in mine if m["blocked"]) == 3
    assert all(m["url"] is None for m in mine if m["blocked"])


def test_emails_never_name_a_secret_admirer(
    auth_client: AuthClient,
    outbox: Outbox,  # noqa: F811
    settings: Any,  # noqa: F811
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    created = _secret(auth_client, recipient_email=TOLU).json()
    assert _run_worker(settings) == 1
    [email] = outbox.sent
    assert email.subject == "A secret admirer sealed a letter for you 💌"
    for part in (email.text, email.html):
        assert "Ada" not in part and "ada_demo" not in part
        assert "a secret admirer (Dearlly knows who they are)" in part
    stop = re.search(r"/unsubscribe\?t=([\w.-]+)", email.text)
    assert stop
    _become_recipient(auth_client)
    assert auth_client.get(f"/email/unsubscribe/{stop.group(1)}").json() == {
        "sender": "this secret admirer"
    }

    # Blocking an emailed letter also stops Ada emailing this address.
    auth_client.use_csrf()
    assert auth_client.post(f"/letters/{_token(created['url'])}/block").status_code == 204
    code = auth_client.request_code(SENDER)
    auth_client.post("/auth/verify", json={"email": SENDER, "code": code})
    auth_client.use_csrf()
    again = auth_client.post("/experiences", json={**NOTE, "recipient_email": TOLU}).json()
    assert again["email_status"] == "blocked"


def test_a_revealed_or_blocked_letter_cant_be_revealed_again(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    named = _create(auth_client)
    assert auth_client.post(f"/me/experiences/{named['id']}/reveal").status_code == 400
