import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from scripts.check_public_import_boundary import audit_import_closure


def test_public_entrypoint_import_closure_excludes_private_runtime() -> None:
    deploy_root = Path(__file__).parents[1]
    paths, issues = audit_import_closure(deploy_root, deploy_root / "public_main.py")

    assert issues == []
    assert "public_main.py" in paths
    assert "core/online_provider_queue.py" in paths
    assert "core/online_provider_worker.py" in paths
    assert "cluster_main.py" not in paths
    assert "admin_routes.py" not in paths
    assert "api_routes.py" not in paths
    assert "core/task_queue.py" not in paths
    assert "services/task_service.py" not in paths


def test_dynamic_import_target_is_rejected_when_static_closure_cannot_resolve_it(tmp_path: Path) -> None:
    entry = tmp_path / "public_main.py"
    entry.write_text(
        "from importlib import import_module\n"
        "module_name = input()\n"
        "import_module(module_name)\n",
        encoding="utf-8",
    )

    _paths, issues = audit_import_closure(tmp_path, entry)

    assert any("dynamic import target cannot be proven public" in issue for issue in issues)


def _write(root: Path, relative: str, source: str = "") -> Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")
    return path


@pytest.mark.parametrize("module", [
    "cluster_main", "core.worker", "core.cluster_manager", "core.task_queue",
    "services.task_service", "routers.tasks", "pipeline.workflow_handler",
])
@pytest.mark.parametrize("present", [False, True], ids=["excluded", "present"])
def test_private_import_paths_fail_without_relying_on_content_signatures(tmp_path, module, present):
    entry = _write(tmp_path, "public_main.py", f"import {module}\n")
    if present:
        _write(tmp_path, module.replace(".", "/") + ".py", "value = 1\n")
    _paths, issues = audit_import_closure(tmp_path, entry)
    assert any("forbidden module" in issue for issue in issues)


@pytest.mark.parametrize("entry_source", ["import feature.api\n", "from feature.api import value\n"])
def test_parent_package_initializers_are_audited(tmp_path, entry_source):
    entry = _write(tmp_path, "public_main.py", entry_source)
    _write(tmp_path, "feature/__init__.py", "import core.worker\n")
    _write(tmp_path, "feature/api.py", "value = 1\n")
    paths, issues = audit_import_closure(tmp_path, entry)
    assert "feature/__init__.py" in paths
    assert any("forbidden module" in issue for issue in issues)


def test_package_wins_over_same_named_module(tmp_path):
    entry = _write(tmp_path, "public_main.py", "import feature\n")
    _write(tmp_path, "feature.py", "value = 1\n")
    _write(tmp_path, "feature/__init__.py", "import core.worker\n")
    paths, issues = audit_import_closure(tmp_path, entry)
    assert "feature/__init__.py" in paths
    assert any("forbidden module" in issue for issue in issues)


def test_safe_namespace_packages_and_import_cycles_are_supported(tmp_path):
    entry = _write(tmp_path, "public_main.py", "from feature.nested.api import value\nimport json\n")
    _write(tmp_path, "feature/nested/api.py", "from . import helper\nvalue = 1\n")
    _write(tmp_path, "feature/nested/helper.py", "from .api import value\n")
    paths, issues = audit_import_closure(tmp_path, entry)
    assert issues == []
    assert paths == {"public_main.py", "feature/nested/api.py", "feature/nested/helper.py"}


@pytest.mark.parametrize("source", [
    "from importlib import import_module as load\nload('core.worker')\n",
    "import importlib as loader\nloader.import_module('core.worker')\n",
    "from builtins import __import__ as load\nload('core.worker')\n",
    "from importlib import import_module\nimport_module('.worker', 'core')\n",
    "from importlib import import_module\nimport_module('.worker', package='core')\n",
    "from importlib import import_module as load\nload(name='core.worker')\n",
    "from builtins import __import__ as load\nload(name='core.worker')\n",
    "__import__('core', fromlist=['worker'])\n",
])
def test_constant_dynamic_imports_and_aliases_resolve_private_targets(tmp_path, source):
    entry = _write(tmp_path, "public_main.py", source)
    _paths, issues = audit_import_closure(tmp_path, entry)
    assert any("forbidden module" in issue for issue in issues)


@pytest.mark.parametrize("source", [
    "from importlib import import_module as load\nload(input())\n",
    "from builtins import __import__ as load\nload(input())\n",
    "from importlib import import_module\nimport_module('.safe', package=input())\n",
    "from importlib import import_module\nimport_module('.safe')\n",
    "__import__('safe', level=level)\n",
    "__import__('safe', globals(), locals(), [], 1)\n",
    "__import__('feature', fromlist=names)\n",
    "__import__('feature', fromlist=['*'])\n",
    "import_module(**arguments)\n",
])
def test_unresolved_dynamic_imports_fail_closed(tmp_path, source):
    entry = _write(tmp_path, "public_main.py", source)
    _paths, issues = audit_import_closure(tmp_path, entry)
    assert any("dynamic import target cannot be proven public" in issue for issue in issues)


def test_constant_relative_dynamic_import_resolves_safe_module(tmp_path):
    entry = _write(tmp_path, "public_main.py",
                   "from importlib import import_module as load\nload('.api', package='feature')\n")
    _write(tmp_path, "feature/__init__.py", "")
    _write(tmp_path, "feature/api.py", "value = 1\n")
    paths, issues = audit_import_closure(tmp_path, entry)
    assert issues == []
    assert {"feature/__init__.py", "feature/api.py"} <= paths


def test_symlinked_import_outside_source_is_rejected_without_reading_it(tmp_path):
    root = tmp_path / "source"
    entry = _write(root, "public_main.py", "import feature\n")
    outside = _write(tmp_path, "outside.py", "not valid Python and must not be read")
    try:
        (root / "feature.py").symlink_to(outside)
    except OSError as exc:
        pytest.skip(f"Symbolic links unavailable ({type(exc).__name__})")
    paths, issues = audit_import_closure(root, entry)
    assert any("outside source root" in issue for issue in issues)
    assert not any("SyntaxError" in issue or "outside.py" in issue for issue in issues)
    assert "../outside.py" not in paths


def test_star_import_checks_submodules_declared_by_package_exports(tmp_path):
    entry = _write(tmp_path, "public_main.py", "from core import *\n")
    _write(tmp_path, "core/__init__.py", "__all__ = ['worker']\n")
    _paths, issues = audit_import_closure(tmp_path, entry)
    assert any("forbidden module" in issue for issue in issues)


@pytest.mark.parametrize("source", ["__all__ = compute_exports()\n", "__all__ = []\n__all__.append(name)\n"])
def test_unknown_package_exports_fail_closed(tmp_path, source):
    entry = _write(tmp_path, "public_main.py", "from feature import *\n")
    _write(tmp_path, "feature/__init__.py", source)
    _paths, issues = audit_import_closure(tmp_path, entry)
    assert any("dynamic package exports cannot be proven public" in issue for issue in issues)


def test_nested_entrypoint_includes_parent_initializer(tmp_path):
    entry = _write(tmp_path, "feature/api.py", "value = 1\n")
    _write(tmp_path, "feature/__init__.py", "import core.worker\n")
    _paths, issues = audit_import_closure(tmp_path, entry)
    assert any("forbidden module" in issue for issue in issues)


def test_public_entrypoint_imports_from_its_own_reviewed_module_closure(tmp_path):
    source = Path(__file__).parents[1]
    paths, issues = audit_import_closure(source, source / "public_main.py")
    assert issues == []
    isolated = tmp_path / "deploy"
    for relative in paths:
        target = isolated / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / relative, target)
    # -I ignores ambient PYTHONPATH and the working checkout. Only reviewed
    # application modules and installed third-party dependencies can be loaded.
    code = """
import json, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root))
import public_main
local = set()
for module in tuple(sys.modules.values()):
    filename = getattr(module, '__file__', None)
    if filename:
        path = pathlib.Path(filename).resolve()
        if path.is_relative_to(root):
            local.add(path.relative_to(root).as_posix())
assert public_main.app is not None
assert 'core/online_provider_worker.py' in local
assert not {'cluster_main.py', 'core/worker.py', 'core/task_queue.py'} & local
print(json.dumps(sorted(local)))
"""
    env = {key: value for key, value in os.environ.items()
           if key in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG"}}
    env.update(OSTORY_RUNTIME_ENV="development", ALLOW_DEV_ADMIN_PASSWORD="false",
               API_PROVIDER_HEALTH_MONITOR_ENABLED="false", PYTHONUTF8="1")
    result = subprocess.run([sys.executable, "-I", "-c", code, str(isolated)], cwd=isolated,
                            env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    loaded = set(json.loads(result.stdout.strip().splitlines()[-1]))
    assert loaded <= paths
