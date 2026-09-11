"""Online-provider task handlers with no local execution-node dependency.

The class is a mixin: a queue worker supplies `task_queue` and lifecycle
coordination, while this module owns only third-party API submission, polling,
bounded media transfer and result persistence.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path

from core.online_provider_task_model import OnlineProviderTask
from minimax_audio import get_minimax_audio_client
from file_service import save_generated_file_to_db
from dao_character_voice import CharacterVoiceDAO
from services.remote_content_service import RemoteContentTooLarge, configured_download_limit
from services.sensitive_data_redaction import redact_sensitive_text

logger = logging.getLogger(__name__)

try:
    from dao_task import TaskDAO
    from dao_content import FileDAO
    DB_AVAILABLE = True
except ImportError:
    DB_AVAILABLE = False
    FileDAO = None
    TaskDAO = None


class OnlineProviderTaskHandlers:
    """Reusable handlers for tasks executed exclusively through online APIs."""

    async def _process_minimax_task(self, task: OnlineProviderTask) -> bool:
        
        try:
            from minimax_api import get_minimax_client
            from external_api.video.minimax import normalize_minimax_generation_options, normalize_minimax_status
            
            minimax_client = get_minimax_client()
            
            
            first_frame_image = task.data.get('first_frame_image')
            prompt = task.data.get('prompt', '')
            last_frame_image = task.data.get('last_frame_image')  
            
            requested_model = task.data.get('minimax_model') or task.data.get('model_name') or None
            requested_duration, requested_resolution = normalize_minimax_generation_options(
                task.data.get('duration'),
                task.data.get('minimax_resolution'),
            )
            requested_prompt_optimizer = task.data.get('minimax_prompt_optimizer')
            if isinstance(requested_prompt_optimizer, str):
                requested_prompt_optimizer = requested_prompt_optimizer.strip().lower() not in {'0', 'false', 'no', 'off'}
            elif requested_prompt_optimizer is None:
                requested_prompt_optimizer = True
            else:
                requested_prompt_optimizer = bool(requested_prompt_optimizer)

            if not first_frame_image:
                raise ValueError("缺少 first_frame_image 参数")

            first_frame_image = await self._file_id_to_dashscope_url(
                first_frame_image,
                label="minimax_first_frame",
            )
            if last_frame_image:
                last_frame_image = await self._file_id_to_dashscope_url(
                    last_frame_image,
                    label="minimax_last_frame",
                )
            
            
            logger.info(f"🎬 创建 MiniMax 任务: {task.task_type}")
            create_result = minimax_client.generate_video(
                first_frame_image=first_frame_image,
                prompt=prompt,
                last_frame_image=last_frame_image,
                model=requested_model,
                duration=requested_duration,
                resolution=requested_resolution,
                prompt_optimizer=requested_prompt_optimizer,
            )
            
            minimax_task_id = create_result.get('task_id')
            if not minimax_task_id:
                raise ValueError("未获取到 MiniMax task_id")
            
            logger.info(f"✅ MiniMax 任务已创建: {minimax_task_id}")
            
            
            logger.info(f"⏳ 等待 MiniMax 任务完成...")
            start_time = time.time()
            max_wait = 600
            poll_interval = 5
            
            while time.time() - start_time < max_wait:
                try:
                    result = minimax_client.query_task(minimax_task_id)
                    status = normalize_minimax_status(result)
                    
                    if status in {'success', 'succeeded'}:
                        logger.info(f"✅ MiniMax 任务完成: {minimax_task_id}")
                        complete_result = result
                        break
                    elif status in {'fail', 'failed', 'expired'}:
                        if result.get('error_message'):
                            raise RuntimeError(f"MiniMax task failed: {result.get('error_message')}")
                        error_msg = result.get('base_resp', {}).get('status_msg', '未知错误')
                        raise RuntimeError(f"MiniMax 任务失败: {error_msg}")
                    elif status == 'processing':
                        
                        progress = min(int((time.time() - start_time) / max_wait * 90), 90)
                        await self.task_queue.update_progress(task.task_id, progress)
                        logger.info(f"⏳ MiniMax 任务处理中: {minimax_task_id}, 进度: {progress}%")
                    
                    await asyncio.sleep(poll_interval)
                except RuntimeError:
                    raise
                except Exception as e:
                    logger.error(f"❌ MiniMax 轮询失败: {e}")
                    await asyncio.sleep(poll_interval)
            else:
                raise TimeoutError(f"MiniMax 任务超时: {minimax_task_id}")
            
            file_id = complete_result.get('file_id')
            if not file_id:
                raise ValueError("未获取到 file_id")
            
            
            logger.info(f"📥 下载 MiniMax 视频: {file_id}")
            video_content = minimax_client.download_video(str(file_id))
            
            
            logger.info(f"💾 保存MiniMax视频...")
            saved_info = await self._save_external_video(
                video_content=video_content,
                task=task,
                source='minimax'
            )
            
            if saved_info:
                result = {
                    "videos": [saved_info],
                    "images": []
                }
                await self.task_queue.complete_task(task.task_id, result)
                logger.info(f"✅ MiniMax 任务完成: {task.task_id}")
                return True
            else:
                raise Exception("保存视频失败")
        
        except Exception as e:
            logger.error(f"❌ MiniMax 任务处理失败: {e}", exc_info=True)
            try:
                from services.api_provider_runtime import (
                    vendor_error_is_non_retryable,
                    vendor_user_facing_error,
                )

                non_retryable = vendor_error_is_non_retryable(e, "minimax")
                task_error = vendor_user_facing_error(e, "minimax")
                if non_retryable:
                    response = getattr(e, "response", None)
                    logger.error(
                        "MiniMax non-retryable auth/config error: task=%s status=%s body=%s",
                        task.task_id,
                        getattr(response, "status_code", "-"),
                        redact_sensitive_text(getattr(response, "text", "") or "", max_chars=300),
                    )
                await self.task_queue.fail_task(task.task_id, task_error, retry=not non_retryable)
            except Exception:
                await self.task_queue.fail_task(task.task_id, redact_sensitive_text(e))
            return False
    
    async def _process_sora2_task(self, task: OnlineProviderTask) -> bool:
        
        try:
            from sora2_api import get_sora2_client
            import tempfile
            from pathlib import Path
            
            sora2_client = get_sora2_client()
            
            
            image_path = task.data.get('image_path')
            image_path_end = task.data.get('image_path_end')  
            prompt = task.data.get('prompt', '')
            
            if not image_path:
                raise ValueError("缺少 image_path 参数")
            
            
            temp_image_path = None
            temp_image_path_end = None
            
            try:
                
                logger.info(f"📥 下载首帧图片: {image_path}")
                temp_image_path = await self._download_image_to_temp(image_path)
                
                
                if task.task_type == 'sora2_morph' and image_path_end:
                    logger.info(f"📥 下载尾帧图片: {image_path_end}")
                    temp_image_path_end = await self._download_image_to_temp(image_path_end)
                    
                    
                    logger.info(f"🔄 拼合首尾帧图片...")
                    merged_bytes = sora2_client.merge_images_vertical(temp_image_path, temp_image_path_end)
                    
                    
                    merged_temp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
                    merged_temp.write(merged_bytes)
                    merged_temp.close()
                    temp_image_path = merged_temp.name
                    logger.info(f"✅ 图片拼合完成: {temp_image_path}")
                
                
                logger.info(f"🎬 创建 Sora2 任务: {task.task_type}")
                create_result = sora2_client.create_video_task(
                    prompt=prompt,
                    image_path=temp_image_path,
                    size="1280x704",
                    seconds="15"
                )
                
                sora2_video_id = create_result.get('id')
                if not sora2_video_id:
                    raise ValueError("未获取到 Sora2 video_id")
                
                logger.info(f"✅ Sora2 任务已创建: {sora2_video_id}")
                
                
                logger.info(f"⏳ 等待 Sora2 任务完成...")
                start_time = time.time()
                max_wait = 600
                poll_interval = 5
                
                while time.time() - start_time < max_wait:
                    try:
                        result = sora2_client.query_task(sora2_video_id)
                        status = result.get('status', '')
                        progress_value = result.get('progress', 0)
                        
                        if status == 'completed':
                            logger.info(f"✅ Sora2 任务完成: {sora2_video_id}")
                            complete_result = result
                            break
                        elif status == 'failed':
                            error = result.get('error', {})
                            error_msg = error.get('message', '未知错误')
                            raise RuntimeError(f"Sora2 任务失败: {error_msg}")
                        else:
                            
                            progress = max(progress_value, int((time.time() - start_time) / max_wait * 90))
                            await self.task_queue.update_progress(task.task_id, min(progress, 90))
                            logger.info(f"⏳ Sora2 任务处理中: {status}, 进度: {progress}%")
                        
                        await asyncio.sleep(poll_interval)
                    except Exception as e:
                        logger.error(f"❌ Sora2 轮询失败: {e}")
                        await asyncio.sleep(poll_interval)
                else:
                    raise TimeoutError(f"Sora2 任务超时: {sora2_video_id}")
                
                
                logger.info(f"📥 下载 Sora2 视频: {sora2_video_id}")
                video_content = sora2_client.download_video(sora2_video_id)
                
                
                logger.info(f"💾 保存Sora2视频...")
                saved_info = await self._save_external_video(
                    video_content=video_content,
                    task=task,
                    source='sora2'
                )
                
                if saved_info:
                    result = {
                        "videos": [saved_info],
                        "images": []
                    }
                    await self.task_queue.complete_task(task.task_id, result)
                    logger.info(f"✅ Sora2 任务完成: {task.task_id}")
                    return True
                raise RuntimeError("Sora2 视频已生成，但服务端持久化失败")
            
            finally:
                
                for temp_path in [temp_image_path, temp_image_path_end]:
                    if temp_path:
                        try:
                            import os
                            os.unlink(temp_path)
                        except:
                            pass
        
        except Exception as e:
            logger.error(f"❌ Sora2 任务处理失败: {e}", exc_info=True)
            try:
                from services.api_provider_runtime import (
                    vendor_error_is_non_retryable,
                    vendor_user_facing_error,
                )

                non_retryable = vendor_error_is_non_retryable(e, "sora2")
                task_error = vendor_user_facing_error(e, "sora2")
                if non_retryable:
                    response = getattr(e, "response", None)
                    logger.error(
                        "Sora2 non-retryable auth/config error: task=%s status=%s body=%s",
                        task.task_id,
                        getattr(response, "status_code", "-"),
                        redact_sensitive_text(getattr(response, "text", "") or "", max_chars=300),
                    )
                await self.task_queue.fail_task(task.task_id, task_error, retry=not non_retryable)
            except Exception:
                await self.task_queue.fail_task(task.task_id, redact_sensitive_text(e))
            return False

    async def _process_seedance_task(self, task: OnlineProviderTask) -> bool:
        # Once accepted, a polling/download failure must not enqueue a new paid
        # generation. Retain the provider id in errors for result recovery.
        ark_task_id = None
        try:
            from seedance_api import get_seedance_client
            client = get_seedance_client()

            sub_model = task.data.get('sub_model', 'standard')
            model_scope = task.data.get('model_scope') or 'workflow'
            prompt = task.data.get('prompt') or ''
            media_inputs = task.data.get('media_inputs') or []
            from services.seedance_audio_validation_service import validate_seedance_reference_audio
            verified_audio = await validate_seedance_reference_audio(
                task.task_type, task.data, task.user_id, file_dao=FileDAO,
            )

            
            contents = []
            if prompt:
                contents.append({"type": "text", "text": prompt})

            for idx, m in enumerate(media_inputs):
                kind = (m.get('kind') or '').lower()
                role = m.get('role') or {
                    'image': 'reference_image',
                    'video': 'reference_video',
                    'audio': 'reference_audio',
                }.get(kind)
                
                
                
                src = m.get('file_id') or m.get('url')
                if not src:
                    continue
                if kind == 'image':
                    resolved = await self._provider_media_reference(
                        src, media_kind='image', seedance_sub_model=sub_model, usage_scope=model_scope,
                    )
                    item = {"type": "image_url", "image_url": {"url": resolved}}
                elif kind == 'video':
                    resolved = await self._provider_media_reference(src, media_kind='video')
                    item = {"type": "video_url", "video_url": {"url": resolved}}
                elif kind == 'audio':
                    resolved = verified_audio.get(idx)
                    if resolved is None:
                        resolved = await self._provider_media_reference(src, media_kind='audio')
                    item = {"type": "audio_url", "audio_url": {"url": resolved}}
                else:
                    logger.warning(f"⚠️ Seedance 未知 media kind: {kind}, skip")
                    continue
                if role:
                    item["role"] = role
                contents.append(item)

            
            if task.task_type == 'seedance_draft':
                draft_id = task.data.get('draft_task_id')
                if draft_id:
                    contents.append({"type": "draft_task", "draft_task": {"id": draft_id}})

            if not contents:
                raise ValueError("Seedance 任务无任何 prompt 或 media，无法生成")

            # Validate again at execution time for legacy/imported queue items.
            # Unsupported specifications must never be silently downgraded after
            # the user has accepted a price for a different resolution.
            from services.video_credit_pricing import validate_seedance_generation_options
            validate_seedance_generation_options(task.data)

            
            kwargs = dict(
                resolution=task.data.get('resolution'),
                ratio=task.data.get('ratio') or 'adaptive',
                duration=task.data.get('duration'),
                seed=task.data.get('seed', -1),
                watermark=bool(task.data.get('watermark', False)),
                generate_audio=bool(task.data.get('generate_audio', True)),
                camera_fixed=bool(task.data.get('camera_fixed', False)),
                tools=task.data.get('tools') or None,
            )
            ark_task_id = client.create_video_task(sub_model, contents, usage_scope=model_scope, **kwargs)
            await self.task_queue.update_progress(task.task_id, 5, "Seedance 任务已创建")

            
            start_time = time.time()
            max_wait = 600
            poll_interval = 5
            video_url = None
            last_status = ''
            while time.time() - start_time < max_wait:
                try:
                    result = client.query_task(ark_task_id)
                    status = (result.get('status') or '').lower()
                    last_status = status
                    if status == 'succeeded':
                        content = result.get('content') or {}
                        video_url = content.get('video_url')
                        if not video_url:
                            raise ValueError(f"Seedance 任务成功但缺 video_url: {result}")
                        break
                    elif status in ('failed', 'cancelled'):
                        err = result.get('error') or {}
                        if isinstance(err, dict):
                            err = {"code": err.get("code"), "message": err.get("message")}
                        raise RuntimeError(f"Seedance 任务{status}: {redact_sensitive_text(json.dumps(err, ensure_ascii=False), max_chars=1000)}")
                    elif status not in ('queued', 'pending', 'running', 'processing'):
                        raise ValueError("Seedance 查询未返回有效任务状态，请核对任务创建渠道。")
                    else:
                        progress = max(5, int((time.time() - start_time) / max_wait * 90))
                        await self.task_queue.update_progress(task.task_id, min(progress, 90), f"Seedance: {status}")
                        logger.info(f"⏳ Seedance 任务 {ark_task_id} 状态: {status}")
                except (ValueError, RuntimeError):
                    raise
                except Exception as e:
                    response = getattr(e, 'response', None)
                    if getattr(response, 'status_code', None) in (400, 401, 403, 404):
                        raise RuntimeError(
                            f"Seedance 查询失败 (HTTP {response.status_code})，请核对任务创建渠道及凭据。"
                        ) from e
                    logger.error(f"❌ Seedance 轮询失败: {e}")
                await asyncio.sleep(poll_interval)
            else:
                raise TimeoutError(f"Seedance 任务超时: {ark_task_id} (last_status={last_status})")

            
            video_content = client.download_video(video_url, task_id=ark_task_id)
            saved_info = await self._save_external_video(
                video_content=video_content,
                task=task,
                source='seedance',
            )
            if not saved_info:
                raise RuntimeError("Seedance 视频保存失败")

            await self.task_queue.complete_task(task.task_id, {
                "videos": [saved_info],
                "images": [],
            })
            logger.info(f"✅ Seedance 任务完成: {task.task_id}")
            return True

        except Exception as e:
            logger.error(f"❌ Seedance 任务处理失败: {e}", exc_info=True)
            try:
                from services.api_provider_runtime import (
                    seedance_error_is_non_retryable,
                    seedance_error_is_input_rejection,
                    seedance_user_facing_error,
                )

                non_retryable = seedance_error_is_non_retryable(e)
                task_error = seedance_user_facing_error(e)
                if ark_task_id:
                    task_error += f"（任务编号 {ark_task_id}；已停止自动重新生成，请先查询原任务结果。）"
                if non_retryable and not seedance_error_is_input_rejection(e):
                    response = getattr(e, "response", None)
                    logger.error(
                        "Seedance non-retryable auth/config error: task=%s status=%s body=%s",
                        task.task_id,
                        getattr(response, "status_code", "-"),
                        redact_sensitive_text(getattr(response, "text", "") or "", max_chars=300),
                    )
                    try:
                        from services.api_provider_health_monitor import cache_provider_health_result
                        from services.api_provider_runtime import resolve_seedance_model_name

                        failed_model = resolve_seedance_model_name(
                            task.data.get("sub_model", "standard"),
                            usage_scope=task.data.get("model_scope") or "workflow",
                        )
                        await cache_provider_health_result(
                            {
                                "provider": "seedance",
                                "model_name": failed_model,
                                "status": "error",
                                "success": False,
                                "message": task_error,
                                "health": {
                                    "ok": False,
                                    "real_generation": True,
                                    "error": task_error,
                                },
                            }
                        )
                    except Exception as cache_error:
                        logger.debug("Seedance provider health cache update skipped: %s", cache_error)
                await self.task_queue.fail_task(task.task_id, task_error, retry=not non_retryable and not ark_task_id)
            except Exception:
                await self.task_queue.fail_task(task.task_id, redact_sensitive_text(e), retry=not ark_task_id)
            return False

    async def _download_image_to_temp(self, image_path: str) -> str:
        """Materialize an online-provider input without touching local nodes."""
        from services.provider_media_input_service import materialize_provider_image_reference

        return await materialize_provider_image_reference(image_path, file_dao=FileDAO)
    
    async def _process_veo_task(self, task: OnlineProviderTask) -> bool:
        
        try:
            from veo_api import get_veo_client
            import tempfile
            from pathlib import Path
            
            veo_client = get_veo_client()
            
            
            image_path = task.data.get('image_path')
            image_path_end = task.data.get('image_path_end')
            prompt = task.data.get('prompt', '')
            
            
            
            
            import base64
            image_urls = []

            def _temp_to_data_uri(path: str) -> str:
                with open(path, 'rb') as f:
                    return f"data:image/png;base64,{base64.b64encode(f.read()).decode('utf-8')}"

            if image_path:
                
                temp_image_path = await self._download_image_to_temp(image_path)
                image_urls.append(_temp_to_data_uri(temp_image_path))

            if task.task_type == 'veo_morph' and image_path_end:
                
                temp_image_path_end = await self._download_image_to_temp(image_path_end)
                image_urls.append(_temp_to_data_uri(temp_image_path_end))
            
            
            logger.info(f"🎬 创建 Veo 任务: {task.task_type}, {len(image_urls)}张图片")
            create_result = veo_client.create_video_task(
                prompt=prompt,
                image_urls=image_urls if image_urls else None,
                model="veo-3.1-landscape-fast-fl"
            )
            
            veo_video_id = create_result.get('id')
            if not veo_video_id:
                raise ValueError("未获取到 Veo video_id")
            
            logger.info(f"✅ Veo 任务已创建: {veo_video_id}")
            
            
            logger.info(f"⏳ 等待 Veo 任务完成...")
            start_time = time.time()
            max_wait = 600
            poll_interval = 5
            
            while time.time() - start_time < max_wait:
                try:
                    result = veo_client.query_task(veo_video_id)
                    status = result.get('status', '')
                    
                    if status == 'completed':
                        logger.info(f"✅ Veo 任务完成: {veo_video_id}")
                        complete_result = result
                        break
                    elif status == 'failed':
                        error = result.get('error', {})
                        error_msg = error.get('message', '未知错误')
                        raise RuntimeError(f"Veo 任务失败: {error_msg}")
                    else:
                        
                        progress = min(int((time.time() - start_time) / max_wait * 90), 90)
                        await self.task_queue.update_progress(task.task_id, progress)
                        logger.info(f"⏳ Veo 任务处理中: {status}, 进度: {progress}%")
                    
                    await asyncio.sleep(poll_interval)
                except Exception as e:
                    logger.error(f"❌ Veo 轮询失败: {e}")
                    await asyncio.sleep(poll_interval)
            else:
                raise TimeoutError(f"Veo 任务超时: {veo_video_id}")
            
            
            logger.info(f"📥 获取 Veo 视频内容...")
            content_result = veo_client.get_video_content(veo_video_id)
            video_url = content_result.get('url')
            
            if not video_url:
                raise ValueError("未获取到视频URL")
            
            
            logger.info("📥 下载 Veo 视频")
            video_content = veo_client.download_video(video_url)
            
            
            logger.info(f"💾 保存Veo视频...")
            saved_info = await self._save_external_video(
                video_content=video_content,
                task=task,
                source='veo'
            )
            
            if saved_info:
                result = {
                    "videos": [saved_info],
                    "images": []
                }
                await self.task_queue.complete_task(task.task_id, result)
                logger.info(f"✅ Veo 任务完成: {task.task_id}")
                return True
            raise RuntimeError("Veo 视频已生成，但服务端持久化失败")
        
        except Exception as e:
            logger.error(f"❌ Veo 任务处理失败: {e}", exc_info=True)
            try:
                from services.api_provider_runtime import (
                    vendor_error_is_non_retryable,
                    vendor_user_facing_error,
                )

                non_retryable = vendor_error_is_non_retryable(e, "veo")
                task_error = vendor_user_facing_error(e, "veo")
                if non_retryable:
                    response = getattr(e, "response", None)
                    logger.error(
                        "Veo non-retryable auth/config error: task=%s status=%s body=%s",
                        task.task_id,
                        getattr(response, "status_code", "-"),
                        redact_sensitive_text(getattr(response, "text", "") or "", max_chars=300),
                    )
                await self.task_queue.fail_task(task.task_id, task_error, retry=not non_retryable)
            except Exception:
                await self.task_queue.fail_task(task.task_id, redact_sensitive_text(e))
            return False


    async def _save_external_video(
        self,
        video_content: bytes,
        task: OnlineProviderTask,
        source: str,
    ):
        








        import os
        import uuid
        from pathlib import Path
        from datetime import datetime

        local_path = None
        thumb_path = None
        try:
            user_id = task.user_id if task else "system"
            task_id = task.task_id if task else f"{source}_{uuid.uuid4().hex[:8]}"

            
            year_month = datetime.now().strftime('%Y%m')
            upload_dir = Path('persistent_storage/video') / user_id / year_month
            upload_dir.mkdir(parents=True, exist_ok=True)

            
            unique_filename = f"{source}_{uuid.uuid4().hex[:12]}.mp4"
            local_path = upload_dir / unique_filename

            
            local_path.write_bytes(video_content)
            logger.info(f"💾 视频已保存到本地: {local_path}, 大小: {len(video_content)} bytes")

            
            file_url = f"/storage/video/{user_id}/{year_month}/{unique_filename}"

            
            task_data = (task.data or {}) if task else {}
            entity_type = task_data.get('entity_type')
            entity_id = task_data.get('entity_id')
            file_role = task_data.get('file_role') or 'video'
            project_id = task_data.get('project_id')

            # Probe the downloaded media once so downstream composition uses the
            # real clip length.  If ffprobe is unavailable, preserve the duration
            # requested from the provider instead of leaving video_segments NULL
            # (the frontend historically interpreted NULL as a hard-coded 5s).
            requested_duration_seconds = None
            for duration_key in ('duration', 'duration_seconds'):
                try:
                    duration_value = float(task_data.get(duration_key) or 0)
                except (TypeError, ValueError):
                    duration_value = 0
                if duration_value > 0:
                    requested_duration_seconds = duration_value
                    break
            actual_duration_seconds = None
            try:
                from file_optimization import FileOptimizationService
                actual_duration_seconds = await asyncio.to_thread(
                    FileOptimizationService._probe_video_duration,
                    str(local_path),
                )
            except Exception as duration_error:
                logger.debug(f"视频时长探测失败，将使用请求时长: {duration_error}")
            resolved_duration_seconds = actual_duration_seconds or requested_duration_seconds
            resolved_duration_ms = (
                max(1, int(round(resolved_duration_seconds * 1000)))
                if resolved_duration_seconds
                else None
            )

            task_type = str(task.task_type if task else source or '').strip().lower()
            persisted_model = (
                'MINI'
                if task_type in {'minimax_i2v', 'minimax_morph'}
                else task_data.get('model')
                or task_data.get('model_name')
                or task_data.get('sub_model')
                or task_type
            )

            
            if not DB_AVAILABLE:
                raise RuntimeError("Database persistence is unavailable")
            file_record = None
            try:
                    version_id = task_data.get('version_id') if task else None
                    file_record = await FileDAO.create_file(
                        version_id=version_id,
                        user_id=user_id,
                        file_type='video',
                        file_name=unique_filename,
                        file_path=str(local_path),
                        file_url=file_url,
                        file_size_bytes=len(video_content),
                        mime_type='video/mp4',
                        metadata={
                            'task_id': task_id,
                            'source': source,
                            'task_type': task.task_type if task else source,
                            'prompt': task_data.get('prompt') or task_data.get('text_prompt') or '',
                            'model': persisted_model,
                            'duration_seconds': resolved_duration_seconds,
                            'project_id': project_id,
                            'episode_id': task_data.get('episode_id'),
                        },
                        entity_type=entity_type,
                        entity_id=entity_id,
                        file_role=file_role,
                    )
                    logger.info(
                        f"📝 文件已记录到数据库: file_id={file_record['file_id']} "
                        f"entity={entity_type}/{entity_id}/{file_role}"
                    )

                    
                    if entity_type and entity_id and file_role:
                        try:
                            from file_service import _sync_legacy_on_file_create
                            await _sync_legacy_on_file_create(entity_type, entity_id, file_role, file_url)
                            logger.info(f"🔁 legacy 字段已同步: {entity_type}/{entity_id}/{file_role}")
                        except Exception as e:
                            logger.warning(f"⚠️ legacy 字段同步失败（不致命）: {e}")

                    
                    
                    if entity_type == 'video_segment' and entity_id:
                        try:
                            from dao.creative.video_segment import VideoSegmentDAO
                            await VideoSegmentDAO.update(
                                entity_id,
                                video_url=file_url,
                                model=persisted_model,
                                duration_ms=resolved_duration_ms,
                                task_id=task_id,
                                status='completed',
                            )
                        except Exception as segment_error:
                            logger.warning(f"⚠️ video_segment 生成元数据同步失败（不致命）: {segment_error}")

                    
                    try:
                        import media_library_service
                        
                        ttype = (task.task_type if task else (source or 'video')).lower()
                        if 'comfy' in ttype:
                            mlib_source = 'generated_video_comfyui'
                        elif 'dashscope' in ttype or 'wanx' in ttype:
                            mlib_source = 'generated_video_dashscope'
                        elif 'seedance' in ttype:
                            mlib_source = 'generated_video_seedance'
                        elif 'doubao' in ttype:
                            mlib_source = 'generated_video_doubao'
                        else:
                            mlib_source = f"generated_video_{ttype.replace('_video','') or 'unknown'}"
                        await media_library_service.create_from_file(
                            file_record=file_record,
                            source=mlib_source,
                            project_id=project_id,
                            episode_id=task_data.get('episode_id'),
                            source_task_id=task_id,
                            source_entity_type=entity_type,
                            source_entity_id=entity_id,
                            title=(task_data.get('prompt') or task_data.get('text_prompt') or '')[:80] or None,
                            metadata={'task_type': task.task_type if task else None, 'source': source},
                        )
                    except Exception as _e:
                        logger.warning(f"media_library 同步失败 (video worker): {_e}")
            except Exception as e:
                logger.error(f"保存文件记录到数据库失败: {e}", exc_info=True)
                raise RuntimeError("External video database persistence failed") from e

            
            thumb_url = None
            try:
                thumb_dir = Path('persistent_storage/thumbnails')
                thumb_dir.mkdir(parents=True, exist_ok=True)
                thumb_filename = f"{Path(unique_filename).stem}.jpg"
                thumb_path = thumb_dir / thumb_filename
                from file_optimization import FileOptimizationService
                result_thumb = await FileOptimizationService.create_video_thumbnail(str(local_path), str(thumb_path))
                if result_thumb and result_thumb.get('success'):
                    thumb_url = f"/storage/thumbnails/{thumb_filename}"
                    logger.info(f"🖼️ 视频缩略图已生成: {thumb_url}")

                    if DB_AVAILABLE and file_record:
                        try:
                            await FileDAO.merge_metadata(file_record['file_id'], {'thumbnail_url': thumb_url})
                        except Exception as te:
                            logger.debug(f"缩略图文件元数据同步失败(不影响结果): {te}")

                    
                    if DB_AVAILABLE and entity_type and entity_id:
                        try:
                            from file_service import _sync_legacy_on_file_create
                            await _sync_legacy_on_file_create(entity_type, entity_id, 'video_thumbnail', thumb_url)
                        except Exception as te:
                            logger.debug(f"缩略图 legacy 同步失败(不影响结果): {te}")
            except Exception as te:
                logger.debug(f"视频缩略图生成失败(不影响结果): {te}")

            
            return {
                'filename': unique_filename,
                'file_id': file_record['file_id'] if file_record else None,
                'url': file_url,
                'thumbnail_url': thumb_url,
                'size': len(video_content),
                'file_path': str(local_path),
                'duration_seconds': resolved_duration_seconds,
                'duration_ms': resolved_duration_ms,
                'model': persisted_model,
            }

        except Exception as e:
            logger.error(f"保存外部视频失败: {e}", exc_info=True)
            for orphan in (thumb_path, local_path):
                if orphan is not None:
                    try:
                        Path(orphan).unlink(missing_ok=True)
                    except OSError:
                        logger.warning("无法清理外部视频孤儿文件: %s", orphan)
            return None

    async def _process_wan26_task(self, task: OnlineProviderTask) -> bool:
        
        try:
            from wan2_dashscope_api import get_wan26_client
            import tempfile
            from pathlib import Path
            
            wan26_client = get_wan26_client()
            
            
            image_path = task.data.get('image_path')
            prompt = task.data.get('prompt', '')
            negative_prompt = task.data.get('negative_prompt', '')
            resolution = task.data.get('resolution', '1080P')  # 720P, 1080P
            duration = task.data.get('duration', 5)  # 5, 10, 15
            shot_type = task.data.get('shot_type', 'multi')  
            seed = task.data.get('seed', -1)
            
            if not image_path:
                raise ValueError("缺少 image_path 参数")
            
            try:
                logger.info(f"📥 准备 Wan2.6 图片引用: {image_path}")
                img_url = await self._file_id_to_dashscope_url(
                    image_path,
                    label="wan26_first_frame",
                )
                
                
                logger.info(f"🎬 创建 Wan2.6 任务: {duration}s, {resolution}, shot_type={shot_type}")
                create_result = wan26_client.create_video_task(
                    prompt=prompt,
                    img_url=img_url,
                    resolution=resolution,
                    duration=duration,
                    prompt_extend=True,
                    shot_type=shot_type,  
                    audio=True,
                    watermark=False,
                    seed=seed if seed >= 0 else None
                )
                
                wan26_task_id = create_result.get('output', {}).get('task_id')
                if not wan26_task_id:
                    raise ValueError("未获取到 Wan2.6 task_id")
                
                logger.info(f"✅ Wan2.6 任务已创建: {wan26_task_id}")
                
                
                logger.info(f"⏳ 等待 Wan2.6 任务完成...")
                start_time = time.time()
                max_wait = 600
                poll_interval = 10
                
                while time.time() - start_time < max_wait:
                    try:
                        result = wan26_client.query_task(wan26_task_id)
                        output = result.get('output', {})
                        status = output.get('task_status', '')
                        
                        if status == 'SUCCEEDED':
                            logger.info(f"✅ Wan2.6 任务完成: {wan26_task_id}")
                            logger.info(
                                "Wan2.6 task completed: provider_task=%s request_id=%s",
                                wan26_task_id,
                                result.get("request_id") or "-",
                            )
                            complete_result = result
                            break
                        elif status == 'FAILED':
                            code = result.get('code', 'Unknown')
                            message = result.get('message', '未知错误')
                            raise RuntimeError(f"Wan2.6 任务失败: {code} - {message}")
                        elif status == 'UNKNOWN':
                            raise RuntimeError(f"Wan2.6 任务不存在或已过期: {wan26_task_id}")
                        else:
                            
                            elapsed_time = time.time() - start_time
                            progress = min(int((elapsed_time / max_wait) * 90), 90)
                            await self.task_queue.update_progress(task.task_id, progress)
                            logger.info(f"⏳ Wan2.6 任务处理中: {status}, 进度: {progress}%")
                        
                        await asyncio.sleep(poll_interval)
                    except Exception as e:
                        if "任务失败" in str(e) or "任务不存在" in str(e):
                            raise
                        logger.error(f"❌ Wan2.6 轮询失败: {e}")
                        await asyncio.sleep(poll_interval)
                else:
                    raise TimeoutError(f"Wan2.6 任务超时: {wan26_task_id}")
                
                
                video_url = complete_result.get('output', {}).get('video_url')
                if not video_url:
                    raise ValueError("未获取到视频URL")
                
                
                logger.info("📥 下载 Wan2.6 视频")
                video_content = wan26_client.download_video(video_url)
                
                
                logger.info(f"💾 保存Wan2.6视频...")
                saved_info = await self._save_external_video(
                    video_content=video_content,
                    task=task,
                    source='wan26'
                )
                
                if saved_info:
                    result = {
                        "videos": [saved_info],
                        "images": []
                    }
                    await self.task_queue.complete_task(task.task_id, result)
                    logger.info(f"✅ Wan2.6 任务完成: {task.task_id}")
                    return True
                else:
                    raise Exception("保存视频失败")
            
            finally:
                pass
        
        except Exception as e:
            logger.error(f"❌ Wan2.6 任务处理失败: {e}", exc_info=True)
            try:
                from services.api_provider_runtime import (
                    vendor_error_is_non_retryable,
                    vendor_user_facing_error,
                )

                non_retryable = vendor_error_is_non_retryable(e, "wan26")
                task_error = vendor_user_facing_error(e, "wan26")
                if non_retryable:
                    response = getattr(e, "response", None)
                    logger.error(
                        "Wan2.6 non-retryable auth/config error: task=%s status=%s body=%s",
                        task.task_id,
                        getattr(response, "status_code", "-"),
                        redact_sensitive_text(getattr(response, "text", "") or "", max_chars=300),
                    )
                await self.task_queue.fail_task(task.task_id, task_error, retry=not non_retryable)
            except Exception:
                await self.task_queue.fail_task(task.task_id, redact_sensitive_text(e))
            return False

    
    
    
    

    async def _file_id_to_dashscope_url(self, ref: str, *, label: str = "image") -> str:
        








        if not ref:
            raise ValueError(f"DashScope 任务缺少 {label}")
        resolved_ref = ref
        # A storyboard id is a business object, not a file id. Resolve it to
        # the registered generated-image URL before entering the media guard.
        if ref.startswith("sb_"):
            from dao_storyboard import StoryboardDAO
            item = await StoryboardDAO.get_by_id(ref)
            img_url = (item or {}).get('generated_image_url')
            if not img_url:
                raise FileNotFoundError(f"{label} 分镜 {ref} 无 generated_image_url")
            resolved_ref = img_url

        from services.provider_media_input_service import provider_image_reference_to_data_uri

        return await provider_image_reference_to_data_uri(
            resolved_ref,
            file_dao=FileDAO,
        )

    async def _provider_media_reference(
        self, ref: str, *, media_kind: str, seedance_sub_model: str = "standard", usage_scope: str = "workflow",
    ) -> str:
        """Resolve a Seedance media reference under the provider-input policy."""
        if media_kind == "image":
            from services.provider_media_input_service import seedance_image_reference_to_data_uri
            return await seedance_image_reference_to_data_uri(
                ref, file_dao=FileDAO, sub_model=seedance_sub_model, usage_scope=usage_scope,
            )
        from services.provider_media_input_service import provider_audio_or_video_reference

        return await provider_audio_or_video_reference(
            ref,
            media_kind=media_kind,
            file_dao=FileDAO,
        )

    async def _process_dashscope_video_task(self, task: OnlineProviderTask) -> bool:
        
















        try:
            from dashscope_video_api import get_dashscope_video_client, DashScopeVideoError
            client = get_dashscope_video_client()

            task_type = task.task_type
            data = task.data or {}
            prompt = data.get('prompt') or ''
            sub_model = (data.get('sub_model') or '').strip().lower()
            duration = int(data.get('duration') or 5)
            seed = data.get('seed')
            seed = int(seed) if seed is not None and int(seed) >= 0 else None
            watermark = bool(data.get('watermark', False))
            audio = bool(data.get('audio', False))

            
            
            
            
            ref_urls: list[str] = []
            media_inputs = data.get('media_inputs') or []
            for idx, m in enumerate(media_inputs):
                if (m.get('kind') or '').lower() != 'image':
                    continue
                
                src = m.get('file_id') or m.get('url')
                if not src:
                    continue
                ref_urls.append(await self._file_id_to_dashscope_url(src, label=f"ref_image_{idx}"))

            await self.task_queue.update_progress(task.task_id, 5, "DashScope 任务准备中…")

            
            
            
            
            
            
            if task_type.startswith('kling_'):
                model = "kling/kling-v3-omni-video-generation" if sub_model == "omni" else "kling/kling-v3-video-generation"
                first_url = await self._file_id_to_dashscope_url(data.get('image_path'), label='first_frame') if data.get('image_path') else None
                last_url = await self._file_id_to_dashscope_url(data.get('image_path_end'), label='last_frame') if data.get('image_path_end') else None
                create_result = await client.kling_submit(
                    prompt=prompt,
                    model=model,
                    first_frame_url=first_url,
                    last_frame_url=last_url,
                    reference_image_urls=ref_urls or None,
                    mode=(data.get('mode') or 'std').lower(),
                    duration=duration,
                    aspect_ratio=data.get('aspect_ratio'),
                    audio=audio,
                    watermark=watermark,
                    seed=seed,
                    multi_shot=bool(data.get('kling_multi_shot')),
                    shot_type=data.get('kling_shot_type'),
                    multi_prompt=data.get('kling_multi_prompt'),
                    keep_original_sound=data.get('kling_keep_original_sound'),
                )
                source_tag = 'kling'

            elif task_type == 'vidu_morph':
                
                first_url = await self._file_id_to_dashscope_url(data.get('image_path'), label='first_frame')
                last_url = await self._file_id_to_dashscope_url(data.get('image_path_end'), label='last_frame')
                
                vidu_sub = sub_model or 'q3-turbo'
                model_map = {
                    'q3-pro': 'vidu/viduq3-pro_start-end2video',
                    'q3-turbo': 'vidu/viduq3-turbo_start-end2video',
                    'q2-pro': 'vidu/viduq2-pro_start-end2video',
                    'q2-turbo': 'vidu/viduq2-turbo_start-end2video',
                }
                model = model_map.get(vidu_sub, 'vidu/viduq3-turbo_start-end2video')
                
                vidu_seed_override = data.get('vidu_seed')
                vidu_seed_final = int(vidu_seed_override) if vidu_seed_override is not None else seed
                vidu_audio_final = data.get('vidu_audio') if data.get('vidu_audio') is not None else audio
                create_result = await client.vidu_startend_submit(
                    prompt=prompt,
                    model=model,
                    first_frame_url=first_url,
                    last_frame_url=last_url,
                    resolution=(data.get('vidu_resolution') or data.get('resolution') or '720P'),
                    duration=duration,
                    audio=bool(vidu_audio_final),
                    watermark=watermark,
                    seed=vidu_seed_final,
                )
                source_tag = 'vidu'

            elif task_type == 'vidu_r2v':
                
                vidu_sub = sub_model or 'q3'
                model_map = {
                    'q3-mix': 'vidu/viduq3-mix_reference2video',
                    'q3': 'vidu/viduq3_reference2video',
                    'q3-turbo': 'vidu/viduq3-turbo_reference2video',
                    'q2-pro': 'vidu/viduq2-pro_reference2video',
                    'q2': 'vidu/viduq2_reference2video',
                }
                model = model_map.get(vidu_sub, 'vidu/viduq3_reference2video')
                
                vidu_seed_override = data.get('vidu_seed')
                vidu_seed_final = int(vidu_seed_override) if vidu_seed_override is not None else seed
                vidu_audio_final = data.get('vidu_audio') if data.get('vidu_audio') is not None else audio
                create_result = await client.vidu_reference_submit(
                    prompt=prompt,
                    model=model,
                    reference_image_urls=ref_urls or None,
                    resolution=(data.get('vidu_resolution') or data.get('resolution') or '720P'),
                    size=(data.get('vidu_size') or data.get('size')),
                    duration=duration,
                    audio=bool(vidu_audio_final),
                    watermark=watermark,
                    seed=vidu_seed_final,
                )
                source_tag = 'vidu'

            elif task_type == 'happyhorse_r2v':
                if not ref_urls:
                    raise ValueError("HappyHorse 至少需要 1 张参考图（media_inputs 中 kind=image）")
                
                hh_watermark_override = data.get('hh_watermark')
                hh_watermark_final = hh_watermark_override if hh_watermark_override is not None else watermark
                hh_seed_override = data.get('hh_seed')
                hh_seed_final = int(hh_seed_override) if hh_seed_override is not None else seed
                
                
                hh_ratio_final = data.get('hh_ratio') or data.get('ratio') or '16:9'
                if hh_ratio_final == 'adaptive':
                    hh_ratio_final = '16:9'
                create_result = await client.happyhorse_submit(
                    prompt=prompt,
                    reference_image_urls=ref_urls,
                    resolution=(data.get('hh_resolution') or data.get('resolution') or '720P'),
                    ratio=hh_ratio_final,
                    duration=int(data.get('hh_duration') or duration),
                    watermark=bool(hh_watermark_final),
                    seed=hh_seed_final,
                )
                source_tag = 'happyhorse'

            else:
                raise ValueError(f"未知 DashScope 视频 task_type: {task_type}")

            ds_task_id = create_result.get('output', {}).get('task_id')
            logger.info(f"✅ DashScope({source_tag}) 任务已创建: {ds_task_id}")
            await self.task_queue.update_progress(task.task_id, 10, f"{source_tag} 任务已创建，等待处理…")

            
            max_wait = 600
            poll_interval = 10
            elapsed = 0
            final_result: dict = {}
            while elapsed < max_wait:
                try:
                    q = await client.query_task(ds_task_id)
                    status = (q.get('output', {}).get('task_status') or '').lower()
                    if status == 'succeeded':
                        final_result = q
                        logger.info(f"✅ DashScope({source_tag}) 完成: {ds_task_id}")
                        break
                    if status in ('failed', 'canceled', 'unknown'):
                        out = q.get('output', {})
                        raise DashScopeVideoError(
                            out.get('message') or f"任务终止({status})",
                            code=out.get('code') or status,
                            task_id=ds_task_id,
                        )
                    # PENDING / RUNNING
                    progress = min(int(elapsed / max_wait * 90), 90)
                    await self.task_queue.update_progress(task.task_id, progress, f"{source_tag}: {status or 'running'}")
                except DashScopeVideoError:
                    raise
                except Exception as poll_err:
                    logger.warning(f"⚠️ DashScope({source_tag}) 轮询临时失败，{poll_interval}s 后重试: {poll_err}")
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval
            else:
                raise TimeoutError(f"DashScope({source_tag}) 任务超时: {ds_task_id}")

            video_url = client.extract_video_url(final_result, prefer_watermark=False)
            if not video_url:
                raise ValueError(
                    f"DashScope({source_tag}) 任务完成但未返回 video_url"
                )

            
            logger.info("📥 下载 DashScope(%s) 视频", source_tag)
            # Supplier result URLs are untrusted data. Reuse the shared bounded
            # downloader so redirects, private-network targets and oversized
            # bodies cannot bypass the external-video safety policy.
            from external_api.video.base import download_streaming_video

            video_content = await asyncio.to_thread(
                download_streaming_video,
                video_url,
                logger=logger,
                label=f"DashScope {source_tag} video",
            )
            logger.info(f"✅ DashScope({source_tag}) 视频下载完成: {len(video_content)} bytes")

            saved_info = await self._save_external_video(
                video_content=video_content,
                task=task,
                source=source_tag,
            )
            if not saved_info:
                raise RuntimeError(f"DashScope({source_tag}) 视频保存失败")

            await self.task_queue.complete_task(task.task_id, {
                "videos": [saved_info],
                "images": [],
            })
            logger.info(f"✅ DashScope({source_tag}) 任务完成: {task.task_id}")
            return True

        except Exception as e:
            logger.error(f"❌ DashScope 视频任务失败: {e}", exc_info=True)
            code = str(getattr(e, "code", "") or "")
            http_status = getattr(e, "http_status", None)
            non_retryable = code in {"InvalidApiKey", "MissingApiKey"} or http_status == 401
            if non_retryable:
                logger.error(
                    "DashScope non-retryable auth/config error: task=%s code=%s http_status=%s",
                    task.task_id,
                    code or "-",
                    http_status or "-",
                )
            await self.task_queue.fail_task(task.task_id, redact_sensitive_text(e), retry=not non_retryable)
            return False

    
    
    
    

    async def _process_minimax_tts_task(self, task: OnlineProviderTask) -> bool:
        









        td = task.data or {}
        try:
            client = get_minimax_audio_client()
            if client is None:
                raise RuntimeError("MiniMax 未配置 — 请在 admin 加 MINIMAX_API_KEY")

            text = td.get('text', '')
            voice_id = td.get('voice_id', '')
            if not text or not voice_id:
                raise ValueError("缺少 text 或 voice_id")

            logger.info(f"🎤 MiniMax TTS 任务启动: text_len={len(text)} voice_id={voice_id}")

            
            tts_kwargs = {
                'text': text,
                'voice_id': voice_id,
            }
            if td.get('model') is not None:
                tts_kwargs['model'] = td['model']
            if td.get('speed') is not None:
                tts_kwargs['speed'] = td['speed']
            if td.get('pitch') is not None:
                tts_kwargs['pitch'] = td['pitch']
            if td.get('emotion') is not None:
                tts_kwargs['emotion'] = td['emotion']

            
            
            
            await self.task_queue.update_progress(task.task_id, 10)
            download_result = await client.tts_sync(**tts_kwargs) or {}
            
            
            audio_local_path = download_result.get('local_path') or ''
            audio_bytes = download_result.get('audio_bytes')
            duration_ms = download_result.get('duration_ms')
            mx_trace_id = download_result.get('trace_id')
            logger.info(
                f"✅ MiniMax TTS sync 完成: trace_id={mx_trace_id} "
                f"local_path={audio_local_path} bytes={len(audio_bytes) if audio_bytes else 0} "
                f"duration_ms={duration_ms}"
            )
            await self.task_queue.update_progress(task.task_id, 80)

            
            audio_file_path = Path(audio_local_path) if audio_local_path else None
            audio_output_limit = configured_download_limit(
                'MAX_PROVIDER_AUDIO_OUTPUT_BYTES',
                100 * 1024 * 1024,
            )
            
            if audio_bytes is None:
                if not audio_file_path or not audio_file_path.is_file():
                    raise FileNotFoundError(
                        f"TTS 输出文件不存在: {audio_file_path} (tts_sync 返回字段: "
                        f"{list(download_result.keys())})"
                    )
                if audio_file_path.stat().st_size > audio_output_limit:
                    raise RemoteContentTooLarge(
                        f"provider audio output exceeds {audio_output_limit} bytes"
                    )
                audio_bytes = audio_file_path.read_bytes()
            if not isinstance(audio_bytes, (bytes, bytearray)):
                raise TypeError("TTS audio output must be bytes")
            if len(audio_bytes) > audio_output_limit:
                raise RemoteContentTooLarge(
                    f"provider audio output exceeds {audio_output_limit} bytes"
                )
            audio_bytes = bytes(audio_bytes)

            ext_suffix = audio_file_path.suffix if audio_file_path else '.mp3'
            saved = await save_generated_file_to_db(
                content=audio_bytes,
                file_type='audio',
                user_id=task.user_id,
                source='minimax',
                entity_type=td.get('entity_type'),
                entity_id=td.get('entity_id'),
                file_role=td.get('file_role') or 'dialogue_audio',
                original_ext=ext_suffix,
                project_id=td.get('project_id'),
                episode_id=td.get('episode_id'),
                extra_metadata={
                    'storyboard_lineage_id': td.get('storyboard_lineage_id'),
                    'requested_entity_id': td.get('entity_id'),
                    'task_id': task.task_id,
                },
            )
            file_id = saved['file_id']
            file_url = saved['file_url']
            logger.info("💾 TTS 文件入库: file_id=%s", file_id)

            
            try:
                import media_library_service
                from dao_content import FileDAO as _FileDAO
                _file_record = await _FileDAO.get_file(file_id) if file_id else None
                if _file_record:
                    await media_library_service.create_from_file(
                        file_record=_file_record,
                        source='generated_audio_minimax',
                        project_id=td.get('project_id'),
                        episode_id=td.get('episode_id'),
                        source_task_id=task.task_id,
                        source_entity_type=td.get('entity_type'),
                        source_entity_id=td.get('entity_id'),
                        title=(td.get('text') or '')[:80] or None,
                    )
            except Exception as _e:
                logger.warning(f"media_library 同步失败 (TTS): {_e}")

            
            bind_voice_id = td.get('bind_to_character_voice_id')
            if bind_voice_id:
                try:
                    await CharacterVoiceDAO.update_sample_audio_url(bind_voice_id, file_url)
                    logger.info(f"🔗 已回写 character_voice {bind_voice_id} 的 sample_audio_url")
                except Exception as e:
                    logger.warning(f"⚠️ 回写 sample_audio_url 失败（不致命）: {e}")

            
            await self.task_queue.complete_task(task.task_id, {
                "audio_url": file_url,
                "file_id": file_id,
                "file_url": file_url,
                "duration_ms": duration_ms,
                "minimax_trace_id": mx_trace_id,
            })
            logger.info(f"🎉 MiniMax TTS 任务完成: {task.task_id}")
            return True

        except Exception as e:
            logger.error(f"❌ MiniMax TTS 任务失败: {e}", exc_info=True)
            try:
                from services.api_provider_runtime import (
                    vendor_error_is_non_retryable,
                    vendor_user_facing_error,
                )

                non_retryable = vendor_error_is_non_retryable(e, "minimax_tts")
                task_error = vendor_user_facing_error(e, "minimax_tts")
                if non_retryable:
                    logger.error(
                        "MiniMax TTS non-retryable auth/config error: task=%s err=%s",
                        task.task_id,
                        redact_sensitive_text(e, max_chars=300),
                    )
                await self.task_queue.fail_task(task.task_id, task_error, retry=not non_retryable)
            except Exception:
                await self.task_queue.fail_task(task.task_id, redact_sensitive_text(e))
            return False

    async def _process_video_reverse_task(self, task) -> bool:
        

        try:
            import video_reverse_service
            logger.info(f"🎬 视频反推任务开始: {task.task_id}")
            result = await video_reverse_service.run_pipeline(task)
            await self.task_queue.complete_task(task.task_id, result)
            logger.info(f"🎉 视频反推任务完成: {task.task_id}")
            return True
        except Exception as e:
            logger.error(f"❌ 视频反推任务失败: {e}", exc_info=True)
            # The pipeline releases its reservation on failure. Only an explicit
            # retry can reauthorize the source/output and reserve another attempt.
            await self.task_queue.fail_task(task.task_id, redact_sensitive_text(e), retry=False)
            return False
