from __future__ import annotations

import io
import logging

from core.logging_security import SensitiveDataRedactingFormatter


def test_formatter_redacts_message_arguments_and_exception_traceback() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(SensitiveDataRedactingFormatter("%(levelname)s %(message)s"))
    logger = logging.getLogger("test.secure.logging")
    logger.handlers = [handler]
    logger.propagate = False
    logger.setLevel(logging.INFO)

    logger.info("provider api_key=%s path=%s", "sk-example-secret", r"C:\Users\Owner\private.env")
    try:
        raise RuntimeError("Authorization: Bearer provider-token")
    except RuntimeError:
        logger.exception("provider request failed")

    output = stream.getvalue()
    assert "sk-example-secret" not in output
    assert "provider-token" not in output
    assert "Owner" not in output
    assert "[REDACTED" in output
