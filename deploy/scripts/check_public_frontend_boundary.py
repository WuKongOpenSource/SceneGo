#!/usr/bin/env python3
"""Validate the source-edition frontend substitutions and optional build output."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


REQUIRED_REPLACEMENTS = {
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

PUBLIC_LOCAL_ADAPTER = "localRuntimeAdapter.ts"
ADAPTER_DELEGATING_REPLACEMENTS = (
    "comfyuiBridgeService.ts",
    "comfyuiGenerationService.ts",
    "comfyuiTaskQueue.ts",
    "comfyuiTaskWaitService.ts",
    "clusterNodeService.ts",
)
FORBIDDEN_ADAPTER_IMPLEMENTATION_VALUES = (
    "fetch(",
    "XMLHttpRequest",
    "WebSocket(",
    "apiJson",
    "apiBlob",
    "/prompt",
    "/history/",
    "/view",
    "/upload/image",
    "http://",
    "https://",
)

FORBIDDEN_VALUES = (
    "/api/comfyui/",
    "/api/agents/",
    "/api/cluster/",
    "/api/admin/agents",
    "/api/admin/workflows",
    "node-output-deletions",
    "127.0.0.1:8188",
    "tv.ostory.ai",
    "www.ostory.ai",
    "sshConfig",
)


def is_reviewed_help_catalog(path: Path, frontend_root: Path) -> bool:
    """Recognize only the unchanged editorial data asset, never runtime JSON/JS.

    Public documentation contains official site links and literal API examples.
    The Markdown reader treats these as text, not runtime configuration. Source
    privacy scanning and the help coverage/reproducibility gate still apply.
    """
    source = frontend_root / 'public/assets/help/catalog.json'
    try:
        if not source.is_file() or path.stat().st_size > 2_000_000 or path.read_bytes() != source.read_bytes():
            return False
        data = json.loads(path.read_text(encoding='utf-8'))
        if set(data) != {'version', 'updatedAt', 'sourceRevision', 'categories', 'documents'} or data['version'] != 1:
            return False
        if not re.fullmatch(r'[a-f0-9]{40}', data['sourceRevision']):
            return False
        groups = {group['id'] for group in data['categories'] if set(group) == {'id', 'title', 'description'}}
        if not groups or not data['documents']:
            return False
        required = {'id', 'title', 'category', 'summary', 'body', 'source'}
        allowed = required | {'sourceUrl', 'sourcePath'}
        return all(required <= set(doc) <= allowed and all(isinstance(value, str) for value in doc.values())
                   and re.fullmatch(r'[a-z0-9-]+', doc['id']) and doc['category'] in groups
                   for doc in data['documents'])
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return False


def audit_resolution_contract(root: Path, frontend: Path) -> list[str]:
    """Require the public commands to select one shared runtime mapping."""
    issues: list[str] = []
    paths: dict = {}
    config_path = root / "tsconfig.public.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        paths = config["compilerOptions"]["paths"]
        if not isinstance(paths, dict):
            raise TypeError("paths must be an object")
    except (OSError, UnicodeError, ValueError, KeyError, TypeError):
        paths = {}
        issues.append("tsconfig.public.json must define public runtime paths")
    for module, filename in REQUIRED_REPLACEMENTS.items():
        targets = paths.get(f"@runtime/{module}")
        expected = (frontend / "public-source" / filename).resolve()
        if (not isinstance(targets, list) or len(targets) != 1
                or not isinstance(targets[0], str)
                or (root / targets[0]).resolve() != expected):
            issues.append(f"tsconfig.public.json does not map @runtime/{module} to its public implementation")
    try:
        scripts = json.loads((root / "package.json").read_text(encoding="utf-8"))["scripts"]
        if not isinstance(scripts, dict):
            raise TypeError("scripts must be an object")
    except (OSError, UnicodeError, ValueError, KeyError, TypeError):
        scripts = {}
    for name, command in {
        "typecheck:public": "tsc --noEmit -p tsconfig.public.json",
        "test:public": "vitest run --config vitest.public.config.ts",
    }.items():
        if scripts.get(name) != command:
            issues.append(f"package.json {name} must use {command}")
    for filename, required in {
        "vite.public.config.ts": ("runtimeModuleAliases", "tsconfig.public.json"),
        "vitest.public.config.ts": ("./vite.public.config", "mergeConfig"),
    }.items():
        file = root / filename
        content = file.read_text(encoding="utf-8") if file.is_file() else ""
        if any(value not in content for value in required):
            issues.append(f"{filename} must share the public runtime resolution contract")
    if not (frontend / "runtimeModuleAliases.ts").is_file():
        issues.append("runtimeModuleAliases.ts is missing")
    return issues


def audit_frontend(frontend_root: Path, dist_root: Path | None = None) -> list[str]:
    root = frontend_root.resolve(strict=True)
    issues: list[str] = audit_resolution_contract(root, root)
    config_path = root / "vite.public.config.ts"
    package_path = root / "package.json"
    public_source = root / "public-source"

    if not config_path.is_file():
        issues.append("vite.public.config.ts is missing")
        config_text = ""
    else:
        config_text = config_path.read_text(encoding="utf-8")
    if not package_path.is_file():
        issues.append("package.json is missing")
    else:
        try:
            package = json.loads(package_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            issues.append(f"package.json is invalid: {type(exc).__name__}")
        else:
            command = str((package.get("scripts") or {}).get("build:public") or "")
            if "vite.public.config.ts" not in command:
                issues.append("package.json build:public does not use vite.public.config.ts")

    for private_name, replacement_name in REQUIRED_REPLACEMENTS.items():
        replacement = public_source / replacement_name
        if not replacement.is_file():
            issues.append(f"public-source/{replacement_name} is missing")
        if private_name not in config_text or replacement_name not in config_text:
            issues.append(f"vite.public.config.ts does not alias {private_name}")

    local_adapter = public_source / PUBLIC_LOCAL_ADAPTER
    if not local_adapter.is_file():
        issues.append(f"public-source/{PUBLIC_LOCAL_ADAPTER} is missing")
    else:
        adapter_text = local_adapter.read_text(encoding="utf-8")
        for value in FORBIDDEN_ADAPTER_IMPLEMENTATION_VALUES:
            if value in adapter_text:
                issues.append(
                    f"public-source/{PUBLIC_LOCAL_ADAPTER} contains local runtime implementation value {value}"
                )
        if "registerPublicLocalRuntimeAdapter" not in adapter_text or "PublicLocalRuntimeOperation" not in adapter_text:
            issues.append("public local runtime adapter must remain an abstract registration contract")

    for replacement_name in ADAPTER_DELEGATING_REPLACEMENTS:
        replacement = public_source / replacement_name
        if replacement.is_file() and "invokePublicLocalRuntime" not in replacement.read_text(encoding="utf-8"):
            issues.append(f"public-source/{replacement_name} does not use the public adapter contract")

    public_admin_auth = public_source / "adminAuth.ts"
    if public_admin_auth.is_file():
        admin_auth_text = public_admin_auth.read_text(encoding="utf-8")
        if "localStorage" in admin_auth_text or "auth_token" in admin_auth_text:
            issues.append("public-source/adminAuth.ts must not read or name a browser bearer token")
        if "pickTokenForCurrentRoute" not in admin_auth_text or "return null" not in admin_auth_text:
            issues.append("public-source/adminAuth.ts must keep browser bearer-token lookup disabled")

    public_index = root / "public-entry" / "index.html"
    if not public_index.is_file():
        issues.append("public-entry/index.html is missing")
    if "public-entry" not in config_text:
        issues.append("vite.public.config.ts does not use public-entry")
    source_files = [config_path, public_index]
    if public_source.is_dir():
        source_files.extend(
            path for path in public_source.rglob("*")
            if path.is_file() and path.suffix.lower() in {".ts", ".tsx", ".js", ".jsx"}
        )
    for path in source_files:
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            issues.append(f"{path.relative_to(root)} is not UTF-8 text")
            continue
        for value in FORBIDDEN_VALUES:
            if value in content:
                issues.append(f"{path.relative_to(root)} contains forbidden value {value}")

    if dist_root is not None:
        output = dist_root.resolve(strict=True)
        manifest = output / ".vite" / "manifest.json"
        if not manifest.is_file():
            issues.append("public build manifest is missing")
        for path in output.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".html", ".js", ".css", ".json"}:
                continue
            if path.relative_to(output).as_posix() == 'assets/help/catalog.json' and is_reviewed_help_catalog(path, root):
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for value in FORBIDDEN_VALUES:
                if value in content:
                    issues.append(f"build output {path.relative_to(output)} contains forbidden value {value}")

    return sorted(set(issues))


def audit_studio(
    studio_root: Path,
    frontend_root: Path,
    dist_root: Path | None = None,
) -> list[str]:
    root = studio_root.resolve(strict=True)
    frontend = frontend_root.resolve(strict=True)
    issues: list[str] = audit_resolution_contract(root, frontend)
    config_path = root / "vite.public.config.ts"
    package_path = root / "package.json"
    if not config_path.is_file():
        issues.append("studio/vite.public.config.ts is missing")
        config_text = ""
    else:
        config_text = config_path.read_text(encoding="utf-8")
    if not package_path.is_file():
        issues.append("studio/package.json is missing")
    else:
        try:
            package = json.loads(package_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            issues.append(f"studio/package.json is invalid: {type(exc).__name__}")
        else:
            command = str((package.get("scripts") or {}).get("build:public") or "")
            if "vite.public.config.ts" not in command:
                issues.append("studio build:public does not use vite.public.config.ts")

    for private_name, replacement_name in REQUIRED_REPLACEMENTS.items():
        if private_name not in config_text or replacement_name not in config_text:
            issues.append(f"studio/vite.public.config.ts does not alias {private_name}")
        if not (frontend / "public-source" / replacement_name).is_file():
            issues.append(f"shared public-source/{replacement_name} is missing")

    if not (frontend / "public-source" / PUBLIC_LOCAL_ADAPTER).is_file():
        issues.append(f"shared public-source/{PUBLIC_LOCAL_ADAPTER} is missing")

    for path in (config_path, root / "index.html"):
        if not path.is_file():
            continue
        content = path.read_text(encoding="utf-8")
        for value in FORBIDDEN_VALUES:
            if value in content:
                issues.append(f"studio/{path.relative_to(root)} contains forbidden value {value}")

    if dist_root is not None:
        output = dist_root.resolve(strict=True)
        if not (output / ".vite" / "manifest.json").is_file():
            issues.append("studio public build manifest is missing")
        for path in output.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".html", ".js", ".css", ".json"}:
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for value in FORBIDDEN_VALUES:
                if value in content:
                    issues.append(f"studio build output {path.relative_to(output)} contains forbidden value {value}")

    return sorted(set(issues))


def main() -> int:
    parser = argparse.ArgumentParser(description="Check source-edition frontend boundaries")
    parser.add_argument(
        "--frontend-root",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "new_html",
    )
    parser.add_argument("--dist-root", type=Path)
    parser.add_argument(
        "--studio-root",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "studio",
    )
    parser.add_argument("--studio-dist-root", type=Path)
    args = parser.parse_args()
    try:
        issues = audit_frontend(args.frontend_root, args.dist_root)
        issues.extend(audit_studio(args.studio_root, args.frontend_root, args.studio_dist_root))
    except (FileNotFoundError, NotADirectoryError) as exc:
        print(f"Public frontend boundary check could not start: {exc}")
        return 2
    if not issues:
        print("Public frontend boundary OK")
        return 0
    print(f"Public frontend boundary failed: {len(issues)} issue(s)")
    for issue in issues:
        print(f"- {issue}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
