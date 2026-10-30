"""Celery worker and beat: emails, scheduled sends, photo checks, AI batches (later stages)."""

import asyncio
from typing import Any

import httpx
from celery import Celery
from celery.app import trace
from celery.signals import setup_logging

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.monitoring import init_sentry
from app.db.session import create_engine, create_sessionmaker
from app.services import photos
from app.services.letter_mail import send_due_letter_emails

settings = get_settings()
init_sentry(settings, component="worker")

# Celery's default success line prints the task's return value, which may be personal data.
trace.LOG_SUCCESS = "Task %(name)s[%(id)s] succeeded in %(runtime)ss"

celery_app = Celery("dearlly", broker=settings.redis_url.get_secret_value())
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    task_ignore_result=True,
    timezone="Africa/Lagos",
    enable_utc=True,
    broker_connection_retry_on_startup=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    # Containers have read-only filesystems; /tmp is a tmpfs.
    beat_schedule_filename="/tmp/celerybeat-schedule",  # noqa: S108
    beat_schedule={
        # Letters to email: sent ones go out within 30 seconds, scheduled ones when they open.
        "send-letter-emails": {"task": "dearlly.send_letter_emails", "schedule": 30.0},
        # Photos never added to a letter, and files left by deleted accounts.
        "sweep-photos": {"task": "dearlly.sweep_photos", "schedule": 6 * 3600.0},
    },
)


@setup_logging.connect
def _use_json_logging(**_: Any) -> None:
    configure_logging(settings.log_level)


@celery_app.task(name="dearlly.ping")
def ping() -> str:
    return "pong"


async def _send_letter_emails() -> int:
    engine = create_engine(settings)
    try:
        async with httpx.AsyncClient(headers={"User-Agent": "Dearlly"}) as http:
            return await send_due_letter_emails(create_sessionmaker(engine), http, settings)
    finally:
        await engine.dispose()


@celery_app.task(name="dearlly.send_letter_emails")
def send_letter_emails() -> int:
    return asyncio.run(_send_letter_emails())


async def _sweep_photos() -> int:
    storage = photos.storage_for(settings)
    if storage is None:
        return 0
    engine = create_engine(settings)
    try:
        return await photos.sweep(create_sessionmaker(engine), storage)
    finally:
        await engine.dispose()


@celery_app.task(name="dearlly.sweep_photos")
def sweep_photos() -> int:
    return asyncio.run(_sweep_photos())
