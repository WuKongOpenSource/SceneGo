import hashlib
import json
from pathlib import Path

import pytest

try:
    from scripts.check_public_release_boundary import REQUIRED_PATHS, audit_candidate
except ModuleNotFoundError:
    from deploy.scripts.check_public_release_boundary import REQUIRED_PATHS, audit_candidate


def _safe_candidate(root: Path) -> Path:
    for relative_path in REQUIRED_PATHS:
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("source-only public candidate\n", encoding="utf-8")
    (root / "LICENSE").write_text(
        "Test-only complete license fixture. " * 16 + "\n",
        encoding="utf-8",
    )
    _write_manifest(root)
    return root


def _write_manifest(root: Path) -> None:
    rows: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "PUBLIC_SOURCE_FILES.sha256":
            continue
        relative = path.relative_to(root).as_posix()
        rows.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {relative}")
    (root / "PUBLIC_SOURCE_FILES.sha256").write_text("\n".join(rows) + "\n", encoding="utf-8")


def _rules(root: Path) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for issue in audit_candidate(root):
        result.setdefault(issue.path, set()).add(issue.rule)
    return result


def test_safe_source_only_candidate_passes(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    assert audit_candidate(candidate) == []


@pytest.mark.parametrize("body,extra,accepted", [
    ("Official help: https://www.ostory.ai", {}, True),
    ("Official help: https://tv.ostory.ai", {"runtime": "https://tv.ostory.ai"}, False),
    ("127.0.0.1:8188", {}, False),
    ("podman run example", {}, False),
])
def test_help_catalog_only_allows_editorial_site_links(tmp_path, body, extra, accepted):
    candidate = _safe_candidate(tmp_path / "candidate")
    path = candidate / "deploy/new_html/public/assets/help/catalog.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {"version": 1, "updatedAt": "2026-09-16", "sourceRevision": "a" * 40,
            "categories": [{"id": "manual", "title": "操作手册", "description": "说明"}],
            "documents": [{"id": "guide", "title": "指南", "category": "manual", "summary": "说明", "body": body, "source": "manual"}], **extra}
    path.write_text(json.dumps(data), encoding="utf-8")
    _write_manifest(candidate)
    assert (not audit_candidate(candidate)) is accepted


@pytest.mark.parametrize('relative', [
    'deploy/requirements.txt', 'deploy/requirements-test.txt', 'deploy/pytest.ini',
    'deploy/tests/test_python_dependency_contract.py',
    'deploy/tests/test_python_dependency_locks.py',
    'deploy/scripts/check_python_dependency_locks.py',
    'deploy/scripts/check_npm_sbom.py',
    'deploy/tests/test_npm_sbom.py',
    'deploy/scripts/check_npm_license_supplement.py',
    'deploy/tests/test_npm_license_supplement.py',
    'deploy/scripts/check_esbuild_distribution_evidence.py',
    'deploy/tests/test_esbuild_distribution_evidence.py',
    'docs/open-source/third-party/npm-esbuild-build-evidence.json',
    'docs/open-source/third-party/licenses/npm-esbuild-go-LICENSE.txt',
    'docs/open-source/third-party/licenses/npm-esbuild-go-PATENTS.txt',
    'docs/open-source/third-party/npm-review.zh-CN.md',
    'docs/open-source/third-party/npm-license-supplement.json',
    'docs/open-source/third-party/licenses/npm-esbuild-0.25.12.txt',
    'docs/open-source/third-party/licenses/npm-rollup-4.63.1-core.txt',
    'docs/open-source/third-party/licenses/npm-saxes-6.0.0.txt',
    'docs/open-source/third-party/licenses/npm-saxes-6.0.0-authors.txt',
    'docs/open-source/third-party/declarations/npm-dlv-1.1.3.txt',
    'deploy/dependency-locks/manifest.json',
    'deploy/dependency-locks/bootstrap.txt', 'deploy/dependency-locks/build.txt',
    'deploy/dependency-locks/linux-cpython312-runtime.txt',
    'deploy/dependency-locks/linux-cpython312-test.txt',
    'deploy/dependency-locks/windows-cpython312-runtime.txt',
    'deploy/dependency-locks/windows-cpython312-test.txt',
    'deploy/new_html/package-lock.json', 'studio/package-lock.json',
    'docs/open-source/dependency-review.zh-CN.md',
    'deploy/scripts/check_python_license_supplement.py',
    'deploy/tests/test_python_license_supplement.py',
    'docs/open-source/third-party/README.zh-CN.md',
    'docs/open-source/third-party/licenses/Apache-2.0.txt',
    'docs/open-source/third-party/declarations/alibabacloud-credentials.txt',
    'docs/open-source/third-party/licenses/alibabacloud-credentials-api-LICENSE.txt',
    'docs/open-source/third-party/licenses/alibabacloud-gateway-LICENSE.txt',
    'docs/open-source/third-party/declarations/alibabacloud-tea.txt',
    'docs/open-source/third-party/declarations/alibabacloud-tea-openapi.txt',
    'docs/open-source/third-party/declarations/alibabacloud-tea-util.txt',
    'docs/open-source/third-party/licenses/tea-util-LICENSE.txt',
    'docs/open-source/third-party/declarations/darabonba-core.txt',
    'docs/open-source/third-party/python-license-supplement.json',
])
def test_dependency_inputs_cannot_be_omitted_from_public_candidate(tmp_path, relative):
    candidate = _safe_candidate(tmp_path / 'candidate')
    (candidate / relative).unlink()
    # A regenerated manifest must not make an incomplete installation pass.
    _write_manifest(candidate)
    assert _rules(candidate)[relative] == {'required public-release file is missing'}


@pytest.mark.parametrize("name", ["test_public_release_boundary.py", "test_public_main_boundary.py"])
def test_reviewed_negative_fixtures_are_allowed_only_at_their_exact_paths(tmp_path, name):
    candidate = _safe_candidate(tmp_path / "candidate")
    source = Path(__file__).with_name(name).read_text(encoding="utf-8")
    (candidate / "deploy/tests" / name).write_text(source, encoding="utf-8")
    _write_manifest(candidate)
    assert audit_candidate(candidate) == []
    # A renamed implementation cannot borrow the test fixture exception.
    renamed = candidate / "deploy/tests/copied_boundary_fixture.py"
    renamed.write_text(source, encoding="utf-8")
    _write_manifest(candidate)
    assert "source contains a forbidden hosted-deployment or local-execution value" in _rules(candidate)[
        "deploy/tests/copied_boundary_fixture.py"
    ]


@pytest.mark.parametrize("relative", [
    "deploy/context/routes.json",
    "deploy/scripts/check_route_contract.py",
    "deploy/scripts/check_architecture_contracts.py",
    "deploy/new_html/index.html",
    "deploy/new_html/__tests__/styles/privateHostedShell.test.ts",
    "deploy/new_html/__tests__/services/privateVideoMediaService.test.ts",
])
def test_private_catalogs_and_hosted_shell_inputs_do_not_enter_public_source(tmp_path, relative):
    candidate = _safe_candidate(tmp_path / "candidate")
    private = candidate / relative
    private.parent.mkdir(parents=True, exist_ok=True)
    private.write_text("private input\n", encoding="utf-8")
    _write_manifest(candidate)
    assert relative in _rules(candidate)


def test_docker_and_packaged_artifacts_fail(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    (candidate / "Dockerfile").write_text("FROM python:3\n", encoding="utf-8")
    (candidate / "release.zip").write_bytes(b"not a real archive")

    rules = _rules(candidate)
    assert "Dockerfile" in rules
    assert "release.zip" in rules


@pytest.mark.parametrize("relative_path", [
    "deploy/fix_deploy.sh", "deploy/local_start.example.ps1", "tools/run.cmd",
    "tools/launch.bat", "tools/install.sh.example", "tools/setup.ps1.template",
    "infra/app.service.example", "tools/provision.py", "tools/install.mjs", "tools/start_server.py",
    "tools/auto_deploy.py", "tools/upgrade.js", "tools/rollback.py",
    "infra/app.service", "infra/app.timer", "infra/app.socket", "infra/main.tf",
    "Makefile", "justfile", "Taskfile.yml", ".dockerignore",
    "k8s/application.yaml", "helm/values.yaml", "ansible/inventory.ini",
    "deploy/scripts/build_clean_migration_package.py",
    "deploy/scripts/build_workflow_catalog.py",
    "deploy/scripts/sync_workflow_templates_from_catalog.py",
    "deploy/tests/test_build_workflow_catalog.py",
    "deploy/tests/test_sync_workflow_templates_from_catalog.py",
    "deploy/tests/test_auto_deploy_cluster_security.py",
    "deploy/tests/test_container_release_contract.py",
])
def test_all_deployment_helpers_are_excluded_even_without_containers(tmp_path, relative_path):
    candidate = _safe_candidate(tmp_path / "candidate")
    helper = candidate / relative_path
    helper.parent.mkdir(parents=True, exist_ok=True)
    helper.write_text("internal deployment helper\n", encoding="utf-8")
    _write_manifest(candidate)
    assert any(relative_path == issue.path or relative_path.startswith(issue.path + "/")
               for issue in audit_candidate(candidate))


def test_manual_compilation_and_standard_build_metadata_remain_allowed(tmp_path):
    candidate = _safe_candidate(tmp_path / "candidate")
    for relative_path, content in {
        "deploy/new_html/tsconfig.json": '{"compilerOptions": {"noEmit": true}}',
        "deploy/requirements.txt": "fastapi\n",
        "deploy/scripts/apply_migrations.py": '"""Apply versioned application migrations."""\n',
        "docs/manual-build.md": "```sh\nnpm ci\nnpx --no-install tsc --noEmit\n"
        "npx --no-install vite build --config vite.public.config.ts\n```\n",
    }.items():
        path = candidate / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    _write_manifest(candidate)
    assert audit_candidate(candidate) == []


def test_ovideo_comfyui_implementation_and_workflows_fail(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    agent = candidate / "deploy" / "pipeline" / "comfyui_agent.py"
    workflow = candidate / "deploy" / "workflows" / "production.json"
    agent.parent.mkdir(parents=True, exist_ok=True)
    workflow.parent.mkdir(parents=True, exist_ok=True)
    agent.write_text("# private implementation\n", encoding="utf-8")
    workflow.write_text("{}\n", encoding="utf-8")

    rules = _rules(candidate)
    assert "deploy/pipeline/comfyui_agent.py" in rules
    assert "deploy/workflows" in rules or "deploy/workflows/production.json" in rules


def test_renamed_local_agent_protocol_still_fails_content_scan(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    disguised = candidate / "deploy" / "services" / "connector.py"
    disguised.parent.mkdir(parents=True, exist_ok=True)
    disguised.write_text(
        "class ComfyUIAgent:\n"
        "    endpoint = '/api/agents/heartbeat'\n",
        encoding="utf-8",
    )

    rules = _rules(candidate)

    assert rules["deploy/services/connector.py"] == {
        "source contains a forbidden hosted-deployment or local-execution value"
    }


def test_mixed_online_and_local_worker_is_forbidden(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    worker = candidate / "deploy" / "core" / "worker.py"
    worker.parent.mkdir(parents=True, exist_ok=True)
    worker.write_text("# mixed private runtime\n", encoding="utf-8")

    rules = _rules(candidate)

    assert "deploy/core/worker.py" in rules


@pytest.mark.parametrize("name", [
    "test_cluster_lifespan.py", "test_cluster_manager_lifespan.py", "test_worker_lifespan.py",
    "test_private_provider_execution.py",
    "test_private_task_cancellation.py",
    "test_private_task_terminal_guards.py",
    "test_private_admin_role_permissions.py",
    "test_private_builtin_admin_config.py",
    "test_private_cluster_status_health.py",
    "test_private_image_upscale_outputs.py",
    "test_private_generate_route_workflow_prepare.py",
    "test_private_generation_route_contract.py",
    "test_private_media_reference_submission.py",
    "test_private_video_crop_service.py",
    "test_private_admin_workflow_import_repair.py",
    "test_private_admin_user_routes.py",
    "test_private_migration_entrypoints.py",
    "test_private_task_reaper_configuration.py",
    "test_private_platform_route_extraction.py",
    "test_private_credit_deployment.py",
    "test_private_media_cache_configuration.py",
    "test_dao_workflow_template.py",
    "test_verified_workflow_template_repair.py",
    "test_video_enhancement_service.py",
    "test_image_upscale_contract.py",
    "test_generation_workflow_fallback.py",
    "test_i2i_angel_workflow.py",
    "test_workflow_handler_morph_placeholders.py",
    "test_workflow_handler_output_dimensions.py",
    "test_workflow_placeholder_integrity.py",
    "test_private_task_service_credit_billing.py",
    "test_private_video_source.py",
    "test_private_api_minimax_tts_enqueue.py",
])
def test_private_lifecycle_test_implementations_are_excluded(tmp_path, name):
    candidate = _safe_candidate(tmp_path / "candidate")
    relative = "deploy/tests/" + name
    target = candidate / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("# Private lifecycle test fixture.\n", encoding="utf-8")
    _write_manifest(candidate)
    assert relative in _rules(candidate)


def test_private_runtime_configuration_is_forbidden(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    for relative_path in (
        "deploy/cluster_config.py",
        "deploy/cluster_config_generated.py",
        "deploy/config.py",
        "deploy/core/agent_dispatch_guard.py",
        "deploy/services/video_crop_service.py",
        "deploy/services/video_enhancement_service.py",
        "deploy/services/image_upscale_contract.py",
        "deploy/scripts/repair_verified_workflow_templates.py",
    ):
        path = candidate / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# private runtime config\n", encoding="utf-8")

    rules = _rules(candidate)

    assert "deploy/cluster_config.py" in rules
    assert "deploy/cluster_config_generated.py" in rules
    assert "deploy/config.py" in rules
    assert "deploy/services/video_crop_service.py" in rules
    assert "deploy/services/video_enhancement_service.py" in rules
    assert "deploy/services/image_upscale_contract.py" in rules
    assert "deploy/scripts/repair_verified_workflow_templates.py" in rules


def test_mixed_application_entrypoints_and_task_runtime_are_forbidden(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    mixed_paths = (
        "deploy/cluster_main.py",
        "deploy/admin_routes.py",
        "deploy/api_routes.py",
        "deploy/routers/tasks.py",
        "deploy/routers/generation.py",
        "deploy/services/task_service.py",
        "deploy/core/task_queue.py",
        "deploy/core/task_types.py",
    )
    for relative_path in mixed_paths:
        path = candidate / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# mixed runtime\n", encoding="utf-8")

    rules = _rules(candidate)

    assert all(relative_path in rules for relative_path in mixed_paths)


def test_private_frontend_local_runtime_services_are_forbidden(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    private_paths = (
        "deploy/new_html/services/videoTaskService.ts",
        "deploy/new_html/services/videoMediaService.ts",
        "deploy/new_html/services/audioGenerationService.ts",
        "deploy/new_html/services/comfyuiBridgeService.ts",
        "deploy/new_html/services/clusterNodeService.ts",
        "deploy/new_html/components/GpuNodeSelector.tsx",
        "deploy/new_html/admin/adminAuth.ts",
    )
    for relative_path in private_paths:
        path = candidate / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("export {};\n", encoding="utf-8")

    rules = _rules(candidate)

    assert all(relative_path in rules for relative_path in private_paths)


def test_prebuilt_reverse_proxy_and_hosted_origin_fail(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    proxy = candidate / "deploy" / "nginx-production.conf"
    proxy.parent.mkdir(parents=True, exist_ok=True)
    proxy.write_text("server {}\n", encoding="utf-8")
    frontend = candidate / "deploy" / "new_html" / "config" / "brand.ts"
    frontend.parent.mkdir(parents=True, exist_ok=True)
    frontend.write_text(
        "export const origin = 'https://tv.ostory.ai';\n",
        encoding="utf-8",
    )

    rules = _rules(candidate)

    assert "deploy/nginx-production.conf" in rules
    assert rules["deploy/new_html/config/brand.ts"] == {
        "source contains a forbidden hosted-deployment or local-execution value"
    }


def test_runtime_environment_and_generated_directories_fail(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    (candidate / ".env.production").write_text("SECRET=value\n", encoding="utf-8")
    generated = candidate / "dist"
    generated.mkdir()
    (generated / "app.js").write_text("compiled\n", encoding="utf-8")

    rules = _rules(candidate)
    assert ".env.production" in rules
    assert "dist" in rules


@pytest.mark.parametrize("filename", [
    "auth.js", "api.js", "modals.js", "task.js", "ui.js", "workspace.js",
    "unknown.js", "slider-captcha-copy.js", "nested/slider-captcha.js",
])
def test_superseded_browser_token_scripts_fail(tmp_path: Path, filename) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    relative = "deploy/static/js/" + filename
    legacy_script = candidate / relative
    legacy_script.parent.mkdir(parents=True, exist_ok=True)
    legacy_script.write_text("localStorage.getItem('auth_token')\n", encoding="utf-8")

    rules = _rules(candidate)

    assert any(relative == path or relative.startswith(path + "/") for path in rules)


@pytest.mark.parametrize("relative", [
    "deploy/login.html", "deploy/static/css/slider-captcha.css", "deploy/static/css/tab-navigation.css",
    "deploy/static/js/slider-captcha.js", "deploy/tests/test_frontend_entry_files.py",
])
def test_public_auth_entries_and_route_regression_cannot_be_omitted(tmp_path, relative):
    candidate = _safe_candidate(tmp_path / "candidate")
    (candidate / relative).unlink()
    _write_manifest(candidate)
    assert _rules(candidate)[relative] == {"required public-release file is missing"}


def test_only_active_captcha_script_survives_without_bypassing_content_review(tmp_path):
    from scripts.check_public_release_boundary import _matches_glob

    candidate = _safe_candidate(tmp_path / "candidate")
    relative = "deploy/static/js/slider-captcha.js"
    script = candidate / relative
    script.write_bytes((Path(__file__).resolve().parents[2] / relative).read_bytes())
    _write_manifest(candidate)
    assert not _matches_glob(relative)
    assert _matches_glob("deploy/static/js/auth.js")
    assert _matches_glob("deploy/static/js/Slider-Captcha.js")
    assert audit_candidate(candidate) == []
    # The path exception is not a content exception for hosted values or keys.
    script.write_text("const origin = 'https://tv.ostory.ai';\n", encoding="utf-8")
    _write_manifest(candidate)
    assert _rules(candidate)[relative] == {
        "source contains a forbidden hosted-deployment or local-execution value"
    }


def test_missing_required_public_document_fails(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    (candidate / "LICENSE").unlink()

    rules = _rules(candidate)
    assert rules["LICENSE"] == {"required public-release file is missing"}


def test_public_runtime_regressions_are_required_release_inputs(tmp_path):
    candidate = _safe_candidate(tmp_path / "candidate")
    path = "deploy/tests/test_online_provider_worker_lifespan.py"
    (candidate / path).unlink()
    _write_manifest(candidate)
    assert _rules(candidate)[path] == {"required public-release file is missing"}


def test_empty_or_incomplete_license_fails(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    (candidate / "LICENSE").write_text("not selected\n", encoding="utf-8")

    rules = _rules(candidate)

    assert rules["LICENSE"] == {"license text is empty or incomplete"}


def test_unresolved_official_contact_placeholders_fail(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    support = candidate / "docs" / "open-source" / "support-policy.zh-CN.md"
    support.write_text(
        "Official contact: <FILL_ME_BEFORE_PUBLIC_RELEASE>\n",
        encoding="utf-8",
    )

    rules = _rules(candidate)

    assert rules["docs/open-source/support-policy.zh-CN.md"] == {
        "official support or security contact placeholder is unresolved"
    }


def test_readme_cannot_direct_users_to_bundled_container_workflow(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    (candidate / "README.md").write_text(
        "Run docker compose up to install this release.\n",
        encoding="utf-8",
    )

    rules = _rules(candidate)
    assert rules["README.md"] == {"documentation points users to a bundled container workflow"}


def test_nested_document_cannot_direct_users_to_container_workflow(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    guide = candidate / "docs" / "install.md"
    guide.parent.mkdir(parents=True, exist_ok=True)
    guide.write_text("Run podman build . to install.\n", encoding="utf-8")

    rules = _rules(candidate)

    assert rules["docs/install.md"] == {
        "documentation points users to a bundled container workflow"
    }


def test_placeholder_environment_example_is_allowed(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    (candidate / ".env.example").write_text("API_KEY=<FILL_ME>\n", encoding="utf-8")
    _write_manifest(candidate)
    assert audit_candidate(candidate) == []


def test_boundary_scripts_do_not_trigger_on_their_own_rule_signatures(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    repository_deploy = Path(__file__).parents[1]
    for name in (
        "check_code_comment_language.mjs",
        "check_code_comment_language.py",
        "check_public_frontend_boundary.py",
        "check_public_import_boundary.py",
        "check_public_release_boundary.py",
    ):
        target = candidate / "deploy" / "scripts" / name
        target.write_text(
            (repository_deploy / "scripts" / name).read_text(encoding="utf-8"),
            encoding="utf-8",
        )

    _write_manifest(candidate)

    assert audit_candidate(candidate) == []


def test_unlisted_file_fails_source_manifest(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    (candidate / "unexpected.txt").write_text("not reviewed\n", encoding="utf-8")

    rules = _rules(candidate)

    assert "source manifest omits candidate files" in rules["PUBLIC_SOURCE_FILES.sha256"]


def test_changed_file_fails_source_manifest_digest(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    (candidate / "README.md").write_text("changed after review\n", encoding="utf-8")

    rules = _rules(candidate)

    assert "source manifest digest mismatch" in rules["PUBLIC_SOURCE_FILES.sha256"]


def test_manifest_cannot_reference_a_missing_file(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    manifest = candidate / "PUBLIC_SOURCE_FILES.sha256"
    manifest.write_text(
        manifest.read_text(encoding="utf-8") + f"{'0' * 64}  removed-after-review.txt\n",
        encoding="utf-8",
    )

    rules = _rules(candidate)

    assert "source manifest lists missing files" in rules["PUBLIC_SOURCE_FILES.sha256"]


def test_manifest_rejects_parent_path_entries(tmp_path: Path) -> None:
    candidate = _safe_candidate(tmp_path / "candidate")
    manifest = candidate / "PUBLIC_SOURCE_FILES.sha256"
    manifest.write_text(
        manifest.read_text(encoding="utf-8") + f"{'0' * 64}  ../outside.txt\n",
        encoding="utf-8",
    )

    rules = _rules(candidate)

    assert "source manifest contains an invalid entry" in rules["PUBLIC_SOURCE_FILES.sha256"]
