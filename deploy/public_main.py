"""Source-edition FastAPI entrypoint for online providers and project data.

This entrypoint intentionally excludes the private local-execution subsystem.
Operators compile the frontends and configure PostgreSQL, Redis, credentials,
TLS, and process supervision themselves as documented under docs/open-source.
"""
from __future__ import annotations

import asyncio
import logging
import mimetypes
import os
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import redis.asyncio as redis
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

import jwt_auth
from admin_api_config_routes import router as api_config_router
from credit_routes import router as credit_router
from dao.admin.admin_stats import AdminStatsDAO
from dao.admin.api_config import validate_api_config_encryption_configuration
from dao.admin.system_settings import SystemSettingsDAO
from dao_credit import CreditAccountDAO
from dao_content import FileDAO, ProjectDAO, ProjectMemberDAO, VersionDAO, WorkspaceSessionDAO
from dao_entity_file import EntityFileDAO
from dao_organization import OrganizationDAO, OrganizationMemberDAO
from dao_storyboard import StoryboardDAO
from dao_task import TaskDAO
from dao_user import UserDAO
from db_manager import init_db_manager
from final_product_share_routes import create_final_product_share_router
from media_library_routes import router as media_library_router
from video_reverse_routes import create_video_reverse_router
from routers.admin_compat import create_admin_compat_router
from routers.admin_credits import router as admin_credit_router
from routers.admin_jimeng import router as admin_jimeng_router
from routers.admin_project_groups import router as admin_project_groups_router
from routers.ai_proxy import create_ai_proxy_router
from routers.auth import create_auth_router
from routers.fallback_static import create_fallback_static_router
from routers.files import create_files_router
from routers.frontend_pages import ADMIN_ENTRY_PATH, create_frontend_pages_router
from routers.online_provider_tasks import create_online_provider_task_router
from routers.phone_auth import create_phone_auth_router
from routers.public_api_configs import create_public_api_config_router
from routers.projects import create_projects_router
from routers.prompts import create_prompt_router
from routers.public_application import create_public_application_router
from routers.public_health import create_public_health_router
from routers.public_video import create_public_video_router
from routers.public_video_capabilities import create_public_video_capabilities_router
from routers.user_session import create_user_session_router
from routers.wechat_pay import create_wechat_pay_router
from routers.workspace import create_workspace_router
from services import admin_audit_service
from services.admin_access_service import (
    require_admin_session as require_admin_access,
    require_super_admin_session as require_super_admin_access,
)
from services.admin_bootstrap_service import apply_configured_admin_bootstrap, load_builtin_users
from services.api_config_runtime_loader import (
    load_api_configs_to_env,
    seed_default_api_providers,
    validate_runtime_provider_environment,
)
from services.api_provider_health_monitor import (
    provider_health_monitor_loop,
    set_provider_health_redis,
)
from services.auth_rate_limit_service import validate_auth_rate_limit_configuration
from services.captcha_service import validate_captcha_configuration
from services.email_delivery_service import email_outbox_worker_loop
from services.wechat_recharge_service import recharge_order_expiry_loop
from services.online_provider_task_service import OnlineProviderTaskService
from services.private_media_access_service import PrivateMediaAccessMiddleware
from services.public_feedback_rate_limit_service import validate_public_feedback_rate_limit_configuration
from services.request_auth_service import get_current_user
from services.session_auth_service import validate_session_token
from services.user_presence_service import clear_user_presence, configure_presence_store, touch_user_presence
from services.user_profile_service import resolve_authenticated_user_id
from core.infrastructure_security import validate_redis_security
from core.logging_security import secure_log_handlers
from core.online_provider_worker import OnlineProviderWorker
from core.request_body_limit import RequestBodyLimitMiddleware
from core.runtime_config import RedisConfig, SystemConfig
from core.safe_errors import safe_http_exception_handler
from core.security_headers import SecurityHeadersMiddleware, fastapi_documentation_options, trusted_host_patterns
from core.session_cookie import request_session_token, SameOriginSessionMiddleware, SessionCookieUpgradeMiddleware


Path("logs").mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=getattr(logging, SystemConfig.LOG_LEVEL),
    handlers=secure_log_handlers(
        log_file=SystemConfig.LOG_FILE,
        format_string=SystemConfig.LOG_FORMAT,
    ),
)
logger = logging.getLogger(__name__)

redis_client: Optional[redis.Redis] = None
pubsub_redis_client: Optional[redis.Redis] = None
database_manager = None
online_task_service: Optional[OnlineProviderTaskService] = None
online_workers: list[OnlineProviderWorker] = []
main_event_loop: Optional[asyncio.AbstractEventLoop] = None
_online_users: dict[str, datetime] = {}


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


async def _seed_admin_roles() -> Any:
    return await apply_configured_admin_bootstrap(
        user_dao=UserDAO,
        settings_dao=SystemSettingsDAO,
        logger=logger,
    )


async def _stop_runtime_tasks(background_tasks: list[asyncio.Task], worker_tasks: list[asyncio.Task]) -> None:
    """Stop consumers before closing the shared database and Redis clients."""
    try:
        for task in background_tasks:
            task.cancel()
        if background_tasks:
            await asyncio.gather(*background_tasks, return_exceptions=True)
        await asyncio.gather(*(worker.stop() for worker in online_workers), return_exceptions=True)
    finally:
        for task in worker_tasks:
            task.cancel()
        if worker_tasks:
            await asyncio.gather(*worker_tasks, return_exceptions=True)


@asynccontextmanager
async def lifespan(application: FastAPI):
    global database_manager, main_event_loop, online_task_service, pubsub_redis_client, redis_client
    main_event_loop = asyncio.get_running_loop()
    background_tasks: list[asyncio.Task] = []
    worker_tasks: list[asyncio.Task] = []

    try:
        # Register cleanup immediately after acquisition, including partial startup.
        # The stack still releases other resources if an individual close fails.
        async with AsyncExitStack() as resources:
            validate_api_config_encryption_configuration()
            validate_captcha_configuration()
            validate_auth_rate_limit_configuration()
            validate_public_feedback_rate_limit_configuration()
            jwt_auth.init()

            database_manager = await init_db_manager()
            resources.push_async_callback(database_manager.disconnect)
            await seed_default_api_providers()
            await _seed_admin_roles()
            await load_api_configs_to_env()
            validate_runtime_provider_environment()

            validate_redis_security(
                host=RedisConfig.HOST,
                password=RedisConfig.PASSWORD,
                tls_enabled=RedisConfig.SSL,
            )
            redis_options: dict[str, Any] = {
                "host": RedisConfig.HOST,
                "port": RedisConfig.PORT,
                "db": RedisConfig.DB,
                "username": RedisConfig.USERNAME,
                "password": RedisConfig.PASSWORD,
                "ssl": RedisConfig.SSL,
                "decode_responses": True,
                "max_connections": RedisConfig.MAX_CONNECTIONS,
            }
            if RedisConfig.SSL_CA_CERTS:
                redis_options.update(ssl_ca_certs=RedisConfig.SSL_CA_CERTS, ssl_cert_reqs="required")
            redis_client = redis.Redis(**redis_options)
            resources.push_async_callback(redis_client.aclose)
            pubsub_redis_client = redis.Redis(**{**redis_options, "max_connections": 200})
            resources.push_async_callback(pubsub_redis_client.aclose)
            application.state.redis_client = redis_client
            await redis_client.ping()
            await pubsub_redis_client.ping()
            set_provider_health_redis(redis_client)
            configure_presence_store(lambda: redis_client)

            online_task_service = OnlineProviderTaskService(redis_client)
            resources.push_async_callback(_stop_runtime_tasks, background_tasks, worker_tasks)
            worker_count = _env_int("ONLINE_PROVIDER_WORKERS_COUNT", 4, 1, 64)
            for index in range(worker_count):
                worker = OnlineProviderWorker(
                    f"online-{index + 1}",
                    redis_client,
                    online_task_service.get_queue(),
                    register_signals=False,
                )
                online_workers.append(worker)
                worker_tasks.append(asyncio.create_task(worker.start(), name=f"online-provider:{index + 1}"))
            background_tasks.append(asyncio.create_task(email_outbox_worker_loop(), name="email-outbox"))
            background_tasks.append(asyncio.create_task(recharge_order_expiry_loop(), name="recharge-order-expiry"))
            from services.jimeng_task_service import jimeng_recovery_loop
            background_tasks.append(asyncio.create_task(jimeng_recovery_loop(online_task_service.get_queue()), name="jimeng-recovery"))
            background_tasks.append(
                asyncio.create_task(provider_health_monitor_loop(redis_client), name="provider-health")
            )
            logger.info("Source-edition runtime started with %s online-provider workers", worker_count)
            yield
    finally:
        online_workers.clear()
        database_manager = main_event_loop = online_task_service = None
        redis_client = pubsub_redis_client = None
        set_provider_health_redis(None)
        configure_presence_store(lambda: None)
        application.state.redis_client = None


app = FastAPI(
    title=SystemConfig.FRONTEND_CONFIG["title"],
    description="Source edition with user-configured online providers",
    version=SystemConfig.FRONTEND_CONFIG["version"],
    lifespan=lifespan,
    **fastapi_documentation_options(),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=SystemConfig.ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CacheControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith(("/storage/", "/uploads/")):
            response.headers["Cache-Control"] = "private, no-store, max-age=0"
            response.headers["Pragma"] = "no-cache"
        elif request.url.path.startswith(("/assets/", "/studio/assets/")):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


async def _validate_private_media_session(token: str) -> Optional[str]:
    identity = await validate_session_token(token, user_dao=UserDAO)
    return str(identity["user_id"]) if identity else None


async def _resolve_private_media_identity(subject: str) -> str:
    return await resolve_authenticated_user_id(subject, user_dao=UserDAO)


app.add_middleware(CacheControlMiddleware)
app.add_middleware(
    PrivateMediaAccessMiddleware,
    token_verifier=jwt_auth.verify_token,
    identity_resolver=_resolve_private_media_identity,
    session_validator=_validate_private_media_session,
    file_dao=FileDAO,
)
app.add_exception_handler(HTTPException, safe_http_exception_handler)
app.add_middleware(SessionCookieUpgradeMiddleware, token_verifier=jwt_auth.verify_token)
app.add_middleware(SameOriginSessionMiddleware, allowed_origins=SystemConfig.ALLOW_ORIGINS)
app.add_middleware(SecurityHeadersMiddleware, admin_entry_path=ADMIN_ENTRY_PATH)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=trusted_host_patterns())
app.add_middleware(RequestBodyLimitMiddleware)

for extension, media_type in {
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
}.items():
    mimetypes.add_type(media_type, extension)

deploy_root = Path(__file__).resolve().parent
static_dir = deploy_root / "static"
storage_dir = Path(os.getenv("STORAGE_BASE_PATH", str(deploy_root / "persistent_storage"))).resolve()
uploads_dir = deploy_root / "temp" / "uploads"
static_dir.mkdir(parents=True, exist_ok=True)
storage_dir.mkdir(parents=True, exist_ok=True)
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
app.mount("/storage", StaticFiles(directory=str(storage_dir)), name="storage")
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

dist_assets = deploy_root / "dist" / "assets"
if dist_assets.is_dir():
    app.mount("/assets", StaticFiles(directory=str(dist_assets)), name="assets")
studio_assets = deploy_root.parent / "studio" / "dist" / "assets"
if studio_assets.is_dir():
    app.mount("/studio/assets", StaticFiles(directory=str(studio_assets)), name="studio-assets")

security = HTTPBearer(auto_error=False)


def _load_builtin_users() -> dict[str, str]:
    return load_builtin_users(logger=logger)


default_users = _load_builtin_users()


def verify_credentials(username: str, password: str) -> bool:
    return default_users.get(username) == password


def create_session_token(username: str, *, session_version: int = 1) -> str:
    _online_users[username] = datetime.now()
    return jwt_auth.create_token(username, session_version=session_version)


async def verify_session(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[str]:
    token = credentials.credentials if credentials else request_session_token(request)
    identity = await validate_session_token(token, user_dao=UserDAO) if token else None
    if not identity:
        return None
    user_id = str(identity["user_id"])
    _online_users[user_id] = datetime.now()
    return user_id


async def require_auth(user_id: Optional[str] = Depends(verify_session)) -> str:
    if not user_id:
        raise HTTPException(status_code=401, detail="需要登录")
    await touch_user_presence(user_id)
    return user_id


def _task_service() -> OnlineProviderTaskService:
    if online_task_service is None:
        raise RuntimeError("Online task service has not started")
    return online_task_service


class DeferredOnlineService:
    """Resolve lifespan-owned queue state only when a request is handled."""

    def get(self) -> OnlineProviderTaskService:
        """Match the module-style service provider used by shared audio routes."""
        return _task_service()

    def get_queue(self):
        return _task_service().get_queue()

    async def submit(self, *args, **kwargs):
        return await _task_service().submit(*args, **kwargs)


deferred_online_service = DeferredOnlineService()

app.include_router(create_video_reverse_router(task_service_module=deferred_online_service))


def _online_queue_or_none():
    return online_task_service.get_queue() if online_task_service is not None else None


public_admin = APIRouter(
    prefix="/api/admin",
    tags=["admin-provider-config"],
    dependencies=[Depends(require_admin_access)],
)
public_admin.include_router(create_public_api_config_router(api_config_router))
public_admin.include_router(admin_project_groups_router)
public_admin.include_router(admin_credit_router)
public_admin.include_router(admin_jimeng_router)
app.include_router(public_admin)
app.include_router(
    create_public_health_router(
        require_admin_dependency=require_admin_access,
        get_database_manager=lambda: database_manager,
        get_redis_client=lambda: redis_client,
        get_online_queue=_online_queue_or_none,
        get_online_workers=lambda: online_workers,
    )
)
app.include_router(create_frontend_pages_router())
app.include_router(create_public_video_capabilities_router(require_auth_dependency=require_auth))
app.include_router(create_public_video_router(require_auth_dependency=require_auth, logger=logger))
app.include_router(
    create_ai_proxy_router(
        require_auth_dependency=require_auth,
        get_main_event_loop=lambda: main_event_loop,
        get_redis_client=lambda: redis_client,
        file_dao=FileDAO,
    )
)
app.include_router(
    create_files_router(
        require_auth_dependency=require_auth,
        security_dependency=security,
        verify_token=jwt_auth.verify_token,
    )
)
app.include_router(create_prompt_router(require_auth_dependency=require_auth))
app.include_router(
    create_user_session_router(
        require_auth_dependency=require_auth,
        online_users=_online_users,
        organization_dao=OrganizationDAO,
        organization_member_dao=OrganizationMemberDAO,
        user_dao=UserDAO,
        project_dao=ProjectDAO,
        project_member_dao=ProjectMemberDAO,
        credit_account_dao=CreditAccountDAO,
        logger=logger,
        create_session_token=create_session_token,
        mark_user_offline=clear_user_presence,
    )
)
app.include_router(
    create_workspace_router(
        require_auth_dependency=require_auth,
        jwt_auth_module=jwt_auth,
        project_dao=ProjectDAO,
        workspace_session_dao=WorkspaceSessionDAO,
        logger=logger,
    )
)
app.include_router(
    create_online_provider_task_router(
        require_auth_dependency=require_auth,
        task_service=deferred_online_service,
        task_dao=TaskDAO,
        file_dao=FileDAO,
        get_pubsub_redis_client=lambda: pubsub_redis_client,
        logger=logger,
    )
)
app.include_router(
    create_projects_router(
        require_auth_dependency=require_auth,
        project_dao=ProjectDAO,
        project_member_dao=ProjectMemberDAO,
        user_dao=UserDAO,
        file_dao=FileDAO,
        version_dao=VersionDAO,
        logger=logger,
        storyboard_dao=StoryboardDAO,
        entity_file_dao=EntityFileDAO,
    )
)
app.include_router(
    create_auth_router(
        verify_credentials=verify_credentials,
        create_session_token=create_session_token,
        logger=logger,
        mark_user_online=touch_user_presence,
        apply_admin_bootstrap=_seed_admin_roles,
        get_redis_client=lambda: redis_client,
    )
)
app.include_router(
    create_phone_auth_router(
        get_redis_client=lambda: redis_client,
        create_session_token=create_session_token,
        require_auth_dependency=require_auth,
        user_dao=UserDAO,
        logger=logger,
        mark_user_online=touch_user_presence,
    )
)
app.include_router(
    create_public_application_router(
        online_task_service=deferred_online_service,
        get_redis_client=lambda: redis_client,
        logger=logger,
    )
)
app.include_router(media_library_router)
app.include_router(credit_router)
app.include_router(
    create_final_product_share_router(
        get_current_user_dependency=get_current_user,
        get_redis_client=lambda: redis_client,
    )
)
app.include_router(
    create_wechat_pay_router(
        get_current_user_dependency=get_current_user,
        logger=logger,
    )
)
app.include_router(
    create_admin_compat_router(
        require_auth=require_admin_access,
        require_super_admin=require_super_admin_access,
        online_users=_online_users,
        default_users=default_users,
        admin_stats_dao=AdminStatsDAO,
        user_dao=UserDAO,
        audit_record=admin_audit_service.record,
        logger=logger,
        include_user_management=True,
    )
)
app.include_router(create_fallback_static_router(deploy_root=deploy_root, logger=logger))


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("PUBLIC_BIND_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = _env_int("PUBLIC_BIND_PORT", 6006, 1, 65535)
    uvicorn.run(app, host=host, port=port, log_level=SystemConfig.LOG_LEVEL.lower())
