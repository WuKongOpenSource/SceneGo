#!/usr/bin/env python3
"""Guard the service/DAO persistence boundary.

Business services should orchestrate domain behavior and call DAO methods for
database persistence. Raw SQL, connection-pool access, and asyncpg primitives
belong in DAO modules so later refactors can reason about storage changes in
one layer instead of chasing scattered queries.
"""
from __future__ import annotations

import ast
import re
import sys
from dataclasses import dataclass
from pathlib import Path


RAW_SQL_RE = re.compile(
    r"^\s*("
    r"SELECT\b.+\bFROM\b|"
    r"INSERT\s+INTO\b|"
    r"UPDATE\s+\w+\s+SET\b|"
    r"DELETE\s+FROM\b|"
    r"WITH\s+\w+\s+AS\b"
    r")",
    re.IGNORECASE | re.MULTILINE | re.DOTALL,
)
DIRECT_DB_IMPORTS = {
    "asyncpg",
    "database",
    "db",
    "db_manager",
}
DIRECT_DB_CALLS = {
    "execute",
    "executemany",
    "fetch",
    "fetchall",
    "fetchone",
    "fetchrow",
    "fetchval",
}
DIRECT_DB_NAMES = {
    "get_db_manager",
}


@dataclass(frozen=True)
class Violation:
    path: Path
    line: int
    message: str


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def iter_service_files(root: Path) -> list[Path]:
    services_dir = root / "services"
    return sorted(
        path
        for path in services_dir.rglob("*.py")
        if "__pycache__" not in path.parts
    )


def is_direct_db_import(module: str | None) -> bool:
    if not module:
        return False
    head = module.split(".", 1)[0]
    return head in DIRECT_DB_IMPORTS


def call_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return ""


def check_file(path: Path) -> list[Violation]:
    source = path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as exc:
        return [Violation(path, exc.lineno or 1, f"syntax error while scanning service boundary: {exc}")]

    violations: list[Violation] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if is_direct_db_import(alias.name):
                    violations.append(
                        Violation(path, node.lineno, f"service imports direct DB module '{alias.name}'")
                    )
        elif isinstance(node, ast.ImportFrom):
            if is_direct_db_import(node.module):
                violations.append(
                    Violation(path, node.lineno, f"service imports direct DB module '{node.module}'")
                )
            for alias in node.names:
                if alias.name in DIRECT_DB_NAMES:
                    violations.append(
                        Violation(path, node.lineno, f"service imports direct DB helper '{alias.name}'")
                    )
        elif isinstance(node, ast.Call):
            name = call_name(node.func)
            if name in DIRECT_DB_NAMES:
                violations.append(
                    Violation(path, node.lineno, f"service calls direct DB helper '{name}()'")
                )
            # Raw SQL execute calls take a query (positional, keyword, or
            # unpacked). Redis pipeline.execute() only flushes queued commands;
            # SQL literals and direct DB imports are still checked separately.
            queryless_batch_flush = (
                name == "execute"
                and isinstance(node.func, ast.Attribute)
                and not node.args
                and not node.keywords
            )
            if name in DIRECT_DB_CALLS and not queryless_batch_flush:
                violations.append(
                    Violation(path, node.lineno, f"service calls raw DB method '{name}()'")
                )
            if (
                isinstance(node.func, ast.Attribute)
                and node.func.attr == "acquire"
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "pool"
            ):
                violations.append(
                    Violation(path, node.lineno, "service opens a DB pool connection directly")
                )
            if (
                isinstance(node.func, ast.Attribute)
                and node.func.attr == "acquire"
                and isinstance(node.func.value, ast.Attribute)
                and node.func.value.attr == "pool"
            ):
                violations.append(
                    Violation(path, node.lineno, "service opens a DB pool connection directly")
                )
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            if RAW_SQL_RE.search(node.value):
                violations.append(
                    Violation(path, node.lineno, "service contains raw SQL; move persistence to DAO")
                )

    return violations


def main() -> int:
    root = deploy_root()
    files = iter_service_files(root)
    violations: list[Violation] = []
    for path in files:
        violations.extend(check_file(path))

    if violations:
        for item in violations:
            print(f"FAIL: {rel(item.path, root)}:{item.line}: {item.message}", file=sys.stderr)
        return 1

    print("Service DAO boundary OK")
    print(f"  service_files={len(files)}")
    print("  raw_sql_in_services=0")
    print("  direct_db_connections_in_services=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
