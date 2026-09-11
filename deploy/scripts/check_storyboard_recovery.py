#!/usr/bin/env python3
"""Read-only storyboard recovery probe.

This script is intended for the "storyboard disappeared" class of incidents:
it verifies that the episode still has storyboard rows, reports per-script
storyboard counts, and confirms stale script-id fallback still recovers the
episode-scope storyboard.
"""
from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass
class HttpResult:
    status: int | None
    body: bytes


def configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.getenv("BASE_URL", "http://127.0.0.1:6006"))
    parser.add_argument("--username", default=os.getenv("ADMIN_USERNAME", "admin"))
    parser.add_argument(
        "--password",
        default=os.getenv("ADMIN_PASSWORD", "admin123"),
        help=(
            "Admin password. Defaults to ADMIN_PASSWORD; falls back to the local "
            "development password only when the server has ALLOW_DEV_ADMIN_PASSWORD=true."
        ),
    )
    parser.add_argument("--project-id", default=os.getenv("PROJECT_ID", ""))
    parser.add_argument("--episode-id", default=os.getenv("EPISODE_ID", ""))
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--min-total", type=int, default=1)
    return parser.parse_args()


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def validated_http_base(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        fail("--base-url must be an absolute http:// or https:// URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        fail("--base-url must not contain credentials, a query, or a fragment")
    return value.rstrip("/")


def request_json(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    token: str | None = None,
    timeout: int = 30,
) -> tuple[int, dict[str, Any]]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    url = validated_http_base(base_url) + path
    req = urllib.request.Request(url, method=method, data=data, headers=headers)
    try:
        # URL scheme and authority are constrained by validated_http_base.
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as resp:  # nosec B310
            raw = resp.read()
            return resp.status, json.loads(raw.decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            payload = {"detail": raw.decode("utf-8", errors="replace")}
        return exc.code, payload


def require_success(label: str, status: int, payload: dict[str, Any]) -> None:
    if status != 200 or payload.get("success") is False:
        fail(f"{label} failed: http={status} payload={json.dumps(payload, ensure_ascii=False)[:500]}")


def get_storyboard(
    base_url: str,
    token: str,
    episode_id: str,
    *,
    script_id: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    params = {
        "limit": str(limit),
        "include_total": "true",
    }
    if script_id:
        params["script_id"] = script_id
    qs = urllib.parse.urlencode(params)
    status, payload = request_json(
        base_url,
        f"/api/episodes/{urllib.parse.quote(episode_id)}/storyboard-items?{qs}",
        token=token,
    )
    require_success("storyboard-items", status, payload)
    return payload


def main() -> int:
    args = parse_args()
    base_url = args.base_url.rstrip("/")
    if not args.episode_id:
        fail("--episode-id is required")

    status, login = request_json(
        base_url,
        "/api/login",
        method="POST",
        body={"username": args.username, "password": args.password},
        timeout=20,
    )
    token = login.get("token") or login.get("access_token")
    if status != 200 or not token:
        fail(f"login failed: http={status}")

    project_status: int | None = None
    if args.project_id:
        project_status, project_payload = request_json(
            base_url,
            f"/api/projects/{urllib.parse.quote(args.project_id)}",
            token=token,
        )
        require_success("project detail", project_status, project_payload)

    status, scripts_payload = request_json(
        base_url,
        f"/api/episodes/{urllib.parse.quote(args.episode_id)}/scripts",
        token=token,
    )
    require_success("episode scripts", status, scripts_payload)
    scripts = scripts_payload.get("scripts") or []

    episode_storyboard = get_storyboard(
        base_url,
        token,
        args.episode_id,
        limit=args.limit,
    )
    episode_total = int(episode_storyboard.get("total") or 0)
    if episode_total < args.min_total:
        fail(f"episode storyboard total {episode_total} is below expected minimum {args.min_total}")

    script_counts: list[dict[str, Any]] = []
    for script in scripts:
        script_id = script.get("script_id") or script.get("scriptId")
        if not script_id:
            continue
        scoped = get_storyboard(
            base_url,
            token,
            args.episode_id,
            script_id=script_id,
            limit=args.limit,
        )
        script_counts.append(
            {
                "script_id": script_id,
                "name": script.get("file_name") or script.get("fileName") or "",
                "items": len(scoped.get("items") or []),
                "total": scoped.get("total"),
                "fallback_reason": scoped.get("fallback_reason") or scoped.get("fallbackReason"),
            }
        )

    if scripts and episode_total > 0 and not any((row.get("total") or 0) > 0 for row in script_counts):
        fail("episode has storyboard rows, but none of the current scripts own storyboard rows")

    stale_script_id = "__codex_missing_script_for_storyboard_recovery__"
    stale = get_storyboard(
        base_url,
        token,
        args.episode_id,
        script_id=stale_script_id,
        limit=min(args.limit, 5),
    )
    stale_fallback_reason = stale.get("fallback_reason") or stale.get("fallbackReason")
    if episode_total > 0 and stale_fallback_reason != "stale_script_storyboard":
        fail(f"stale script fallback missing: reason={stale_fallback_reason!r}")
    if episode_total > 0 and len(stale.get("items") or []) == 0:
        fail("stale script fallback returned no storyboard items")

    summary = {
        "base_url": base_url,
        "project_id": args.project_id or None,
        "project_status": project_status,
        "episode_id": args.episode_id,
        "script_count": len(scripts),
        "episode_items": len(episode_storyboard.get("items") or []),
        "episode_total": episode_total,
        "script_counts": script_counts,
        "stale_fallback": {
            "items": len(stale.get("items") or []),
            "total": stale.get("total"),
            "fallback_reason": stale_fallback_reason,
            "fallback_scope": stale.get("fallback_scope") or stale.get("fallbackScope"),
        },
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print("Storyboard recovery probe OK")
    return 0


if __name__ == "__main__":
    configure_stdio()
    raise SystemExit(main())
