"""Celery worker and beat: emails, scheduled sends, photo checks, AI batches (later stages)."""

from typing import Any

from celery import Celery
from celery.signals import setup_logging

from app.core.config import get_settings
from app.core.logging import configure_logging

settings = get_settings()

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
    beat_schedule={},
)


@setup_logging.connect
def _use_json_logging(**_: Any) -> None:
    configure_logging(settings.log_level)


@celery_app.task(name="dearlly.ping")
def ping() -> str:
    return "pong"
