



import os
import shutil
import logging
from pathlib import Path
from typing import Optional, Literal
from datetime import datetime
import hashlib
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)


class StorageConfigurationError(RuntimeError):
    """Raised when a production storage configuration is unsafe."""

class StorageConfig:


    STORAGE_TYPE = os.getenv("STORAGE_TYPE", "local")


    LOCAL_STORAGE_PATH = os.getenv("LOCAL_STORAGE_PATH", "persistent_storage")


    MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
    MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
    MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
    MINIO_BUCKET = os.getenv("MINIO_BUCKET", "comfyui-outputs")
    MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"

    @classmethod
    def validate(cls, storage_type: str) -> None:
        """Reject implicit or unsafe MinIO defaults in production."""
        if storage_type != "minio":
            return
        if os.environ.get("OSTORY_RUNTIME_ENV", "development").strip().lower() != "production":
            return

        if not cls.MINIO_ENDPOINT.strip():
            raise StorageConfigurationError("MINIO_ENDPOINT is required in production")
        if not cls.MINIO_BUCKET.strip():
            raise StorageConfigurationError("MINIO_BUCKET is required in production")
        if not cls.MINIO_ACCESS_KEY.strip() or cls.MINIO_ACCESS_KEY == "minioadmin":
            raise StorageConfigurationError(
                "MINIO_ACCESS_KEY must be explicit and must not use the minioadmin default"
            )
        if not cls.MINIO_SECRET_KEY.strip() or cls.MINIO_SECRET_KEY == "minioadmin":
            raise StorageConfigurationError(
                "MINIO_SECRET_KEY must be explicit and must not use the minioadmin default"
            )

        endpoint_host = (urlsplit(f"//{cls.MINIO_ENDPOINT.strip()}").hostname or "").lower()
        loopback_hosts = {"localhost", "127.0.0.1", "::1"}
        if not cls.MINIO_SECURE and endpoint_host not in loopback_hosts:
            raise StorageConfigurationError(
                "MINIO_SECURE=true is required for a non-loopback production endpoint"
            )

class StorageManager:


    def __init__(self, storage_type: str = "local"):
        self.storage_type = storage_type
        self.logger = logging.getLogger(f"{__name__}.StorageManager")
        StorageConfig.validate(storage_type)

        if storage_type == "local":
            self._init_local_storage()
        elif storage_type == "minio":
            self._init_minio_storage()
        else:
            raise ValueError(f"不支持的存储类型: {storage_type}")

    def _init_local_storage(self):

        self.storage_path = Path(StorageConfig.LOCAL_STORAGE_PATH)


        subdirs = ["video", "videos", "image", "images", "temp"]
        for subdir in subdirs:
            (self.storage_path / subdir).mkdir(parents=True, exist_ok=True)

        self.logger.info(f"✅ 本地存储已初始化: {self.storage_path}")

    def _init_minio_storage(self):

        try:
            from minio import Minio

            self.minio_client = Minio(
                StorageConfig.MINIO_ENDPOINT,
                access_key=StorageConfig.MINIO_ACCESS_KEY,
                secret_key=StorageConfig.MINIO_SECRET_KEY,
                secure=StorageConfig.MINIO_SECURE
            )


            bucket_name = StorageConfig.MINIO_BUCKET
            if not self.minio_client.bucket_exists(bucket_name):
                self.minio_client.make_bucket(bucket_name)
                self.logger.info(f"✅ 创建 MinIO bucket: {bucket_name}")

            self.logger.info(f"✅ MinIO 存储已初始化: {StorageConfig.MINIO_ENDPOINT}")

        except ImportError:
            raise ImportError("请安装 minio: pip install minio")
        except Exception as e:
            self.logger.error(f"❌ MinIO 初始化失败: {e}")
            raise

    def save_file(
        self,
        source_path: str,
        file_type: Literal["video", "image", "temp"],
        user_id: str,
        task_id: str,
        preserve_name: bool = False
    ) -> dict:



















        source_path = Path(source_path)

        if not source_path.exists():
            raise FileNotFoundError(f"源文件不存在: {source_path}")


        if preserve_name:
            filename = source_path.name
        else:

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            ext = source_path.suffix
            filename = f"{timestamp}_{task_id[:8]}{ext}"


        file_hash = self._calculate_file_hash(source_path)

        if self.storage_type == "local":
            return self._save_to_local(source_path, file_type, user_id, filename, file_hash)
        elif self.storage_type == "minio":
            return self._save_to_minio(source_path, file_type, user_id, filename, file_hash)

    def _save_to_local(
        self,
        source_path: Path,
        file_type: str,
        user_id: str,
        filename: str,
        file_hash: str
    ) -> dict:


        file_type_dir = file_type
        if file_type == "videos":
            file_type_dir = "video"
        elif file_type == "images":
            file_type_dir = "image"

        if file_type_dir not in ["video", "image", "temp"]:
            file_type_dir = file_type


        year_month = datetime.now().strftime("%Y%m")
        target_dir = self.storage_path / file_type_dir / user_id / year_month
        target_dir.mkdir(parents=True, exist_ok=True)

        target_path = target_dir / filename


        shutil.copy2(source_path, target_path)


        relative_path = target_path.relative_to(self.storage_path)
        url = f"/storage/{relative_path.as_posix()}"

        file_size = target_path.stat().st_size

        self.logger.info(f"✅ 文件已保存到本地: {target_path} ({file_size} bytes)")

        return {
            "storage_path": str(target_path),
            "url": url,
            "filename": filename,
            "size": file_size,
            "hash": file_hash,
            "storage_type": "local"
        }

    def _save_to_minio(
        self,
        source_path: Path,
        file_type: str,
        user_id: str,
        filename: str,
        file_hash: str
    ) -> dict:


        file_type_plural = file_type
        if file_type == "video":
            file_type_plural = "videos"
        elif file_type == "image":
            file_type_plural = "images"


        year_month = datetime.now().strftime("%Y%m")
        object_name = f"{file_type_plural}/{user_id}/{year_month}/{filename}"


        file_size = source_path.stat().st_size

        self.minio_client.fput_object(
            StorageConfig.MINIO_BUCKET,
            object_name,
            str(source_path),
            content_type=self._get_content_type(source_path)
        )


        url = f"/storage/minio/{object_name}"

        self.logger.info(f"✅ 文件已保存到 MinIO: {object_name} ({file_size} bytes)")

        return {
            "storage_path": object_name,
            "url": url,
            "filename": filename,
            "size": file_size,
            "hash": file_hash,
            "storage_type": "minio"
        }

    def get_file(self, storage_path: str) -> Optional[Path]:

        if self.storage_type == "local":
            full_path = Path(storage_path)
            if full_path.exists():
                return full_path
            return None
        elif self.storage_type == "minio":

            temp_path = self.storage_path / "temp" / Path(storage_path).name
            temp_path.parent.mkdir(parents=True, exist_ok=True)

            try:
                self.minio_client.fget_object(
                    StorageConfig.MINIO_BUCKET,
                    storage_path,
                    str(temp_path)
                )
                return temp_path
            except Exception as e:
                self.logger.error(f"从 MinIO 下载文件失败: {e}")
                return None

    def delete_file(self, storage_path: str) -> bool:

        try:
            if self.storage_type == "local":
                path = Path(storage_path)
                if path.exists():
                    path.unlink()
                    self.logger.info(f"✅ 已删除文件: {storage_path}")
                    return True
            elif self.storage_type == "minio":
                self.minio_client.remove_object(
                    StorageConfig.MINIO_BUCKET,
                    storage_path
                )
                self.logger.info(f"✅ 已从 MinIO 删除: {storage_path}")
                return True
        except Exception as e:
            self.logger.error(f"删除文件失败: {e}")
        return False

    @staticmethod
    def _calculate_file_hash(file_path: Path) -> str:

        sha256 = hashlib.sha256()
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256.update(chunk)
        return sha256.hexdigest()

    @staticmethod
    def _get_content_type(file_path: Path) -> str:

        ext = file_path.suffix.lower()
        content_types = {
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.gif': 'image/gif',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp'
        }
        return content_types.get(ext, 'application/octet-stream')


_storage_manager: Optional[StorageManager] = None

def get_storage_manager() -> StorageManager:

    global _storage_manager
    if _storage_manager is None:
        storage_type = StorageConfig.STORAGE_TYPE
        _storage_manager = StorageManager(storage_type)
    return _storage_manager

def init_storage_manager(storage_type: str = None):

    global _storage_manager
    if storage_type is None:
        storage_type = StorageConfig.STORAGE_TYPE
    _storage_manager = StorageManager(storage_type)
    return _storage_manager
