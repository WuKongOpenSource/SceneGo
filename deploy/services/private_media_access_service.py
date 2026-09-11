"""Authorization boundary for legacy `/storage` and `/uploads` media URLs."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from core.session_cookie import request_session_token
from services.entity_access_service import EntityAccessDenied, require_file_access
from services.media_response_policy import apply_safe_media_response_headers


logger = logging.getLogger(__name__)
PRIVATE_MEDIA_PREFIXES = ("/storage/", "/uploads/")


class PrivateMediaAuthenticationRequired(PermissionError):
    pass


class PrivateMediaNotFound(LookupError):
    pass


async def authorize_private_media_request(
    request: Request,
    *,
    token_verifier: Any,
    identity_resolver: Any,
    file_dao: Any,
    access_checker: Any = require_file_access,
    session_validator: Any = None,
) -> dict[str, Any]:
    """Authenticate the browser and authorize access to the matching file row."""
    token = request_session_token(request)
    if not token:
        raise PrivateMediaAuthenticationRequired("authentication required")
    if session_validator is not None:
        identity = await session_validator(token)
    else:
        # Compatibility path for callers outside the main application. The
        # production app supplies session_validator so account status and
        # session-version revocation are always enforced.
        subject = token_verifier(token)
        identity = await identity_resolver(subject) if subject else None
    if not identity:
        raise PrivateMediaAuthenticationRequired("authentication required")
    file_record = await file_dao.get_file_by_url(request.url.path)
    if not file_record:
        raise PrivateMediaNotFound("media not found")
    record = dict(file_record)
    file_id = str(record.get("file_id") or "")
    if not file_id:
        raise PrivateMediaNotFound("media not found")
    try:
        await access_checker(file_id, identity, "readonly", file_dao=file_dao)
    except EntityAccessDenied as exc:
        raise PrivateMediaNotFound("media not found") from exc
    return record


class PrivateMediaAccessMiddleware(BaseHTTPMiddleware):
    """Protect legacy static mounts before Starlette's StaticFiles serves them."""

    def __init__(
        self,
        app,
        *,
        token_verifier: Any,
        identity_resolver: Any,
        file_dao: Any,
        access_checker: Any = require_file_access,
        session_validator: Any = None,
    ):
        super().__init__(app)
        self.token_verifier = token_verifier
        self.identity_resolver = identity_resolver
        self.file_dao = file_dao
        self.access_checker = access_checker
        self.session_validator = session_validator

    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith(PRIVATE_MEDIA_PREFIXES):
            return await call_next(request)
        try:
            record = await authorize_private_media_request(
                request,
                token_verifier=self.token_verifier,
                identity_resolver=self.identity_resolver,
                file_dao=self.file_dao,
                access_checker=self.access_checker,
                session_validator=self.session_validator,
            )
        except PrivateMediaAuthenticationRequired:
            return JSONResponse({"detail": "Authentication required"}, status_code=401)
        except PrivateMediaNotFound:
            return JSONResponse({"detail": "Media not found"}, status_code=404)
        except Exception:
            logger.exception("Private media authorization failed")
            return JSONResponse({"detail": "Media authorization unavailable"}, status_code=503)

        response = await call_next(request)
        apply_safe_media_response_headers(
            response,
            request.url.path,
            download_name=str(record.get("file_name") or "") or None,
        )
        response.headers["Cache-Control"] = "private, no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
        return response
