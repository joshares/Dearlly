"""Gift reveals: the gift waits under a scratch-off stamp; they answer with a reaction."""

from typing import Any

import pytest

from .conftest import AuthClient
from .test_experiences import SENDER, _become_recipient, _token

GIFT: dict[str, Any] = {
    "type": "gift_reveal",
    "sender_name": "Ada",
    "recipient_name": "Tolu",
    "theme": "cream",
    "content": {
        "message": "For being you.",
        "gift": "A weekend spa day for two",
        "hint": "Something to help you relax",
    },
}


def test_a_gift_is_revealed_and_thanked(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    created = auth_client.post("/experiences", json=GIFT)
    assert created.status_code == 201, created.text
    token = _token(created.json()["url"])
    _become_recipient(auth_client)
    auth_client.use_csrf()

    shown = auth_client.get(f"/letters/{token}").json()
    assert shown["reply_kind"] == "reaction"
    assert [r["key"] for r in shown["reactions"]] == [
        "love_it",
        "thank_you",
        "cant_wait",
        "you_shouldnt",
    ]
    assert shown["content"]["gift"] == "A weekend spa day for two"
    reply = auth_client.post(f"/letters/{token}/reply", json={"reaction": "thank_you"})
    assert reply.status_code == 200


@pytest.mark.parametrize(
    ("content", "error"),
    [
        ({"gift": ""}, "Gift is required"),
        ({"gift": "x" * 121}, "up to 120"),
        ({"hint": "Visit www.example.com"}, "can't contain links"),
    ],
)
def test_bad_gifts_are_refused(
    auth_client: AuthClient, content: dict[str, Any], error: str
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    body = {**GIFT, "content": {**GIFT["content"], **content}}
    response = auth_client.post("/experiences", json=body)
    assert response.status_code == 400
    assert error in response.json()["detail"]
