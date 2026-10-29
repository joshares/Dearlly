"""Cloudflare Turnstile: checks the browser passed the bot challenge before we send any email."""

import logging

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
MAX_TOKEN_LENGTH = 2048


async def verify_turnstile(
    client: httpx.AsyncClient, settings: Settings, token: str, remote_ip: str
) -> bool:
    if not token or len(token) > MAX_TOKEN_LENGTH:
        return False
    try:
        response = await client.post(
            SITEVERIFY_URL,
            data={
                "secret": settings.turnstile_secret_key.get_secret_value(),
                "response": token,
                "remoteip": remote_ip,
            },
            timeout=5.0,
        )
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        # Fail closed: if Cloudflare can't confirm, we don't send.
        logger.warning("turnstile check unavailable", extra={"error": repr(exc)})
        return False
    if not result.get("success"):
        logger.info("turnstile rejected", extra={"error_codes": result.get("error-codes", [])})
        return False
    return True
