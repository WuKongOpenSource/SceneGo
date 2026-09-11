import asyncio
import json
from pathlib import Path

from fastapi.responses import FileResponse, RedirectResponse
from PIL import Image

from routers.frontend_pages import ADMIN_ENTRY_PATH, _studio_dist_dir, create_frontend_pages_router


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def _route_endpoint(path: str):
    router = create_frontend_pages_router()
    return next(route.endpoint for route in router.routes if route.path == path)


def test_root_redirects_to_the_project_workspace():
    response = asyncio.run(_route_endpoint("/")())

    assert isinstance(response, RedirectResponse)
    assert response.status_code == 307
    assert response.headers["location"] == "/projects"


def test_favicon_routes_serve_the_chuangju_assets(monkeypatch):
    monkeypatch.chdir(DEPLOY_DIR)

    ico_response = asyncio.run(_route_endpoint("/favicon.ico")())
    png_response = asyncio.run(_route_endpoint("/favicon.png")())
    png_32_response = asyncio.run(_route_endpoint("/favicon-32x32.png")())
    png_16_response = asyncio.run(_route_endpoint("/favicon-16x16.png")())
    svg_response = asyncio.run(_route_endpoint("/favicon.svg")())
    apple_response = asyncio.run(_route_endpoint("/apple-touch-icon.png")())

    expectations = [
        (ico_response, "static/favicon.ico", "image/x-icon"),
        (png_response, "static/favicon-32x32.png", "image/png"),
        (png_32_response, "static/favicon-32x32.png", "image/png"),
        (png_16_response, "static/favicon-16x16.png", "image/png"),
        (svg_response, "static/favicon.svg", "image/svg+xml"),
        (apple_response, "static/apple-touch-icon.png", "image/png"),
    ]
    for response, path, media_type in expectations:
        assert isinstance(response, FileResponse)
        assert Path(response.path) == DEPLOY_DIR / path
        assert response.media_type == media_type
        assert response.headers["cache-control"] == "no-cache, no-store, must-revalidate"
        assert response.headers["pragma"] == "no-cache"
        assert response.headers["expires"] == "0"


def test_chuangju_favicon_files_have_valid_signatures():
    assert (DEPLOY_DIR / "static/favicon.ico").read_bytes()[:4] == b"\x00\x00\x01\x00"
    assert (DEPLOY_DIR / "static/favicon-32x32.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert (DEPLOY_DIR / "static/apple-touch-icon.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_chuangju_favicons_and_mark_use_the_clapperboard_play_symbol():
    login_html = (DEPLOY_DIR / "login.html").read_text(encoding="utf-8")

    assert "/static/branding/chuangju-logo-on-dark.svg" in login_html
    assert "/static/branding/chuangju-logo-on-light.svg" in login_html

    for relative_path in [
        "static/branding/chuangju-mark.png",
        "static/favicon-32x32.png",
    ]:
        image = Image.open(DEPLOY_DIR / relative_path).convert("RGBA")
        pixels = image.get_flattened_data()
        visible_pixels = sum(1 for _, _, _, alpha in pixels if alpha > 128)
        assert visible_pixels > 0

    mark = Image.open(DEPLOY_DIR / "static/branding/chuangju-mark.png").convert("RGBA")
    gradient = mark.getpixel((52, 230))
    front = mark.getpixel((300, 230))
    play_cutout = mark.getpixel((190, 228))

    assert gradient[3] == 255 and gradient[2] > gradient[0]
    assert front[3] == 255 and front[2] > front[0]
    assert play_cutout[3] == 0
    assert mark.getpixel((0, 0))[3] == 0


def test_chuangju_logo_assets_are_theme_ready_and_reproducible():
    image_expectations = {
        DEPLOY_DIR / "static/branding/chuangju-logo-on-light.png": (820, 368),
        DEPLOY_DIR / "static/branding/chuangju-logo-on-dark.png": (820, 368),
        DEPLOY_DIR / "static/branding/chuangju-mark.png": (368, 368),
    }

    for image_path, expected_size in image_expectations.items():
        image = Image.open(image_path)
        assert image.mode == "RGBA"
        assert image.size == expected_size
        assert image.getpixel((0, 0))[3] == 0

    generator = DEPLOY_DIR / "scripts/generate_ostory_brand_assets.py"
    assert generator.is_file()

    for relative_path in [
        "static/branding/chuangju-logo-on-light.svg",
        "static/branding/chuangju-logo-on-dark.svg",
    ]:
        source = (DEPLOY_DIR / relative_path).read_text(encoding="utf-8")
        assert 'font-family="Noto Sans SC, sans-serif"' in source
        assert 'font-weight="900"' in source


def test_login_page_uses_the_compact_easy_style_split_and_three_step_preview():
    login_html = (DEPLOY_DIR / "login.html").read_text(encoding="utf-8")

    assert "width: 44%;" in login_html
    assert "width: min(156px, 40vw);" in login_html
    assert "width: 136px;" in login_html
    assert "linear-gradient(145deg, #0C1628 0%, #09111F 54%, #070D18 100%)" in login_html
    assert 'class="workflow-showcase"' in login_html
    assert login_html.count('class="workflow-card"') == 3
    assert "写剧本" in login_html
    assert "做分镜" in login_html
    assert "出成片" in login_html
    assert '<h1><span>把一个好想法，</span><span>变成一部好漫剧</span></h1>' in login_html
    assert "把一个想法，变成一部好故事" not in login_html


def test_unregistered_sms_login_moves_to_prefilled_registration_without_fake_delivery_notice():
    login_html = (DEPLOY_DIR / "login.html").read_text(encoding="utf-8")

    assert "result.next_action === 'register'" in login_html
    assert "setView('register')" in login_html
    assert "registerPhone.value = result.phone || phone" in login_html
    assert "showError(result.message || '该手机号尚未注册，请先注册')" in login_html
    assert "result.sent === false" in login_html


def test_studio_routes_serve_the_sibling_build_directory():
    router = create_frontend_pages_router()
    studio_paths = {
        route.path
        for route in router.routes
        if route.path.startswith("/studio")
    }

    assert studio_paths == {"/studio", "/studio/", "/studio/{path:path}"}
    assert _studio_dist_dir() == DEPLOY_DIR.parent / "studio" / "dist"


def test_admin_shell_uses_the_non_default_entry_and_retires_old_admin_routes():
    router = create_frontend_pages_router()
    route_paths = {route.path for route in router.routes}

    assert ADMIN_ENTRY_PATH == "/a7k9m3q8x2v6n4p"
    assert ADMIN_ENTRY_PATH in route_paths
    assert f"{ADMIN_ENTRY_PATH}/{{path:path}}" in route_paths
    assert "/admin" in route_paths
    assert "/admin/{path:path}" in route_paths

    frontend_route = (DEPLOY_DIR / "new_html" / "admin" / "adminRoute.ts").read_text(encoding="utf-8")
    login_html = (DEPLOY_DIR / "login.html").read_text(encoding="utf-8")
    assert f"ADMIN_BASE_PATH = '{ADMIN_ENTRY_PATH}'" in frontend_route
    assert f"ADMIN_ENTRY_PATH = '{ADMIN_ENTRY_PATH}'" in login_html


def test_studio_build_toolchain_is_pinned_for_local_builds():
    package = json.loads(
        (DEPLOY_DIR.parent / "studio" / "package.json").read_text(encoding="utf-8")
    )
    dev_dependencies = package["devDependencies"]

    assert dev_dependencies["vite"] == "6.4.3"
    assert dev_dependencies["vitest"] == "4.1.11"
    assert dev_dependencies["rollup"] == "4.63.1"


def test_both_frontend_locks_keep_the_security_fixed_test_runtime():
    # Backend contracts also consume frontend metadata; rerun them on updates.
    for root in (DEPLOY_DIR / 'new_html', DEPLOY_DIR.parent / 'studio'):
        package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
        lock = json.loads((root / 'package-lock.json').read_text(encoding='utf-8'))
        version = package['devDependencies']['vitest']
        assert version == '4.1.11'
        assert lock['packages']['']['devDependencies']['vitest'] == version
        assert lock['packages']['node_modules/vitest']['version'] == version
        assert lock['packages']['node_modules/@vitest/mocker']['version'] == version
