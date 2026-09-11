"""Page entries must use the installed source tree, not the launch directory."""
from __future__ import annotations

import logging
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import frontend_pages
from routers.fallback_static import create_fallback_static_router


@pytest.fixture
def page_tree(tmp_path, monkeypatch):
    deploy_root = tmp_path / "installed" / "deploy"
    deploy_root.mkdir(parents=True)
    launch_dir = tmp_path / "launch"
    launch_dir.mkdir()
    monkeypatch.chdir(launch_dir)
    monkeypatch.setattr(frontend_pages, "DEPLOY_ROOT", deploy_root, raising=False)
    monkeypatch.setattr(
        frontend_pages, "_studio_dist_dir", lambda: deploy_root.parent / "studio" / "dist"
    )
    app = FastAPI()
    app.include_router(frontend_pages.create_frontend_pages_router())
    app.include_router(create_fallback_static_router(deploy_root=deploy_root, logger=logging.getLogger(__name__)))
    with TestClient(app) as client:
        yield deploy_root, launch_dir, client


def write_entry(root, relative, content):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def assert_uncached(response):
    assert response.headers["cache-control"] == "no-cache, no-store, must-revalidate"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["expires"] == "0"


@pytest.mark.parametrize("url", [
    "/projects", "/projects/example/ep/example/workflow/video", "/tools/history",
    "/updates", "/canvas/example", "/share/final/example",
    frontend_pages.ADMIN_ENTRY_PATH + "/settings", "/projects-shell",
])
def test_spa_routes_use_one_build_directory_even_with_a_decoy_cwd(page_tree, url):
    deploy_root, launch_dir, client = page_tree
    write_entry(deploy_root, "dist/index.html", "<html>installed-shell</html>")
    write_entry(deploy_root, "new_html/dist/index.html", "<html>obsolete-shell</html>")
    write_entry(launch_dir, "dist/index.html", "<html>unrelated-shell</html>")

    response = client.get(url)

    assert response.status_code == 200
    assert response.text == "<html>installed-shell</html>"
    assert_uncached(response)


@pytest.mark.parametrize("url", ["/login", "/register", "/legacy-login", "/bind-phone", "/password-reset"])
def test_login_entries_are_rooted_and_not_cached(page_tree, url):
    deploy_root, launch_dir, client = page_tree
    write_entry(deploy_root, "login.html", "<html>installed-login</html>")
    write_entry(launch_dir, "login.html", "<html>unrelated-login</html>")

    response = client.get(url)

    assert response.status_code == 200
    assert response.text == "<html>installed-login</html>"
    assert_uncached(response)


@pytest.mark.parametrize("url", ["/projects", "/studio/", "/login"])
@pytest.mark.parametrize("directory_instead_of_file", [False, True])
def test_missing_entry_returns_uncached_service_unavailable(page_tree, url, directory_instead_of_file):
    deploy_root, launch_dir, client = page_tree
    relative = {"/projects": "dist/index.html", "/studio/": "../studio/dist/index.html", "/login": "login.html"}[url]
    if directory_instead_of_file:
        (deploy_root / relative).mkdir(parents=True)
    write_entry(launch_dir, "dist/index.html", "<html>unrelated-shell</html>")
    write_entry(launch_dir, "login.html", "<html>unrelated-login</html>")

    response = client.get(url)

    assert response.status_code == 503
    assert "unrelated" not in response.text
    assert "npm run build" not in response.text
    assert_uncached(response)


def test_studio_entry_also_preserves_no_cache_headers(page_tree):
    deploy_root, _, client = page_tree
    write_entry(deploy_root.parent, "studio/dist/index.html", "<html>studio-shell</html>")
    response = client.get("/studio/canvas/example")
    assert response.status_code == 200
    assert response.text == "<html>studio-shell</html>"
    assert_uncached(response)


@pytest.mark.parametrize("url,filename", [
    ("/favicon.ico", "favicon.ico"), ("/favicon.png", "favicon-32x32.png"),
    ("/favicon.svg", "favicon.svg"), ("/apple-touch-icon.png", "apple-touch-icon.png"),
])
def test_icons_do_not_depend_on_or_fall_back_to_cwd(page_tree, url, filename):
    deploy_root, launch_dir, client = page_tree
    write_entry(deploy_root, "static/" + filename, "installed-icon")
    write_entry(launch_dir, "static/" + filename, "unrelated-icon")
    response = client.get(url)
    assert response.status_code == 200
    assert response.text == "installed-icon"
    assert_uncached(response)
    (deploy_root / "static" / filename).unlink()
    assert client.get(url).status_code == 204


def test_fallback_does_not_resurrect_an_obsolete_build(page_tree):
    deploy_root, _, client = page_tree
    write_entry(deploy_root, "new_html/dist/index.html", "<html>obsolete-shell</html>")
    response = client.get("/projects-shell")
    assert response.status_code == 404
    assert "obsolete-shell" not in response.text


@pytest.mark.parametrize("url", ["/api", "/api-no-such-route", "/api/private", "/private.png", "/.git/config"])
def test_fallback_keeps_api_media_and_nested_unknown_paths_closed(page_tree, url):
    deploy_root, _, client = page_tree
    write_entry(deploy_root, "dist/index.html", "<html>installed-shell</html>")
    response = client.get(url)
    assert response.status_code == 404
    assert "installed-shell" not in response.text


def test_login_captcha_assets_exist_in_the_public_source_profile():
    from scripts.check_public_release_boundary import PUBLIC_AUTH_ENTRY_FILES, REQUIRED_PATHS, _matches_glob

    root = Path(__file__).resolve().parents[2]
    login = (root / "deploy/login.html").read_text(encoding="utf-8")
    for relative in PUBLIC_AUTH_ENTRY_FILES:
        assert relative in REQUIRED_PATHS
        assert not _matches_glob(relative)
        assert (root / relative).is_file()
        if relative != "deploy/login.html":
            assert relative.removeprefix("deploy") in login
