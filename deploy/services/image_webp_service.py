







import io
import base64
from PIL import Image
from pathlib import Path
from typing import Union, Tuple, Optional
import logging

from services.image_safety_service import load_image_bytes_safely, open_image_path_safely

logger = logging.getLogger(__name__)

class WebPImageService:



    QUALITY = {
        'thumbnail': 80,
        'compressed': 85,
        'high': 90
    }


    THUMBNAIL_MAX_SIZE = 1024

    @staticmethod
    def create_thumbnail_from_path(
        input_path: Union[str, Path],
        output_path: Union[str, Path],
        max_size: int = THUMBNAIL_MAX_SIZE,
        quality: int = QUALITY['thumbnail']
    ) -> dict:












        try:
            with open_image_path_safely(input_path) as img:

                if img.mode == 'RGBA':

                    pass
                elif img.mode not in ['RGB', 'RGBA']:
                    img = img.convert('RGB')


                width, height = img.size
                if width > height:
                    if width > max_size:
                        new_width = max_size
                        new_height = int(height * (max_size / width))
                    else:
                        new_width, new_height = width, height
                else:
                    if height > max_size:
                        new_height = max_size
                        new_width = int(width * (max_size / height))
                    else:
                        new_width, new_height = width, height


                if (new_width, new_height) != (width, height):
                    img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)


                img.save(
                    output_path,
                    'WEBP',
                    quality=quality,
                    method=6
                )

                file_size = Path(output_path).stat().st_size

                logger.info(f"✅ 缩略图已生成: {new_width}x{new_height}, {file_size} bytes")

                return {
                    'success': True,
                    'size': (new_width, new_height),
                    'file_size': file_size,
                    'format': 'webp'
                }

        except Exception as e:
            logger.error(f"❌ 缩略图生成失败: {e}")
            return {'success': False, 'error': str(e)}

    @staticmethod
    def create_thumbnail_from_bytes(
        image_bytes: bytes,
        max_size: int = THUMBNAIL_MAX_SIZE,
        quality: int = QUALITY['thumbnail']
    ) -> Optional[str]:











        try:
            img = load_image_bytes_safely(image_bytes)


            if img.mode == 'RGBA':
                pass
            elif img.mode not in ['RGB', 'RGBA']:
                img = img.convert('RGB')


            width, height = img.size
            if width > height:
                if width > max_size:
                    new_width = max_size
                    new_height = int(height * (max_size / width))
                else:
                    new_width, new_height = width, height
            else:
                if height > max_size:
                    new_height = max_size
                    new_width = int(width * (max_size / height))
                else:
                    new_width, new_height = width, height


            if (new_width, new_height) != (width, height):
                img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)


            output_buffer = io.BytesIO()
            img.save(output_buffer, 'WEBP', quality=quality, method=6)
            webp_bytes = output_buffer.getvalue()


            b64_data = base64.b64encode(webp_bytes).decode('utf-8')

            logger.info(f"✅ 缩略图已生成: {new_width}x{new_height}, {len(webp_bytes)} bytes")

            return f"data:image/webp;base64,{b64_data}"

        except Exception as e:
            logger.error(f"❌ 缩略图生成失败: {e}")
            return None

    @staticmethod
    def compress_image_to_webp(
        input_path: Union[str, Path],
        output_path: Union[str, Path],
        quality: int = QUALITY['compressed'],
        max_size: Optional[Tuple[int, int]] = None
    ) -> dict:












        try:
            with open_image_path_safely(input_path) as img:
                original_size = img.size


                if img.mode == 'RGBA':
                    pass
                elif img.mode not in ['RGB', 'RGBA']:
                    img = img.convert('RGB')


                if max_size:
                    img.thumbnail(max_size, Image.Resampling.LANCZOS)


                img.save(
                    output_path,
                    'WEBP',
                    quality=quality,
                    method=6
                )

                file_size = Path(output_path).stat().st_size

                logger.info(f"✅ 图片已压缩为WebP: {original_size} -> {img.size}, {file_size} bytes")

                return {
                    'success': True,
                    'original_size': original_size,
                    'size': img.size,
                    'file_size': file_size,
                    'format': 'webp'
                }

        except Exception as e:
            logger.error(f"❌ 图片压缩失败: {e}")
            return {'success': False, 'error': str(e)}

    @staticmethod
    def compress_base64_to_webp(
        base64_data: str,
        quality: int = QUALITY['compressed'],
        max_size: Optional[Tuple[int, int]] = None
    ) -> Optional[str]:











        try:

            if ',' in base64_data:
                base64_data = base64_data.split(',')[1]


            image_bytes = base64.b64decode(base64_data)
            img = load_image_bytes_safely(image_bytes)


            if img.mode == 'RGBA':
                pass
            elif img.mode not in ['RGB', 'RGBA']:
                img = img.convert('RGB')


            if max_size:
                img.thumbnail(max_size, Image.Resampling.LANCZOS)


            output_buffer = io.BytesIO()
            img.save(output_buffer, 'WEBP', quality=quality, method=6)
            webp_bytes = output_buffer.getvalue()


            b64_data = base64.b64encode(webp_bytes).decode('utf-8')

            logger.info(f"✅ Base64图片已压缩为WebP: {img.size}, {len(webp_bytes)} bytes")

            return f"data:image/webp;base64,{b64_data}"

        except Exception as e:
            logger.error(f"❌ Base64图片压缩失败: {e}")
            return None

    @staticmethod
    def bytes_to_webp(
        image_bytes: bytes,
        quality: int = QUALITY['compressed']
    ) -> Optional[bytes]:










        try:
            img = load_image_bytes_safely(image_bytes)


            if img.mode == 'RGBA':
                pass
            elif img.mode not in ['RGB', 'RGBA']:
                img = img.convert('RGB')


            output_buffer = io.BytesIO()
            img.save(output_buffer, 'WEBP', quality=quality, method=6)
            webp_bytes = output_buffer.getvalue()

            logger.info(f"✅ 图片已转换为WebP: {img.size}, {len(webp_bytes)} bytes")

            return webp_bytes

        except Exception as e:
            logger.error(f"❌ 图片转换失败: {e}")
            return None
