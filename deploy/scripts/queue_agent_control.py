#!/usr/bin/env python3
"""Queue a constrained control task for a GPU Agent.

This is intentionally not a generic remote shell. The agent only accepts
whitelisted actions implemented in pipeline/comfyui_agent.py.

Examples:
    .venv/bin/python scripts/queue_agent_control.py status
    .venv/bin/python scripts/queue_agent_control.py self_update --wait
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shlex
import shutil
import sys
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

CONTROL_VERSION_MARKER = "agent-control"


async def redis_client():
    import redis.asyncio as redis
    from cluster_config import RedisConfig

    client = redis.Redis(
        host=RedisConfig.HOST,
        port=RedisConfig.PORT,
        db=RedisConfig.DB,
        password=RedisConfig.PASSWORD,
        decode_responses=True,
    )
    await client.ping()
    return client


def _load_service_env() -> dict[str, str]:
    env = dict(os.environ)
    if env.get("DB_PASSWORD") or not shutil.which("systemctl"):
        return env

    def merge_env_file(path: Path) -> None:
        if not path.exists():
            return
        for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env.setdefault(key.strip(), value.strip().strip("\"'"))

    try:
        output = subprocess.check_output(
            ["systemctl", "show", "ostory.service", "-p", "Environment", "--value"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        for item in shlex.split(output):
            if "=" in item:
                key, value = item.split("=", 1)
                env.setdefault(key, value)
    except Exception:
        pass
    if not env.get("DB_PASSWORD"):
        merge_env_file(ROOT / "configs" / "runtime.env")
    return env


async def fetch_online_agents() -> list[dict[str, Any]]:
    import asyncpg

    env = _load_service_env()
    conn = await asyncpg.connect(
        host=env.get("DB_HOST", "localhost"),
        port=int(env.get("DB_PORT", "5432")),
        database=env.get("DB_NAME", "ostory_db"),
        user=env.get("DB_USER", "ostory_user"),
        password=env.get("DB_PASSWORD", ""),
    )
    try:
        rows = await conn.fetch(
            """
            select agent_id,
                   name,
                   status,
                   last_heartbeat,
                   coalesce(system_info->>'agent_version', 'legacy') as agent_version,
                   coalesce(system_info->>'hostname', '-') as hostname
            from comfyui_agents
            where enabled = true
              and status in ('online', 'busy')
              and last_heartbeat > now() - interval '2 minutes'
            order by last_heartbeat desc nulls last
            """
        )
        return [dict(row) for row in rows]
    finally:
        await conn.close()


def _supports_agent_control(agent: dict[str, Any]) -> bool:
    return CONTROL_VERSION_MARKER in str(agent.get("agent_version") or "")


async def ensure_control_supported(force: bool) -> None:
    if force:
        print("warning=force enabled; skipping online agent compatibility check")
        return

    agents = await fetch_online_agents()
    if not agents:
        raise RuntimeError("No online Agent found; refusing to queue agent_control task")

    for agent in agents:
        print(
            "agent="
            + json.dumps(
                {
                    "agent_id": agent.get("agent_id"),
                    "name": agent.get("name"),
                    "status": agent.get("status"),
                    "agent_version": agent.get("agent_version"),
                    "hostname": agent.get("hostname"),
                    "supports_agent_control": _supports_agent_control(agent),
                },
                ensure_ascii=False,
            )
        )

    unsupported = [agent for agent in agents if not _supports_agent_control(agent)]
    if unsupported:
        versions = ", ".join(
            f"{a.get('name') or a.get('agent_id')}={a.get('agent_version')}"
            for a in unsupported
        )
        raise RuntimeError(
            "Online Agent does not support agent_control yet; restart it with "
            f"the latest comfyui_agent.py first. Unsupported: {versions}"
        )


async def queue_control_task(args: argparse.Namespace) -> str:
    from cluster_config import RedisConfig

    await ensure_control_supported(args.force)

    r = await redis_client()
    task_id = f"agent_control_{args.action}_{uuid.uuid4().hex[:12]}"
    data: dict[str, Any] = {"action": args.action}
    if args.script_url:
        data["script_url"] = args.script_url
    if args.agent_id:
        data["preferred_agent_id"] = args.agent_id
    if args.action == "install_h3_sidecar":
        data["timeout_seconds"] = args.timeout_seconds
        if args.skip_model_downloads:
            data["skip_model_downloads"] = True
        if args.force_refresh_comfyui:
            data["force_refresh_comfyui"] = True

    await r.hset(
        f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}",
        mapping={
            "task_id": task_id,
            "task_type": "agent_control",
            "data": json.dumps(data, ensure_ascii=False),
            "params": json.dumps(data, ensure_ascii=False),
            "priority": 1,
            "user_id": "admin",
            "status": "queued",
            "created_at": datetime.now().isoformat(),
            "progress": 0,
        },
    )
    score = 1_000_000 + int(datetime.now().timestamp())
    await r.zadd(RedisConfig.TASK_QUEUE_KEY, {task_id: score})
    await r.close()
    return task_id


async def wait_task(task_id: str, seconds: int) -> dict[str, Any]:
    from cluster_config import RedisConfig

    r = await redis_client()
    key = f"{RedisConfig.TASK_STATUS_PREFIX}{task_id}"
    last = None
    for _ in range(max(1, seconds // 3)):
        h = await r.hgetall(key)
        status = h.get("status", "")
        if status and status != last:
            print(f"{task_id}: status={status}")
            last = status
        if status in {"completed", "failed", "cancelled", "timeout"}:
            await r.close()
            return h
        await asyncio.sleep(3)
    h = await r.hgetall(key)
    h.setdefault("status", "still_processing")
    await r.close()
    return h


async def main_async(args: argparse.Namespace) -> int:
    task_id = await queue_control_task(args)
    print(f"queued {task_id}")
    if not args.wait:
        return 0

    result = await wait_task(task_id, args.timeout)
    print("final_status=" + result.get("status", ""))
    if result.get("error"):
        print("error=" + result["error"])
    if result.get("result"):
        print("result=" + result["result"])
    return 0 if result.get("status") == "completed" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Queue a constrained GPU Agent control task")
    parser.add_argument(
        "action",
        choices=["status", "self_update", "install_h3_sidecar", "sync_runtime_tools"],
    )
    parser.add_argument("--agent-id", default="", help="Pin the control task to one Agent ID")
    parser.add_argument("--script-url", default="", help="Override self-update script URL")
    parser.add_argument("--wait", action="store_true", help="Wait for the agent to report completion")
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=4 * 60 * 60,
        help="GPU-side command timeout for install_h3_sidecar",
    )
    parser.add_argument(
        "--skip-model-downloads",
        action="store_true",
        help="Pass -SkipModelDownloads to the H3 installer",
    )
    parser.add_argument(
        "--force-refresh-comfyui",
        action="store_true",
        help="Pass -ForceRefreshComfyUI to the H3 installer",
    )
    parser.add_argument("--force", action="store_true", help="Queue even if online Agents look legacy/unsupported")
    args = parser.parse_args()
    try:
        return asyncio.run(main_async(args))
    except RuntimeError as exc:
        print(f"error={exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
