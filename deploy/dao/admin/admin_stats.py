"""DAO helpers for legacy admin statistics/reporting endpoints."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from db_manager import get_db_manager


logger = logging.getLogger(__name__)

VIDEO_TASK_TYPES = (
    "i2v",
    "morph",
    "upscale",
    "minimax_i2v",
    "minimax_morph",
    "sora2_i2v",
    "sora2_morph",
    "veo_i2v",
    "veo_morph",
    "wan2_i2v",
    "wan2_morph",
    "wan26_i2v",
    "kling_t2v",
    "kling_i2v",
    "kling_morph",
    "kling_refer",
    "vidu_r2v",
    "vidu_morph",
    "happyhorse_r2v",
    "seedance_t2v",
    "seedance_i2v",
    "seedance_morph",
    "seedance_multi",
    "seedance_draft",
)

VIDEO_LOG_TYPE_MATCHES = (
    "i2v",
    "morph",
    "upscale",
    "voice",
    "minimax_i2v",
    "minimax_morph",
    "wan2_i2v",
    "wan2_morph",
    "sora2_i2v",
    "sora2_morph",
    "veo_i2v",
    "veo_morph",
    "video_crop",
    "video_magnify",
    "kling_t2v",
    "kling_i2v",
    "kling_morph",
    "kling_refer",
    "vidu_r2v",
    "vidu_morph",
    "happyhorse_r2v",
)

IMAGE_LOG_TYPE_MATCHES = (
    "qwen",
    "qwen_lora",
    "qwen_1",
    "qwen_2",
    "qwen_3",
    "qwen_4",
    "qwen_5",
    "qwen_lora_1",
    "qwen_lora_2",
    "qwen_lora_3",
    "qwen_lora_4",
    "qwen_lora_5",
    "kontext",
    "upscale_hd",
    "remove_watermark",
    "three_view",
    "gemini_image",
    "doubao_image",
    "i2i_fj",
)

TEXT_LOG_TYPE_MATCHES = (
    "deepseek_text",
    "gemini_text",
    "minimax_text",
)

MODEL_NAME_BY_TASK_TYPE = {
    "wan2_i2v": "wan2-i2v",
    "wan2_morph": "wan2-morph",
    "wan26_i2v": "wan26-i2v",
    "kling_t2v": "kling-t2v",
    "kling_i2v": "kling-i2v",
    "kling_morph": "kling-morph",
    "kling_refer": "kling-refer",
    "vidu_r2v": "vidu-r2v",
    "vidu_morph": "vidu-morph",
    "happyhorse_r2v": "happyhorse-r2v",
    "sora2_i2v": "sora2-i2v",
    "sora2_morph": "sora2-morph",
    "veo_i2v": "veo-i2v",
    "veo_morph": "veo-morph",
    "minimax_i2v": "minimax-i2v",
    "minimax_morph": "minimax-morph",
    "upscale_hd": "upscale-hd",
    "remove_watermark": "remove-watermark",
    "three_view": "three-view",
    "qwen": "qwen",
    "qwen_lora": "qwen-lora",
    "qwen_1": "qwen",
    "qwen_2": "qwen",
    "qwen_3": "qwen",
    "qwen_4": "qwen",
    "qwen_5": "qwen",
    "qwen_lora_1": "qwen-lora",
    "qwen_lora_2": "qwen-lora",
    "qwen_lora_3": "qwen-lora",
    "qwen_lora_4": "qwen-lora",
    "qwen_lora_5": "qwen-lora",
    "kontext": "kontext",
    "i2v": "i2v",
    "morph": "morph",
    "upscale": "upscale",
    "voice": "voice",
    "gemini_image_2.5-flash": "gemini-2.5-flash-image",
    "gemini_image_3-pro": "gemini-3-pro-image",
    "doubao_image": "doubao-image",
    "deepseek_text": "deepseek-r1",
    "gemini_text": "gemini-2.5-flash-text",
    "minimax_text": "MiniMax-M3",
    "i2i_fj": "comfyui-i2i",
    "video_crop": "video-crop",
    "video_magnify": "video-magnify",
}


class AdminStatsDAO:
    """Admin reporting queries used by the compatibility admin shell."""

    @staticmethod
    def _empty_summary(active_users_count: int) -> Dict[str, Any]:
        return {
            "totalProjects": 0,
            "totalStoryboards": 0,
            "totalImages": 0,
            "totalVideos": 0,
            "totalText": 0,
            "totalMaterials": 0,
            "storageUsedMB": 0,
            "activeUsers": active_users_count,
            "source": "memory",
        }

    @staticmethod
    def _decode_jsonish(value: Any) -> Any:
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return None
        return value

    @staticmethod
    def _row_get(row: Any, key: str, default: Any = None) -> Any:
        if hasattr(row, "get"):
            return row.get(key, default)
        try:
            return row[key]
        except Exception:
            return default

    @staticmethod
    def _timestamp_ms(value: Any) -> int:
        if not value:
            return 0
        if hasattr(value, "timestamp"):
            return int(value.timestamp() * 1000)
        try:
            return int(value)
        except Exception:
            return 0

    @staticmethod
    def _duration_ms(started_at: Any, completed_at: Any) -> int:
        if not started_at or not completed_at:
            return 0
        try:
            return int((completed_at - started_at).total_seconds() * 1000)
        except Exception:
            return 0

    @classmethod
    def _count_legacy_project_generations(cls, projects: List[Any]) -> Dict[str, int]:
        totals = {
            "storyboards": 0,
            "images": 0,
            "text": 0,
        }
        for project in projects:
            storyboard = cls._decode_jsonish(cls._row_get(project, "storyboard"))
            if isinstance(storyboard, dict):
                items = storyboard.get("items")
                if isinstance(items, list):
                    totals["storyboards"] += len(items)
                    totals["text"] += len(items)
                    for item in items:
                        if not isinstance(item, dict):
                            continue
                        generated_images = item.get("generatedImages")
                        if isinstance(generated_images, list):
                            totals["images"] += len(generated_images)

            generated_images = cls._decode_jsonish(cls._row_get(project, "generated_images"))
            if isinstance(generated_images, dict):
                for images in generated_images.values():
                    if isinstance(images, list):
                        totals["images"] += len(images)
        return totals

    @staticmethod
    async def _has_legacy_project_generation_columns(db: Any) -> bool:
        try:
            await db.fetch(
                "SELECT storyboard, generated_images FROM projects "
                "WHERE storyboard IS NOT NULL OR generated_images IS NOT NULL LIMIT 1"
            )
            return True
        except Exception as exc:
            logger.warning("projects legacy generation columns unavailable: %s", exc)
            return False

    @staticmethod
    async def _fetch_legacy_project_generations(
        db: Any,
        *,
        requesting_username: str,
        super_admin_username: str,
    ) -> List[Any]:
        if requesting_username == "admin":
            super_admin_user = await db.fetchrow(
                "SELECT user_id FROM users WHERE username = $1",
                super_admin_username,
            )
            super_admin_id = super_admin_user["user_id"] if super_admin_user else None
            if super_admin_id:
                return await db.fetch(
                    "SELECT storyboard, generated_images FROM projects "
                    "WHERE (storyboard IS NOT NULL OR generated_images IS NOT NULL) "
                    "AND user_id != $1",
                    super_admin_id,
                )

        return await db.fetch(
            "SELECT storyboard, generated_images FROM projects "
            "WHERE storyboard IS NOT NULL OR generated_images IS NOT NULL"
        )

    @staticmethod
    async def _get_modern_generation_counts(db: Any) -> Dict[str, int]:
        total_text = await db.fetchval(
            """
            SELECT COUNT(*) FROM tasks
            WHERE status = 'completed'
            """
        ) or 0
        if total_text == 0:
            total_text = await db.fetchval(
                "SELECT COUNT(*) FROM text_contents WHERE is_deleted = FALSE"
            ) or 0

        try:
            total_storyboards = await db.fetchval(
                "SELECT COUNT(*) FROM storyboard_items"
            ) or 0
        except Exception:
            total_storyboards = total_text

        total_images = await db.fetchval(
            """
            SELECT COUNT(*) FROM tasks
            WHERE status = 'completed'
            AND (task_type LIKE '%qwen%'
                 OR task_type LIKE '%kontext%'
                 OR task_type LIKE '%gemini_image%'
                 OR task_type LIKE '%doubao_image%'
                 OR task_type = 'three_view'
                 OR task_type = 'i2i_fj')
            """
        ) or 0

        return {
            "storyboards": total_storyboards,
            "images": total_images,
            "text": total_text,
        }

    @staticmethod
    async def _count_video_generations(db: Any) -> int:
        try:
            total_videos = await db.fetchval(
                """
                SELECT COUNT(*) FROM tasks
                WHERE status = 'completed'
                AND task_type = ANY($1::text[])
                """,
                list(VIDEO_TASK_TYPES),
            ) or 0
            if total_videos == 0:
                total_videos = await db.fetchval(
                    """
                    SELECT COUNT(*) FROM files
                    WHERE file_type = 'video'
                    AND is_deleted = FALSE
                    """
                ) or 0
            return total_videos
        except Exception as exc:
            logger.warning("failed to count video generations: %s", exc)
            return 0

    @classmethod
    async def get_summary_stats(
        cls,
        *,
        requesting_username: str,
        super_admin_username: str,
        active_users_count: int,
    ) -> Dict[str, Any]:
        stats = cls._empty_summary(active_users_count)
        db = get_db_manager()
        if not db:
            return stats

        try:
            stats["totalProjects"] = await db.fetchval(
                "SELECT COUNT(*) FROM projects"
            ) or 0

            if await cls._has_legacy_project_generation_columns(db):
                projects = await cls._fetch_legacy_project_generations(
                    db,
                    requesting_username=requesting_username,
                    super_admin_username=super_admin_username,
                )
                generation_totals = cls._count_legacy_project_generations(projects)
            else:
                try:
                    generation_totals = await cls._get_modern_generation_counts(db)
                except Exception as exc:
                    logger.warning("failed to count modern generation stats: %s", exc)
                    generation_totals = {"storyboards": 0, "images": 0, "text": 0}

            total_videos = await cls._count_video_generations(db)
            storage_used = (generation_totals["images"] * 0.5) + (total_videos * 10)

            stats.update(
                {
                    "totalStoryboards": generation_totals["storyboards"],
                    "totalImages": generation_totals["images"],
                    "totalVideos": total_videos,
                    "totalText": generation_totals["text"],
                    "storageUsedMB": round(storage_used, 2),
                    "source": "backend",
                }
            )
            logger.info(
                "loaded admin summary stats: Text=%s, Images=%s, Videos=%s, Projects=%s",
                stats["totalText"],
                stats["totalImages"],
                stats["totalVideos"],
                stats["totalProjects"],
            )
        except Exception as exc:
            logger.warning("failed to load admin summary stats: %s", exc)
        return stats

    @staticmethod
    async def _fetch_legacy_generation_log_projects(
        db: Any,
        *,
        requesting_username: str,
        super_admin_username: str,
        limit: int,
    ) -> List[Any]:
        if requesting_username == "admin":
            return await db.fetch(
                """
                SELECT p.project_id, p.user_id, u.username, p.storyboard, p.generated_images, p.updated_at
                FROM projects p
                LEFT JOIN users u ON p.user_id = u.user_id
                WHERE (p.storyboard IS NOT NULL OR p.generated_images IS NOT NULL)
                AND u.username != $1
                ORDER BY p.updated_at DESC
                LIMIT $2
                """,
                super_admin_username,
                limit * 2,
            )

        return await db.fetch(
            """
            SELECT p.project_id, p.user_id, u.username, p.storyboard, p.generated_images, p.updated_at
            FROM projects p
            LEFT JOIN users u ON p.user_id = u.user_id
            WHERE p.storyboard IS NOT NULL OR p.generated_images IS NOT NULL
            ORDER BY p.updated_at DESC
            LIMIT $1
            """,
            limit * 2,
        )

    @staticmethod
    async def _fetch_completed_generation_tasks(
        db: Any,
        *,
        requesting_username: str,
        super_admin_username: str,
        limit: int,
    ) -> List[Any]:
        if requesting_username == "admin":
            return await db.fetch(
                """
                SELECT t.task_id, t.user_id, u.username, t.status, t.created_at, t.completed_at,
                       t.task_data, t.result_data, t.task_type
                FROM tasks t
                LEFT JOIN users u ON t.user_id = u.user_id
                WHERE t.status = 'completed'
                AND u.username != $1
                ORDER BY t.completed_at DESC
                LIMIT $2
                """,
                super_admin_username,
                limit,
            )

        return await db.fetch(
            """
            SELECT t.task_id, t.user_id, u.username, t.status, t.created_at, t.completed_at,
                   t.task_data, t.result_data, t.task_type
            FROM tasks t
            LEFT JOIN users u ON t.user_id = u.user_id
            WHERE t.status = 'completed'
            ORDER BY t.completed_at DESC
            LIMIT $1
            """,
            limit,
        )

    @classmethod
    def _build_legacy_project_logs(cls, projects: List[Any]) -> List[Dict[str, Any]]:
        logs: List[Dict[str, Any]] = []
        for project in projects:
            project_id = cls._row_get(project, "project_id")
            user_id = cls._row_get(project, "user_id")
            username = cls._row_get(project, "username") or "unknown"
            updated_at_ms = cls._timestamp_ms(cls._row_get(project, "updated_at"))
            storyboard = cls._decode_jsonish(cls._row_get(project, "storyboard"))
            if not isinstance(storyboard, dict):
                continue
            items = storyboard.get("items")
            if not isinstance(items, list):
                continue

            for item in items:
                if not isinstance(item, dict):
                    continue
                item_id = item.get("id", "unknown")
                logs.append(
                    {
                        "id": f"text_{project_id}_{item_id}",
                        "userId": user_id,
                        "username": username,
                        "timestamp": updated_at_ms,
                        "type": "text",
                        "model": "gemini-2.5-flash",
                        "status": "success",
                        "prompt": (item.get("scriptSegment", "") or "")[:100] or "Storyboard generation",
                        "params": '{"temperature": 0.7}',
                        "executionTimeMs": 2000,
                        "queueTimeMs": 100,
                    }
                )

                generated_images = item.get("generatedImages")
                if not isinstance(generated_images, list):
                    continue
                for idx, image in enumerate(generated_images):
                    image_url = image.get("url") if isinstance(image, dict) else None
                    image_timestamp = (
                        image.get("timestamp", updated_at_ms)
                        if isinstance(image, dict)
                        else updated_at_ms
                    )
                    logs.append(
                        {
                            "id": f"img_{project_id}_{item_id}_{idx}",
                            "userId": user_id,
                            "username": username,
                            "timestamp": image_timestamp,
                            "type": "image",
                            "model": "gemini-2.5-flash-image",
                            "status": "success",
                            "prompt": (item.get("imagePrompt", "") or "")[:100] or "Image generation",
                            "params": '{"temperature": 0.7}',
                            "executionTimeMs": 5000,
                            "queueTimeMs": 300,
                            "resultPreview": image_url,
                        }
                    )
        return logs

    @staticmethod
    def _classify_task_log_type(task_type: str) -> str:
        if any(video_type in task_type for video_type in VIDEO_LOG_TYPE_MATCHES):
            return "video"
        if any(image_type in task_type for image_type in IMAGE_LOG_TYPE_MATCHES):
            return "image"
        if any(text_type in task_type for text_type in TEXT_LOG_TYPE_MATCHES):
            return "text"
        lowered = task_type.lower()
        if "video" in lowered:
            return "video"
        if "image" in lowered or "img" in lowered:
            return "image"
        return "text"

    @staticmethod
    def _extract_task_result(log_type: str, result_data: Dict[str, Any]) -> Dict[str, Any]:
        result = {
            "resultPreview": None,
            "resultVideo": None,
            "resultText": None,
        }

        if log_type == "image":
            images = result_data.get("images")
            if isinstance(images, list) and images:
                image = images[0]
                if isinstance(image, dict):
                    result["resultPreview"] = image.get("url") or image.get("filename")
                elif isinstance(image, str):
                    result["resultPreview"] = image
        elif log_type == "video":
            videos = result_data.get("videos")
            if isinstance(videos, list) and videos:
                video = videos[0]
                if isinstance(video, dict):
                    result["resultVideo"] = video.get("url") or video.get("filename")
                elif isinstance(video, str):
                    result["resultVideo"] = video
        elif log_type == "text":
            result["resultText"] = result_data.get("text") or "（文本内容未保存）"
        return result

    @classmethod
    def _build_task_log(cls, task: Any) -> Dict[str, Any]:
        task_data = cls._decode_jsonish(cls._row_get(task, "task_data")) or {}
        if not isinstance(task_data, dict):
            task_data = {}
        result_data = cls._decode_jsonish(cls._row_get(task, "result_data")) or {}
        if not isinstance(result_data, dict):
            result_data = {}

        task_type = cls._row_get(task, "task_type") or "unknown"
        log_type = cls._classify_task_log_type(task_type)
        prompt = (task_data.get("prompt") or "")[:100] or f"{log_type.capitalize()} generation"
        result_fields = cls._extract_task_result(log_type, result_data)
        created_at = cls._row_get(task, "created_at")
        completed_at = cls._row_get(task, "completed_at")

        return {
            "id": f"{log_type}_{cls._row_get(task, 'task_id')}",
            "userId": cls._row_get(task, "user_id"),
            "username": cls._row_get(task, "username") or "unknown",
            "timestamp": cls._timestamp_ms(completed_at) or cls._timestamp_ms(created_at),
            "type": log_type,
            "model": MODEL_NAME_BY_TASK_TYPE.get(task_type, task_type),
            "status": "success" if cls._row_get(task, "status") == "completed" else "failed",
            "prompt": prompt,
            "params": f'{{"workflow": "{task_type}"}}',
            "executionTimeMs": cls._duration_ms(created_at, completed_at),
            "queueTimeMs": 500,
            **result_fields,
        }

    @classmethod
    async def get_generation_logs(
        cls,
        *,
        requesting_username: str,
        super_admin_username: str,
        limit: int,
    ) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []

        logs: List[Dict[str, Any]] = []
        try:
            if await cls._has_legacy_project_generation_columns(db):
                projects = await cls._fetch_legacy_generation_log_projects(
                    db,
                    requesting_username=requesting_username,
                    super_admin_username=super_admin_username,
                    limit=limit,
                )
                logs.extend(cls._build_legacy_project_logs(projects))
            else:
                logger.info("using task table for admin generation logs")

            tasks = await cls._fetch_completed_generation_tasks(
                db,
                requesting_username=requesting_username,
                super_admin_username=super_admin_username,
                limit=limit,
            )
            logger.info("loaded %s completed tasks for admin generation logs", len(tasks))
            logs.extend(cls._build_task_log(task) for task in tasks)
            logs.sort(key=lambda log: log["timestamp"], reverse=True)

            if logs:
                type_counts: Dict[str, int] = {}
                for log in logs:
                    type_counts[log["type"]] = type_counts.get(log["type"], 0) + 1
                logger.info(
                    "admin generation logs loaded: total=%s Text=%s Image=%s Video=%s",
                    len(logs),
                    type_counts.get("text", 0),
                    type_counts.get("image", 0),
                    type_counts.get("video", 0),
                )
            else:
                logger.warning("admin generation logs query returned no rows")
        except Exception as exc:
            logger.warning("failed to load admin generation logs: %s", exc)
        return logs

    @staticmethod
    async def get_user_asset_breakdown(
        *,
        requesting_username: str,
        super_admin_username: str,
    ) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []

        per_user_sql = """
            WITH u_files AS (
                SELECT user_id,
                    SUM(CASE WHEN file_type='image' THEN 1 ELSE 0 END) AS img_cnt,
                    SUM(CASE WHEN file_type='video' THEN 1 ELSE 0 END) AS vid_cnt,
                    SUM(CASE WHEN file_type='audio' THEN 1 ELSE 0 END) AS aud_cnt
                FROM files WHERE is_deleted = FALSE
                GROUP BY user_id
            ),
            u_proj AS (
                SELECT user_id, COUNT(*) AS proj_cnt
                FROM projects
                GROUP BY user_id
            )
            SELECT u.user_id, u.username,
                COALESCE(p.proj_cnt, 0) AS projects,
                COALESCE(f.img_cnt, 0) AS images,
                COALESCE(f.vid_cnt, 0) AS videos,
                COALESCE(f.aud_cnt, 0) AS audios
            FROM users u
            LEFT JOIN u_files f ON f.user_id = u.user_id
            LEFT JOIN u_proj  p ON p.user_id = u.user_id
            WHERE u.is_deleted = FALSE
        """
        if requesting_username == "admin":
            per_user_sql += " AND u.username <> $1 "
            rows = await db.fetch(per_user_sql, super_admin_username)
        else:
            rows = await db.fetch(per_user_sql)
        return [dict(row) for row in rows]

    @staticmethod
    async def get_active_org_members() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            SELECT om.org_id, o.name, om.user_id
            FROM organization_members om
            JOIN organizations o ON o.org_id = om.org_id
            WHERE o.status = 'active'
            """
        )
        return [dict(row) for row in rows]

    @classmethod
    async def get_stats_breakdown(
        cls,
        *,
        group_by: str,
        requesting_username: str,
        super_admin_username: str,
    ) -> List[Dict[str, Any]]:
        user_rows = await cls.get_user_asset_breakdown(
            requesting_username=requesting_username,
            super_admin_username=super_admin_username,
        )

        if group_by == "user":
            return sorted(
                user_rows,
                key=lambda row: (row["projects"] + row["images"] + row["videos"]),
                reverse=True,
            )

        if group_by != "org":
            return []

        members = await cls.get_active_org_members()
        user_idx = {row["user_id"]: row for row in user_rows}
        agg: Dict[str, Dict[str, Any]] = {}
        for member in members:
            org_id = member["org_id"]
            if org_id not in agg:
                agg[org_id] = {
                    "org_id": org_id,
                    "name": member["name"],
                    "member_count": 0,
                    "projects": 0,
                    "images": 0,
                    "videos": 0,
                    "audios": 0,
                }
            agg[org_id]["member_count"] += 1
            user_row = user_idx.get(member["user_id"])
            if user_row:
                agg[org_id]["projects"] += user_row["projects"]
                agg[org_id]["images"] += user_row["images"]
                agg[org_id]["videos"] += user_row["videos"]
                agg[org_id]["audios"] += user_row["audios"]

        return sorted(
            agg.values(),
            key=lambda row: (row["projects"] + row["images"] + row["videos"]),
            reverse=True,
        )
