import asyncio
import json
import re
from datetime import date
from pathlib import Path

from fastapi.responses import FileResponse

from routers.frontend_pages import create_frontend_pages_router


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def test_release_metadata_has_a_valid_version_and_bounded_recent_history():
    release = json.loads((DEPLOY_DIR / "static/platform-release.json").read_text(encoding="utf-8"))
    assert release["schemaVersion"] == 1
    assert re.fullmatch(r"\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?", release["version"])
    start, end = (date.fromisoformat(release["period"][key]) for key in ("from", "to"))
    assert (end - start).days == 6
    assert date.fromisoformat(release["updatedAt"]) == end
    dates = [date.fromisoformat(record["date"]) for record in release["records"]]
    assert dates and dates == sorted(set(dates), reverse=True)
    for record, recorded_on in zip(release["records"], dates):
        assert start <= recorded_on <= end
        assert record["title"] and record["changes"]
        for change in record["changes"]:
            assert change["kind"] in {"new", "improvement", "fix"}
            assert change["text"].strip()


def test_updates_direct_links_serve_spa_without_authentication_or_caching(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("routers.frontend_pages.DEPLOY_ROOT", tmp_path)
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist/index.html").write_text("<html></html>", encoding="utf-8")
    routes = create_frontend_pages_router().routes
    for path in ("/updates", "/updates/"):
        route = next(route for route in routes if route.path == path)
        assert not route.dependencies
        response = asyncio.run(route.endpoint())
        assert isinstance(response, FileResponse)
        assert Path(response.path) == tmp_path / "dist/index.html"
        assert "no-store" in response.headers["cache-control"]




def test_frontend_route_contract_includes_updates_routes():
    from public_main import app
    from fastapi.routing import iter_route_contexts

    expected = {(method, route.path) for route in create_frontend_pages_router().routes for method in route.methods}
    registered = {(method, route.path) for route in iter_route_contexts(app.routes) for method in (getattr(route, "methods", None) or ())}
    assert len(expected) == 37
    assert {("GET", "/updates"), ("GET", "/updates/")} <= expected
    assert expected <= registered


def test_workspace_shells_hide_the_footer_and_public_entries_keep_release_information():
    main = (DEPLOY_DIR / "new_html/App.tsx").read_text(encoding="utf-8")
    studio = (DEPLOY_DIR.parent / "studio/main.tsx").read_text(encoding="utf-8")
    component = (DEPLOY_DIR / "new_html/components/PlatformFooter.tsx").read_text(encoding="utf-8")
    shell = (DEPLOY_DIR / "new_html/components/PlatformShell.tsx").read_text(encoding="utf-8")
    styles = (DEPLOY_DIR / "new_html/styles/platform-release.css").read_text(encoding="utf-8")
    login = (DEPLOY_DIR / "login.html").read_text(encoding="utf-8")
    script = (DEPLOY_DIR / "static/platform-version.js").read_text(encoding="utf-8")
    assert "<RoutedPlatformShell>" in main
    assert "<PlatformShell><StudioEntry /></PlatformShell>" in studio
    assert "<PlatformFooter />" not in main + studio
    assert "showFooter = false" in shell
    assert "{showFooter && <PlatformFooter />}" in shell
    assert ".platform-shell-workspace { --platform-footer-height: 0px; }" in styles
    assert "../../static/platform-release.json" in component
    assert 'src="/static/platform-version.js"' in login
    assert 'href="/updates"' in login
    assert "'/static/platform-release.json'" in script
    assert "innerHTML" not in script
