from fastapi import APIRouter, Depends, FastAPI

from scripts.check_public_route_authorization import audit_public_route_authorization


async def get_current_user() -> str:
    return "user"


def test_nested_lazy_router_cannot_escape_authentication_audit(monkeypatch):
    app, parent, child = FastAPI(), APIRouter(), APIRouter()
    @child.get("/secret")
    async def secret():
        return {"ok": True}
    parent.include_router(child, prefix="/nested")
    app.include_router(parent, prefix="/api")
    monkeypatch.setattr("scripts.check_public_route_authorization.ANONYMOUS_API_ROUTES", frozenset())
    assert [(item.method, item.path) for item in audit_public_route_authorization(app)] == [
        ("GET", "/api/nested/secret")
    ]


def test_nested_router_parent_authentication_is_respected(monkeypatch):
    app, child = FastAPI(), APIRouter()
    @child.get("/secret")
    async def secret():
        return {"ok": True}
    app.include_router(child, prefix="/api", dependencies=[Depends(get_current_user)])
    monkeypatch.setattr("scripts.check_public_route_authorization.ANONYMOUS_API_ROUTES", frozenset())
    assert audit_public_route_authorization(app) == []


def test_reviewed_anonymous_route_and_authenticated_route_pass(monkeypatch) -> None:
    app = FastAPI()

    @app.post("/api/login")
    async def login():
        return {"ok": True}

    @app.get("/api/private")
    async def private(_: str = Depends(get_current_user)):
        return {"ok": True}

    monkeypatch.setattr(
        "scripts.check_public_route_authorization.ANONYMOUS_API_ROUTES",
        frozenset({("POST", "/api/login")}),
    )

    assert audit_public_route_authorization(app) == []


def test_unreviewed_anonymous_api_route_fails(monkeypatch) -> None:
    app = FastAPI()

    @app.get("/api/accidental-public")
    async def accidental_public():
        return {"ok": True}

    monkeypatch.setattr(
        "scripts.check_public_route_authorization.ANONYMOUS_API_ROUTES",
        frozenset(),
    )

    issues = audit_public_route_authorization(app)

    assert [(issue.method, issue.path) for issue in issues] == [("GET", "/api/accidental-public")]


def test_stale_anonymous_allowlist_entry_fails(monkeypatch) -> None:
    app = FastAPI()
    monkeypatch.setattr(
        "scripts.check_public_route_authorization.ANONYMOUS_API_ROUTES",
        frozenset({("POST", "/api/removed")}),
    )

    issues = audit_public_route_authorization(app)

    assert issues[0].reason.startswith("anonymous-route allowlist entry is stale")
