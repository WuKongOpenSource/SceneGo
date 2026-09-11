from pathlib import Path
import json
import os

import pytest

try:
    from scripts.check_public_frontend_boundary import FORBIDDEN_VALUES, REQUIRED_REPLACEMENTS, audit_frontend, audit_studio
except ModuleNotFoundError:
    from deploy.scripts.check_public_frontend_boundary import FORBIDDEN_VALUES, REQUIRED_REPLACEMENTS, audit_frontend, audit_studio


def _resolution_files(root: Path, frontend: Path, replacements: dict[str, str]) -> None:
    (root / "tsconfig.public.json").write_text(json.dumps({"compilerOptions": {"paths": {
        f"@runtime/{name}": [os.path.relpath(frontend / "public-source" / filename, root)]
        for name, filename in replacements.items()
    }}}), encoding="utf-8")
    (root / "vitest.public.config.ts").write_text(
        "import publicConfig from './vite.public.config';\nmergeConfig(publicConfig, {});\n",
        encoding="utf-8",
    )
    config = root / "vite.public.config.ts"
    config.write_text(config.read_text(encoding="utf-8") + "\nruntimeModuleAliases tsconfig.public.json\n", encoding="utf-8")
    (frontend / "runtimeModuleAliases.ts").write_text("export {};\n", encoding="utf-8")
    (root / "package.json").write_text(json.dumps({"scripts": {
        "build:public": "vite build --config vite.public.config.ts",
        "typecheck:public": "tsc --noEmit -p tsconfig.public.json",
        "test:public": "vitest run --config vitest.public.config.ts",
    }}), encoding="utf-8")


def _frontend(root: Path) -> Path:
    public_source = root / "public-source"
    public_source.mkdir(parents=True)
    replacements = {
        "videoTaskService": "videoTaskService.ts",
        "videoMediaService": "videoMediaService.ts",
        "audioGenerationService": "audioGenerationService.ts",
        "comfyuiGenerationService": "comfyuiGenerationService.ts",
        "comfyuiTaskWaitService": "comfyuiTaskWaitService.ts",
        "comfyuiTaskQueue": "comfyuiTaskQueue.ts",
        "comfyuiBridgeService": "comfyuiBridgeService.ts",
        "clusterNodeService": "clusterNodeService.ts",
        "processingQueueService": "processingQueueService.ts",
        "GpuNodeSelector": "GpuNodeSelector.tsx",
        "AdminPage": "AdminPage.tsx",
        "adminAuth": "adminAuth.ts",
    }
    config_lines = []
    for private_name, filename in replacements.items():
        content = (
            "export function pickTokenForCurrentRoute(): null { return null; }\n"
            if filename == "adminAuth.ts"
            else (
                "import { invokePublicLocalRuntime } from './localRuntimeAdapter';\n"
                "export const call = () => invokePublicLocalRuntime('media.upload', []);\n"
                if filename in {
                    "comfyuiBridgeService.ts",
                    "comfyuiGenerationService.ts",
                    "comfyuiTaskQueue.ts",
                    "comfyuiTaskWaitService.ts",
                    "clusterNodeService.ts",
                }
                else "export {};\n"
            )
        )
        (public_source / filename).write_text(content, encoding="utf-8")
        config_lines.append(f"{private_name}: {filename}")
    config_lines.append("root: public-entry")
    (public_source / "localRuntimeAdapter.ts").write_text(
        "export type PublicLocalRuntimeOperation = 'media.upload';\n"
        "export function registerPublicLocalRuntimeAdapter() {}\n"
        "export async function invokePublicLocalRuntime() {}\n",
        encoding="utf-8",
    )
    (root / "vite.public.config.ts").write_text("\n".join(config_lines), encoding="utf-8")
    (root / "package.json").write_text(
        '{"scripts":{"build:public":"vite build --config vite.public.config.ts"}}',
        encoding="utf-8",
    )
    public_entry = root / "public-entry"
    public_entry.mkdir()
    (public_entry / "index.html").write_text("<html></html>\n", encoding="utf-8")
    _resolution_files(root, root, replacements)
    return root


def test_safe_public_frontend_contract_passes(tmp_path: Path) -> None:
    assert audit_frontend(_frontend(tmp_path / "frontend")) == []


def test_private_endpoint_in_replacement_fails(tmp_path: Path) -> None:
    frontend = _frontend(tmp_path / "frontend")
    replacement = frontend / "public-source" / "videoMediaService.ts"
    replacement.write_text(f"export const endpoint = '{FORBIDDEN_VALUES[0]}upload';\n", encoding="utf-8")
    issues = audit_frontend(frontend)
    assert any("videoMediaService.ts contains forbidden value" in issue for issue in issues)


def test_public_admin_auth_cannot_restore_browser_bearer_tokens(tmp_path: Path) -> None:
    frontend = _frontend(tmp_path / "frontend")
    replacement = frontend / "public-source" / "adminAuth.ts"
    replacement.write_text(
        "export function pickTokenForCurrentRoute() { "
        "return localStorage.getItem('auth_token'); }\n",
        encoding="utf-8",
    )

    issues = audit_frontend(frontend)

    assert "public-source/adminAuth.ts must not read or name a browser bearer token" in issues


def test_public_local_adapter_cannot_embed_a_transport_implementation(tmp_path: Path) -> None:
    frontend = _frontend(tmp_path / "frontend")
    adapter = frontend / "public-source" / "localRuntimeAdapter.ts"
    adapter.write_text(
        "export type PublicLocalRuntimeOperation = 'media.upload';\n"
        "export function registerPublicLocalRuntimeAdapter() {}\n"
        "export async function invokePublicLocalRuntime() { return fetch('/prompt'); }\n",
        encoding="utf-8",
    )

    issues = audit_frontend(frontend)

    assert any("localRuntimeAdapter.ts contains local runtime implementation value" in issue for issue in issues)


def test_build_output_is_scanned(tmp_path: Path) -> None:
    frontend = _frontend(tmp_path / "frontend")
    output = tmp_path / "dist"
    (output / ".vite").mkdir(parents=True)
    (output / ".vite" / "manifest.json").write_text("{}\n", encoding="utf-8")
    (output / "app.js").write_text(f"const endpoint = '{FORBIDDEN_VALUES[1]}poll';\n", encoding="utf-8")
    issues = audit_frontend(frontend, output)
    assert any("build output app.js contains forbidden value" in issue for issue in issues)


def test_safe_public_studio_contract_passes(tmp_path: Path) -> None:
    frontend = _frontend(tmp_path / "frontend")
    studio = tmp_path / "studio"
    studio.mkdir()
    aliases = "\n".join(
        f"{name}: {filename}"
        for name, filename in {
            "videoTaskService": "videoTaskService.ts",
            "videoMediaService": "videoMediaService.ts",
            "audioGenerationService": "audioGenerationService.ts",
            "comfyuiGenerationService": "comfyuiGenerationService.ts",
            "comfyuiTaskWaitService": "comfyuiTaskWaitService.ts",
            "comfyuiTaskQueue": "comfyuiTaskQueue.ts",
            "comfyuiBridgeService": "comfyuiBridgeService.ts",
            "clusterNodeService": "clusterNodeService.ts",
            "processingQueueService": "processingQueueService.ts",
            "GpuNodeSelector": "GpuNodeSelector.tsx",
            "AdminPage": "AdminPage.tsx",
            "adminAuth": "adminAuth.ts",
        }.items()
    )
    (studio / "vite.public.config.ts").write_text(aliases, encoding="utf-8")
    (studio / "package.json").write_text(
        '{"scripts":{"build:public":"vite build --config vite.public.config.ts"}}',
        encoding="utf-8",
    )
    (studio / "index.html").write_text("<html></html>\n", encoding="utf-8")
    _resolution_files(studio, frontend, REQUIRED_REPLACEMENTS)

    assert audit_studio(studio, frontend) == []


@pytest.mark.parametrize("filename", ["tsconfig.public.json", "vitest.public.config.ts", "runtimeModuleAliases.ts"])
def test_missing_runtime_resolution_files_fail(tmp_path: Path, filename: str) -> None:
    frontend = _frontend(tmp_path / "frontend")
    (frontend / filename).unlink()
    assert any(filename in issue for issue in audit_frontend(frontend))


@pytest.mark.parametrize("target", ["services/videoTaskService.ts", "public-source/adminAuth.ts", "../private.ts"])
def test_public_types_cannot_resolve_another_implementation(tmp_path: Path, target: str) -> None:
    frontend = _frontend(tmp_path / "frontend")
    file = frontend / "tsconfig.public.json"
    config = json.loads(file.read_text(encoding="utf-8"))
    config["compilerOptions"]["paths"]["@runtime/videoTaskService"] = [target]
    file.write_text(json.dumps(config), encoding="utf-8")
    assert any("@runtime/videoTaskService" in issue for issue in audit_frontend(frontend))


@pytest.mark.parametrize("name", ["typecheck:public", "test:public"])
def test_public_checks_cannot_silently_fall_back_to_full_edition(tmp_path: Path, name: str) -> None:
    frontend = _frontend(tmp_path / "frontend")
    file = frontend / "package.json"
    config = json.loads(file.read_text(encoding="utf-8"))
    config["scripts"][name] = "tsc --noEmit" if name == "typecheck:public" else "vitest run"
    file.write_text(json.dumps(config), encoding="utf-8")
    assert any(name in issue for issue in audit_frontend(frontend))
