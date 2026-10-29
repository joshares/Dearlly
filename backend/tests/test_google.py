"""Continue with Google, against a simulated Google (our own signing key and endpoints)."""

import json
import time
from collections.abc import Iterator
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import SecretStr

from app.services import google

from .conftest import AuthClient

CLIENT_ID = "dearlly-test.apps.googleusercontent.com"
EMAIL = "ada_demo@example.com"
SUB = "google-user-123"


class FakeGoogle:
    def __init__(self) -> None:
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
        self.jwks = {"keys": [{**jwk, "kid": "k1", "alg": "RS256", "use": "sig"}]}
        self.claims: dict[str, Any] = {}
        self.token_requests: list[dict[str, list[str]]] = []

    def id_token(self) -> str:
        now = int(time.time())
        claims = {
            "iss": "https://accounts.google.com",
            "aud": CLIENT_ID,
            "sub": SUB,
            "email": EMAIL,
            "email_verified": True,
            "iat": now,
            "exp": now + 300,
            **self.claims,
        }
        return jwt.encode(claims, self.key, algorithm="RS256", headers={"kid": "k1"})

    def handle(self, request: httpx.Request) -> httpx.Response:
        if str(request.url) == google.JWKS_URL:
            return httpx.Response(200, json=self.jwks)
        if str(request.url) == google.TOKEN_URL:
            self.token_requests.append(parse_qs(request.content.decode()))
            return httpx.Response(200, json={"id_token": self.id_token()})
        return httpx.Response(404)


@pytest.fixture
def fake_google(auth_client: AuthClient) -> Iterator[FakeGoogle]:
    fake = FakeGoogle()
    app: Any = auth_client.app
    app.state.settings = app.state.settings.model_copy(
        update={"google_client_id": CLIENT_ID, "google_client_secret": SecretStr("test-secret")}
    )
    assert auth_client.portal is not None
    app.state.http = auth_client.portal.call(
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handle))
    )
    google.clear_key_cache()
    yield fake
    google.clear_key_cache()


def _sign_in(client: AuthClient, fake: FakeGoogle, *, tamper_state: bool = False) -> str:
    """Run start → (Google) → callback. Returns where the browser lands."""
    start = client.get("/auth/google/start", follow_redirects=False)
    assert start.status_code == 302
    params = parse_qs(urlparse(start.headers["location"]).query)
    assert params["code_challenge_method"] == ["S256"]
    fake.claims.setdefault("nonce", params["nonce"][0])
    state = "forged-state" if tamper_state else params["state"][0]
    back = client.get(
        "/auth/google/callback",
        params={"code": "one-time-code", "state": state},
        follow_redirects=False,
    )
    assert back.status_code == 302
    return back.headers["location"]


def test_hidden_until_configured(auth_client: AuthClient) -> None:
    assert auth_client.get("/auth/providers").json() == {"google": False}
    assert auth_client.get("/auth/google/start", follow_redirects=False).status_code == 404


def test_new_person_signs_up_through_google(
    auth_client: AuthClient, fake_google: FakeGoogle
) -> None:
    assert auth_client.get("/auth/providers").json() == {"google": True}
    landing = _sign_in(auth_client, fake_google)
    assert landing.endswith("/login?step=signup")
    # The token exchange used PKCE and our secret.
    sent = fake_google.token_requests[0]
    assert sent["code_verifier"] and sent["client_secret"] == ["test-secret"]
    # They still choose a username and must tick 18+.
    refused = auth_client.post("/auth/signup", json={"username": "ada_demo", "is_adult": False})
    assert refused.status_code == 403
    created = auth_client.post("/auth/signup", json={"username": "ada_demo", "is_adult": True})
    assert created.status_code == 201
    assert created.json()["email"] == EMAIL


def test_returning_person_goes_straight_in(
    auth_client: AuthClient, fake_google: FakeGoogle
) -> None:
    _sign_in(auth_client, fake_google)
    auth_client.post("/auth/signup", json={"username": "ada_demo", "is_adult": True})
    auth_client.post("/auth/logout")
    auth_client.use_csrf()
    fake_google.claims.clear()
    assert _sign_in(auth_client, fake_google).endswith("/profile")
    assert auth_client.get("/me").json()["username"] == "ada_demo"


def test_google_links_to_an_existing_email_account(
    auth_client: AuthClient, fake_google: FakeGoogle
) -> None:
    auth_client.sign_up(EMAIL, "ada_demo")
    auth_client.post("/auth/logout")
    auth_client.use_csrf()
    assert _sign_in(auth_client, fake_google).endswith("/profile")
    assert auth_client.get("/me").json()["username"] == "ada_demo"


@pytest.mark.parametrize(
    "bad_claims",
    [
        {"email_verified": False},
        {"aud": "someone-elses-app"},
        {"iss": "https://evil.example"},
        {"nonce": "replayed-nonce"},
        {"exp": int(time.time()) - 60},
    ],
)
def test_untrustworthy_answers_are_refused(
    auth_client: AuthClient, fake_google: FakeGoogle, bad_claims: dict[str, Any]
) -> None:
    fake_google.claims.update(bad_claims)
    assert _sign_in(auth_client, fake_google).endswith("/login?error=google")
    assert auth_client.get("/me").status_code == 401


def test_forged_state_is_refused(auth_client: AuthClient, fake_google: FakeGoogle) -> None:
    assert _sign_in(auth_client, fake_google, tamper_state=True).endswith("/login?error=google")
    assert fake_google.token_requests == []


def test_callback_without_starting_is_refused(
    auth_client: AuthClient, fake_google: FakeGoogle
) -> None:
    back = auth_client.get(
        "/auth/google/callback", params={"code": "x", "state": "y"}, follow_redirects=False
    )
    assert back.headers["location"].endswith("/login?error=google")


def test_answer_signed_by_someone_else_is_refused(
    auth_client: AuthClient, fake_google: FakeGoogle
) -> None:
    impostor = FakeGoogle()
    fake_google.key = impostor.key  # signs with a key Google never published
    assert _sign_in(auth_client, fake_google).endswith("/login?error=google")
