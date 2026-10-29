"""Sends one test message to Sentry, to prove error alerts reach you. On the server:

docker exec dearlly-api-1 python -m app.sentry_check
"""

import sentry_sdk

from app.core.config import get_settings
from app.core.monitoring import init_sentry


def main() -> None:
    if not init_sentry(get_settings(), component="sentry-check"):
        print("SENTRY_DSN is not set: nothing sent.")
        raise SystemExit(1)
    event_id = sentry_sdk.capture_message("Dearlly Sentry test: alerts are working", level="error")
    sentry_sdk.flush(timeout=10)
    print(f"Sent test event {event_id}. It should appear in Sentry within a minute.")


if __name__ == "__main__":
    main()
