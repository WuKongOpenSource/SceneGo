"""Legacy static image route and final unknown-path guard."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from routers.frontend_pages import PAGE_CACHE_HEADERS

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico")


def create_fallback_static_router(*, deploy_root: Path, logger: logging.Logger) -> APIRouter:
    router = APIRouter()

    @router.get("/{filename}")
    async def serve_image_files(filename: str):
        """Hand React routes to the SPA without exposing arbitrary host files.

        Public static assets have dedicated, rooted routes and mounts.  The old
        implementation searched the process directory, ``/root`` and uploads,
        which made a one-segment URL an unauthenticated file-discovery bypass.
        """
        if filename.startswith("api"):
            raise HTTPException(status_code=404, detail="Not Found")

        if not filename.lower().endswith(IMAGE_EXTENSIONS):
            # Match the main page and /assets mount; an old source-side bundle
            # must not reappear through a fallback URL after a new build.
            index_path = deploy_root / "dist" / "index.html"
            if index_path.is_file():
                logger.info("🔀 React路由: /%s, 返回 index.html", filename)
                return FileResponse(index_path, media_type="text/html", headers=PAGE_CACHE_HEADERS)
            raise HTTPException(status_code=404, detail="Not Found")

        raise HTTPException(status_code=404, detail="Not Found")

    @router.get("/{path:path}")
    async def catch_scanner_requests(path: str):




        scanner_patterns = [
            "wp-admin",
            "wp-login",
            "wp-content",
            "wordpress",
            "wp-includes",
            "phpmyadmin",
            "phpMyAdmin",
            "pma",
            "mysql",
            "administrator",
            "login.asp",
            "login.php",
            "admin.php",
            "setup-config.php",
            "config.php",
            "configuration.php",
            "geoserver",
            "wfs",
            "ows",
            "wms",
            "webui",
            "console",
            "manager",
            ".env",
            ".git",
            ".svn",
            ".htaccess",
            "shell",
            "cmd",
            "exec",
            "XDEBUG_SESSION",
        ]

        path_lower = path.lower()

        if any(pattern in path_lower for pattern in scanner_patterns):
            return Response(status_code=404)

        logger.warning("⚠️ 未知路径访问: /%s", path)
        return Response(status_code=404)

    return router
