import subprocess
from pathlib import Path

from scripts.check_open_source_hygiene import scan_git_history


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


def _commit(repo: Path, name: str, content: str) -> None:
    path = repo / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    _git(repo, "add", name)
    _git(
        repo,
        "-c",
        "user.name=Security Test",
        "-c",
        "user.email=security-test@example.invalid",
        "commit",
        "-m",
        name,
    )


def test_history_scan_finds_secret_removed_from_head(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    secret_assignment = "api_" + "key = 'real-looking-credential-value'\n"
    _commit(repo, "config.py", secret_assignment)
    _commit(repo, "config.py", "api_key = '<FILL_ME>'\n")

    issues = scan_git_history(repo)

    assert any(issue.path == "config.py" and issue.rule == "possible committed credential" for issue in issues)


def test_new_history_with_placeholders_passes(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _commit(repo, ".env.example", "API_KEY=<FILL_ME>\n")

    assert scan_git_history(repo) == []
