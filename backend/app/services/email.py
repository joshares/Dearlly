"""Transactional email. Locally emails are logged, not sent; production sends through Resend."""

import html
import logging
from dataclasses import dataclass

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    text: str
    html: str


class EmailDeliveryError(Exception):
    pass


def login_code_email(to: str, code: str, minutes_valid: int) -> Email:
    text = (
        f"Your Dearlly code is {code}\n\n"
        f"It works once and expires in {minutes_valid} minutes.\n"
        "If you didn't ask for it, you can ignore this email. "
        "Nobody can sign in without the code.\n"
    )
    safe_code = html.escape(code)
    body = (
        '<div style="font-family:Georgia,serif;background:#F3EADB;color:#1F2A6B;padding:24px">'
        '<p style="font-size:20px;margin:0 0 12px">Your Dearlly code</p>'
        '<p style="font-size:32px;letter-spacing:6px;font-weight:bold;margin:0 0 12px">'
        f"{safe_code}</p>"
        f"<p>It works once and expires in {minutes_valid} minutes.</p>"
        "<p>If you didn't ask for it, you can ignore this email. "
        "Nobody can sign in without the code.</p></div>"
    )
    return Email(to=to, subject=f"{code} is your Dearlly code", text=text, html=body)


async def send_email(client: httpx.AsyncClient, settings: Settings, email: Email) -> None:
    if settings.email_delivery == "log":
        # Development only (production refuses to start with EMAIL_DELIVERY=log).
        logger.info(
            "email not sent (EMAIL_DELIVERY=log)",
            extra={"to": email.to, "subject": email.subject, "body": email.text},
        )
        return
    if settings.resend_api_key is None:
        raise EmailDeliveryError("RESEND_API_KEY is not set")
    try:
        response = await client.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key.get_secret_value()}"},
            json={
                "from": settings.email_from,
                "to": [email.to],
                "subject": email.subject,
                "text": email.text,
                "html": email.html,
            },
            timeout=10.0,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        status_code = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
        logger.error("email delivery failed", extra={"status": status_code})
        raise EmailDeliveryError from exc
