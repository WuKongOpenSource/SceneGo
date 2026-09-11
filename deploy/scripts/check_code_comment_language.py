#!/usr/bin/env python3
"""Reject non-English or mechanically decorative source comments.

The scanner reports only source locations and never echoes comment text. Product
copy, prompts, fixtures, and documentation are intentionally outside this rule.
Generated-source provenance markers are preserved.
"""
from __future__ import annotations

import argparse
import ast
import io
import json
import re
import subprocess
import tokenize
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
NODE_SCANNER = Path(__file__).with_suffix(".mjs")
HAN_CHARACTER = re.compile(
    r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff。！？；：（），、【】“”‘’《》]"
)
LOW_VALUE_SEPARATOR = re.compile(r"^[-=_*#─━═—–]{3,}$")
LOW_VALUE_HEADING = re.compile(
    r"^(?:[-=_*#─━═—–]{2,}\s*.+?\s*[-=_*#─━═—–]{2,}"
    r"|(?:🆕\s*)?(?:new\s+)?[a-z0-9 &/()'.-]+\s+"
    r"(?:state(?:\s*\([^)]*\))?|operations|management|logic|types|strategies(?:\s*\([^)]*\))?))$",
    flags=re.IGNORECASE,
)
LOW_VALUE_PATH = re.compile(
    r"^(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\.(?:py|ts|tsx|js|jsx|mjs|cjs|css|scss|sh|ps1)$",
    flags=re.IGNORECASE,
)

SCRIPT_SUFFIXES = {
    ".cjs",
    ".js",
    ".jsx",
    ".mjs",
    ".ts",
    ".tsx",
}
SLASH_COMMENT_SUFFIXES = {".css", ".scss"}
HASH_COMMENT_SUFFIXES = {
    ".conf",
    ".dockerfile",
    ".env",
    ".example",
    ".ini",
    ".ps1",
    ".service",
    ".sh",
    ".toml",
    ".yaml",
    ".yml",
}
SUPPORTED_SUFFIXES = (
    SCRIPT_SUFFIXES
    |
    SLASH_COMMENT_SUFFIXES
    | HASH_COMMENT_SUFFIXES
    | {".bat", ".cmd", ".htm", ".html", ".py", ".sql"}
)
SUPPORTED_NAMES = {
    ".env.example",
    "caddyfile",
    "dockerfile",
    "manifest.txt",
    "requirements.txt",
    ".dockerignore",
    ".gitattributes",
    ".gitignore",
}
SKIPPED_DIRECTORY_NAMES = {
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "logs",
    "node_modules",
    "persistent_storage",
    "release-artifacts",
    "temp",
    "venv",
}


@dataclass(frozen=True, order=True)
class CommentLanguageIssue:
    path: str
    line: int
    kind: str


def _comment_body(value: str) -> str:
    body = value.strip()
    for prefix in ("<!--", "/*", "//", "--", "#", "::"):
        if body.startswith(prefix):
            body = body[len(prefix) :].strip()
            break
    if body.upper().startswith("REM "):
        body = body[4:].strip()
    for suffix in ("-->", "*/"):
        if body.endswith(suffix):
            body = body[: -len(suffix)].strip()
            break
    return body


def _comment_issue_kind(value: str, *, generated: bool = False) -> str | None:
    if HAN_CHARACTER.search(value):
        return "comment"
    body = _comment_body(value)
    if not generated and (
        LOW_VALUE_SEPARATOR.fullmatch(body)
        or LOW_VALUE_HEADING.fullmatch(body)
        or LOW_VALUE_PATH.fullmatch(body)
    ):
        return "nonessential comment"
    return None


def _repository_paths(root: Path) -> Iterable[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=root,
        check=True,
        capture_output=True,
    )
    for raw_path in result.stdout.split(b"\0"):
        if raw_path:
            yield raw_path.decode("utf-8", errors="surrogateescape").replace("\\", "/")


def _is_supported(path: Path) -> bool:
    return path.suffix.lower() in SUPPORTED_SUFFIXES or path.name.lower() in SUPPORTED_NAMES


def _is_skipped(path: Path) -> bool:
    return any(part.lower() in SKIPPED_DIRECTORY_NAMES for part in path.parts)


def _python_issues(source: str) -> list[tuple[int, str]]:
    issues: list[tuple[int, str]] = []
    generated = bool(re.search(r"\bGENERATED\b.*do not edit", source[:200], flags=re.IGNORECASE))
    try:
        tokens = tokenize.generate_tokens(io.StringIO(source).readline)
        for token in tokens:
            if token.type == tokenize.COMMENT:
                kind = _comment_issue_kind(token.string, generated=generated)
                if kind:
                    issues.append((token.start[0], kind))
    except (IndentationError, tokenize.TokenError):
        issues.append((1, "parse error"))

    try:
        tree = ast.parse(source)
    except SyntaxError:
        issues.append((1, "parse error"))
        return issues

    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if not node.body:
            continue
        first_statement = node.body[0]
        if not isinstance(first_statement, ast.Expr):
            continue
        value = first_statement.value
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            if HAN_CHARACTER.search(value.value):
                issues.append((first_statement.lineno, "docstring"))
    return issues


def _slash_comment_issues(source: str) -> list[tuple[int, str]]:
    issues: list[tuple[int, str]] = []
    generated = bool(re.search(r"\bGENERATED\b.*do not edit", source[:200], flags=re.IGNORECASE))
    index = 0
    line = 1
    state = "code"
    quote = ""
    comment_start = 0
    comment_line = 1
    template_expression_depths: list[int] = []

    while index < len(source):
        character = source[index]
        following = source[index + 1] if index + 1 < len(source) else ""

        if state == "code":
            if character in {"'", '"'}:
                state = "string"
                quote = character
            elif character == "`":
                state = "template"
            elif character == "/" and following == "/":
                state = "line comment"
                comment_start = index
                comment_line = line
                index += 1
            elif character == "/" and following == "*":
                state = "block comment"
                comment_start = index
                comment_line = line
                index += 1
            elif template_expression_depths and character == "{":
                template_expression_depths[-1] += 1
            elif template_expression_depths and character == "}":
                template_expression_depths[-1] -= 1
                if template_expression_depths[-1] == 0:
                    template_expression_depths.pop()
                    state = "template"
        elif state == "string":
            if character == "\\":
                index += 1
            elif character == quote:
                state = "code"
        elif state == "template":
            if character == "\\":
                index += 1
            elif character == "`":
                state = "code"
            elif character == "$" and following == "{":
                template_expression_depths.append(1)
                state = "code"
                index += 1
        elif state == "line comment":
            if character in "\r\n":
                kind = _comment_issue_kind(source[comment_start:index], generated=generated)
                if kind:
                    issues.append((comment_line, kind))
                state = "code"
        elif state == "block comment" and character == "*" and following == "/":
            kind = _comment_issue_kind(source[comment_start : index + 2], generated=generated)
            if kind:
                issues.append((comment_line, kind))
            state = "code"
            index += 1

        if character == "\n":
            line += 1
        index += 1

    if state == "line comment":
        kind = _comment_issue_kind(source[comment_start:], generated=generated)
        if kind:
            issues.append((comment_line, kind))
    return issues


def _quoted_line_comment_issues(source: str, marker: str) -> list[tuple[int, str]]:
    issues: list[tuple[int, str]] = []
    generated = bool(re.search(r"\bGENERATED\b.*do not edit", source[:200], flags=re.IGNORECASE))
    for line_number, line in enumerate(source.splitlines(), start=1):
        quote = ""
        escaped = False
        index = 0
        while index < len(line):
            character = line[index]
            if escaped:
                escaped = False
            elif character == "\\" and quote:
                escaped = True
            elif quote:
                if character == quote:
                    quote = ""
            elif character in {"'", '"'}:
                quote = character
            elif line.startswith(marker, index):
                kind = _comment_issue_kind(line[index:], generated=generated)
                if kind:
                    issues.append((line_number, kind))
                break
            index += 1
    return issues


def _powershell_block_comment_issues(source: str) -> list[tuple[int, str]]:
    issues: list[tuple[int, str]] = []
    generated = bool(re.search(r"\bGENERATED\b.*do not edit", source[:200], flags=re.IGNORECASE))
    for match in re.finditer(r"<#.*?#>", source, flags=re.DOTALL):
        kind = _comment_issue_kind(match.group(0), generated=generated)
        if kind:
            issues.append((source.count("\n", 0, match.start()) + 1, kind))
    return issues


def _html_comment_issues(source: str) -> list[tuple[int, str]]:
    issues: list[tuple[int, str]] = []
    generated = bool(re.search(r"\bGENERATED\b.*do not edit", source[:200], flags=re.IGNORECASE))
    for match in re.finditer(r"<!--.*?-->", source, flags=re.DOTALL):
        kind = _comment_issue_kind(match.group(0), generated=generated)
        if kind:
            issues.append((source.count("\n", 0, match.start()) + 1, kind))
    return issues


def _batch_comment_issues(source: str) -> list[tuple[int, str]]:
    issues: list[tuple[int, str]] = []
    generated = bool(re.search(r"\bGENERATED\b.*do not edit", source[:200], flags=re.IGNORECASE))
    for line_number, line in enumerate(source.splitlines(), start=1):
        stripped = line.lstrip()
        upper = stripped.upper()
        if upper.startswith("REM ") or stripped.startswith("::"):
            kind = _comment_issue_kind(stripped, generated=generated)
            if kind:
                issues.append((line_number, kind))
    return issues


def _source_issues(path: Path, source: str) -> list[tuple[int, str]]:
    suffix = path.suffix.lower()
    if suffix == ".py":
        return _python_issues(source)
    if suffix in SLASH_COMMENT_SUFFIXES:
        return _slash_comment_issues(source)
    if suffix == ".sql":
        return _quoted_line_comment_issues(source, "--") + _slash_comment_issues(source)
    if suffix in {".cmd", ".bat"}:
        return _batch_comment_issues(source)
    if suffix == ".ps1":
        return _quoted_line_comment_issues(source, "#") + _powershell_block_comment_issues(source)
    return _quoted_line_comment_issues(source, "#")


def _script_issues(root: Path, relative_paths: Sequence[str]) -> list[CommentLanguageIssue]:
    if not relative_paths:
        return []
    payload = json.dumps({"root": str(root), "paths": list(relative_paths)})
    result = subprocess.run(
        ["node", str(NODE_SCANNER)],
        input=payload,
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("JavaScript comment scanner failed to run")
    return [CommentLanguageIssue(**item) for item in json.loads(result.stdout)]


def scan_repository(
    root: Path = REPOSITORY_ROOT,
    relative_paths: Sequence[str] | None = None,
) -> list[CommentLanguageIssue]:
    """Return source comment policy violations from the effective source tree."""
    paths = relative_paths if relative_paths is not None else tuple(_repository_paths(root))
    issues: list[CommentLanguageIssue] = []
    script_paths: list[str] = []
    for relative_path in paths:
        normalized = relative_path.replace("\\", "/")
        path = Path(normalized)
        if _is_skipped(path) or not _is_supported(path):
            continue
        file_path = root / path
        if not file_path.is_file():
            continue
        if path.suffix.lower() in SCRIPT_SUFFIXES | {".html", ".htm"}:
            script_paths.append(normalized)
            continue
        try:
            source = file_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for line, kind in _source_issues(path, source):
            issues.append(CommentLanguageIssue(normalized, line, kind))
    issues.extend(_script_issues(root, script_paths))
    return sorted(set(issues))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check that source comments are concise and use English only.")
    parser.add_argument("--max-issues", type=int, default=100)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if args.max_issues < 1:
        raise SystemExit("--max-issues must be at least 1")
    issues = scan_repository()
    if issues:
        print(f"Code comment language check failed: {len(issues)} issue(s)")
        for issue in issues[: args.max_issues]:
            print(f"- {issue.path}:{issue.line} [{issue.kind}]")
        return 1
    print("Code comment language check OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
