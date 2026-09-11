


import os
import io
import asyncio
import aiofiles
import hashlib
from pathlib import Path
from typing import Optional, Tuple, AsyncGenerator
from PIL import Image
import ffmpeg
import logging
from PIL import ImageStat
from services.image_safety_service import open_image_path_safely

logger = logging.getLogger(__name__)

class FileOptimizationService:



    IMAGE_QUALITY = {
        'thumbnail': 75,
        'preview': 85,
        'original': 95
    }


    THUMBNAIL_SIZES = {
        'small': (256, 256),
        'medium': (512, 512),
        'large': (1024, 1024)
    }


    CHUNK_SIZE = 10 * 1024 * 1024

    @staticmethod
    async def compress_image(
        input_path: str,
        output_path: str,
        quality: str = 'preview',
        max_size: Optional[Tuple[int, int]] = None
    ) -> dict:

        try:
            with open_image_path_safely(input_path) as img:

                if img.mode == 'RGBA':
                    background = Image.new('RGB', img.size, (255, 255, 255))
                    background.paste(img, mask=img.split()[3])
                    img = background
                elif img.mode != 'RGB':
                    img = img.convert('RGB')


                if max_size:
                    img.thumbnail(max_size, Image.Resampling.LANCZOS)


                img.save(
                    output_path,
                    'JPEG',
                    quality=FileOptimizationService.IMAGE_QUALITY[quality],
                    optimize=True
                )


                original_size = os.path.getsize(input_path)
                compressed_size = os.path.getsize(output_path)
                compression_ratio = (1 - compressed_size / original_size) * 100

                return {
                    'success': True,
                    'original_size': original_size,
                    'compressed_size': compressed_size,
                    'compression_ratio': round(compression_ratio, 2),
                    'width': img.width,
                    'height': img.height
                }

        except Exception as e:
            logger.error(f"图片压缩失败: {e}")
            return {'success': False, 'error': str(e)}

    @staticmethod
    async def create_thumbnail(
        input_path: str,
        output_path: str,
        size: str = 'medium'
    ) -> dict:

        try:
            thumbnail_size = FileOptimizationService.THUMBNAIL_SIZES[size]

            with open_image_path_safely(input_path) as img:

                if img.mode == 'RGBA':
                    background = Image.new('RGB', img.size, (255, 255, 255))
                    background.paste(img, mask=img.split()[3])
                    img = background
                elif img.mode != 'RGB':
                    img = img.convert('RGB')


                img.thumbnail(thumbnail_size, Image.Resampling.LANCZOS)
                img.save(output_path, 'JPEG', quality=75, optimize=True)

                return {
                    'success': True,
                    'thumbnail_path': output_path,
                    'size': thumbnail_size
                }

        except Exception as e:
            logger.error(f"缩略图创建失败: {e}")
            return {'success': False, 'error': str(e)}

    @staticmethod
    def _video_thumbnail_positions(duration: Optional[float]) -> list[float]:
        """Return early-frame samples in chronological order, bounded by duration."""
        candidates = (0.05, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0)
        if not duration or duration <= 0:
            return list(candidates)
        latest = max(0.0, duration - 0.02)
        positions = [position for position in candidates if position <= latest]
        return positions or [0.0]

    @staticmethod
    def _probe_video_duration(video_path: str) -> Optional[float]:
        try:
            probe = ffmpeg.probe(video_path)
            return float(probe.get('format', {}).get('duration') or 0) or None
        except Exception:
            return None

    @staticmethod
    def _extract_video_frame(video_path: str, output_path: str, position: float) -> None:
        (
            ffmpeg
            .input(video_path, ss=position)
            .output(output_path, vframes=1, format='image2', vcodec='mjpeg')
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )

    @staticmethod
    def _frame_has_visible_content(frame_path: str) -> bool:
        """Reject fully or nearly black intro frames without rejecting dark scenes."""
        with open_image_path_safely(frame_path) as frame:
            grayscale = frame.convert('L')
            grayscale.thumbnail((96, 96), Image.Resampling.BILINEAR)
            histogram = grayscale.histogram()
            pixel_count = max(1, sum(histogram))
            dark_ratio = sum(histogram[:12]) / pixel_count
            mean_luma = float(ImageStat.Stat(grayscale).mean[0])
            return mean_luma >= 8.0 or dark_ratio <= 0.98

    @staticmethod
    async def create_video_thumbnail(
        video_path: str,
        output_path: str,
        time_position: Optional[float] = None,
        max_size: Optional[Tuple[int, int]] = None,
    ) -> dict:
        """Extract the earliest visible frame from the beginning of a video."""
        try:
            duration = await asyncio.to_thread(FileOptimizationService._probe_video_duration, video_path)
            positions = [time_position] if time_position is not None else FileOptimizationService._video_thumbnail_positions(duration)
            extracted_position = None
            visible_frame_found = False

            for position in positions:
                try:
                    await asyncio.to_thread(
                        FileOptimizationService._extract_video_frame,
                        video_path,
                        output_path,
                        float(position),
                    )
                except Exception as exc:
                    logger.debug("视频缩略图候选帧 %.2fs 提取失败: %s", position, exc)
                    continue
                extracted_position = float(position)
                if await asyncio.to_thread(FileOptimizationService._frame_has_visible_content, output_path):
                    visible_frame_found = True
                    break

            if extracted_position is None or not os.path.exists(output_path):
                raise RuntimeError("无法从视频中提取有效帧")


            compression = await FileOptimizationService.compress_image(
                output_path, output_path, 'thumbnail', max_size=max_size
            )
            if not compression.get('success'):
                raise RuntimeError(compression.get('error') or '视频缩略图压缩失败')

            return {
                'success': True,
                'thumbnail_path': output_path,
                'time_position': extracted_position,
                'non_black': visible_frame_found,
            }

        except Exception as e:
            logger.error(f"视频缩略图创建失败: {e}")
            return {'success': False, 'error': str(e)}

    @staticmethod
    async def get_video_info(video_path: str) -> dict:

        try:
            probe = ffmpeg.probe(video_path)
            video_stream = next(
                (s for s in probe['streams'] if s['codec_type'] == 'video'),
                None
            )

            if not video_stream:
                raise ValueError("找不到视频流")

            return {
                'success': True,
                'width': int(video_stream['width']),
                'height': int(video_stream['height']),
                'duration': float(probe['format']['duration']),
                'size': int(probe['format']['size']),
                'format': probe['format']['format_name']
            }

        except Exception as e:
            logger.error(f"获取视频信息失败: {e}")
            return {'success': False, 'error': str(e)}

    @staticmethod
    async def compress_video(
        input_path: str,
        output_path: str,
        crf: int = 23,
        preset: str = 'medium'
    ) -> dict:

        try:
            (
                ffmpeg
                .input(input_path)
                .output(
                    output_path,
                    vcodec='libx264',
                    crf=crf,
                    preset=preset,
                    acodec='aac',
                    audio_bitrate='128k'
                )
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )

            original_size = os.path.getsize(input_path)
            compressed_size = os.path.getsize(output_path)
            compression_ratio = (1 - compressed_size / original_size) * 100

            return {
                'success': True,
                'original_size': original_size,
                'compressed_size': compressed_size,
                'compression_ratio': round(compression_ratio, 2)
            }

        except Exception as e:
            logger.error(f"视频压缩失败: {e}")
            return {'success': False, 'error': str(e)}

    @staticmethod
    async def file_chunked_reader(
        file_path: str,
        chunk_size: int = CHUNK_SIZE
    ) -> AsyncGenerator[bytes, None]:

        async with aiofiles.open(file_path, 'rb') as f:
            while True:
                chunk = await f.read(chunk_size)
                if not chunk:
                    break
                yield chunk

    @staticmethod
    async def calculate_file_hash(file_path: str) -> str:

        sha256_hash = hashlib.sha256()

        async with aiofiles.open(file_path, 'rb') as f:
            while True:
                chunk = await f.read(8192)
                if not chunk:
                    break
                sha256_hash.update(chunk)

        return sha256_hash.hexdigest()

    @staticmethod
    def get_file_size_mb(file_path: str) -> float:

        size_bytes = os.path.getsize(file_path)
        return round(size_bytes / (1024 * 1024), 2)

class FileDeduplicationService:


    @staticmethod
    async def check_duplicate(file_hash: str, user_id: str) -> Optional[dict]:

        from db_manager import get_db_manager

        db = get_db_manager()
        query = """
            SELECT * FROM files
            WHERE user_id = $1
            AND metadata->>'file_hash' = $2
            AND is_deleted = FALSE
            LIMIT 1
        """
        return await db.fetchrow(query, user_id, file_hash)

    @staticmethod
    async def link_duplicate_file(
        existing_file: dict,
        version_id: str,
        user_id: str
    ) -> dict:

        from dao_content import FileDAO


        return await FileDAO.create_file(
            version_id=version_id,
            user_id=user_id,
            file_type=existing_file['file_type'],
            file_name=existing_file['file_name'],
            file_path=existing_file['file_path'],
            file_url=existing_file['file_url'],
            file_size_bytes=0,
            mime_type=existing_file['mime_type'],
            metadata={
                **existing_file['metadata'],
                'is_duplicate': True,
                'original_file_id': existing_file['file_id']
            }
        )
