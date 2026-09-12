#!/usr/bin/env python3
"""Validate that an explicitly selected public candidate obeys release boundaries.

The development repository is intentionally broader than the public source
edition. This command therefore has no implicit default: callers must name the
candidate directory they intend to publish. It reports paths and rule names,
never file contents or potential secret values.
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import os
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


# This reviewed profile must survive source-only distribution. It is also run
# in an isolated test tree; do not replace it with failure-based test filtering.
PUBLIC_RUNTIME_REGRESSION_TESTS = (
    "deploy/tests/test_builtin_admin_config.py",
    "deploy/tests/test_admin_bootstrap_service.py",
    "deploy/tests/test_admin_role_permissions.py",
    "deploy/tests/test_task_service_credit_billing.py",
    "deploy/tests/test_video_client_base.py",
    "deploy/tests/test_seedance_audio_validation.py",
    "deploy/tests/test_online_daily_quota.py",
    "deploy/tests/test_task_cancellation.py",
    "deploy/tests/test_task_terminal_guards.py",
    "deploy/tests/test_cors_configuration.py",
    "deploy/tests/test_runtime_health_service.py",
    "deploy/tests/test_cluster_status_health.py",
    "deploy/tests/test_generate_route_workflow_prepare.py",
    "deploy/tests/test_media_reference_submission.py",
    "deploy/tests/test_video_crop_service.py",
    "deploy/tests/test_dashscope_wiring_e2e.py",
    "deploy/tests/test_worker_minimax_tts.py",
    "deploy/tests/test_worker_external_api_non_retryable.py",
    "deploy/tests/test_worker_file_url_resolution.py",
    "deploy/tests/test_public_admin_credits.py",
    "deploy/tests/test_backend_test_database.py",
    "deploy/tests/test_online_provider_queue.py",
    "deploy/tests/test_online_provider_task_router.py",
    "deploy/tests/test_online_provider_worker.py",
    "deploy/tests/test_online_provider_worker_lifespan.py",
    "deploy/tests/test_public_account_isolation.py",
    "deploy/tests/test_session_cookie.py",
    "deploy/tests/test_project_group_management.py",
    "deploy/tests/test_project_group_data.py",
    "deploy/tests/test_project_groups_routes.py",
    "deploy/tests/test_public_admin_user_routes.py",
    "deploy/tests/test_public_api_config_routes.py",
    "deploy/tests/test_public_feedback_rate_limit_service.py",
    "deploy/tests/test_public_frontend_boundary.py",
    "deploy/tests/test_public_health.py",
    "deploy/tests/test_public_import_boundary.py",
    "deploy/tests/test_public_lifespan.py",
    "deploy/tests/test_public_main_boundary.py",
    "deploy/tests/test_public_minimax_tts_enqueue.py",
    "deploy/tests/test_api_minimax_tts_enqueue.py",
    "deploy/tests/test_public_release_boundary.py",
    "deploy/tests/test_public_route_authorization.py",
    "deploy/tests/test_public_video_capabilities.py",
    "deploy/tests/test_public_video_crop_service.py",
    "deploy/tests/test_public_video_reverse.py",
    "deploy/tests/test_video_submission_grace.py",
    "deploy/tests/test_video_timing_contract.py",
    "deploy/tests/test_video_reverse_access.py",
    "deploy/tests/test_video_reverse_atomicity.py",
    "deploy/tests/test_video_reverse_reconciliation.py",
    "deploy/tests/test_video_reverse_episode_filter.py",
    "deploy/tests/test_video_reverse_service_guard.py",
)

PUBLIC_AUTH_ENTRY_FILES = (
    "deploy/login.html",
    "deploy/static/css/slider-captcha.css",
    "deploy/static/css/tab-navigation.css",
    "deploy/static/js/slider-captcha.js",
)

# The active captcha shares a directory with retired token-based browser code.
# Keep only this reviewed source file, with normal content scanning still on.
PUBLIC_STATIC_SCRIPT_EXCEPTIONS = frozenset({"deploy/static/js/slider-captcha.js"})

REQUIRED_PATHS = (
    "README.md",
    "SECURITY.md",
    "LICENSE",
    "PUBLIC_SOURCE_FILES.sha256",
    "deploy/requirements.txt",
    "deploy/requirements-test.txt",
    "deploy/pytest.ini",
    "deploy/tests/test_python_dependency_contract.py",
    "deploy/tests/test_python_dependency_locks.py",
    "deploy/scripts/check_python_dependency_locks.py",
    "deploy/scripts/check_npm_sbom.py",
    "deploy/tests/test_npm_sbom.py",
    "deploy/scripts/check_npm_license_supplement.py",
    "deploy/tests/test_npm_license_supplement.py",
    "deploy/scripts/check_esbuild_distribution_evidence.py",
    "deploy/tests/test_esbuild_distribution_evidence.py",
    "docs/open-source/third-party/npm-esbuild-build-evidence.json",
    "docs/open-source/third-party/licenses/npm-esbuild-go-LICENSE.txt",
    "docs/open-source/third-party/licenses/npm-esbuild-go-PATENTS.txt",
    "docs/open-source/third-party/npm-review.zh-CN.md",
    "docs/open-source/third-party/npm-license-supplement.json",
    "docs/open-source/third-party/licenses/npm-esbuild-0.25.12.txt",
    "docs/open-source/third-party/licenses/npm-rollup-4.63.1-core.txt",
    "docs/open-source/third-party/licenses/npm-saxes-6.0.0.txt",
    "docs/open-source/third-party/licenses/npm-saxes-6.0.0-authors.txt",
    "docs/open-source/third-party/declarations/npm-dlv-1.1.3.txt",
    "deploy/dependency-locks/manifest.json",
    "deploy/dependency-locks/bootstrap.txt",
    "deploy/dependency-locks/build.txt",
    "deploy/dependency-locks/linux-cpython312-runtime.txt",
    "deploy/dependency-locks/linux-cpython312-test.txt",
    "deploy/dependency-locks/windows-cpython312-runtime.txt",
    "deploy/dependency-locks/windows-cpython312-test.txt",
    "deploy/public_main.py",
    *PUBLIC_AUTH_ENTRY_FILES,
    "deploy/tests/test_frontend_entry_files.py",
    "deploy/core/online_provider_queue.py",
    "deploy/core/video_submission_grace.py",
    "deploy/core/daily_task_quota.py",
    "deploy/core/online_provider_task_model.py",
    "deploy/core/online_provider_task_types.py",
    "deploy/core/online_provider_tasks.py",
    "deploy/core/online_provider_worker.py",
    "deploy/services/online_provider_task_service.py",
    "deploy/services/seedance_task_identity.py",
    "deploy/services/online_task_quota_service.py",
    "deploy/services/online_video_catalog_service.py",
    "deploy/services/public_video_capability_service.py",
    "deploy/services/public_video_crop_service.py",
    "deploy/routers/online_provider_tasks.py",
    "deploy/routers/public_application.py",
    "deploy/routers/public_api_configs.py",
    "deploy/routers/public_health.py",
    "deploy/routers/public_video.py",
    "deploy/routers/public_video_capabilities.py",
    "deploy/scripts/check_public_frontend_boundary.py",
    "deploy/scripts/check_public_import_boundary.py",
    "deploy/scripts/check_code_comment_language.py",
    "deploy/scripts/check_code_comment_language.mjs",
    "deploy/scripts/check_public_release_boundary.py",
    "deploy/scripts/check_public_route_authorization.py",
    "deploy/scripts/source_contract_utils.py",
    "deploy/tests/conftest.py",
    "deploy/tests/backend_test_database.py",
    "deploy/tests/worker_lifespan_contract.py",
    "deploy/tests/provider_execution_contract.py",
    "deploy/tests/admin_role_contract.py",
    "deploy/tests/builtin_admin_contract.py",
    "deploy/tests/task_billing_contract.py",
    "deploy/tests/tts_enqueue_contract.py",
    "deploy/tests/seedance_audio_contract.py",
    "deploy/tests/daily_quota_contract.py",
    "deploy/tests/task_cancellation_contract.py",
    "deploy/tests/task_terminal_contract.py",
    "deploy/tests/runtime_health_contract.py",
    "deploy/tests/generation_route_contract.py",
    "deploy/tests/video_crop_contract.py",
    "deploy/tests/test_public_runtime_source_isolation.py",
    # Source/static contracts are mandatory files and run in the full public
    # suite, separate from the smaller import-closure-only runtime profile.
    "deploy/tests/test_admin_user_service.py",
    "deploy/tests/test_admin_compat_service.py",
    "deploy/tests/test_admin_workflow_import_repair.py",
    "deploy/tests/test_credit_onboarding_migration.py",
    "deploy/tests/test_migration_ledger.py",
    "deploy/tests/test_provider_remote_objects_migration.py",
    "deploy/tests/test_storyboard_reference_config_migration.py",
    "deploy/tests/test_platform_release.py",
    "deploy/tests/test_private_media_cache_control.py",
    "deploy/tests/test_task_stale_reaper.py",
    *PUBLIC_RUNTIME_REGRESSION_TESTS,
    "deploy/new_html/package.json",
    "deploy/new_html/package-lock.json",
    "deploy/new_html/vite.public.config.ts",
    "deploy/new_html/tsconfig.public.json",
    "deploy/new_html/vitest.public.config.ts",
    "deploy/new_html/runtimeModuleAliases.ts",
    "deploy/new_html/__tests__/publicRuntimeResolution.test.ts",
    "deploy/new_html/public-entry/index.html",
    "deploy/new_html/public-source/runtimeUnavailable.ts",
    "deploy/new_html/public-source/localRuntimeAdapter.ts",
    "deploy/new_html/public-source/videoTaskService.ts",
    "deploy/new_html/public-source/videoMediaService.ts",
    "deploy/new_html/public-source/audioGenerationService.ts",
    "deploy/new_html/public-source/clusterNodeService.ts",
    "deploy/new_html/public-source/comfyuiBridgeService.ts",
    "deploy/new_html/public-source/comfyuiGenerationService.ts",
    "deploy/new_html/public-source/comfyuiTaskQueue.ts",
    "deploy/new_html/public-source/comfyuiTaskWaitService.ts",
    "deploy/new_html/public-source/GpuNodeSelector.tsx",
    "deploy/new_html/public-source/adminAuth.ts",
    "deploy/new_html/public-source/processingQueueService.ts",
    "studio/package.json",
    "studio/package-lock.json",
    "studio/vite.public.config.ts",
    "studio/tsconfig.public.json",
    "studio/vitest.public.config.ts",
    "studio/publicRuntimeResolution.test.ts",
    "docs/open-source/README.zh-CN.md",
    "docs/open-source/manual-installation.zh-CN.md",
    "docs/open-source/dependency-review.zh-CN.md",
    "deploy/scripts/check_python_license_supplement.py",
    "deploy/tests/test_python_license_supplement.py",
    "docs/open-source/third-party/README.zh-CN.md",
    "docs/open-source/third-party/licenses/Apache-2.0.txt",
    "docs/open-source/third-party/declarations/alibabacloud-credentials.txt",
    "docs/open-source/third-party/licenses/alibabacloud-credentials-api-LICENSE.txt",
    "docs/open-source/third-party/licenses/alibabacloud-gateway-LICENSE.txt",
    "docs/open-source/third-party/declarations/alibabacloud-tea.txt",
    "docs/open-source/third-party/declarations/alibabacloud-tea-openapi.txt",
    "docs/open-source/third-party/declarations/alibabacloud-tea-util.txt",
    "docs/open-source/third-party/licenses/tea-util-LICENSE.txt",
    "docs/open-source/third-party/declarations/darabonba-core.txt",
    "docs/open-source/third-party/python-license-supplement.json",
    "docs/open-source/configuration-reference.zh-CN.md",
    "docs/open-source/provider-configuration.zh-CN.md",
    "docs/open-source/comfyui-integration.zh-CN.md",
    "docs/open-source/public-release-boundary.zh-CN.md",
    "docs/open-source/security-release-checklist.zh-CN.md",
    "docs/open-source/support-policy.zh-CN.md",
)

RELEASE_COMPLETION_FILES = (
    "README.md",
    "SECURITY.md",
    "docs/open-source/support-policy.zh-CN.md",
)

INCOMPLETE_RELEASE_MARKERS = (
    "<FILL_ME_BEFORE_PUBLIC_RELEASE>",
)

MINIMUM_LICENSE_BYTES = 200
PUBLIC_SOURCE_MANIFEST = "PUBLIC_SOURCE_FILES.sha256"
MANIFEST_LINE = re.compile(r"^([0-9a-f]{64})  ([^\\]+)$")

FORBIDDEN_DIRECTORY_NAMES = {
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "backups",
    "build",
    "dist",
    "logs",
    "node_modules",
    "persistent_storage",
    "release-artifacts",
    "venv",
    "ansible",
    "terraform",
    "helm",
    "k8s",
    "kubernetes",
}

FORBIDDEN_FILE_SUFFIXES = {
    ".7z",
    ".bundle",
    ".exe",
    ".img",
    ".iso",
    ".msi",
    ".pyc",
    ".pyo",
    ".tar",
    ".tgz",
    ".whl",
    ".zip",
}

FORBIDDEN_BASENAME = re.compile(
    r"^(?:dockerfile(?:\..+)?|containerfile(?:\..+)?|"
    r"docker-compose(?:\..+)?\.ya?ml|compose(?:\..+)?\.ya?ml|caddyfile|"
    r"nginx(?:[-_.].+)?\.conf|.+\.nginx\.conf|\.dockerignore|"
    r"makefile|gnumakefile|justfile|taskfile(?:\..+)?\.ya?ml|chart\.ya?ml)$",
    re.IGNORECASE,
)

FORBIDDEN_DEPLOYMENT_SUFFIXES = {
    ".sh", ".bash", ".ps1", ".psm1", ".cmd", ".bat",
    ".service", ".timer", ".socket", ".tf", ".tfvars",
}

FORBIDDEN_DEPLOYMENT_SCRIPT_NAME = re.compile(
    r"^(?:(?:auto|fix|one[-_]?click)[-_])?"
    r"(?:deploy|install|setup|start|stop|restart|upgrade|rollback|provision|bootstrap)"
    r"(?:[-_.].*)?\.(?:py|js|mjs|cjs)$",
    re.IGNORECASE,
)

FORBIDDEN_GLOBS = (
    "deploy/new_html/__tests__/private-runtime/**",
    "deploy/new_html/components/AdminPage.tsx",
    # Ovideo-developed ComfyUI execution and task-relay implementations.
    "deploy/comfyui_agent.py",
    "deploy/comfyui_main.py",
    "deploy/agent_routes.py",
    "deploy/agent_api.py",
    "deploy/dao_agent.py",
    "deploy/dao_workflow_template.py",
    "deploy/cluster_manager.py",
    "deploy/worker.py",
    "deploy/core/cluster_manager.py",
    "deploy/core/agent_dispatch_guard.py",
    # Private runtime and generated cluster configuration are deployment
    # inputs, not portable source-edition defaults.
    "deploy/cluster_config.py",
    "deploy/cluster_config_generated.py",
    "deploy/config.py",
    "deploy/sync_users_to_db.py",
    # This file currently mixes online-provider dispatch with Ovideo's local
    # ComfyUI execution engine. It must be split before any public candidate
    # can include the online worker half.
    "deploy/core/worker.py",
    "deploy/core/task_queue.py",
    "deploy/core/task_types.py",
    "deploy/cluster_main.py",
    "deploy/admin_routes.py",
    "deploy/api_routes.py",
    "deploy/routers/tasks.py",
    "deploy/routers/generation.py",
    "deploy/services/task_service.py",
    "deploy/dao/admin/agent.py",
    "deploy/dao/admin/workflow_template.py",
    "deploy/pipeline/comfyui_agent.py",
    "deploy/pipeline/comfyui_main.py",
    "deploy/pipeline/workflow_config.py",
    "deploy/pipeline/workflow_handler.py",
    "deploy/pipeline/workflow_manager.py",
    "deploy/pipeline/workflow_*.py",
    "deploy/workflow_*.py",
    "deploy/routers/comfyui_files.py",
    "deploy/routers/cluster_status.py",
    "deploy/routers/node_outputs.py",
    "deploy/services/comfyui_file_service.py",
    "deploy/services/cluster_node_service.py",
    "deploy/services/node_output_relay.py",
    "deploy/services/video_source_service.py",
    "deploy/services/video_crop_service.py",
    "deploy/services/video_enhancement_service.py",
    "deploy/services/image_upscale_contract.py",
    "deploy/scripts/repair_verified_workflow_templates.py",
    "deploy/utils/image_processor.py",
    # These catalogs/gates describe the mixed private application. Generic AST
    # assertions live in source_contract_utils; public routes have their own gate.
    "deploy/context/routes.json",
    "deploy/scripts/check_route_contract.py",
    "deploy/scripts/check_architecture_contracts.py",
    "deploy/new_html/index.html",
    "deploy/new_html/__tests__/styles/privateHostedShell.test.ts",
    "deploy/new_html/__tests__/services/privateVideoMediaService.test.ts",
    # Superseded browser implementation still persists Bearer tokens and adds
    # them to media URLs. The current SPA is under deploy/new_html.
    "deploy/static/js/**",
    "deploy/new_html/services/comfyui*.ts",
    "deploy/new_html/services/comfyui*.tsx",
    "deploy/new_html/services/clusterNodeService.ts",
    "deploy/new_html/services/processingQueueService.ts",
    "deploy/new_html/services/videoTaskService.ts",
    "deploy/new_html/services/videoMediaService.ts",
    "deploy/new_html/services/audioGenerationService.ts",
    "deploy/new_html/components/GpuNodeSelector.tsx",
    "deploy/new_html/**/services/comfyui*.ts",
    "deploy/new_html/**/services/comfyui*.tsx",
    "deploy/new_html/**/services/clusterNodeService.ts",
    "deploy/new_html/**/services/processingQueueService.ts",
    "deploy/new_html/**/services/videoTaskService.ts",
    "deploy/new_html/**/services/videoMediaService.ts",
    "deploy/new_html/**/services/audioGenerationService.ts",
    "deploy/new_html/**/components/GpuNodeSelector.tsx",
    "deploy/new_html/admin/adminAuth.ts",
    "workflows/**",
    "deploy/workflows/**",
    # Ovideo-developed local node installation, registration, and deployment.
    "deploy/containers/**",
    "deploy/auto_deploy*",
    "deploy/scripts/deploy_*",
    "deploy/scripts/*gpu*",
    "deploy/scripts/register_gpu_agent.py",
    "deploy/scripts/*node*output*",
    "deploy/scripts/build_clean_migration_package.py",
    "deploy/scripts/build_workflow_catalog.py",
    "deploy/scripts/sync_workflow_templates_from_catalog.py",
    "deploy/tests/test_build_workflow_catalog.py",
    "deploy/tests/test_sync_workflow_templates_from_catalog.py",
    # Tests and fixtures can disclose the private protocol just as precisely as
    # production files, so known local-runtime suites are excluded as well.
    "deploy/tests/*comfyui*",
    "deploy/tests/*gpu*",
    "deploy/tests/*agent*",
    "deploy/tests/test_auto_deploy_cluster_security.py",
    "deploy/tests/test_ostory_container_deploy.py",
    "deploy/tests/test_container_release_contract.py",
    "deploy/tests/test_cluster_node_service.py",
    "deploy/tests/test_cluster_lifespan.py",
    "deploy/tests/test_cluster_manager_lifespan.py",
    "deploy/tests/test_worker_lifespan.py",
    "deploy/tests/test_private_provider_execution.py",
    "deploy/tests/test_private_task_cancellation.py",
    "deploy/tests/test_private_task_terminal_guards.py",
    "deploy/tests/test_private_admin_role_permissions.py",
    "deploy/tests/test_private_builtin_admin_config.py",
    "deploy/tests/test_private_cluster_status_health.py",
    "deploy/tests/test_private_image_upscale_outputs.py",
    "deploy/tests/test_private_generate_route_workflow_prepare.py",
    "deploy/tests/test_private_generation_route_contract.py",
    "deploy/tests/test_private_media_reference_submission.py",
    "deploy/tests/test_private_video_crop_service.py",
    "deploy/tests/test_private_admin_workflow_import_repair.py",
    "deploy/tests/test_private_admin_user_routes.py",
    "deploy/tests/test_private_migration_entrypoints.py",
    "deploy/tests/test_private_task_reaper_configuration.py",
    "deploy/tests/test_private_platform_route_extraction.py",
    "deploy/tests/test_private_credit_deployment.py",
    "deploy/tests/test_private_media_cache_configuration.py",
    "deploy/tests/test_dao_workflow_template.py",
    "deploy/tests/test_verified_workflow_template_repair.py",
    "deploy/tests/test_video_enhancement_service.py",
    "deploy/tests/test_image_upscale_contract.py",
    "deploy/tests/test_generation_workflow_fallback.py",
    "deploy/tests/test_i2i_angel_workflow.py",
    "deploy/tests/test_workflow_handler_morph_placeholders.py",
    "deploy/tests/test_workflow_handler_output_dimensions.py",
    "deploy/tests/test_workflow_placeholder_integrity.py",
    "deploy/tests/test_private_task_service_credit_billing.py",
    "deploy/tests/test_private_video_source.py",
    "deploy/tests/test_private_api_minimax_tts_enqueue.py",
    "deploy/tests/test_local_video_manifest.py",
    "deploy/tests/test_video_capability_service.py",
    "deploy/tests/test_node_output*.py",
    "deploy/tests/test_worker_agent_queue.py",
)

SOURCE_CODE_SUFFIXES = {
    ".cmd",
    ".html",
    ".js",
    ".jsx",
    ".json",
    ".ps1",
    ".py",
    ".sh",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
}

# These scripts must contain the literal boundary signatures they enforce.
# Exempt only their own source text; their paths and every other candidate file
# remain subject to all filename, directory, packaging, and release rules.
SOURCE_CONTENT_EXEMPT_PATHS = {
    "deploy/scripts/check_public_frontend_boundary.py",
    "deploy/scripts/check_public_import_boundary.py",
    "deploy/scripts/check_public_release_boundary.py",
    "deploy/scripts/check_public_route_authorization.py",
    # Reviewed negative fixtures assert rejection of these literal signatures;
    # they contain no relay implementation. Do not exempt the whole test tree.
    "deploy/tests/test_public_release_boundary.py",
    "deploy/tests/test_public_main_boundary.py",
}

FORBIDDEN_SOURCE_CONTENT = (
    re.compile(r"(?i)\bdef\s+claim_agent_submission\s*\("),
    re.compile(r"(?i)class\s+(?:ComfyUIAgent|ClusterManager)\b"),
    re.compile(r"(?i)/api/agents/(?:register|heartbeat|poll|complete)\b"),
    re.compile(r"(?i)node-output-deletions|node_output_relay"),
    re.compile(r"(?i)/api/comfyui/(?:upload|view|reupload)\b"),
    re.compile(r"(?i)\bcomfyui_server\s*[:=]"),
    re.compile(r"(?i)\bWORKFLOW_CONFIGS\s*="),
    re.compile(r"(?i)127\.0\.0\.1:8188"),
    # The source edition must not make the hosted product origin a deployment
    # default. Operators provide their own origin while assembling a candidate.
    re.compile(r"(?i)https?://(?:tv|www)\.ostory\.ai\b"),
)

FORBIDDEN_DOCUMENTATION_INSTRUCTIONS = (
    re.compile(r"(?i)\b(?:docker|docker-compose|podman)\s+(?:build|compose|run|up)\b"),
    re.compile(r"(?i)deploy/containers/"),
)


@dataclass(frozen=True, order=True)
class BoundaryIssue:
    path: str
    rule: str


def _normalise(relative_path: Path | str) -> str:
    value = str(relative_path).replace("\\", "/")
    if value == ".":
        return ""
    while value.startswith("./"):
        value = value[2:]
    return value


def _matches_glob(path: str) -> bool:
    lowered = path.lower()
    if path in PUBLIC_STATIC_SCRIPT_EXCEPTIONS:
        return False
    return any(fnmatch.fnmatchcase(lowered, pattern.lower()) for pattern in FORBIDDEN_GLOBS)


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _candidate_files(root: Path) -> set[str]:
    files: set[str] = set()
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root)
        if any(part.lower() == ".git" for part in relative.parts):
            continue
        normalised = _normalise(relative)
        if normalised != PUBLIC_SOURCE_MANIFEST:
            files.add(normalised)
    return files


def _audit_source_manifest(root: Path, issues: set[BoundaryIssue]) -> None:
    manifest_path = root / PUBLIC_SOURCE_MANIFEST
    if not manifest_path.is_file():
        return
    try:
        lines = manifest_path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        issues.add(BoundaryIssue(PUBLIC_SOURCE_MANIFEST, "source manifest must be readable UTF-8 text"))
        return

    entries: dict[str, str] = {}
    malformed = False
    duplicate = False
    for line in lines:
        if not line:
            continue
        match = MANIFEST_LINE.fullmatch(line)
        if not match:
            malformed = True
            continue
        digest, relative_path = match.groups()
        manifest_relative = PurePosixPath(relative_path)
        parts = manifest_relative.parts
        if (
            relative_path.startswith("/")
            or manifest_relative.is_absolute()
            or relative_path == PUBLIC_SOURCE_MANIFEST
            or not parts
            or any(part in {"", ".", ".."} for part in parts)
            or parts[0].endswith(":")
        ):
            malformed = True
            continue
        if relative_path in entries:
            duplicate = True
            continue
        entries[relative_path] = digest

    if malformed:
        issues.add(BoundaryIssue(PUBLIC_SOURCE_MANIFEST, "source manifest contains an invalid entry"))
    if duplicate:
        issues.add(BoundaryIssue(PUBLIC_SOURCE_MANIFEST, "source manifest contains duplicate paths"))

    actual_files = _candidate_files(root)
    listed_files = set(entries)
    if actual_files - listed_files:
        issues.add(BoundaryIssue(PUBLIC_SOURCE_MANIFEST, "source manifest omits candidate files"))
    if listed_files - actual_files:
        issues.add(BoundaryIssue(PUBLIC_SOURCE_MANIFEST, "source manifest lists missing files"))
    if any(
        _file_digest(root / relative_path) != entries[relative_path]
        for relative_path in sorted(actual_files & listed_files)
    ):
        issues.add(BoundaryIssue(PUBLIC_SOURCE_MANIFEST, "source manifest digest mismatch"))


def audit_candidate(candidate_root: Path) -> list[BoundaryIssue]:
    """Return public-release boundary violations for a candidate directory."""
    root = candidate_root.expanduser().resolve(strict=True)
    if not root.is_dir():
        raise NotADirectoryError(root)

    issues: set[BoundaryIssue] = set()
    for required in REQUIRED_PATHS:
        if not (root / required).is_file():
            issues.add(BoundaryIssue(required, "required public-release file is missing"))

    for current_root, directory_names, file_names in os.walk(root, followlinks=False):
        current = Path(current_root)
        relative_root = current.relative_to(root)

        kept_directories: list[str] = []
        for directory_name in directory_names:
            relative = relative_root / directory_name
            path = _normalise(relative)
            directory_path = current / directory_name
            if directory_path.is_symlink():
                issues.add(BoundaryIssue(path, "symbolic link is not allowed in public candidate"))
                continue
            if directory_name.lower() == ".git":
                continue
            if directory_name.lower() in FORBIDDEN_DIRECTORY_NAMES:
                issues.add(BoundaryIssue(path, "generated, runtime, or packaged directory is forbidden"))
                continue
            # Traverse the exception's ancestors, but keep checking every file
            # and subdirectory. One public asset must not allow its siblings.
            contains_public_asset = any(
                allowed.startswith(f"{path.lower()}/") for allowed in PUBLIC_STATIC_SCRIPT_EXCEPTIONS
            )
            if not contains_public_asset and (_matches_glob(f"{path}/") or _matches_glob(f"{path}/placeholder")):
                issues.add(BoundaryIssue(path, "forbidden deployment or local execution directory"))
                continue
            kept_directories.append(directory_name)
        directory_names[:] = kept_directories

        for file_name in file_names:
            file_path = current / file_name
            relative = relative_root / file_name
            path = _normalise(relative)
            lowered_name = file_name.lower()

            if file_path.is_symlink():
                issues.add(BoundaryIssue(path, "symbolic link is not allowed in public candidate"))
                continue
            if FORBIDDEN_BASENAME.match(file_name):
                issues.add(BoundaryIssue(path, "container or bundled deployment file is forbidden"))
            if file_path.suffix.lower() in FORBIDDEN_FILE_SUFFIXES:
                issues.add(BoundaryIssue(path, "prebuilt or packaged artifact is forbidden"))
            if lowered_name == ".env" or (
                lowered_name.startswith(".env.")
                and lowered_name not in {".env.example", ".env.sample", ".env.template"}
            ):
                issues.add(BoundaryIssue(path, "runtime environment file is forbidden"))
            if (any(suffix.lower() in FORBIDDEN_DEPLOYMENT_SUFFIXES for suffix in file_path.suffixes)
                    or FORBIDDEN_DEPLOYMENT_SCRIPT_NAME.fullmatch(file_name)):
                issues.add(BoundaryIssue(path, "deployment automation is forbidden; provide manual instructions"))
            if _matches_glob(path):
                issues.add(BoundaryIssue(path, "Ovideo local execution or deployment implementation is forbidden"))
            if (
                file_path.suffix.lower() in SOURCE_CODE_SUFFIXES
                and not _matches_glob(path)
                and path not in SOURCE_CONTENT_EXEMPT_PATHS
            ):
                try:
                    source = file_path.read_text(encoding="utf-8")
                except (OSError, UnicodeDecodeError):
                    issues.add(BoundaryIssue(path, "source file must be readable UTF-8 text"))
                else:
                    if any(pattern.search(source) for pattern in FORBIDDEN_SOURCE_CONTENT):
                        issues.add(
                            BoundaryIssue(
                                path,
                                "source contains a forbidden hosted-deployment or local-execution value",
                            )
                        )

    for documentation_path in root.rglob("*.md"):
        if not documentation_path.is_file() or documentation_path.is_symlink():
            continue
        relative_documentation = _normalise(documentation_path.relative_to(root))
        try:
            documentation = documentation_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            issues.add(BoundaryIssue(relative_documentation, "documentation must be UTF-8 text"))
        else:
            if any(pattern.search(documentation) for pattern in FORBIDDEN_DOCUMENTATION_INSTRUCTIONS):
                issues.add(
                    BoundaryIssue(
                        relative_documentation,
                        "documentation points users to a bundled container workflow",
                    )
                )

    for relative_path in RELEASE_COMPLETION_FILES:
        completion_path = root / relative_path
        if not completion_path.is_file():
            continue
        try:
            completion_text = completion_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if any(marker in completion_text for marker in INCOMPLETE_RELEASE_MARKERS):
            issues.add(
                BoundaryIssue(
                    relative_path,
                    "official support or security contact placeholder is unresolved",
                )
            )

    license_path = root / "LICENSE"
    if license_path.is_file():
        try:
            license_size = license_path.stat().st_size
        except OSError:
            license_size = 0
        if license_size < MINIMUM_LICENSE_BYTES:
            issues.add(BoundaryIssue("LICENSE", "license text is empty or incomplete"))

    _audit_source_manifest(root, issues)

    return sorted(issues)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check an explicit source-only public release candidate."
    )
    parser.add_argument(
        "--candidate-root",
        required=True,
        type=Path,
        help="Absolute or relative path to the exact directory intended for publication.",
    )
    parser.add_argument(
        "--max-issues",
        type=int,
        default=100,
        help="Maximum issue paths printed; the total count is always reported.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if args.max_issues < 1:
        raise SystemExit("--max-issues must be at least 1")
    try:
        issues = audit_candidate(args.candidate_root)
    except (FileNotFoundError, NotADirectoryError) as exc:
        print(f"Public release boundary check could not start: {exc}")
        return 2

    if not issues:
        print("Public release boundary OK")
        return 0

    print(f"Public release boundary failed: {len(issues)} issue(s)")
    for issue in issues[: args.max_issues]:
        print(f"- {issue.path} [{issue.rule}]")
    remaining = len(issues) - args.max_issues
    if remaining > 0:
        print(f"- ... {remaining} additional issue(s) omitted")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
