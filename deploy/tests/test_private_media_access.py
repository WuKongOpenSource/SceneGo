from __future__ import annotations

import pytest
from starlette.requests import Request

from services.entity_access_service import EntityAccessDenied
from services.private_media_access_service import (
    PrivateMediaAuthenticationRequired,
    PrivateMediaNotFound,
    authorize_private_media_request,
)
from services.media_response_policy import safe_content_disposition


def _request(*, cookie: str = "", authorization: str = "") -> Request:
    headers = []
    if cookie:
        headers.append((b"cookie", cookie.encode("latin-1")))
    if authorization:
        headers.append((b"authorization", authorization.encode("latin-1")))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/storage/video/owner/clip.mp4",
            "query_string": b"token=must-not-be-used",
            "headers": headers,
            "scheme": "https",
            "server": ("tv.ostory.ai", 443),
        }
    )


class FileDAO:
    record = {"file_id": "file-1", "user_id": "owner"}

    @classmethod
    async def get_file_by_url(cls, url: str):
        assert url == "/storage/video/owner/clip.mp4"
        return cls.record


async def resolve_identity(subject: str) -> str:
    assert subject == "owner-subject"
    return "owner"


@pytest.mark.asyncio
async def test_query_token_is_not_accepted_for_private_media() -> None:
    with pytest.raises(PrivateMediaAuthenticationRequired):
        await authorize_private_media_request(
            _request(),
            token_verifier=lambda token: "owner-subject" if token == "valid" else None,
            identity_resolver=resolve_identity,
            file_dao=FileDAO,
        )


@pytest.mark.asyncio
async def test_cookie_session_and_file_access_are_both_required() -> None:
    access_calls = []

    async def allow(file_id, identity, role, *, file_dao):
        access_calls.append((file_id, identity, role, file_dao))

    record = await authorize_private_media_request(
        _request(cookie="ostory_session=valid"),
        token_verifier=lambda token: "owner-subject" if token == "valid" else None,
        identity_resolver=resolve_identity,
        file_dao=FileDAO,
        access_checker=allow,
    )

    assert record["file_id"] == "file-1"
    assert access_calls == [("file-1", "owner", "readonly", FileDAO)]


@pytest.mark.asyncio
async def test_missing_file_and_denied_file_are_indistinguishable() -> None:
    original = FileDAO.record
    try:
        FileDAO.record = None
        with pytest.raises(PrivateMediaNotFound):
            await authorize_private_media_request(
                _request(cookie="ostory_session=valid"),
                token_verifier=lambda _token: "owner-subject",
                identity_resolver=resolve_identity,
                file_dao=FileDAO,
            )

        FileDAO.record = original
        async def deny(*_args, **_kwargs):
            raise EntityAccessDenied("denied")

        with pytest.raises(PrivateMediaNotFound):
            await authorize_private_media_request(
                _request(authorization="Bearer valid"),
                token_verifier=lambda _token: "owner-subject",
                identity_resolver=resolve_identity,
                file_dao=FileDAO,
                access_checker=deny,
            )
    finally:
        FileDAO.record = original


def test_private_static_html_policy_is_attachment_only() -> None:
    mime_type, disposition, headers = safe_content_disposition(
        "/storage/others/payload.html",
        download_name="payload.html",
    )

    assert mime_type == "application/octet-stream"
    assert disposition.startswith("attachment;")
    assert headers["Content-Security-Policy"].startswith("sandbox")
