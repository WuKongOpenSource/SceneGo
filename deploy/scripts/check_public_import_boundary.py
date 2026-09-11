#!/usr/bin/env python3
"""Audit the local Python import closure of the source-edition entrypoint."""
from __future__ import annotations

import argparse
import ast
import fnmatch
from collections import deque
from importlib.util import resolve_name
from pathlib import Path

try:
    from scripts.check_public_release_boundary import FORBIDDEN_GLOBS, FORBIDDEN_SOURCE_CONTENT
except ModuleNotFoundError:
    from check_public_release_boundary import FORBIDDEN_GLOBS, FORBIDDEN_SOURCE_CONTENT


def _normalise(path: Path) -> str:
    return str(path).replace("\\", "/")


def _forbidden(relative: str) -> bool:
    # Release rules are repository-relative; this scanner starts at deploy/.
    lowered = "deploy/" + relative.lower()
    return any(fnmatch.fnmatchcase(lowered, pattern.lower()) for pattern in FORBIDDEN_GLOBS)


def _resolve_module(source_root: Path, module: str) -> Path | None:
    if not module:
        return None
    path = source_root.joinpath(*module.split("."))
    package_file = path / "__init__.py"
    if package_file.is_file():
        return package_file
    module_file = path.with_suffix(".py")
    return module_file if module_file.is_file() else None


def _module_prefixes(module: str) -> list[str]:
    parts = module.split(".")
    if not all(part.isidentifier() for part in parts):
        return []
    return [".".join(parts[:length]) for length in range(1, len(parts) + 1)]


def _call_argument(node: ast.Call, position: int, name: str, default=None):
    if len(node.args) > position:
        return node.args[position]
    return next((keyword.value for keyword in node.keywords if keyword.arg == name), default)


def _dynamic_targets(node: ast.Call, loader: str) -> set[str] | None:
    """Resolve literal loader arguments only; unknown targets fail closed."""
    if any(keyword.arg is None for keyword in node.keywords):
        return None
    argument = _call_argument(node, 0, "name")
    if not isinstance(argument, ast.Constant) or not isinstance(argument.value, str):
        return None
    name = argument.value
    targets = {name}
    if loader == "import_module":
        if name.startswith("."):
            package = _call_argument(node, 1, "package")
            if not isinstance(package, ast.Constant) or not isinstance(package.value, str):
                return None
            try:
                targets = {resolve_name(name, package.value)}
            except (ImportError, ValueError):
                return None
    else:
        # Relative __import__ depends on the caller's globals. Do not guess it.
        level = _call_argument(node, 4, "level", ast.Constant(value=0))
        if not isinstance(level, ast.Constant) or level.value != 0:
            return None
        fromlist = _call_argument(node, 3, "fromlist", ast.Constant(value=None))
        if not (isinstance(fromlist, ast.Constant) and fromlist.value is None):
            if not isinstance(fromlist, (ast.List, ast.Tuple)):
                return None
            for item in fromlist.elts:
                if not isinstance(item, ast.Constant) or not isinstance(item.value, str):
                    return None
                targets.add(f"{name}.{item.value}")
    return targets if all(_module_prefixes(target) for target in targets) else None


def _absolute_from_import(current: Path, source_root: Path, node: ast.ImportFrom) -> str:
    if node.level <= 0:
        return node.module or ""
    package_parts = list(current.relative_to(source_root).with_suffix("").parts[:-1])
    keep = max(0, len(package_parts) - (node.level - 1))
    prefix = package_parts[:keep]
    if node.module:
        prefix.extend(node.module.split("."))
    return ".".join(prefix)


def _package_exports(tree: ast.Module) -> set[str] | None:
    """Package star imports may load submodules named by __all__."""
    exports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if isinstance(node.func.value, ast.Name) and node.func.value.id == "__all__":
                return None
        targets = node.targets if isinstance(node, ast.Assign) else (
            [node.target] if isinstance(node, (ast.AnnAssign, ast.AugAssign)) else []
        )
        if not any(isinstance(target, ast.Name) and target.id == "__all__" for target in targets):
            continue
        try:
            value = ast.literal_eval(node.value)
        except (ValueError, TypeError, SyntaxError):
            return None
        if not isinstance(value, (list, tuple)) or not all(
            isinstance(name, str) and name.isidentifier() for name in value
        ):
            return None
        exports.update(value)
    return exports


def audit_import_closure(source_root: Path, entrypoint: Path) -> tuple[set[str], list[str]]:
    root = source_root.resolve(strict=True)
    entry = entrypoint.resolve(strict=True)
    if not entry.is_relative_to(root):
        raise ValueError("entrypoint must be inside source root")

    visited: set[Path] = set()
    issues: set[str] = set()
    # Importing a submodule executes its parent packages before the target file.
    entry_module = ".".join(entry.relative_to(root).with_suffix("").parts)
    queue: deque[Path] = deque(
        path for module in _module_prefixes(entry_module)
        if (path := _resolve_module(root, module)) is not None
    )
    queue.append(entry)
    while queue:
        current = queue.popleft()
        if current in visited:
            continue
        visited.add(current)
        relative = _normalise(current.relative_to(root))
        try:
            resolved_current = current.resolve()
        except (OSError, RuntimeError):
            issues.add(f"{relative}: imported module path cannot be resolved")
            continue
        if not resolved_current.is_relative_to(root):
            issues.add(f"{relative}: imported module resolves outside source root")
            continue
        if resolved_current != current:
            issues.add(f"{relative}: symbolic-link import cannot be proven public")
            continue
        if _forbidden(relative):
            issues.add(f"{relative}: forbidden module is reachable from public entrypoint")
            continue
        try:
            source = current.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(current))
        except (OSError, UnicodeDecodeError, SyntaxError) as exc:
            issues.add(f"{relative}: cannot audit source ({type(exc).__name__})")
            continue
        if any(pattern.search(source) for pattern in FORBIDDEN_SOURCE_CONTENT):
            issues.add(f"{relative}: contains forbidden local-runtime or hosted value")

        modules: set[str] = set()
        if current.name == "__init__.py":
            exports = _package_exports(tree)
            if exports is None:
                issues.add(f"{relative}: dynamic package exports cannot be proven public")
            else:
                package = ".".join(current.parent.relative_to(root).parts)
                modules.update(f"{package}.{name}" for name in exports)
        loaders = {"__import__": "__import__", "import_module": "import_module"}
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.level == 0:
                for alias in node.names:
                    if (node.module, alias.name) in {
                        ("importlib", "import_module"), ("builtins", "__import__")
                    }:
                        loaders[alias.asname or alias.name] = alias.name
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                base = _absolute_from_import(current, root, node)
                if base:
                    modules.add(base)
                    for alias in node.names:
                        modules.add(f"{base}.{alias.name}")
            elif isinstance(node, ast.Call):
                function_name = ""
                if isinstance(node.func, ast.Name):
                    function_name = node.func.id
                elif isinstance(node.func, ast.Attribute):
                    function_name = node.func.attr
                if function_name in loaders:
                    targets = _dynamic_targets(node, loaders[function_name])
                    if targets is None:
                        issues.add(
                            f"{relative}:{node.lineno}: dynamic import target cannot be proven public"
                        )
                    else:
                        modules.update(targets)

        for module in modules:
            for prefix in _module_prefixes(module):
                module_path = prefix.replace(".", "/")
                # A removed private file is still a forbidden dependency, not
                # an external package that the candidate can safely ignore.
                if _forbidden(module_path + ".py") or _forbidden(module_path + "/__init__.py"):
                    issues.add(f"{relative}: forbidden module dependency {prefix}")
                    continue
                resolved = _resolve_module(root, prefix)
                if resolved and resolved not in visited:
                    queue.append(resolved)

    paths = {_normalise(path.relative_to(root)) for path in visited}
    return paths, sorted(issues)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check the public Python import closure")
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--entrypoint", type=Path)
    args = parser.parse_args()
    source_root = args.source_root.resolve()
    entrypoint = args.entrypoint or source_root / "public_main.py"
    paths, issues = audit_import_closure(source_root, entrypoint)
    if issues:
        print(f"Public import boundary failed: {len(issues)} issue(s), {len(paths)} local modules inspected")
        for issue in issues:
            print(f"- {issue}")
        return 1
    print(f"Public import boundary OK: {len(paths)} local modules inspected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
