"""Logging helpers that redact credentials and private host paths.

Application code should still avoid logging request bodies and provider
responses.  This formatter is a final containment layer for unexpected library
exceptions; it is not permission to add sensitive values to log messages.
"""
from __future__ import annotations

import logging

from services.sensitive_data_redaction import redact_sensitive_text


class SensitiveDataRedactingFormatter(logging.Formatter):
    """Redact the fully formatted record, including exception tracebacks."""

    def format(self, record: logging.LogRecord) -> str:
        rendered = super().format(record)
        return redact_sensitive_text(rendered, max_chars=20_000)


def secure_log_handlers(*, log_file: str, format_string: str) -> list[logging.Handler]:
    """Create consistently redacted file and console handlers."""
    formatter = SensitiveDataRedactingFormatter(format_string)
    file_handler = logging.FileHandler(log_file)
    stream_handler = logging.StreamHandler()
    file_handler.setFormatter(formatter)
    stream_handler.setFormatter(formatter)
    return [file_handler, stream_handler]
