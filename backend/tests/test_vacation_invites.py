"""Vacation invitations: a destination, the travel dates, what to pack, and Yes / No."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from .conftest import AuthClient
from .test_experiences import SENDER, _become_recipient, _token

TODAY = (datetime.now(UTC) + timedelta(hours=1)).date()  # today in WAT
START = TODAY + timedelta(days=30)

TRIP: dict[str, Any] = {
    "type": "vacation_invite",
    "sender_name": "Ada",
    "recipient_name": "Tolu",
    "theme": "kraft",
    "content": {
        "message": "Pack your bags. We're going away.",
        "destination": "Zanzibar",
        "start_date": START.isoformat(),
        "end_date": (START + timedelta(days=4)).isoformat(),
        "packing": "Swimsuit, sunglasses, your passport",
    },
}


def _trip(client: AuthClient, **content: Any) -> Any:
    return client.post("/experiences", json={**TRIP, "content": {**TRIP["content"], **content}})


def test_a_trip_is_sent_and_they_say_lets_go(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    created = _trip(auth_client)
    assert created.status_code == 201, created.text
    token = _token(created.json()["url"])
    _become_recipient(auth_client)
    auth_client.use_csrf()

    shown = auth_client.get(f"/letters/{token}").json()
    assert shown["reply_kind"] == "yes_no"
    assert shown["reactions"][0] == {"key": "yes", "label": "Let's go!"}
    assert shown["content"]["destination"] == "Zanzibar"
    reply = auth_client.post(f"/letters/{token}/reply", json={"reaction": "yes"})
    assert reply.status_code == 200


def test_a_one_day_trip_starting_today_is_fine(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    today = TODAY.isoformat()
    assert _trip(auth_client, start_date=today, end_date=today).status_code == 201


@pytest.mark.parametrize(
    ("content", "error"),
    [
        ({"destination": ""}, "Destination is required"),
        ({"start_date": "next month"}, "Pick a date"),
        ({"start_date": (TODAY - timedelta(days=1)).isoformat()}, "from today"),
        ({"end_date": (TODAY + timedelta(days=400)).isoformat()}, "within a year"),
        ({"end_date": (START - timedelta(days=1)).isoformat()}, "end on or after"),
        ({"end_date": (START + timedelta(days=60)).isoformat()}, "up to 60 days"),
    ],
)
def test_bad_trips_are_refused(
    auth_client: AuthClient, content: dict[str, Any], error: str
) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    response = _trip(auth_client, **content)
    assert response.status_code == 400
    assert error in response.json()["detail"]


def test_the_trip_must_start_after_the_invitation_opens(auth_client: AuthClient) -> None:
    auth_client.sign_up(SENDER, "ada_demo")
    opens = datetime.combine(START + timedelta(days=1), datetime.min.time(), UTC)
    response = auth_client.post("/experiences", json={**TRIP, "opens_at": opens.isoformat()})
    assert response.status_code == 400
    assert "start after the invitation opens" in response.json()["detail"]
