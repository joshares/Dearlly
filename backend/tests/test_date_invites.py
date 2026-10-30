"""Date invitations: a curated or typed-in place, a date, and a Yes / No answer."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from .conftest import AuthClient
from .test_experiences import SENDER, _become_recipient, _token

WHEN = (datetime.now(UTC) + timedelta(days=7)).replace(microsecond=0)

DATE: dict[str, Any] = {
    "type": "date_invite",
    "sender_name": "Ada",
    "recipient_name": "Tolu",
    "theme": "rose",
    "content": {
        "message": "Dinner with me, Saturday?",
        "city": "lagos",
        "place_key": "shiro",
        "date_at": WHEN.isoformat(),
        "note": "Wear the blue dress.",
    },
}


def _invite(client: AuthClient, **content: Any) -> Any:
    return client.post("/experiences", json={**DATE, "content": {**DATE["content"], **content}})


def test_a_curated_place_is_copied_from_our_list(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    # Whatever the browser claims, the name and address come from cities.yaml.
    created = _invite(auth_client, place_name="Fake Place", place_address="Somewhere else")
    assert created.status_code == 201, created.text
    content = created.json()["content"]
    assert content["place_name"] == "Shiro Lagos"
    assert content["place_area"] == "Victoria Island"
    assert "Water Corporation" in content["place_address"]
    assert datetime.fromisoformat(content["date_at"]) == WHEN


def test_a_typed_in_place_works_too(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    created = _invite(
        auth_client, place_key=None, place_name="Mama Put by the office", place_area="Yaba"
    )
    assert created.status_code == 201, created.text
    assert created.json()["content"]["place_name"] == "Mama Put by the office"


@pytest.mark.parametrize(
    ("content", "error"),
    [
        ({"place_key": None}, "Pick a place"),
        ({"place_key": "not-a-place"}, "isn't on our list"),
        ({"place_key": "blucabana"}, "isn't on our list"),  # an Abuja place in Lagos
        ({"city": "kano"}, "city we cover"),
        ({"date_at": "next saturday"}, "date and time"),
        ({"date_at": "2026-11-07T19:00:00"}, "date and time"),  # no time zone
        ({"date_at": (datetime.now(UTC) - timedelta(hours=1)).isoformat()}, "in the future"),
        ({"date_at": (datetime.now(UTC) + timedelta(days=400)).isoformat()}, "within a year"),
        ({"message": ""}, "Message is required"),
    ],
)
def test_bad_invitations_are_refused(
    auth_client: AuthClient, content: dict[str, Any], error: str
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    response = _invite(auth_client, **content)
    assert response.status_code == 400
    assert error in response.json()["detail"]


def test_the_date_must_be_after_the_invitation_opens(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    late = (WHEN + timedelta(days=1)).isoformat()
    response = auth_client.post("/experiences", json={**DATE, "opens_at": late})
    assert response.status_code == 400
    assert "after the invitation opens" in response.json()["detail"]


def test_they_say_yes(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    token = _token(_invite(auth_client).json()["url"])
    _become_recipient(auth_client)
    auth_client.use_csrf()

    shown = auth_client.get(f"/letters/{token}").json()
    assert shown["reply_kind"] == "yes_no"
    assert [r["key"] for r in shown["reactions"]] == ["yes", "no"]
    assert shown["content"]["place_name"] == "Shiro Lagos"

    assert (
        auth_client.post(f"/letters/{token}/reply", json={"reaction": "love_it"}).status_code == 400
    )
    reply = auth_client.post(
        f"/letters/{token}/reply", json={"reaction": "yes", "note": "Finally!"}
    )
    assert reply.status_code == 200
    assert reply.json()["reaction"] == "yes"


def test_love_notes_are_unchanged(auth_client: AuthClient) -> None:
    types = {t["key"]: t for t in auth_client.get("/experience-types").json()}
    assert types["love_note"]["reply"] == "reaction"
    assert types["date_invite"]["reply"] == "yes_no"
    assert types["date_invite"]["fields"]["date_at"]["kind"] == "datetime"
