"""Stage 2 "done when": sign up, log in, log out, rate limits; no sign-up without the 18+ tick."""

from .conftest import AuthClient

EMAIL = "ada_demo@example.com"


# --- sign up ---------------------------------------------------------------------------------


def test_sign_up_with_code_and_18_plus_tick(auth_client: AuthClient) -> None:
    response = auth_client.sign_up(EMAIL, "ada_demo")
    assert response.status_code == 201, response.text
    assert response.json()["username"] == "ada_demo"
    assert response.json()["email"] == EMAIL
    assert response.json()["plan"] == "free"
    me = auth_client.get("/me")
    assert me.status_code == 200
    assert me.json()["email"] == EMAIL


def test_sign_up_refused_without_18_plus_tick(auth_client: AuthClient) -> None:
    code = auth_client.request_code(EMAIL)
    auth_client.post("/auth/verify", json={"email": EMAIL, "code": code})
    refused = auth_client.post("/auth/signup", json={"username": "ada_demo", "is_adult": False})
    assert refused.status_code == 403
    assert "18" in refused.json()["detail"]
    # No account was created, and they're not logged in.
    assert auth_client.get("/me").status_code == 401
    assert auth_client.get("/users/ada_demo").status_code == 404


def test_sign_up_needs_the_tick_field(auth_client: AuthClient) -> None:
    code = auth_client.request_code(EMAIL)
    auth_client.post("/auth/verify", json={"email": EMAIL, "code": code})
    assert auth_client.post("/auth/signup", json={"username": "ada_demo"}).status_code == 422


def test_sign_up_needs_a_verified_email(auth_client: AuthClient) -> None:
    response = auth_client.post("/auth/signup", json={"username": "ada_demo", "is_adult": True})
    assert response.status_code == 401


def test_username_rules_and_uniqueness(auth_client: AuthClient) -> None:
    assert auth_client.sign_up(EMAIL, "ada_demo").status_code == 201
    auth_client.post("/auth/logout")
    auth_client.use_csrf()
    code = auth_client.request_code("bola_demo@example.com")
    auth_client.post("/auth/verify", json={"email": "bola_demo@example.com", "code": code})
    for bad in ("ab", "1abc", "has space", "admin", "dearlly_team"):
        response = auth_client.post("/auth/signup", json={"username": bad, "is_adult": True})
        assert response.status_code == 400, bad
    taken = auth_client.post("/auth/signup", json={"username": "ADA_demo", "is_adult": True})
    assert taken.status_code == 409
    assert taken.json()["detail"] == "That username is taken."
    ok = auth_client.post("/auth/signup", json={"username": "bola_demo", "is_adult": True})
    assert ok.status_code == 201


def test_username_availability(auth_client: AuthClient) -> None:
    auth_client.sign_up(EMAIL, "ada_demo")
    assert auth_client.get("/usernames/ada_demo/availability").json()["available"] is False
    assert auth_client.get("/usernames/kemi_demo/availability").json() == {
        "available": True,
        "reason": None,
    }
    assert auth_client.get("/usernames/x/availability").json()["available"] is False


# --- log in ----------------------------------------------------------------------------------


def test_existing_user_logs_in_with_code(auth_client: AuthClient) -> None:
    auth_client.sign_up(EMAIL, "ada_demo")
    auth_client.post("/auth/logout")
    auth_client.use_csrf()
    assert auth_client.get("/me").status_code == 401
    code = auth_client.request_code(EMAIL)
    response = auth_client.post("/auth/verify", json={"email": EMAIL.upper(), "code": code})
    assert response.json()["status"] == "logged_in"
    assert response.json()["user"]["username"] == "ada_demo"
    assert auth_client.get("/me").status_code == 200


def test_start_gives_the_same_answer_for_new_and_existing_emails(auth_client: AuthClient) -> None:
    auth_client.sign_up(EMAIL, "ada_demo")
    existing = auth_client.post("/auth/start", json={"email": EMAIL, "turnstile_token": "ok"})
    new = auth_client.post(
        "/auth/start", json={"email": "new_demo@example.com", "turnstile_token": "ok"}
    )
    assert existing.status_code == new.status_code == 202
    assert existing.json() == new.json()


def test_wrong_code_is_refused(auth_client: AuthClient) -> None:
    code = auth_client.request_code(EMAIL)
    wrong = "000000" if code != "000000" else "111111"
    response = auth_client.post("/auth/verify", json={"email": EMAIL, "code": wrong})
    assert response.status_code == 400


def test_code_works_only_once(auth_client: AuthClient) -> None:
    code = auth_client.request_code(EMAIL)
    first = auth_client.post("/auth/verify", json={"email": EMAIL, "code": code})
    assert first.status_code == 200
    second = auth_client.post("/auth/verify", json={"email": EMAIL, "code": code})
    assert second.status_code == 400


def test_code_dies_after_five_wrong_guesses(auth_client: AuthClient) -> None:
    code = auth_client.request_code(EMAIL)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        auth_client.post("/auth/verify", json={"email": EMAIL, "code": wrong})
    response = auth_client.post("/auth/verify", json={"email": EMAIL, "code": code})
    assert response.status_code == 400


def test_turnstile_failure_sends_nothing(auth_client: AuthClient) -> None:
    response = auth_client.post("/auth/start", json={"email": EMAIL, "turnstile_token": "bot"})
    assert response.status_code == 400
    assert auth_client.sent == []


def test_changes_need_the_csrf_token(auth_client: AuthClient) -> None:
    del auth_client.headers["X-CSRF-Token"]
    response = auth_client.post("/auth/start", json={"email": EMAIL, "turnstile_token": "ok"})
    assert response.status_code == 403
    assert auth_client.sent == []


# --- sessions, refresh, log out --------------------------------------------------------------


def test_log_out_ends_the_session_immediately(auth_client: AuthClient) -> None:
    auth_client.sign_up(EMAIL, "ada_demo")
    old_access = auth_client.cookies.get("dl_access")
    assert old_access
    assert auth_client.post("/auth/logout").status_code == 204
    assert auth_client.get("/me").status_code == 401
    # Even a copied access token stops working once the session is revoked.
    auth_client.replace_cookies(dl_access=old_access)
    assert auth_client.get("/me").status_code == 401


def test_refresh_rotates_and_detects_reuse(auth_client: AuthClient) -> None:
    auth_client.sign_up(EMAIL, "ada_demo")
    first = auth_client.cookies.get("dl_refresh", path="/auth")
    assert first
    assert auth_client.post("/auth/refresh").status_code == 204
    second = auth_client.cookies.get("dl_refresh", path="/auth")
    assert second and second != first
    access = auth_client.cookies.get("dl_access")
    assert access
    assert auth_client.get("/me").status_code == 200
    # Replaying the spent token revokes the whole session (assume it was stolen)...
    auth_client.replace_cookies(dl_refresh=first)
    assert auth_client.post("/auth/refresh").status_code == 401
    # ...so the newest token and the access token stop working too.
    auth_client.replace_cookies(dl_refresh=second, dl_access=access)
    assert auth_client.post("/auth/refresh").status_code == 401
    auth_client.replace_cookies(dl_access=access)
    assert auth_client.get("/me").status_code == 401


def test_refresh_without_cookie_is_refused(auth_client: AuthClient) -> None:
    assert auth_client.post("/auth/refresh").status_code == 401


# --- rate limits -----------------------------------------------------------------------------


def test_code_requests_are_rate_limited_per_email(auth_client: AuthClient) -> None:
    for _ in range(3):
        auth_client.request_code(EMAIL)
    response = auth_client.post("/auth/start", json={"email": EMAIL, "turnstile_token": "ok"})
    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) > 0
    assert len(auth_client.sent) == 3


def test_code_requests_are_rate_limited_per_ip(auth_client: AuthClient) -> None:
    for i in range(10):
        auth_client.request_code(f"person{i}_demo@example.com")
    response = auth_client.post(
        "/auth/start", json={"email": "one_more_demo@example.com", "turnstile_token": "ok"}
    )
    assert response.status_code == 429


def test_code_guesses_are_rate_limited(auth_client: AuthClient) -> None:
    auth_client.request_code(EMAIL)
    statuses = [
        auth_client.post("/auth/verify", json={"email": EMAIL, "code": "123456"}).status_code
        for _ in range(11)
    ]
    assert statuses[-1] == 429


# --- profiles --------------------------------------------------------------------------------


def test_public_profile_never_shows_email(auth_client: AuthClient) -> None:
    auth_client.sign_up(EMAIL, "ada_demo")
    response = auth_client.get("/users/ADA_DEMO")
    assert response.status_code == 200
    assert response.json()["username"] == "ada_demo"
    assert "email" not in response.json()
    assert EMAIL not in response.text


def test_update_display_name(auth_client: AuthClient) -> None:
    auth_client.sign_up(EMAIL, "ada_demo")
    ok = auth_client.patch("/me", json={"display_name": "  Ada   Lovelace "})
    assert ok.json()["display_name"] == "Ada Lovelace"
    for bad in ("visit www.scam.com", "call 0803 123 4567", "x" * 41):
        assert auth_client.patch("/me", json={"display_name": bad}).status_code == 400, bad


def test_profile_changes_need_login(auth_client: AuthClient) -> None:
    assert auth_client.patch("/me", json={"display_name": "Ada"}).status_code == 401
