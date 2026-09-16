"""Pinned official CLI running with a dedicated persistent, private identity.

No shell, implicit account, default session, arbitrary command or caller path is
accepted. Account authorization is an operator action, never a generation retry.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import stat
import subprocess
from dataclasses import dataclass
from contextlib import contextmanager
from pathlib import Path

from services.jimeng_contract import EXECUTION_MODEL, JimengError


class CliUnavailable(JimengError):
    pass


class CliOutcomeUnknown(JimengError):
    pass


class CliNotStarted(JimengError):
    """The OS lock denied entry before any command could execute."""


def parse_object(output: bytes) -> dict:
    """Ignore CLI version notices, but require one complete command JSON object."""
    text = output.decode("utf-8", errors="strict")
    decoder = json.JSONDecoder()
    for match in re.finditer(r"(?m)^\s*(?=\{)", text):
        try:
            value, end = decoder.raw_decode(text[match.end():])
            if isinstance(value, dict):
                if text[match.end() + end:].strip():
                    break
                return value
        except ValueError:
            continue
    raise CliOutcomeUnknown("即梦返回结果暂时无法确认，请核查原任务，勿重复提交。")


@dataclass(frozen=True)
class CliConfig:
    binary: Path
    home: Path
    uid: int
    gid: int
    account_id: str
    session_id: str
    state_id: str
    sha256: str

    @classmethod
    def load(cls):
        if os.getenv("JIMENG_CLI_ENABLED", "").lower() != "true":
            raise CliUnavailable("即梦通道尚未启用，请联系管理员完成独立账号授权。")
        try:
            binary, home = Path(os.environ["JIMENG_CLI_BIN"]), Path(os.environ["JIMENG_CLI_HOME"])
            uid, gid = int(os.environ["JIMENG_CLI_UID"]), int(os.environ["JIMENG_CLI_GID"])
            expected_hash = os.environ["JIMENG_CLI_SHA256"].lower()
            if os.name != "posix" or uid <= 0 or gid <= 0 or os.geteuid() not in (0, uid):
                raise ValueError("Dedicated POSIX identity required")
            if not binary.is_absolute() or not home.is_absolute() or binary.is_symlink() or home.is_symlink():
                raise ValueError("Absolute private paths required")
            binary, home = binary.resolve(strict=True), home.resolve(strict=True)
            if binary.is_relative_to(home):
                raise ValueError("Executable must be separate from writable CLI state")
            for public in ("persistent_storage", "static", "new_html", "uploads"):
                if home.is_relative_to((Path.cwd() / public).resolve()):
                    raise ValueError("CLI home cannot be publicly served")
            home_stat, bin_stat = home.stat(), binary.stat()
            if home_stat.st_uid != uid or stat.S_IMODE(home_stat.st_mode) != 0o700:
                raise ValueError("Private home ownership/mode required")
            if bin_stat.st_mode & 0o022 or (bin_stat.st_uid == uid and bin_stat.st_mode & 0o200):
                raise ValueError("CLI user cannot modify pinned executable")
            if not re.fullmatch(r"[a-f0-9]{64}", expected_hash):
                raise ValueError("Pinned hash required")
            if hashlib.sha256(binary.read_bytes()).hexdigest() != expected_hash:
                raise ValueError("Executable changed")
            marker = home / ".ovideo-jimeng-state.json"
            if marker.is_symlink() or marker.stat().st_mode & 0o077:
                raise ValueError("Private state marker required")
            binding = json.loads(marker.read_text(encoding="utf-8"))
            account, session, state_id = (str(binding.get(k) or "") for k in ("account_id", "session_id", "state_id"))
            if not re.fullmatch(r"[0-9]+", account) or not re.fullmatch(r"[1-9][0-9]*", session):
                raise ValueError("Explicit account and non-default new session required")
            if not re.fullmatch(r"[a-zA-Z0-9_-]{16,80}", state_id):
                raise ValueError("Persistent state identity required")
            return cls(binary, home, uid, gid, account, session, state_id, expected_hash)
        except (OSError, KeyError, ValueError, TypeError) as exc:
            raise CliUnavailable("即梦独立账号运行环境未就绪，管理员需核对授权、专用会话和持久化目录。") from exc

    def private_directory(self, name: str) -> Path:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", name):
            raise CliUnavailable("任务编号无效。")
        jobs = self.home / "ovideo-jobs"
        if jobs.is_symlink():
            raise CliUnavailable("即梦任务存储校验失败。")
        jobs.mkdir(mode=0o700, exist_ok=True)
        target = jobs / name
        if target.is_symlink():
            raise CliUnavailable("即梦任务存储校验失败。")
        target.mkdir(mode=0o700, exist_ok=True)
        if jobs.is_symlink() or target.is_symlink() or not target.resolve().is_relative_to(self.home):
            raise CliUnavailable("即梦任务存储校验失败。")
        for path in (jobs, target):
            os.chmod(path, 0o700)
            if os.geteuid() == 0:
                os.chown(path, self.uid, self.gid)
        return target

    def permit_input(self, path: Path):
        if path.is_symlink() or not path.resolve().is_relative_to(self.home / "ovideo-jobs"):
            raise CliUnavailable("即梦输入文件校验失败。")
        os.chmod(path, 0o600)
        if os.geteuid() == 0:
            os.chown(path, self.uid, self.gid)


class JimengCli:
    def __init__(self, config: CliConfig):
        self.config = config

    @contextmanager
    def _state_lock(self):
        # Account/status queries can also refresh OAuth state. Serialize every
        # CLI command across workers, preflight requests and the admin card.
        if os.name != "posix":
            yield  # Only injectable offline tests can construct this runtime off POSIX.
            return
        import fcntl
        lock_path = self.config.home / ".ovideo-jimeng-cli.lock"
        descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            # Bounded contention: do not wait forever behind a hung CLI process.
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield
        finally:
            os.close(descriptor)

    def _invoke(self, args, kwargs):
        with self._state_lock():
            return subprocess.run(args, **kwargs)

    async def _run(self, args: list[str], *, timeout: int) -> dict:
        cfg = self.config
        # Do not inherit API keys, database credentials, proxies or another app's HOME.
        env = {"HOME": str(cfg.home), "PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8", "TZ": "Asia/Shanghai"}
        kwargs = {"user": cfg.uid, "group": cfg.gid, "extra_groups": []} if os.geteuid() == 0 else {}
        try:
            result = await asyncio.to_thread(self._invoke, [str(cfg.binary), *args], dict(
                cwd=str(cfg.home), env=env, stdin=subprocess.DEVNULL, capture_output=True,
                timeout=timeout, check=False, umask=0o077, **kwargs))
            if len(result.stdout) > 2 * 1024**2:
                raise ValueError("Unexpected response size")
            response = parse_object(result.stdout)
            if result.returncode and not response.get("submit_id"):
                raise ValueError("Command unsuccessful")
            return response
        except BlockingIOError as exc:
            raise CliNotStarted("即梦账号正在检查或处理其他命令，本次尚未提交。") from exc
        except (OSError, subprocess.SubprocessError, ValueError) as exc:
            raise CliOutcomeUnknown("即梦响应暂时无法确认，将保留原任务等待核查；不会自动重新生成。") from exc

    async def account_status(self) -> dict:
        value = await self._run(["user_credit"], timeout=30)
        if str(value.get("user_id") or "") != self.config.account_id:
            raise CliUnavailable("即梦授权账号与绑定账号不一致，已暂停该通道。")
        credits = value.get("total_credit")
        if not isinstance(credits, (int, float)) or isinstance(credits, bool) or not math.isfinite(credits) or credits < 0:
            raise CliUnavailable("暂时无法确认即梦账号状态，请稍后重试。")
        return {"authorized": True, "account_id": self.config.account_id,
                "session_id": self.config.session_id, "provider_credits": credits}

    async def submit(self, data: dict, inputs: list[dict]) -> dict:
        args = ["multimodal2video", "--model_version", EXECUTION_MODEL,
                "--video_resolution", "720p", "--duration", str(data["duration"]),
                "--ratio", data["ratio"], "--session", self.config.session_id,
                "--poll", "0", "--prompt", data["prompt"]]
        for entry in inputs:
            self.config.permit_input(Path(entry["path"]))
            args.extend(["--" + entry["kind"], entry["path"]])
        return await self._run(args, timeout=180)

    async def query(self, submit_id: str, directory: Path) -> dict:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,160}", submit_id):
            raise CliOutcomeUnknown("即梦任务编号无法确认，需要人工核查。")
        return await self._run(["query_result", "--submit_id", submit_id, "--download_dir", str(directory)], timeout=180)
