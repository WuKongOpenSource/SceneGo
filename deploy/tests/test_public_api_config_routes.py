import pytest
from fastapi import APIRouter, FastAPI
from httpx import ASGITransport, AsyncClient

from routers.public_api_configs import create_public_api_config_router


def _source_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api-configs")
    async def list_configs():
        return []

    @router.post("/api-configs/import-keys")
    async def import_keys():
        return {"ok": True}

    @router.post("/api-configs/export-keys")
    async def export_keys():
        return {"keys": ["plaintext"]}

    return router


def test_public_router_keeps_configuration_but_removes_plaintext_bulk_export() -> None:
    router = create_public_api_config_router(_source_router())
    routes = {
        (method, route.path)
        for route in router.routes
        for method in (getattr(route, "methods", None) or set())
    }

    assert ("GET", "/api-configs") in routes
    assert ("POST", "/api-configs/import-keys") in routes
    assert ("POST", "/api-configs/export-keys") not in routes


@pytest.mark.asyncio
async def test_filtered_router_blocks_export_without_mutating_private_router():
    source = _source_router()
    public_app, private_app = FastAPI(), FastAPI()
    public_app.include_router(create_public_api_config_router(source), prefix="/admin")
    private_app.include_router(source, prefix="/admin")
    async with AsyncClient(transport=ASGITransport(app=public_app), base_url="http://test") as client:
        assert (await client.post("/admin/api-configs/export-keys")).status_code == 404
        assert (await client.get("/admin/api-configs")).status_code == 200
    async with AsyncClient(transport=ASGITransport(app=private_app), base_url="http://test") as client:
        assert (await client.post("/admin/api-configs/export-keys")).status_code == 200


def test_unreviewed_nested_router_fails_closed():
    parent = APIRouter()
    parent.include_router(_source_router())
    with pytest.raises(ValueError, match="explicit reviewed routes"):
        create_public_api_config_router(parent)
