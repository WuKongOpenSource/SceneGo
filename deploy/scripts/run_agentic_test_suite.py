#!/usr/bin/env python3







from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence


PASS = "PASS"
PARTIAL = "PARTIAL"
FAIL = "FAIL"
NOT_ATTEMPTED = "NOT_ATTEMPTED"


@dataclass(frozen=True)
class TestCase:
    case_id: str
    title: str
    command: tuple[str, ...]
    cwd: Path
    timeout_seconds: int
    category: str
    unavailable_reason: str | None = None
    partial_output_markers: tuple[str, ...] = ()


@dataclass
class TestResult:
    case_id: str
    title: str
    category: str
    status: str
    command: list[str]
    cwd: str
    duration_seconds: float
    return_code: int | None
    output: str
    reason: str | None = None


def _command_path(name: str) -> str | None:
    if os.name == "nt" and not name.endswith(".exe"):
        return shutil.which(f"{name}.cmd") or shutil.which(name)
    return shutil.which(name)


def discover(repo_root: Path) -> dict:
    deploy_root = repo_root / "deploy"
    frontend_root = deploy_root / "new_html"
    browser_candidates = [
        os.getenv("BROWSER_PATH"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ]
    browser = next((candidate for candidate in browser_candidates if candidate and Path(candidate).is_file()), None)
    return {
        "repo_root": str(repo_root),
        "python": sys.executable,
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "git": _command_path("git"),
        "npm": _command_path("npm"),
        "node": _command_path("node"),
        "browser": browser,
        "frontend_dependencies": (frontend_root / "node_modules").is_dir(),
        "backend_tests": (deploy_root / "tests").is_dir(),
        "frontend_tests": (frontend_root / "__tests__").is_dir(),
    }


def build_plan(repo_root: Path, environment: dict, base_url: str | None) -> list[TestCase]:
    deploy_root = repo_root / "deploy"
    frontend_root = deploy_root / "new_html"
    npm = environment.get("npm")
    git = environment.get("git")

    cases = [
        TestCase(
            "frontend-vitest",
            "Frontend Vitest regression suite",
            (npm or "npm", "run", "test:run"),
            frontend_root,
            180,
            "frontend",
            None if npm and environment["frontend_dependencies"] else "npm or node_modules unavailable",
        ),
        TestCase(
            "backend-pytest",
            "Backend Pytest regression suite",
            (sys.executable, "-m", "pytest", "-q", "-rs"),
            deploy_root,
            360,
            "backend",
            None if environment["backend_tests"] else "backend tests unavailable",
            ("PostgreSQL integration tests unavailable",),
        ),
        TestCase(
            "route-contract",
            "Frontend/backend route contract",
            (sys.executable, "scripts/check_route_contract.py"),
            deploy_root,
            90,
            "contract",
        ),
        TestCase(
            "architecture-contracts",
            "Architecture boundary contracts",
            (sys.executable, "scripts/check_architecture_contracts.py"),
            deploy_root,
            120,
            "contract",
        ),
        TestCase(
            "frontend-build",
            "Production frontend build",
            (npm or "npm", "run", "build"),
            frontend_root,
            240,
            "build",
            None if npm and environment["frontend_dependencies"] else "npm or node_modules unavailable",
        ),
        TestCase(
            "diff-check",
            "Git whitespace validation",
            (git or "git", "diff", "--check"),
            repo_root,
            30,
            "source",
            None if git else "git unavailable",
        ),
    ]
    if base_url:
        cases.append(TestCase(
            "public-smoke",
            f"Public smoke test for {base_url}",
            (sys.executable, "scripts/smoke_test.py", base_url, "--public-only"),
            deploy_root,
            120,
            "live",
        ))
        cases.append(TestCase(
            "browser-public-smoke",
            f"Browser rendering smoke test for {base_url}",
            (environment.get("node") or "node", "scripts/browser_public_smoke.mjs", base_url),
            deploy_root,
            150,
            "live-browser",
            (
                None
                if environment.get("node") and environment.get("browser")
                else "Node.js or a Chromium browser is unavailable"
            ),
        ))
    return cases


def run_case(case: TestCase) -> TestResult:
    command = list(case.command)
    if case.unavailable_reason:
        return TestResult(
            case.case_id,
            case.title,
            case.category,
            NOT_ATTEMPTED,
            command,
            str(case.cwd),
            0.0,
            None,
            "",
            case.unavailable_reason,
        )

    started = time.monotonic()
    try:
        child_environment = os.environ.copy()
        child_environment["PYTHONIOENCODING"] = "utf-8"
        child_environment["PYTHONUTF8"] = "1"
        completed = subprocess.run(
            command,
            cwd=case.cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=child_environment,
            timeout=case.timeout_seconds,
            check=False,
        )
        output = "\n".join(part for part in (completed.stdout, completed.stderr) if part).strip()
        if completed.returncode != 0:
            status = FAIL
            reason = f"command exited with {completed.returncode}"
        elif any(marker in output for marker in case.partial_output_markers):
            status = PARTIAL
            reason = "command passed, but required integration coverage was unavailable"
        else:
            status = PASS
            reason = None
        return_code = completed.returncode
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout.decode("utf-8", "replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        stderr = exc.stderr.decode("utf-8", "replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        output = "\n".join(part for part in (stdout, stderr) if part).strip()
        status = FAIL
        reason = f"timed out after {case.timeout_seconds}s"
        return_code = None
    except OSError as exc:
        output = ""
        status = NOT_ATTEMPTED
        reason = str(exc)
        return_code = None

    return TestResult(
        case.case_id,
        case.title,
        case.category,
        status,
        command,
        str(case.cwd),
        round(time.monotonic() - started, 3),
        return_code,
        output,
        reason,
    )


def _output_excerpt(output: str, max_lines: int = 40) -> str:
    lines = output.splitlines()
    if len(lines) <= max_lines:
        return output
    return "\n".join([f"... {len(lines) - max_lines} earlier lines omitted ...", *lines[-max_lines:]])


def write_reports(report_dir: Path, environment: dict, results: Sequence[TestResult]) -> tuple[Path, Path]:
    report_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    jsonl_path = report_dir / f"ostory_agent_test_{timestamp}.jsonl"
    markdown_path = report_dir / f"ostory_agent_test_report_{timestamp}.md"

    with jsonl_path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps({"phase": "discover", "environment": environment}, ensure_ascii=False) + "\n")
        for result in results:
            handle.write(json.dumps({"phase": "execute", **asdict(result)}, ensure_ascii=False) + "\n")

    statuses = (PASS, PARTIAL, FAIL, NOT_ATTEMPTED)
    counts = {status: sum(result.status == status for result in results) for status in statuses}
    lines = [
        "# 创剧 Automated Test Report",
        "",
        "Legend: PASS | PARTIAL | FAIL | NOT ATTEMPTED",
        "",
        (
            f"Summary: {counts[PASS]} passed, {counts[PARTIAL]} partial, "
            f"{counts[FAIL]} failed, {counts[NOT_ATTEMPTED]} not attempted."
        ),
        "",
        "## Discovery",
        "",
        "```json",
        json.dumps(environment, ensure_ascii=False, indent=2),
        "```",
        "",
        "## Results",
    ]
    for result in results:
        command = subprocess.list2cmdline(result.command)
        lines.extend([
            "",
            f"### {result.status} [{result.case_id}] {result.title}",
            "",
            f"- Category: `{result.category}`",
            f"- Duration: `{result.duration_seconds:.3f}s`",
            f"- Command: `{command}`",
        ])
        if result.reason:
            lines.append(f"- Reason: {result.reason}")
        if result.output:
            lines.extend(["", "```text", _output_excerpt(result.output), "```"])

    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return markdown_path, jsonl_path


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--base-url", help="Run the non-mutating public smoke checks against this URL")
    parser.add_argument("--report-dir", type=Path, help="Report directory (default: deploy/logs)")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    repo_root = args.repo_root.resolve()
    report_dir = args.report_dir or repo_root / "deploy" / "logs"

    print("Phase 1/4: Discover")
    environment = discover(repo_root)
    print(json.dumps(environment, ensure_ascii=False, indent=2))

    print("Phase 2/4: Plan")
    plan = build_plan(repo_root, environment, args.base_url)
    for case in plan:
        print(f"  [{case.case_id}] {case.title}")

    print("Phase 3/4: Execute")
    results = []
    for case in plan:
        print(f"  Running [{case.case_id}]...", flush=True)
        result = run_case(case)
        results.append(result)
        print(f"  {result.status} [{case.case_id}] ({result.duration_seconds:.3f}s)")

    print("Phase 4/4: Report")
    markdown_path, jsonl_path = write_reports(report_dir, environment, results)
    print(f"  Markdown: {markdown_path}")
    print(f"  JSONL: {jsonl_path}")
    return 1 if any(result.status == FAIL for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
