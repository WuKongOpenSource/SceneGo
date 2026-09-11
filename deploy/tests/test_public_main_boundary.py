from pathlib import Path

import public_main
from fastapi.routing import iter_route_contexts


def test_public_main_does_not_register_private_local_execution_routes() -> None:
    paths = {route.path for route in iter_route_contexts(public_main.app.routes)}
    forbidden_prefixes = (
        "/api/agents",
        "/api/agent",
        "/api/comfyui",
        "/api/proxy/comfyui",
        "/api/cluster/nodes",
        "/api/node-outputs",
    )
    assert not any(
        path.startswith(prefix)
        for path in paths
        for prefix in forbidden_prefixes
    )
    assert "/api/generate" in paths
    assert "/api/admin/api-configs" in paths
    assert "/health" in paths
    assert "/api/admin/system/health" in paths
    assert "/api/video/capabilities" in paths
    assert "/api/video/crop" in paths


def test_public_video_capabilities_require_an_authenticated_session() -> None:
    route = next(route for route in iter_route_contexts(public_main.app.routes) if route.path == "/api/video/capabilities")
    dependencies = getattr(getattr(route, "dependant", None), "dependencies", [])
    assert any(dependency.call is public_main.require_auth for dependency in dependencies)


def test_public_admin_preserves_all_project_group_operations() -> None:
    expected = {
        ("GET", "/api/admin/project-groups"),
        ("POST", "/api/admin/project-groups"),
        ("GET", "/api/admin/project-groups/{group_id}/projects"),
        ("PUT", "/api/admin/project-groups/{group_id}"),
        ("DELETE", "/api/admin/project-groups/{group_id}"),
        ("GET", "/api/admin/ungrouped-projects"),
        ("POST", "/api/admin/projects/{project_id}/move"),
    }
    operations = [(method, route.path) for route in iter_route_contexts(public_main.app.routes)
                  for method in (getattr(route, "methods", None) or set())]
    for operation in expected:
        assert operations.count(operation) == 1, operation


def test_public_openapi_never_exposes_server_owned_authentication_hooks() -> None:
    schema = public_main.app.openapi()
    assert "/api/admin/project-groups" in schema["paths"]
    for path, methods in schema["paths"].items():
        for method, operation in methods.items():
            if not isinstance(operation, dict):
                continue
            names = {parameter["name"] for parameter in operation.get("parameters", [])}
            assert not names & {"identity_loader", "session_validator"}, (method, path, names)


def test_public_main_has_no_mixed_runtime_imports() -> None:
    source = Path(public_main.__file__).read_text(encoding="utf-8").lower()
    forbidden_imports = (
        "from cluster_main",
        "import cluster_main",
        "from admin_routes",
        "import admin_routes",
        "from api_routes",
        "import api_routes",
        "from routers.tasks",
        "from routers.generation",
        "from services.task_service",
        "from core.task_queue",
        "from agent_routes",
        "from cluster_manager",
    )
    assert not any(value in source for value in forbidden_imports)


def test_public_application_composition_has_no_private_transport_imports() -> None:
    source = Path(__file__).parents[1].joinpath("routers", "public_application.py").read_text(
        encoding="utf-8"
    ).lower()
    forbidden_imports = (
        "node_output_relay",
        "comfyui_agent",
        "cluster_manager",
        "workflow_handler",
        "services.task_service",
        "core.task_queue",
    )
    assert not any(value in source for value in forbidden_imports)
