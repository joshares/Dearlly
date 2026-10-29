"""Optional passwords: sign-up, log-in, set/change, rules, breach check, rate limits."""

import httpx
import pytest

from app.services import passwords

from .conftest import AuthClient

EMAIL = "ada_demo@example.com"
GOOD = "lagoon-sunset-2027"


def test_sign_up_with_password_then_log_in_with_it(auth_client: AuthClient) -> None:
    created = auth_client.sign_up(EMAIL, "ada_demo", password=GOOD)
    assert created.status_code == 201, created.text
    assert created.json()["has_password"] is True
    auth_client.post("/auth/logout")
    auth_client.use_csrf()
    response = auth_client.password_login(EMAIL.upper(), GOOD)
    assert response.status_code == 200
    assert response.json()["status"] == "logged_in"
    assert auth_client.get("/me").json()["username"] == "ada_demo"


def test_password_is_optional(auth_client: AuthClient) -> None:
    created = auth_client.sign_up(EMAIL, "ada_demo")
    assert created.json()["has_password"] is False
    auth_client.post("/auth/logout")
    auth_client.use_csrf()
    assert auth_client.password_login(EMAIL, GOOD).status_code == 400


def test_wrong_password_and_unknown_email_get_the_same_answer(auth_client: AuthClient) -> None:
    auth_client.sign_up(EMAIL, "ada_demo", password=GOOD)
    auth_client.post("/auth/logout")
    auth_client.use_csrf()
    wrong = auth_client.password_login(EMAIL, "not-the-password-1")
    unknown = auth_client.password_login("nobody_demo@example.com", GOOD)
    assert wrong.status_code == unknown.status_code == 400
    assert wrong.json() == unknown.json()
    assert auth_client.get("/me").status_code == 401


def test_password_log_in_needs_the_human_check(auth_client: AuthClient) -> None:
    auth_client.sign_up(EMAIL, "ada_demo", password=GOOD)
    auth_client.post("/auth/logout")
    auth_client.use_csrf()
    assert auth_client.password_login(EMAIL, GOOD, turnstile="bot").status_code == 400


def test_password_guesses_are_rate_limited(auth_client: AuthClient) -> None:
    auth_client.sign_up(EMAIL, "ada_demo", password=GOOD)
    auth_client.post("/auth/logout")
    auth_client.use_csrf()
    statuses = [
        auth_client.password_login(EMAIL, f"guess-number-{i}").status_code for i in range(6)
    ]
    assert statuses[:5] == [400] * 5
    assert statuses[5] == 429


@pytest.mark.parametrize(
    "bad",
    ["short", "aaaaaaaaaaaa", "ada_demo@example.com", "ada_demo", "password123456"],
)
def test_weak_or_breached_passwords_are_refused(auth_client: AuthClient, bad: str) -> None:
    response = auth_client.sign_up(EMAIL, "ada_demo", password=bad)
    assert response.status_code == 400, bad


def test_set_first_password_then_change_it(auth_client: AuthClient) -> None:
    auth_client.sign_up(EMAIL, "ada_demo")
    assert auth_client.post("/me/password", json={"new_password": GOOD}).status_code == 204
    assert auth_client.get("/me").json()["has_password"] is True
    # Changing it needs the current one.
    no_current = auth_client.post("/me/password", json={"new_password": "another-good-one-9"})
    assert no_current.status_code == 400
    changed = auth_client.post(
        "/me/password",
        json={"current_password": GOOD, "new_password": "another-good-one-9"},
    )
    assert changed.status_code == 204
    auth_client.post("/auth/logout")
    auth_client.use_csrf()
    assert auth_client.password_login(EMAIL, GOOD).status_code == 400
    assert auth_client.password_login(EMAIL, "another-good-one-9").status_code == 200


def test_changing_password_logs_out_other_devices(auth_client: AuthClient) -> None:
    auth_client.sign_up(EMAIL, "ada_demo", password=GOOD)
    other_device = auth_client.cookies.get("dl_access")
    assert other_device
    # Log in again: this is "this device".
    auth_client.password_login(EMAIL, GOOD)
    this_device = auth_client.cookies.get("dl_access")
    assert this_device
    auth_client.post(
        "/me/password", json={"current_password": GOOD, "new_password": "brand-new-secret-7"}
    )
    assert auth_client.get("/me").status_code == 200
    auth_client.replace_cookies(dl_access=other_device)
    assert auth_client.get("/me").status_code == 401


# --- unit tests (no database) ----------------------------------------------------------------


async def test_hash_and_verify() -> None:
    stored = await passwords.hash_password(GOOD)
    assert stored.startswith("$argon2id$")
    assert await passwords.verify_password(stored, GOOD)
    assert not await passwords.verify_password(stored, "wrong-password-1")
    assert not await passwords.verify_password(None, GOOD)


async def test_breach_check_sends_only_a_hash_prefix() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, text="0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert not await passwords.is_breached(client, "lagoon-sunset-2027")
    assert seen[0].startswith(passwords.HIBP_RANGE_URL)
    assert len(seen[0].removeprefix(passwords.HIBP_RANGE_URL)) == 5
    assert "lagoon" not in seen[0]


async def test_breach_check_finds_a_listed_password() -> None:
    import hashlib

    digest = hashlib.sha1(b"password123456", usedforsecurity=False).hexdigest().upper()

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=f"{digest[5:]}:2900\r\nABCDEF:0\r\n")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await passwords.is_breached(client, "password123456")


async def test_breach_check_allows_when_hibp_is_down() -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(503))
    ) as client:
        assert not await passwords.is_breached(client, "anything-at-all-1")
