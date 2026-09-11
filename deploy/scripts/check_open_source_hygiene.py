#!/usr/bin/env python3
"""Fail when tracked source exposes private provenance or usable credentials.

The release check deliberately reports only a rule name and source location. It
does not echo matching text, because a scanner should not copy a discovered
credential into CI logs. Add a narrowly documented exception only when a term is
part of a public protocol rather than repository history.
"""
from __future__ import annotations

import argparse
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SELF_PATH = "deploy/scripts/check_open_source_hygiene.py"


@dataclass(frozen=True)
class HygieneIssue:
    path: str
    line: int
    rule: str


@dataclass(frozen=True)
class HistoryHygieneIssue:
    path: str
    blob: str
    rule: str


FORBIDDEN_CONTENT = {
    "private repository reference": re.compile(
        r"(?:Drama/NewUI|wuqi80/Drama|git\.5kcrm\.cn|refactor/v2)", re.IGNORECASE
    ),
    "private product or domain": re.compile(
        r"(?:spti\.ai|(?:[\w-]+\.)?5kcrm\.cn|"
        r"(?<![\w.-])(?!www\.)(?:[\w-]+\.)*rongyansuanli\.com\b|mecha\.one)",
        re.IGNORECASE,
    ),
    "migrated runtime identifier": re.compile(
        r"(?:@drama/|dramaRuntime|createDramaRuntime|DRAMA_[A-Z0-9_]*|drama\.service|\bNewUI\b)"
    ),
    "private machine path": re.compile(r"(?:[A-Z]:\\Codex\\Drama|/[^\s]*/Drama/deploy)", re.IGNORECASE),
    "personal fixture identifier": re.compile(r"\bwuqi80\b", re.IGNORECASE),
    "legacy product identifier": re.compile(r"(?:\bMY2\b|my2[_:-]|h-my2)", re.IGNORECASE),
}

FORBIDDEN_PATH = {
    "internal agent log": re.compile(r"(?:^|/)Agent\.md$"),
    "dated internal implementation plan": re.compile(r"^deploy/docs/superpowers/"),
    "migrated runtime filename": re.compile(r"(?:^|/)dramaRuntime(?:\.test)?\.ts$", re.IGNORECASE),
}

SECRET_ASSIGNMENT = re.compile(
    r"(?i)(?:api[_-]?key|secret(?:[_-]?key)?|password|access[_-]?token|refresh[_-]?token)"
    r"\s*[:=]\s*['\"]([^'\"]{8,})['\"]"
)
SAFE_PLACEHOLDER = re.compile(
    r"(?i)(?:example|placeholder|change[-_ ]?me|your[-_ ]|test[-_ ]|dummy|\$\{|<[^>]+>)"
)

SKIPPED_PREFIXES = (
    "deploy/dist/",
    "studio/dist/",
)
SKIPPED_SUFFIXES = (
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2",
    ".mp3", ".wav", ".mp4", ".zip", ".pdf", ".pyc",
)
MAX_HISTORY_TEXT_BYTES = 2 * 1024 * 1024

# Applied migrations are immutable because their bytes are recorded in the
# migration ledger. They are isolated here until a clean baseline is selected;
# changing even a comment would make existing installations fail checksum
# verification.
IMMUTABLE_MIGRATION_PATH = re.compile(
    r"^deploy/(?:sql/)?(?:database_schema|db_migration_[^/]+)\.sql$",
    re.IGNORECASE,
)


def _tracked_paths(root: Path) -> Iterable[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=root,
        check=True,
        capture_output=True,
    )
    for raw_path in result.stdout.split(b"\0"):
        if raw_path:
            yield raw_path.decode("utf-8", errors="surrogateescape").replace("\\", "/")


def _is_skipped(path: str) -> bool:
    lowered = path.lower()
    return (
        path == SELF_PATH
        or path.startswith(SKIPPED_PREFIXES)
        or lowered.endswith(SKIPPED_SUFFIXES)
    )


def scan_repository(root: Path = REPOSITORY_ROOT) -> list[HygieneIssue]:
    """Return tracked-file violations without printing matched source text."""
    issues: list[HygieneIssue] = []
    for path in _tracked_paths(root):
        file_path = root / Path(path)
        # A rename is represented as a missing tracked path plus a new untracked
        # path until it is staged. Scan the effective working tree, not the stale
        # index entry, so contributors can run the gate before staging.
        if not file_path.exists():
            continue
        for rule, pattern in FORBIDDEN_PATH.items():
            if pattern.search(path):
                issues.append(HygieneIssue(path=path, line=0, rule=rule))
        if _is_skipped(path):
            continue
        try:
            text = file_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            for rule, pattern in FORBIDDEN_CONTENT.items():
                if rule == "legacy product identifier" and IMMUTABLE_MIGRATION_PATH.match(path):
                    continue
                if pattern.search(line):
                    issues.append(HygieneIssue(path=path, line=line_number, rule=rule))
            for match in SECRET_ASSIGNMENT.finditer(line):
                if not SAFE_PLACEHOLDER.search(match.group(1)):
                    issues.append(HygieneIssue(path=path, line=line_number, rule="possible committed credential"))
    return issues


def _reachable_blob_paths(root: Path) -> dict[str, set[str]]:
    result = subprocess.run(
        ["git", "rev-list", "--objects", "--all"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="surrogateescape",
    )
    object_paths: dict[str, set[str]] = {}
    for line in result.stdout.splitlines():
        object_id, separator, raw_path = line.partition(" ")
        if not separator or not raw_path:
            continue
        object_paths.setdefault(object_id, set()).add(raw_path.replace("\\", "/"))
    if not object_paths:
        return {}

    check = subprocess.run(
        ["git", "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
        cwd=root,
        input="\n".join(object_paths) + "\n",
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    blobs: dict[str, set[str]] = {}
    for line in check.stdout.splitlines():
        parts = line.split()
        if len(parts) != 3 or parts[1] != "blob":
            continue
        try:
            size = int(parts[2])
        except ValueError:
            continue
        if size <= MAX_HISTORY_TEXT_BYTES:
            blobs[parts[0]] = object_paths.get(parts[0], set())
    return blobs


def scan_git_history(root: Path = REPOSITORY_ROOT) -> list[HistoryHygieneIssue]:
    """Scan every reachable small text blob without echoing matched values."""
    issues: set[HistoryHygieneIssue] = set()
    for object_id, paths in _reachable_blob_paths(root).items():
        relevant_paths = {
            path
            for path in paths
            if path != SELF_PATH and not _is_skipped(path)
        }
        if not relevant_paths:
            continue
        for path in relevant_paths:
            for rule, pattern in FORBIDDEN_PATH.items():
                if pattern.search(path):
                    issues.add(HistoryHygieneIssue(path, object_id[:12], rule))
        result = subprocess.run(
            ["git", "cat-file", "blob", object_id],
            cwd=root,
            check=True,
            capture_output=True,
        )
        if b"\0" in result.stdout:
            continue
        try:
            text = result.stdout.decode("utf-8")
        except UnicodeDecodeError:
            continue
        matched_rules: set[str] = set()
        for line in text.splitlines():
            for rule, pattern in FORBIDDEN_CONTENT.items():
                if pattern.search(line):
                    matched_rules.add(rule)
            for match in SECRET_ASSIGNMENT.finditer(line):
                if not SAFE_PLACEHOLDER.search(match.group(1)):
                    matched_rules.add("possible committed credential")
        for path in relevant_paths:
            for rule in matched_rules:
                issues.add(HistoryHygieneIssue(path, object_id[:12], rule))
    return sorted(issues, key=lambda issue: (issue.path, issue.blob, issue.rule))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check public-source repository hygiene.")
    parser.add_argument(
        "--history",
        action="store_true",
        help="also scan every reachable Git blob; required for a public release candidate",
    )
    parser.add_argument("--max-issues", type=int, default=100)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if args.max_issues < 1:
        raise SystemExit("--max-issues must be at least 1")
    issues = scan_repository()
    if issues:
        print(f"Open-source hygiene failed: {len(issues)} issue(s)")
        for issue in issues[: args.max_issues]:
            location = f"{issue.path}:{issue.line}" if issue.line else issue.path
            print(f"- {location} [{issue.rule}]")
        return 1
    if args.history:
        history_issues = scan_git_history()
        if history_issues:
            print(f"Open-source Git history hygiene failed: {len(history_issues)} issue(s)")
            for issue in history_issues[: args.max_issues]:
                print(f"- {issue.path} blob={issue.blob} [{issue.rule}]")
            return 1
        print("Open-source Git history hygiene OK")
    print("Open-source hygiene OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
