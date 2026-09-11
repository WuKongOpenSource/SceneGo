"""HTTP ownership checks with real password/JWT/DAO logic and isolated PostgreSQL.

Only Redis storage and media directories are local substitutes. No lifespan or
provider workers run; CAPTCHA is explicitly disabled in development for these
already-verified accounts, not claimed as part of the registration test coverage.
"""
from contextlib import AsyncExitStack
from dataclasses import dataclass
import secrets
from types import SimpleNamespace

from fakeredis.aioredis import FakeRedis
from httpx import ASGITransport, AsyncClient, Response
import pytest

from core import jwt_auth
from core.online_provider_task_model import OnlineProviderTask
from core.session_cookie import DEVELOPMENT_COOKIE_NAME
from dao_content import FileDAO
from dao_task import TaskDAO
from dao_user import UserDAO
from services.online_provider_task_service import OnlineProviderTaskService
from services import user_presence_service


@dataclass
class Account:
    user_id: str
    username: str
    password: str
    client: AsyncClient
    project_id: str
    login_response: Response


@pytest.fixture
async def accounts(test_db, monkeypatch, tmp_path):
    import public_main

    assert not public_main.app.dependency_overrides
    monkeypatch.setenv("OSTORY_RUNTIME_ENV", "development")
    monkeypatch.setenv("AUTH_CAPTCHA_REQUIRED", "false")
    monkeypatch.setenv("AUTH_LOGIN_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("STORAGE_BASE_PATH", str(tmp_path / "storage"))
    monkeypatch.setenv("LOCAL_STORAGE_PATH", str(tmp_path / "uploads"))
    monkeypatch.setattr(jwt_auth, "_secret_key", secrets.token_urlsafe(48))
    redis = FakeRedis(decode_responses=True)
    service = OnlineProviderTaskService(redis)
    monkeypatch.setattr(public_main, "redis_client", redis)
    monkeypatch.setattr(public_main, "pubsub_redis_client", redis)
    monkeypatch.setattr(public_main, "online_task_service", service)
    original_online_users = dict(public_main._online_users)
    monkeypatch.setattr(user_presence_service, "_redis_provider", lambda: redis)
    monkeypatch.setattr(user_presence_service, "_fallback", {})
    for route in public_main.app.routes:
        if getattr(route, "path", "") in {"/storage", "/uploads"}:
            directory = tmp_path / route.path.lstrip("/")
            directory.mkdir()
            monkeypatch.setattr(route.app, "directory", str(directory))
            monkeypatch.setattr(route.app, "all_directories", [str(directory)])

    transport = ASGITransport(app=public_main.app, raise_app_exceptions=False)
    try:
        async with AsyncExitStack() as stack:
            async def client():
                return await stack.enter_async_context(AsyncClient(
                    transport=transport, base_url="https://testserver",
                    headers={"Origin": "https://testserver"},
                ))

            users = []
            for name in ("isolation_owner", "isolation_other"):
                password = secrets.token_urlsafe(24)
                user = await UserDAO.create_user(name, password)
                await test_db.execute(
                    "UPDATE users SET phone_verified = TRUE, role = 'user', "
                    "status = 'active', is_active = TRUE WHERE user_id = $1",
                    user["user_id"],
                )
                http = await client()
                login = await http.post("/api/login", json={"username": name, "password": password})
                assert login.status_code == 200, login.text
                assert http.cookies.get(DEVELOPMENT_COOKIE_NAME)
                created = await http.post("/api/projects", json={
                    "project_name": name, "settings": {"owner_marker": name},
                })
                assert created.status_code == 200, created.text
                users.append(Account(user["user_id"], name, password, http,
                                     created.json()["project"]["project_id"], login))
            yield SimpleNamespace(owner=users[0], other=users[1], anonymous=await client(),
                                  db=test_db, redis=redis, queue=service.get_queue(), root=tmp_path)
    finally:
        await redis.aclose()
        public_main._online_users.clear()
        public_main._online_users.update(original_online_users)


@pytest.mark.parametrize("transport", ["cookie", "bearer"])
async def test_public_admin_self_rename_preserves_ownership_and_refreshes_legacy_cookie(accounts, transport):
    owner = accounts.owner
    await accounts.db.execute("UPDATE users SET role='super_admin' WHERE user_id=$1", owner.user_id)
    before = await accounts.db.fetchrow("SELECT * FROM projects WHERE project_id=$1", owner.project_id)
    identity = await UserDAO.get_session_identity(owner.user_id)
    legacy = jwt_auth.create_token(owner.username, session_version=identity["session_version"])
    # Preserve the browser cookie's domain/path so Set-Cookie replaces it,
    # rather than creating a second unrelated test-only cookie of the same name.
    cookies = [cookie for cookie in owner.client.cookies.jar if cookie.name == DEVELOPMENT_COOKIE_NAME]
    assert len(cookies) == 1
    if transport == "cookie":
        cookies[0].value = legacy
    headers = {"Authorization": f"Bearer {legacy}"} if transport == "bearer" else {}
    response = await owner.client.put(f"/api/admin/users/{owner.user_id}/username", json={"username": "renamed_owner"}, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["session"] == {"username": "renamed_owner", "role": "super_admin"}
    assert response.json()["user"]["user_id"] == owner.user_id
    assert "httponly" in response.headers["set-cookie"].lower()
    assert response.headers["cache-control"] == "no-store"
    assert jwt_auth.verify_token_claims(owner.client.cookies.get(DEVELOPMENT_COOKIE_NAME))["u"] == owner.user_id
    session = await owner.client.get("/api/admin/session")
    assert session.status_code == 200 and session.json()["username"] == "renamed_owner"
    assert await accounts.db.fetchrow("SELECT * FROM projects WHERE project_id=$1", owner.project_id) == before
    # Opening a project updates its access timestamp; that is not a rename write.
    assert (await owner.client.get(f"/api/projects/{owner.project_id}")).status_code == 200
    assert await accounts.db.fetchval("SELECT user_id FROM projects WHERE project_id=$1", owner.project_id) == owner.user_id
    audit = await accounts.db.fetchrow("SELECT * FROM admin_audit_logs WHERE action='user_rename'")
    assert audit["admin_user_id"] == owner.user_id == audit["target_id"]
    count = await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs WHERE action='user_rename'")
    repeated = await owner.client.put(f"/api/admin/users/{owner.user_id}/username", json={"username": "renamed_owner"})
    assert repeated.status_code == 200 and repeated.json()["changed"] is False
    assert "set-cookie" not in repeated.headers
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs WHERE action='user_rename'") == count


@pytest.mark.parametrize("role", ["user", "admin"])
async def test_public_admin_rename_denies_non_owners_before_any_write(accounts, role):
    owner = accounts.owner
    await accounts.db.execute("UPDATE users SET role=$1 WHERE user_id=$2", role, owner.user_id)
    before = await accounts.db.fetchrow("SELECT * FROM users WHERE user_id=$1", accounts.other.user_id)
    audits = await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs")
    for client, status in ((owner.client, 403), (accounts.anonymous, 401)):
        response = await client.put(f"/api/admin/users/{accounts.other.user_id}/username", json={"username": "denied"})
        assert response.status_code == status, response.text
    assert await accounts.db.fetchrow("SELECT * FROM users WHERE user_id=$1", accounts.other.user_id) == before
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs") == audits


@pytest.mark.parametrize("body", [{"username": "bad name"}, {"username": "isolation_other"},
                                  {"username": "valid", "role": "super_admin"}, {"username": None}])
async def test_public_admin_rename_rejects_invalid_duplicate_and_extra_fields(accounts, body):
    owner = accounts.owner
    await accounts.db.execute("UPDATE users SET role='super_admin' WHERE user_id=$1", owner.user_id)
    response = await owner.client.put(f"/api/admin/users/{owner.user_id}/username", json=body)
    assert response.status_code == 400, response.text
    assert "set-cookie" not in response.headers
    assert (await UserDAO.get_user_by_id(owner.user_id))["username"] == owner.username
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs WHERE action='user_rename'") == 0


async def _media(accounts, prefix="storage"):
    # The bytes are a test-owned inert fixture; serving them must still cross
    # the real middleware, session revocation, file DAO, and project access checks.
    content = b"private media fixture"
    path = accounts.root / prefix / "private.png"
    path.write_bytes(content)
    url = f"/{prefix}/{path.name}"
    row = await FileDAO.create_file(
        version_id=None, user_id=accounts.owner.user_id, file_type="image",
        file_name=path.name, file_path=str(path), file_url=url,
        file_size_bytes=len(content), mime_type="image/png",
        project_id=accounts.owner.project_id,
    )
    return url, content, row["file_id"]


async def _task(accounts, storage):
    task_id = f"isolation_{storage}"
    if storage == "redis":
        assert await accounts.queue.enqueue(OnlineProviderTask(
            task_id, "minimax_i2v", {"prompt": "private task fixture"},
            user_id=accounts.owner.user_id,
        ))
    else:
        await TaskDAO.create_task(task_id, accounts.owner.user_id, "minimax_i2v",
                                  {"prompt": "private task fixture"})
        await TaskDAO.update_task_status(task_id, "completed", result_data={"fixture": True})
    return task_id


async def test_cookie_login_uses_real_identity_and_rejects_wrong_password(accounts):
    response = accounts.owner.login_response
    assert response.json()["session_mode"] == "cookie"
    assert "token" not in response.json()
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert response.headers["cache-control"] == "no-store"
    rejected = await accounts.anonymous.post("/api/login", json={
        "username": accounts.owner.username, "password": "incorrect-password",
    })
    assert rejected.status_code == 401
    assert not accounts.anonymous.cookies.get(DEVELOPMENT_COOKIE_NAME)
    assert (await accounts.owner.client.get("/api/projects")).status_code == 200
    assert (await accounts.anonymous.get("/api/projects")).status_code == 401


async def test_project_read_list_update_delete_keep_account_boundaries(accounts):
    owner, other = accounts.owner, accounts.other
    for account in (owner, other):
        response = await account.client.get("/api/projects")
        assert response.status_code == 200, response.text
        assert {row["project_id"] for row in response.json()["projects"]} == {account.project_id}
    path = f"/api/projects/{owner.project_id}"
    assert (await owner.client.get(path)).json()["project"]["owner_marker"] == owner.username
    assert (await other.client.get(path)).status_code == 403
    assert (await other.client.get(path + "/workspace")).status_code == 403
    assert (await accounts.anonymous.get(path)).status_code == 401
    assert (await owner.client.put(path, json={"project_name": "Owner edit"})).status_code == 200
    assert (await other.client.put(path, json={"project_name": "Unauthorized edit"})).status_code == 403
    assert (await other.client.delete(path)).status_code == 403
    row = await accounts.db.fetchrow("SELECT project_name, is_deleted FROM projects WHERE project_id=$1", owner.project_id)
    assert row["project_name"] == "Owner edit" and not row["is_deleted"]


@pytest.mark.parametrize("role", ["admin", "super_admin"])
async def test_admin_groups_and_frontend_share_rename_membership_and_deletion(accounts, role):
    from dao_admin_audit import AdminAuditLogDAO
    from dao_content import ProjectMemberDAO

    operator, owner = accounts.other, accounts.owner
    await accounts.db.execute("UPDATE users SET role=$2 WHERE user_id=$1", operator.user_id, role)
    created = await operator.client.post("/api/admin/project-groups", json={
        "user_id": owner.user_id, "group_name": " Original group ", "description": "Keep description",
        "color": "#654321", "sort_order": 3,
    })
    assert created.status_code == 201, created.text
    group = created.json()["group"]
    gid = group["group_id"]
    assert group["group_name"] == "Original group" and group["user_id"] == owner.user_id
    assert isinstance(group["created_at"], str)
    moved = await operator.client.post(f"/api/admin/projects/{owner.project_id}/move", json={"group_id": gid})
    assert moved.status_code == 200, moved.text
    renamed = await operator.client.put(f"/api/admin/project-groups/{gid}", json={"group_name": " 新组名 "})
    assert renamed.status_code == 200 and renamed.json()["group"]["group_name"] == "新组名"
    frontend = await owner.client.get("/api/project-groups")
    saved = next(g for g in frontend.json()["groups"] if g["group_id"] == gid)
    assert saved["group_name"] == "新组名" and saved["project_count"] == 1
    assert saved["description"] == "Keep description" and saved["sort_order"] == 3
    projects = (await owner.client.get("/api/projects")).json()["projects"]
    assert next(p for p in projects if p["project_id"] == owner.project_id)["group_id"] == gid
    for suffix in ("", f"?user_id={owner.user_id}"):
        listed = await operator.client.get("/api/admin/project-groups" + suffix)
        assert listed.status_code == 200, listed.text
        assert next(g for g in listed.json()["groups"] if g["group_id"] == gid)["project_count"] == 1
    contents = await operator.client.get(f"/api/admin/project-groups/{gid}/projects")
    assert contents.status_code == 200, contents.text
    assert [p["project_id"] for p in contents.json()["projects"]] == [owner.project_id]
    deleted = await operator.client.delete(f"/api/admin/project-groups/{gid}")
    assert deleted.status_code == 200, deleted.text
    preserved = await accounts.db.fetchrow("SELECT user_id, group_id, is_deleted FROM projects WHERE project_id=$1", owner.project_id)
    assert preserved["user_id"] == owner.user_id and preserved["group_id"] is None and not preserved["is_deleted"]
    assert await ProjectMemberDAO.check_permission(owner.project_id, owner.user_id, "owner")
    ungrouped = await operator.client.get("/api/admin/ungrouped-projects")
    assert ungrouped.status_code == 200, ungrouped.text
    assert owner.project_id in {p["project_id"] for p in ungrouped.json()["projects"]}
    audits = await AdminAuditLogDAO.list(target_id=gid)
    assert {a["action"] for a in audits} == {"project_group_create", "project_group_update", "project_group_delete"}
    assert all(a["admin_user_id"] == operator.user_id for a in audits)
    updated = next(a for a in audits if a["action"] == "project_group_update")
    assert updated["before_data"]["group_name"] == "Original group"
    assert updated["after_data"] == {"group_name": "新组名"}


async def test_admin_group_operations_enforce_role_and_session_without_side_effects(accounts):
    operations = [
        ("GET", "/api/admin/project-groups", None),
        ("POST", "/api/admin/project-groups", {"user_id": accounts.owner.user_id, "group_name": "Denied"}),
        ("GET", "/api/admin/project-groups/missing/projects", None),
        ("PUT", "/api/admin/project-groups/missing", {"group_name": "Denied"}),
        ("DELETE", "/api/admin/project-groups/missing", None),
        ("GET", "/api/admin/ungrouped-projects", None),
        ("POST", f"/api/admin/projects/{accounts.owner.project_id}/move", {"group_id": None}),
    ]
    before = await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs")
    denied = await accounts.owner.client.get("/api/admin/project-groups", params={
        "identity_loader": "client-controlled", "session_validator": "client-controlled",
    })
    assert denied.status_code == 403, denied.text
    for method, path, body in operations:
        for client, expected in ((accounts.owner.client, 403), (accounts.anonymous, 401)):
            response = await client.request(method, path, **({"json": body} if body is not None else {}))
            assert response.status_code == expected, (method, path, response.text)
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM project_groups") == 0
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs") == before


async def test_admin_cannot_move_a_project_into_another_owners_group(accounts):
    operator = accounts.other
    created = await operator.client.post("/api/project-groups", json={"group_name": "Operator group"})
    assert created.status_code == 201, created.text
    gid = created.json()["group"]["group_id"]
    await accounts.db.execute("UPDATE users SET role='admin' WHERE user_id=$1", operator.user_id)
    before = await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs")
    response = await operator.client.post(f"/api/admin/projects/{accounts.owner.project_id}/move", json={"group_id": gid})
    assert response.status_code == 403, response.text
    assert await accounts.db.fetchval("SELECT group_id FROM projects WHERE project_id=$1", accounts.owner.project_id) is None
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM admin_audit_logs") == before


async def test_legacy_save_cannot_claim_success_for_another_users_project(accounts):
    owner = accounts.owner
    before = await accounts.db.fetchrow("SELECT * FROM projects WHERE project_id=$1", owner.project_id)
    response = await accounts.other.client.post("/api/projects/save", json={
        "project_id": owner.project_id, "name": "Unauthorized save", "user_id": owner.user_id,
    })
    after = await accounts.db.fetchrow("SELECT * FROM projects WHERE project_id=$1", owner.project_id)
    assert after == before
    assert response.status_code == 403, response.text
    assert "owner_marker" not in response.text


async def test_legacy_save_creates_and_updates_only_the_authenticated_owners_data(accounts):
    owner = accounts.owner
    response = await owner.client.post("/api/projects/save", json={
        "name": "Legacy fixture", "user_id": accounts.other.user_id,
        "original_content": "Draft content",
    })
    assert response.status_code == 200, response.text
    project_id = response.json()["project_id"]
    row = await accounts.db.fetchrow("SELECT user_id FROM projects WHERE project_id=$1", project_id)
    assert row["user_id"] == owner.user_id
    updated = await owner.client.post("/api/projects/save", json={
        "project_id": project_id, "name": "Saved again", "original_content": "Updated draft",
    })
    assert updated.status_code == 200, updated.text
    assert (await owner.client.get(f"/api/projects/{project_id}")).json()["project"]["original_content"] == "Updated draft"


async def test_beacon_save_rejects_other_owner_without_a_false_success(accounts):
    path = "/api/workspace/save-beacon"
    body = {"project_id": accounts.owner.project_id, "name": "Beacon fixture", "original_content": "Owner draft"}
    own = await accounts.owner.client.post(path, json=body)
    assert own.status_code == 200 and own.json()["success"] is True
    before = await accounts.db.fetchrow("SELECT * FROM projects WHERE project_id=$1", accounts.owner.project_id)
    response = await accounts.other.client.post(path, json={**body, "name": "Unauthorized beacon"})
    assert await accounts.db.fetchrow("SELECT * FROM projects WHERE project_id=$1", accounts.owner.project_id) == before
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("role", ["readonly", "member"])
async def test_collaboration_does_not_grant_legacy_snapshot_replacement(accounts, role):
    owner, other = accounts.owner, accounts.other
    response = await owner.client.post(f"/api/projects/{owner.project_id}/members", json={
        "user_id": other.user_id, "role": role,
    })
    assert response.status_code == 200, response.text
    assert (await other.client.get(f"/api/projects/{owner.project_id}")).status_code == 200
    before = await accounts.db.fetchrow("SELECT * FROM projects WHERE project_id=$1", owner.project_id)
    for path in ("/api/projects/save", "/api/workspace/save-beacon"):
        denied = await other.client.post(path, json={"project_id": owner.project_id, "name": "Not owner"})
        assert denied.status_code == 403, denied.text
        assert await accounts.db.fetchrow("SELECT * FROM projects WHERE project_id=$1", owner.project_id) == before


@pytest.mark.parametrize("prefix", ["storage", "uploads"])
async def test_static_media_requires_owner_session_and_is_not_publicly_cached(accounts, prefix):
    url, content, file_id = await _media(accounts, prefix)
    own = await accounts.owner.client.get(url)
    assert own.status_code == 200, own.text
    assert own.content == content
    assert "no-store" in own.headers["cache-control"]
    assert own.headers["x-content-type-options"] == "nosniff"
    assert (await accounts.other.client.get(url)).status_code == 404
    assert (await accounts.anonymous.get(url)).status_code == 401
    token = accounts.owner.client.cookies.get(DEVELOPMENT_COOKIE_NAME)
    assert (await accounts.anonymous.get(url, params={"token": token})).status_code == 401
    download = f"/api/files/{file_id}/download"
    own_download = await accounts.owner.client.get(download)
    assert own_download.status_code == 200, own_download.text
    assert own_download.content == content
    assert (await accounts.other.client.get(download)).status_code == 404
    assert (await accounts.anonymous.get(download)).status_code == 401


async def test_asset_collaboration_distinguishes_readonly_and_member_access(accounts):
    owner, other = accounts.owner, accounts.other
    created = await owner.client.post("/api/assets", json={
        "project_id": owner.project_id, "asset_type": "prop", "name": "Fixture prop",
    })
    assert created.status_code == 200, created.text
    asset_id = created.json()["asset"]["asset_id"]
    listing = f"/api/projects/{owner.project_id}/assets"
    assert (await other.client.get(listing)).status_code == 404
    assert (await other.client.put(f"/api/assets/{asset_id}", json={"name": "Forbidden"})).status_code == 404
    assert (await other.client.delete(f"/api/assets/{asset_id}")).status_code == 404
    members = f"/api/projects/{owner.project_id}/members"
    added = await owner.client.post(members, json={"user_id": other.user_id, "role": "readonly"})
    assert added.status_code == 200, added.text
    response = await other.client.get(listing)
    assert response.status_code == 200, response.text
    assert [asset["name"] for asset in response.json()["assets"]] == ["Fixture prop"]
    assert (await other.client.put(f"/api/assets/{asset_id}", json={"name": "Still forbidden"})).status_code == 404
    promoted = await owner.client.put(members + f"/{other.user_id}", json={"role": "member"})
    assert promoted.status_code == 200, promoted.text
    edited = await other.client.put(f"/api/assets/{asset_id}", json={"name": "Collaborator edit"})
    assert edited.status_code == 200, edited.text
    assert (await owner.client.get(listing)).json()["assets"][0]["name"] == "Collaborator edit"


async def test_removing_project_membership_revokes_file_access_without_ending_own_session(accounts):
    url, content, file_id = await _media(accounts)
    owner, other = accounts.owner, accounts.other
    members = f"/api/projects/{owner.project_id}/members"
    added = await owner.client.post(members, json={"user_id": other.user_id, "role": "readonly"})
    assert added.status_code == 200, added.text
    response = await other.client.get(url)
    assert response.status_code == 200 and response.content == content
    denied = await other.client.delete(f"/api/files/{file_id}")
    assert denied.status_code == 403, denied.text
    removed = await owner.client.delete(members + f"/{other.user_id}")
    assert removed.status_code == 200, removed.text
    assert (await other.client.get(url)).status_code == 404
    assert (await other.client.get("/api/projects")).status_code == 200
    assert (await owner.client.get(url)).content == content


@pytest.mark.parametrize("source", ["project", "image_path", "media_url", "media_file_id"])
async def test_generation_rejects_foreign_scope_and_sources_before_queue_or_credits(accounts, source):
    url, _, file_id = await _media(accounts)
    body = {"task_type": "minimax_i2v", "prompt": "Permission fixture"}
    if source == "project":
        body["project_id"] = accounts.owner.project_id
    elif source == "image_path":
        body["image_path"] = url
    elif source == "media_url":
        body["media_inputs"] = [{"kind": "image", "url": url}]
    else:
        body["media_inputs"] = [{"kind": "image", "file_id": file_id}]
    before_tasks = await accounts.db.fetchval("SELECT COUNT(*) FROM tasks")
    before_freezes = await accounts.db.fetchval("SELECT COUNT(*) FROM credit_freezes")
    response = await accounts.other.client.post("/api/generate", json=body)
    assert response.status_code == 404, response.text
    assert await accounts.queue.get_external_queue_length() == 0
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM tasks") == before_tasks
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM credit_freezes") == before_freezes


@pytest.fixture
async def audio_scope(accounts, monkeypatch):
    from dao_character_voice import CharacterVoiceDAO
    from dao_credit import CreditAccountDAO
    from routers import public_application

    # The queue, billing, DAO, and cookie session are real application code.
    # Replace provider configuration only; no worker consumes the test queue.
    monkeypatch.setattr(public_application, "get_minimax_audio_client",
                        lambda: SimpleNamespace(api_key="test-only"))
    for account in (accounts.owner, accounts.other):
        credit = await CreditAccountDAO.get_or_create("user", account.user_id)
        await accounts.db.execute(
            "UPDATE credit_accounts SET available_credits=100, account_credits=100 WHERE account_id=$1",
            credit["account_id"],
        )
    await accounts.db.execute(
        "INSERT INTO episodes (episode_id, project_id, episode_number, episode_name) "
        "VALUES ('episode-audio-scope', $1, 1, 'Audio fixture')", accounts.owner.project_id,
    )
    await accounts.db.execute(
        "INSERT INTO storyboard_items (item_id, episode_id, sort_order) "
        "VALUES ('shot-audio-scope', 'episode-audio-scope', 0)",
    )
    voice = await CharacterVoiceDAO.create(accounts.owner.project_id, "Fixture character")
    return SimpleNamespace(voice_id=str(voice["voice_id"]), body={
        "text": "你好", "voice_id": "female-shaonv",
        "project_id": accounts.owner.project_id, "episode_id": "episode-audio-scope",
        "entity_type": "storyboard_item", "entity_id": "shot-audio-scope",
        "storyboard_lineage_id": "lineage-audio-scope",
    })


async def test_public_tts_real_queue_preserves_scope_and_reserves_credits_once(accounts, audio_scope):
    body = {**audio_scope.body, "bind_to_character_voice_id": audio_scope.voice_id,
            "user_id": accounts.other.user_id}
    response = await accounts.owner.client.post("/api/minimax/tts", json=body)
    assert response.status_code == 200, response.text
    task_id = response.json()["task_id"]
    task = await accounts.queue.get_task(task_id)
    assert task.user_id == accounts.owner.user_id and task.task_type == "minimax_tts"
    for field, value in audio_scope.body.items():
        assert task.data[field] == value
    assert task.data["bind_to_character_voice_id"] == audio_scope.voice_id
    assert await accounts.queue.get_external_queue_length() == 1
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM tasks WHERE task_id=$1", task_id) == 1
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM credit_freezes WHERE task_id=$1", task_id) == 1
    balance = await accounts.db.fetchrow(
        "SELECT available_credits, frozen_credits, total_used_credits FROM credit_accounts "
        "WHERE owner_type='user' AND owner_id=$1", accounts.owner.user_id,
    )
    assert dict(balance) == {"available_credits": 98, "frozen_credits": 2, "total_used_credits": 0}
    assert (await accounts.other.client.get(f"/api/task/{task_id}")).status_code == 404


@pytest.mark.parametrize("target", ["project", "episode", "storyboard", "voice_binding", "invalid_voice_binding"])
async def test_public_tts_rejects_foreign_targets_before_queue_and_credits(accounts, audio_scope, target):
    body = {"text": "Hello", "voice_id": "female-shaonv"}
    if target == "project":
        body["project_id"] = accounts.owner.project_id
    elif target == "episode":
        body["episode_id"] = "episode-audio-scope"
    elif target == "storyboard":
        body.update(entity_type="storyboard_item", entity_id="shot-audio-scope")
    elif target == "voice_binding":
        body["bind_to_character_voice_id"] = audio_scope.voice_id
    else:
        body["bind_to_character_voice_id"] = "not-a-voice-uuid"
    before_tasks = await accounts.db.fetchval("SELECT COUNT(*) FROM tasks")
    before_freezes = await accounts.db.fetchval("SELECT COUNT(*) FROM credit_freezes")
    response = await accounts.other.client.post("/api/minimax/tts", json=body)
    assert response.status_code == 404, response.text
    assert await accounts.queue.get_external_queue_length() == 0
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM tasks") == before_tasks
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM credit_freezes") == before_freezes


async def test_public_tts_rejects_voice_binding_from_another_accessible_project(accounts, audio_scope):
    created = await accounts.owner.client.post("/api/projects", json={"project_name": "Separate audio project"})
    assert created.status_code == 200, created.text
    before_tasks = await accounts.db.fetchval("SELECT COUNT(*) FROM tasks")
    before_freezes = await accounts.db.fetchval("SELECT COUNT(*) FROM credit_freezes")
    response = await accounts.owner.client.post("/api/minimax/tts", json={
        "text": "Hello", "voice_id": "female-shaonv",
        "project_id": created.json()["project"]["project_id"],
        "bind_to_character_voice_id": audio_scope.voice_id,
    })
    assert response.status_code == 404, response.text
    assert await accounts.queue.get_external_queue_length() == 0
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM tasks") == before_tasks
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM credit_freezes") == before_freezes


@pytest.mark.parametrize("storage", ["redis", "database"])
async def test_task_status_and_mutations_never_cross_accounts(accounts, storage):
    task_id = await _task(accounts, storage)
    path = f"/api/task/{task_id}"
    own = await accounts.owner.client.get(path)
    assert own.status_code == 200, own.text
    assert own.json()["data"]["prompt"] == "private task fixture"
    assert (await accounts.other.client.get(path)).status_code == 404
    assert (await accounts.anonymous.get(path)).status_code == 401
    assert (await accounts.other.client.delete(path)).status_code == 404
    assert (await accounts.other.client.delete(path + "/delete")).status_code == 404
    assert (await accounts.owner.client.get(path)).json() == own.json()
    listed = await accounts.other.client.get("/api/tasks")
    assert listed.status_code == 200, listed.text
    assert task_id not in listed.text and "private task fixture" not in listed.text
    assert await accounts.db.fetchval("SELECT COUNT(*) FROM tasks WHERE task_id=$1", task_id) == 1


async def test_cross_origin_cookie_write_is_rejected_before_database_mutation(accounts):
    response = await accounts.owner.client.put(f"/api/projects/{accounts.owner.project_id}",
        headers={"Origin": "https://untrusted.example.test"}, json={"project_name": "Forged"})
    assert response.status_code == 403
    assert await accounts.db.fetchval("SELECT project_name FROM projects WHERE project_id=$1", accounts.owner.project_id) == accounts.owner.username


@pytest.mark.parametrize("revocation", ["password", "disabled"])
async def test_revoked_sessions_fail_across_projects_tasks_and_media(accounts, revocation):
    owner = accounts.owner
    url, _, _ = await _media(accounts)
    task_id = await _task(accounts, "database")
    paths = ["/api/projects", f"/api/projects/{owner.project_id}", f"/api/task/{task_id}", url]
    for path in paths:
        assert (await owner.client.get(path)).status_code == 200
    if revocation == "password":
        changed = await owner.client.post("/api/me/password", json={
            "current_password": owner.password, "new_password": secrets.token_urlsafe(24),
        })
        assert changed.status_code == 200, changed.text
    else:
        await accounts.db.execute("UPDATE users SET is_active=FALSE, status='disabled' WHERE user_id=$1", owner.user_id)
    for path in paths:
        assert (await owner.client.get(path)).status_code == 401, path
    assert (await accounts.other.client.get("/api/projects")).status_code == 200


async def test_ordinary_account_cannot_read_provider_secrets_or_admin_health(accounts):
    for path in ("/api/admin/api-configs", "/api/admin/system/health"):
        response = await accounts.owner.client.get(path)
        assert response.status_code == 403, response.text
        assert (await accounts.anonymous.get(path)).status_code == 401
