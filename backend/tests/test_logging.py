import json
import logging

from app.core.logging import (
    REDACTED,
    JsonFormatter,
    configure_logging,
    redact,
    redact_text,
    request_id_var,
)


def _format(message: str, **extra: object) -> dict[str, object]:
    record = logging.makeLogRecord({"name": "t", "levelname": "INFO", "msg": message, **extra})
    result: dict[str, object] = json.loads(JsonFormatter().format(record))
    return result


def test_log_line_is_json_with_request_id() -> None:
    token = request_id_var.set("req-12345678")
    try:
        line = _format("hello")
    finally:
        request_id_var.reset(token)
    assert line["message"] == "hello"
    assert line["request_id"] == "req-12345678"
    assert line["level"] == "INFO"


def test_sensitive_extra_fields_are_redacted() -> None:
    line = _format("login", password="hunter2", api_key="k", user_id=7, email="a@b.c")
    assert line["password"] == REDACTED
    assert line["api_key"] == REDACTED
    assert line["user_id"] == 7


def test_nested_values_are_redacted() -> None:
    assert redact({"headers": {"Cookie": "s=1", "Accept": "json"}}) == {
        "headers": {"Cookie": REDACTED, "Accept": "json"}
    }


def test_secrets_inside_messages_are_redacted() -> None:
    text = redact_text("token=abc123 password: 'p w' url=postgresql://u:pw@db/x Bearer eyJhb.c")
    assert "abc123" not in text
    assert "p w" not in text
    assert ":pw@" not in text
    assert "eyJhb" not in text


def test_task_inputs_and_results_are_redacted() -> None:
    data = {"id": "1", "name": "send", "args": "('a@b.c',)", "kwargs": "{}", "return_value": "x"}
    assert redact({"data": data})["data"] == {
        "id": "1",
        "name": "send",
        "args": REDACTED,
        "kwargs": REDACTED,
        "return_value": REDACTED,
    }


def test_uvicorn_access_log_is_off() -> None:
    configure_logging()
    assert logging.getLogger("uvicorn.access").disabled
