"""Runtime configuration shared by the API and provider-backed task workers.

This module intentionally contains no local GPU-node, ComfyUI workflow, agent,
or scheduling implementation.  Keeping the transport and queue configuration
here lets a source-only distribution depend on the online-provider runtime
without importing the private local-node subsystem.
"""
from __future__ import annotations

import os


DEVELOPMENT_CORS_ALLOW_ORIGINS = (
    "http://localhost:6006,"
    "http://127.0.0.1:6006,"
    "http://localhost:5173,"
    "http://127.0.0.1:5173"
)


def parse_cors_allow_origins(value: str | None = None) -> list[str]:
    """Return the explicit browser-origin allowlist for the current runtime.

    Production has no guessed hostname.  Same-origin browser requests do not
    need a CORS entry; cross-origin deployments must set CORS_ALLOW_ORIGINS.
    """
    runtime_env = os.getenv("OSTORY_RUNTIME_ENV", "development").strip().lower()
    default = "" if runtime_env == "production" else DEVELOPMENT_CORS_ALLOW_ORIGINS
    raw = value if value is not None else os.getenv("CORS_ALLOW_ORIGINS", default)
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


class RedisConfig:
    HOST = os.getenv("REDIS_HOST", "localhost")
    PORT = int(os.getenv("REDIS_PORT", "6379"))
    DB = int(os.getenv("REDIS_DB", "0"))
    PASSWORD = os.getenv("REDIS_PASSWORD", None)
    USERNAME = os.getenv("REDIS_USERNAME", None)
    SSL = os.getenv("REDIS_SSL", "false").strip().lower() in {"1", "true", "yes", "on"}
    SSL_CA_CERTS = os.getenv("REDIS_SSL_CA_CERTS", "").strip() or None
    MAX_CONNECTIONS = 50
    DECODE_RESPONSES = True
    TASK_QUEUE_KEY = "comfyui:task_queue"
    PROCESSING_QUEUE_KEY = "comfyui:processing"
    EXTERNAL_TASK_QUEUE_KEY = "external_api:task_queue"
    EXTERNAL_PROCESSING_QUEUE_KEY = "external_api:processing"
    COMPLETED_QUEUE_KEY = "comfyui:completed"
    FAILED_QUEUE_KEY = "comfyui:failed"
    TASK_STATUS_PREFIX = "comfyui:task:"
    TASK_RESULT_PREFIX = "comfyui:result:"
    NODE_STATUS_PREFIX = "comfyui:node:"
    NODE_LOCK_PREFIX = "comfyui:lock:"
    TASK_EXPIRE_TIME = 15552000
    RESULT_EXPIRE_TIME = 15552000
    QUEUE_BLOCK_TIMEOUT = 5
    MAX_RETRIES = 3
    RETRY_DELAY = 10


class QueueConfig:
    PRIORITY_HIGH = 3
    PRIORITY_NORMAL = 2
    PRIORITY_LOW = 1
    QUEUE_BLOCK_TIMEOUT = 5
    TASK_TIMEOUT = 600
    TASK_HEARTBEAT_INTERVAL = 5
    MAX_RETRIES = 3
    RETRY_DELAY = 10
    BATCH_SIZE = 10
    DEAD_LETTER_QUEUE = "comfyui:dead_letter"
    MAX_DEAD_LETTER_SIZE = 1000


class WorkerConfig:
    NUM_WORKERS = 4
    WORKER_ID_PREFIX = "worker"
    WORKER_STATUS_KEY = "comfyui:workers"
    WORKER_HEARTBEAT_INTERVAL = 10
    WORKER_TIMEOUT = 30
    TASK_PREFETCH_COUNT = 1
    GRACEFUL_SHUTDOWN_TIMEOUT = 30


class MonitorConfig:
    METRICS_ENABLED = True
    METRICS_INTERVAL = 60
    STATS_KEY = "comfyui:stats"
    METRICS = [
        "tasks_total",
        "tasks_completed",
        "tasks_failed",
        "tasks_cancelled",
        "avg_processing_time",
        "queue_length",
        "workers_active",
        "nodes_active",
    ]


class SystemConfig:
    AGENT_ONLY_MODE = os.environ.get("AGENT_ONLY_MODE", "true").lower() == "true"
    LITE_WORKERS_COUNT = int(os.environ.get("LITE_WORKERS_COUNT", "2"))
    EXTERNAL_API_WORKERS_COUNT = int(os.environ.get("EXTERNAL_API_WORKERS_COUNT", "16"))
    # Private cluster entrypoint intentionally listens behind an operator-managed firewall/proxy.
    # The public source entrypoint defaults to 127.0.0.1 and never consumes this value.
    HOST = "0.0.0.0"  # nosec B104
    PORT = 6006
    LOG_LEVEL = "INFO"
    LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    LOG_FILE = "logs/cluster.log"
    FRONTEND_CONFIG = {
        "title": "Ovideo",
        "description": "AI video creation platform",
        "version": "2.0.0",
    }
    ALLOW_ORIGINS = parse_cors_allow_origins()
    SESSION_TIMEOUT = 86400
    UPLOAD_DIR = "uploads"
    OUTPUT_DIR = "outputs"
    TEMP_DIR = "temp"
    MAX_UPLOAD_SIZE = 10 * 1024 * 1024
    ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"]
