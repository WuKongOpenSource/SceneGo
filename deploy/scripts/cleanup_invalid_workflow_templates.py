"""Back up and remove non-executable rows from workflow_templates.

The command is dry-run by default. Pass --apply to delete rows after the
recovery snapshot has been written successfully.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import asyncpg


DEPLOY_DIR = Path(__file__).resolve().parents[1]
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

from services.workflow_template_validation import workflow_invalid_reason  # noqa: E402


def _jsonable_row(row: Any) -> dict[str, Any]:
    return {
        key: value.isoformat() if isinstance(value, datetime) else value
        for key, value in dict(row).items()
    }


async def cleanup_invalid_templates(*, apply: bool, backup_path: Path) -> tuple[int, int]:
    conn = await asyncpg.connect(
        host=os.getenv("DB_HOST", "/tmp"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "ostory_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", ""),
    )
    try:
        async with conn.transaction():
            rows = await conn.fetch(
                "SELECT * FROM workflow_templates ORDER BY category, name FOR UPDATE"
            )
            invalid = [
                (_jsonable_row(row), workflow_invalid_reason(row["workflow_json"]))
                for row in rows
                if workflow_invalid_reason(row["workflow_json"]) is not None
            ]
            if not invalid:
                return 0, len(rows)

            if not apply:
                for row, reason in invalid:
                    print(
                        f"INVALID {row.get('workflow_key') or row.get('name')}: {reason}"
                    )
                return len(invalid), len(rows) - len(invalid)

            backup_path.parent.mkdir(parents=True, exist_ok=True)
            snapshot = {
                "created_at": datetime.now().astimezone().isoformat(),
                "table": "workflow_templates",
                "reason": (
                    "Recovery snapshot before removing empty, replacement-marker, "
                    "PlaceholderNode, and no-node workflow templates."
                ),
                "rows": [
                    {**row, "_invalid_reason": reason}
                    for row, reason in invalid
                ],
            }
            backup_path.write_text(
                json.dumps(snapshot, ensure_ascii=False, indent=2, default=str) + "\n",
                encoding="utf-8",
                newline="\n",
            )

            template_ids = [row["template_id"] for row, _reason in invalid]
            result = await conn.execute(
                "DELETE FROM workflow_templates WHERE template_id = ANY($1::text[])",
                template_ids,
            )
            deleted = int(result.split()[-1])
            if deleted != len(template_ids):
                raise RuntimeError(
                    f"Expected to delete {len(template_ids)} rows, deleted {deleted}"
                )

            remaining = await conn.fetch("SELECT workflow_json FROM workflow_templates")
            remaining_invalid = sum(
                workflow_invalid_reason(row["workflow_json"]) is not None
                for row in remaining
            )
            if remaining_invalid:
                raise RuntimeError(
                    f"Cleanup verification failed: {remaining_invalid} invalid rows remain"
                )
            return deleted, len(remaining)
    finally:
        await conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--backup-path",
        type=Path,
        default=Path("server_backups")
        / f"workflow_templates_cleanup_{datetime.now():%Y%m%d-%H%M%S}"
        / "invalid_workflow_templates.json.bak",
    )
    args = parser.parse_args()
    invalid_or_deleted, valid = asyncio.run(
        cleanup_invalid_templates(apply=args.apply, backup_path=args.backup_path)
    )
    action = "deleted" if args.apply else "would_delete"
    print(
        f"Workflow template cleanup: {action}={invalid_or_deleted} "
        f"valid_preserved={valid} backup={args.backup_path if args.apply else '-'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
