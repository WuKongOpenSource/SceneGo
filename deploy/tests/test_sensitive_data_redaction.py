from services.sensitive_data_redaction import redact_sensitive_text


def test_redacts_bearer_assignments_jwt_and_common_key_prefixes() -> None:
    jwt = "eyJabcdefghijk.abcdefghijk.abcdefghijk"
    text = (
        "Authorization: Bearer top-secret-token "
        "api_key=sk-abcdefghijk password=hunter2 "
        f"jwt={jwt}"
    )

    redacted = redact_sensitive_text(text)

    assert "top-secret-token" not in redacted
    assert "sk-abcdefghijk" not in redacted
    assert "hunter2" not in redacted
    assert jwt not in redacted
    assert "[REDACTED]" in redacted


def test_redaction_applies_output_bound() -> None:
    assert redact_sensitive_text("x" * 50, max_chars=12) == "x" * 12


def test_redacts_query_credentials_and_private_filesystem_paths() -> None:
    text = (
        "fetch https://example.invalid/media?token=secret-value&size=small failed at "
        "C:\\Users\\Owner\\private\\database.env and /srv/ovideo/private.env"
    )

    redacted = redact_sensitive_text(text)

    assert "secret-value" not in redacted
    assert "Owner" not in redacted
    assert "/srv/ovideo" not in redacted
    assert redacted.count("[REDACTED_PATH]") == 2


def test_redacts_provider_content_fields_and_entire_url_queries() -> None:
    text = (
        "result={'prompt': 'private story', 'video_url': "
        "'https://cdn.example.invalid/out.mp4?X-Amz-Signature=signed&Expires=1'}"
    )

    redacted = redact_sensitive_text(text)

    assert "private story" not in redacted
    assert "X-Amz-Signature" not in redacted
    assert "signed" not in redacted
    assert "[REDACTED_CONTENT]" in redacted
