from starlette.responses import Response

from services.media_response_policy import (
    apply_safe_media_response_headers,
    safe_content_disposition,
    safe_inline_media_type,
)


def test_known_media_extension_uses_server_owned_inline_mime() -> None:
    assert safe_inline_media_type("clip.MP4") == "video/mp4"
    mime_type, disposition, headers = safe_content_disposition(
        "stored.mp4",
        download_name="用户视频.mp4",
    )

    assert mime_type == "video/mp4"
    assert disposition.startswith("inline; filename*=UTF-8''")
    assert "%E7%94%A8%E6%88%B7" in disposition
    assert headers == {}


def test_executable_or_unknown_extension_is_forced_to_attachment() -> None:
    mime_type, disposition, headers = safe_content_disposition(
        "payload.html",
        download_name="..\\attack\r\nX-Test: injected.html",
    )

    assert mime_type == "application/octet-stream"
    assert disposition.startswith("attachment; filename*=UTF-8''")
    assert "\\r" not in disposition
    assert "\\n" not in disposition
    assert headers["Content-Security-Policy"] == "sandbox; default-src 'none'"


def test_response_policy_overrides_untrusted_content_type() -> None:
    response = Response(headers={"Content-Type": "text/html"})

    apply_safe_media_response_headers(response, "/storage/others/payload.svg")

    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["x-content-type-options"] == "nosniff"
