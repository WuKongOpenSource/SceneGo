"""Frontend shell and static page routes."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response


DEPLOY_ROOT = Path(__file__).resolve().parents[1]

PAGE_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}
ICON_CACHE_HEADERS = PAGE_CACHE_HEADERS

ADMIN_ENTRY_PATH = "/a7k9m3q8x2v6n4p"


def _serve_html_entry(index_path: Path, unavailable_message: str):
    """Never cache an entry shell or disguise an incomplete install as healthy."""
    if index_path.is_file():
        return FileResponse(index_path, headers=PAGE_CACHE_HEADERS)
    return HTMLResponse(
        f"""
        <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h1>{unavailable_message}</h1>
        <p>Check the installation and build configuration for this runtime.</p>
        <p>For source-only installations, see docs/open-source/manual-installation.zh-CN.md.</p>
        </body></html>
        """,
        status_code=503,
        headers=PAGE_CACHE_HEADERS,
    )


def _serve_spa():
    """Use the same installed build tree as the application's /assets mount."""
    return _serve_html_entry(DEPLOY_ROOT / "dist" / "index.html", "Application is not built")


def _studio_dist_dir() -> Path:
    return DEPLOY_ROOT.parent / "studio" / "dist"


def _serve_studio_spa():
    """Return the independently-built Studio SPA entry."""
    return _serve_html_entry(_studio_dist_dir() / "index.html", "创剧自由画布尚未构建")


def _serve_icon(relative_path: str, media_type: str):
    icon_path = DEPLOY_ROOT / "static" / relative_path
    if icon_path.is_file():
        return FileResponse(icon_path, media_type=media_type, headers=ICON_CACHE_HEADERS)
    return Response(status_code=204, headers=ICON_CACHE_HEADERS)


def create_frontend_pages_router() -> APIRouter:
    router = APIRouter()

    @router.get("/")
    async def root():
        return RedirectResponse(url="/projects", status_code=307)

    @router.get("/login")
    @router.get("/register")
    @router.get("/legacy-login")
    @router.get("/bind-phone")
    @router.get("/password-reset")
    async def login_page():
        return _serve_html_entry(DEPLOY_ROOT / "login.html", "Login page is unavailable")

    @router.get("/favicon.ico")
    async def favicon():
        return _serve_icon("favicon.ico", "image/x-icon")

    @router.get("/favicon.png")
    @router.get("/favicon-32x32.png")
    async def favicon_png():
        return _serve_icon("favicon-32x32.png", "image/png")

    @router.get("/favicon-16x16.png")
    async def favicon_16_png():
        return _serve_icon("favicon-16x16.png", "image/png")

    @router.get("/favicon.svg")
    async def favicon_svg():
        return _serve_icon("favicon.svg", "image/svg+xml")

    @router.get("/apple-touch-icon.png")
    async def apple_touch_icon():
        return _serve_icon("apple-touch-icon.png", "image/png")

    @router.get("/editor")
    async def editor_page():
        return RedirectResponse("/projects", status_code=301)

    @router.get("/materials")
    async def materials_page():
        return RedirectResponse("/projects", status_code=301)

    @router.get("/generation")
    async def generation_page():
        return RedirectResponse("/projects", status_code=301)

    @router.get("/workspace")
    async def workspace_page():
        return RedirectResponse("/projects", status_code=301)

    @router.get("/app")
    async def app_page():
        return RedirectResponse(url="/projects")

    @router.get("/create")
    async def create_page():

        return _serve_spa()

    @router.get("/projects")
    async def projects_hub():
        return _serve_spa()

    @router.get("/updates")
    @router.get("/updates/")
    async def updates_page():
        return _serve_spa()

    @router.get("/tools")
    @router.get("/tools/{path:path}")
    async def global_tools_spa(path: str = ""):
        return _serve_spa()

    @router.get("/projects/{path:path}")
    async def projects_spa(path: str):
        return _serve_spa()

    @router.get("/share/final/{share_token}")
    async def final_product_share_spa(share_token: str):
        """Serve the public final-review SPA on direct link visits and refreshes."""
        return _serve_spa()

    @router.get("/profile")
    async def profile_page():
        return _serve_spa()

    @router.get("/credits")
    async def credits_page():
        return _serve_spa()

    @router.get("/canvas")
    async def canvas_page():
        return _serve_spa()

    @router.get("/canvas/{path:path}")
    async def canvas_spa(path: str):
        return _serve_spa()

    @router.get("/studio")
    @router.get("/studio/")
    async def studio_spa_root():
        return _serve_studio_spa()

    @router.get("/studio/{path:path}")
    async def studio_spa(path: str):
        return _serve_studio_spa()

    @router.get(ADMIN_ENTRY_PATH)
    @router.get(f"{ADMIN_ENTRY_PATH}/")
    async def admin_spa_root():
        return _serve_spa()

    @router.get(f"{ADMIN_ENTRY_PATH}/{{path:path}}")
    async def admin_spa_subpath(path: str):
        return _serve_spa()

    @router.get("/admin", include_in_schema=False)
    @router.get("/admin/{path:path}", include_in_schema=False)
    async def retired_admin_entry(path: str = ""):
        return Response(status_code=404)

    return router
