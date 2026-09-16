"""Durable intent/outcome ledger; every paid submit is preceded by committed intent."""
from __future__ import annotations

import hashlib
import json
from contextlib import asynccontextmanager
from db_manager import get_db_manager
from services.jimeng_contract import JimengError


def unpack(row):
    if not row:
        return None
    result = dict(row)
    for key in ("task_data", "input_trace", "result_data"):
        if isinstance(result.get(key), str):
            result[key] = json.loads(result[key])
    return result


class JimengJobDAO:
    @staticmethod
    async def mark_processing(task_id):
        # Duplicate dispatch must never turn a terminal task back into processing.
        return bool(await get_db_manager().fetchval("""
            UPDATE tasks SET status='processing',started_at=COALESCE(started_at,CURRENT_TIMESTAMP)
            WHERE task_id=$1 AND task_type='jimeng_multimodal'
              AND status IN ('pending','queued','processing') RETURNING task_id
        """, task_id))

    @staticmethod
    async def review_count(account_id):
        return int(await get_db_manager().fetchval(
            "SELECT COUNT(*) FROM jimeng_jobs WHERE account_id=$1 AND stage='review_required'", account_id))

    @staticmethod
    @asynccontextmanager
    async def account_lock(account_id):
        async with get_db_manager().acquire() as conn:
            key = "jimeng:account:" + account_id
            locked = await conn.fetchval("SELECT pg_try_advisory_lock(hashtextextended($1, 0))", key)
            try:
                yield conn if locked else None
            finally:
                if locked:
                    await conn.execute("SELECT pg_advisory_unlock(hashtextextended($1, 0))", key)

    @staticmethod
    async def ensure(task, config):
        stable_data = {k: v for k, v in task.data.items() if k not in {"progress_message", "progress_stage"}}
        data = json.dumps(stable_data, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        digest = hashlib.sha256(data.encode()).hexdigest()
        row = await get_db_manager().fetchrow("""
            INSERT INTO jimeng_jobs(task_id,user_id,account_id,session_id,state_id,request_sha256,task_data)
            VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
            ON CONFLICT(task_id) DO UPDATE SET task_id=EXCLUDED.task_id RETURNING *
        """, task.task_id, task.user_id, config.account_id, config.session_id, config.state_id, digest, data)
        if row["user_id"] != task.user_id or row["request_sha256"] != digest:
            raise JimengError("任务编号已绑定其他请求，已阻止重复提交。")
        return unpack(row)

    @staticmethod
    async def get(task_id):
        return unpack(await get_db_manager().fetchrow("SELECT * FROM jimeng_jobs WHERE task_id=$1", task_id))

    @staticmethod
    async def update(task_id, *, stage, message="", submit_id=None, trace=None, result=None, provider_credits=None, delay=15):
        await get_db_manager().execute("""
            UPDATE jimeng_jobs SET stage=$2,message=$3,submit_id=COALESCE($4,submit_id),
                input_trace=COALESCE($5::jsonb,input_trace),result_data=COALESCE($6::jsonb,result_data),
                provider_credit_count=COALESCE($7,provider_credit_count),
                next_poll_at=CURRENT_TIMESTAMP + $8::int * INTERVAL '1 second',updated_at=CURRENT_TIMESTAMP
            WHERE task_id=$1
        """, task_id, stage, message[:200], submit_id,
            json.dumps(trace) if trace is not None else None,
            json.dumps(result) if result is not None else None, provider_credits, delay)

    @staticmethod
    async def mark_submitting(task_id):
        return bool(await get_db_manager().fetchval("""
            UPDATE jimeng_jobs SET stage='submitting',updated_at=CURRENT_TIMESTAMP
            WHERE task_id=$1 AND stage='waiting' RETURNING task_id
        """, task_id))

    @staticmethod
    async def account_busy(account_id, task_id):
        return bool(await get_db_manager().fetchval("""
            SELECT EXISTS(SELECT 1 FROM jimeng_jobs WHERE account_id=$1 AND task_id<>$2
              AND stage IN ('submitting','submitted','downloading','persisting','settling','refund_pending','review_required'))
        """, account_id, task_id))

    @staticmethod
    async def due(account_id, limit=10):
        rows = await get_db_manager().fetch("""
            SELECT * FROM jimeng_jobs WHERE account_id=$1 AND stage NOT IN ('completed','failed','review_required')
              AND next_poll_at<=CURRENT_TIMESTAMP
            ORDER BY (stage='waiting') ASC,created_at ASC LIMIT $2
        """, account_id, limit)
        return [unpack(row) for row in rows]

    @staticmethod
    async def undiscovered():
        """Recover a worker exit after queue claim but before ledger creation."""
        rows = await get_db_manager().fetch("""
            SELECT t.* FROM tasks t WHERE t.task_type='jimeng_multimodal'
              AND t.status='processing' AND NOT EXISTS
              (SELECT 1 FROM jimeng_jobs j WHERE j.task_id=t.task_id)
            ORDER BY t.created_at LIMIT 20
        """)
        return [unpack(row) for row in rows]
