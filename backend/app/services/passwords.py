"""Optional passwords: Argon2id hashes, length rules and a breached-password check.

- Hashing uses OWASP's Argon2id settings (19 MiB, 2 passes) and runs off the event loop.
- Breach check: HIBP "range" API with k-anonymity. Only the first 5 characters of the SHA-1
  hash leave the server, never the password. If HIBP is down we allow the password (logged):
  blocking everyone's sign-up on a third party would be worse.
"""

import hashlib
import logging

import anyio
import httpx
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

logger = logging.getLogger(__name__)

MIN_LENGTH = 10
MAX_LENGTH = 128
HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/"

_hasher = PasswordHasher(time_cost=2, memory_cost=19 * 1024, parallelism=1)
# Verified against when the account doesn't exist or has no password, so the response takes
# the same time either way and doesn't reveal which emails have accounts.
_DUMMY_HASH = _hasher.hash("dearlly-timing-equaliser")


class PasswordRuleError(ValueError):
    pass


def check_rules(password: str, *, email: str, username: str | None = None) -> None:
    if len(password) < MIN_LENGTH:
        raise PasswordRuleError(f"Use at least {MIN_LENGTH} characters.")
    if len(password) > MAX_LENGTH:
        raise PasswordRuleError(f"Use at most {MAX_LENGTH} characters.")
    lowered = password.lower()
    if lowered in {email.lower(), email.split("@")[0].lower(), (username or "").lower()}:
        raise PasswordRuleError("Don't use your email or username as your password.")
    if len(set(password)) < 4:
        raise PasswordRuleError("That password is too easy to guess.")


async def hash_password(password: str) -> str:
    return await anyio.to_thread.run_sync(_hasher.hash, password)


async def verify_password(password_hash: str | None, password: str) -> bool:
    def _verify() -> bool:
        try:
            return _hasher.verify(password_hash or _DUMMY_HASH, password) and bool(password_hash)
        except (VerificationError, InvalidHashError):
            return False

    return await anyio.to_thread.run_sync(_verify)


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


async def is_breached(client: httpx.AsyncClient, password: str) -> bool:
    # SHA-1 here is HIBP's lookup format, not password storage (that is Argon2id above), and only
    # 5 hex characters of it leave the server. Reviewed false positive for weak-hash scanners.
    # nosemgrep: python.lang.security.insecure-hash-algorithms.insecure-hash-algorithm-sha1
    digest = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]
    try:
        response = await client.get(
            HIBP_RANGE_URL + prefix, headers={"Add-Padding": "true"}, timeout=3.0
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("breached-password check unavailable", extra={"error": repr(exc)})
        return False
    for line in response.text.splitlines():
        candidate, _, count = line.partition(":")
        if candidate.strip() == suffix and count.strip() not in {"", "0"}:
            return True
    return False
