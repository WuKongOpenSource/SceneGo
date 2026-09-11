"""Run public runtime regressions without the development checkout on sys.path.

This disposable test tree is not a release candidate or installation package.
Dependencies are preinstalled; real PostgreSQL is a dedicated test database.
"""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

import pytest

from backend_test_database import load_test_database_config
from scripts.check_public_import_boundary import audit_import_closure
from scripts.check_public_release_boundary import PUBLIC_AUTH_ENTRY_FILES, PUBLIC_RUNTIME_REGRESSION_TESTS


PUBLIC_TEST_FILES = tuple(Path(name).name for name in PUBLIC_RUNTIME_REGRESSION_TESTS)
SUPPORT_FILES = (
    # HTML and JS are runtime inputs too; Python import closure cannot find them.
    *(name.removeprefix("deploy/") for name in PUBLIC_AUTH_ENTRY_FILES),
    "pytest.ini",
    "tests/conftest.py",
    "tests/backend_test_database.py",
    "tests/worker_lifespan_contract.py",
    "tests/provider_execution_contract.py",
    "tests/admin_role_contract.py",
    "tests/builtin_admin_contract.py",
    "tests/task_billing_contract.py",
    "tests/tts_enqueue_contract.py",
    "tests/seedance_audio_contract.py",
    "tests/daily_quota_contract.py",
    "tests/task_cancellation_contract.py",
    "tests/task_terminal_contract.py",
    "tests/runtime_health_contract.py",
    "tests/generation_route_contract.py",
    "tests/video_crop_contract.py",
    "scripts/check_code_comment_language.py",
    "scripts/check_code_comment_language.mjs",
    "scripts/check_public_import_boundary.py",
    "scripts/check_public_release_boundary.py",
    "scripts/check_public_frontend_boundary.py",
    "scripts/check_public_route_authorization.py",
)


def test_public_regressions_run_from_a_separate_source_only_tree(tmp_path):
    if load_test_database_config() is None:
        pytest.skip("Source-only regression requires a dedicated OSTORY_TEST_DATABASE_URL.")
    source = Path(__file__).parents[1]
    runtime_files, issues = audit_import_closure(source, source / "public_main.py")
    assert issues == []
    # Read-only health helpers are shared with the full application even when
    # the public HTTP health endpoint uses a smaller response contract.
    health_files, health_issues = audit_import_closure(
        source, source / "services/runtime_health_service.py"
    )
    assert health_issues == []
    runtime_files |= health_files
    assert len(PUBLIC_TEST_FILES) == len(set(PUBLIC_TEST_FILES))
    assert all(name == "deploy/tests/" + Path(name).name for name in PUBLIC_RUNTIME_REGRESSION_TESTS)
    files = runtime_files | set(SUPPORT_FILES) | {"tests/" + name for name in PUBLIC_TEST_FILES}
    assert not {"cluster_main.py", "core/worker.py", "core/task_queue.py",
                "core/agent_dispatch_guard.py", "services/task_service.py"} & files
    isolated = tmp_path / "public-source" / "deploy"
    digests = {}
    for name in sorted(files):
        original = source / name
        assert original.resolve().is_relative_to(source.resolve()) and not original.is_symlink()
        target = isolated / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
        digests[name] = hashlib.sha256(original.read_bytes()).hexdigest()
        assert hashlib.sha256(target.read_bytes()).hexdigest() == digests[name]

    # Retain only the explicit test database URL, never application DB, Redis,
    # provider, proxy, or authentication configuration from the parent process.
    env = {key: value for key, value in os.environ.items()
           if key in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG"}}
    env.update(OSTORY_TEST_DATABASE_URL=os.environ["OSTORY_TEST_DATABASE_URL"],
               OSTORY_REQUIRE_TEST_DB="true", OSTORY_RUNTIME_ENV="development",
               API_PROVIDER_HEALTH_MONITOR_ENABLED="false", ALLOW_DEV_ADMIN_PASSWORD="false",
               PYTEST_DISABLE_PLUGIN_AUTOLOAD="1")
    report = tmp_path / "public-regressions.xml"
    result = subprocess.run(
        [sys.executable, "-I", "-B", "-m", "pytest", "-p", "pytest_asyncio.plugin",
         "-p", "no:cacheprovider", "-q", "--tb=short", "--confcutdir=" + str(isolated),
         "--junitxml=" + str(report), *["tests/" + name for name in PUBLIC_TEST_FILES]],
        cwd=isolated, env=env, capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    suites = list(ET.parse(report).getroot().iter("testsuite"))
    assert suites and all(int(suite.get(key, 0)) == 0 for suite in suites
                          for key in ("failures", "errors", "skipped"))
    cases = list(ET.parse(report).getroot().iter("testcase"))
    for name in PUBLIC_TEST_FILES:
        stem = Path(name).stem
        assert any(stem in case.get("classname", "").split(".") for case in cases), name
    assert all(hashlib.sha256((isolated / name).read_bytes()).hexdigest() == digest
               for name, digest in digests.items())
