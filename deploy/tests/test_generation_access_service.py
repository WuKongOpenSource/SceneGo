from types import SimpleNamespace

import pytest

from services.entity_access_service import EntityAccessDenied
from services.generation_access_service import (
    GenerationAccessDenied,
    generation_source_references,
    require_generation_request_access,
)


class FakeFileDAO:
    def __init__(self, records=None):
        self.records = {row["file_id"]: row for row in (records or [])}

    async def get_file(self, file_id):
        return self.records.get(file_id)

    async def get_file_by_url(self, url):
        return next((row for row in self.records.values() if row.get("file_url") == url), None)

    async def get_file_by_name(self, filename):
        return next((row for row in self.records.values() if row.get("file_name") == filename), None)

    async def get_file_by_comfyui_filename(self, filename):
        return next((row for row in self.records.values() if row.get("file_name") == filename), None)


async def allow_project(project_id, identity, role):
    return {"project_id": project_id, "role": role}


async def resolve_entity(entity_type, entity_id, identity, role):
    scopes = {
        ("episode", "ep_1"): {"project_id": "proj_1", "episode_id": "ep_1"},
        ("storyboard_item", "sb_1"): {"project_id": "proj_1", "episode_id": "ep_1"},
    }
    if (entity_type, entity_id) not in scopes:
        raise EntityAccessDenied("denied")
    return scopes[(entity_type, entity_id)]


async def allow_file(file_id, identity, role, *, file_dao):
    row = dict(await file_dao.get_by_id(file_id) or {})
    if not row:
        raise EntityAccessDenied("denied")
    row["_access_project_id"] = row.get("project_id", "")
    return row


def scoped_request(**overrides):
    values = {
        "project_id": "proj_1",
        "episode_id": "ep_1",
        "entity_type": "storyboard_item",
        "entity_id": "sb_1",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_generation_source_references_collects_legacy_and_multimodal_fields_once():
    request = SimpleNamespace(
        image_path="file_first",
        image_path_end=None,
        video_filename="file_video",
        audio_filename=None,
        first_frame_image="file_first",
        last_frame_image="file_last",
        media_inputs=[
            {"url": "/storage/reference.png", "file_id": "file_reference"},
            {"url": "/storage/reference.png"},
        ],
    )

    assert generation_source_references(request) == [
        "file_first",
        "file_video",
        "file_last",
        "/storage/reference.png",
        "file_reference",
    ]


@pytest.mark.asyncio
async def test_generation_scope_and_owned_local_source_are_authorized():
    files = FakeFileDAO(
        [{"file_id": "file_1", "file_name": "source.png", "file_url": "/storage/source.png", "project_id": "proj_1"}]
    )

    scope = await require_generation_request_access(
        scoped_request(),
        "yuan",
        ["source.png"],
        file_dao=files,
        entity_access_checker=resolve_entity,
        project_access_checker=allow_project,
        file_access_checker=allow_file,
    )

    assert scope == {"project_id": "proj_1", "episode_id": "ep_1"}


@pytest.mark.asyncio
async def test_generation_rejects_cross_project_source_even_when_file_is_readable():
    files = FakeFileDAO(
        [{"file_id": "file_2", "file_name": "foreign.png", "file_url": "/storage/foreign.png", "project_id": "proj_2"}]
    )

    with pytest.raises(GenerationAccessDenied):
        await require_generation_request_access(
            scoped_request(),
            "yuan",
            ["foreign.png"],
            file_dao=files,
            entity_access_checker=resolve_entity,
            project_access_checker=allow_project,
            file_access_checker=allow_file,
        )


@pytest.mark.asyncio
async def test_generation_rejects_mismatched_entity_and_project_scope():
    with pytest.raises(GenerationAccessDenied):
        await require_generation_request_access(
            scoped_request(project_id="proj_other"),
            "yuan",
            [],
            file_dao=FakeFileDAO(),
            entity_access_checker=resolve_entity,
            project_access_checker=allow_project,
            file_access_checker=allow_file,
        )


@pytest.mark.asyncio
async def test_generation_rejects_untracked_local_filename():
    with pytest.raises(GenerationAccessDenied):
        await require_generation_request_access(
            scoped_request(),
            "yuan",
            ["missing-local.png"],
            file_dao=FakeFileDAO(),
            entity_access_checker=resolve_entity,
            project_access_checker=allow_project,
            file_access_checker=allow_file,
        )


@pytest.mark.asyncio
async def test_generation_allows_inline_data_without_file_lookup():
    scope = await require_generation_request_access(
        scoped_request(),
        "yuan",
        ["data:image/png;base64,AAAA"],
        file_dao=FakeFileDAO(),
        entity_access_checker=resolve_entity,
        project_access_checker=allow_project,
        file_access_checker=allow_file,
    )

    assert scope["project_id"] == "proj_1"


@pytest.mark.asyncio
@pytest.mark.parametrize("reference", [
    "/api/files/file_1/download",
    "/api/files/file_1/download?download=1",
    "https://media.example.com/api/files/file_1/download",
    "file_1.png",
    "/api/files/719ce9a0-4e75-40dd-8c29-4aca5c215001/download",
])
async def test_generation_resolves_authenticated_downloads_and_legacy_identifiers(reference):
    file_id = "719ce9a0-4e75-40dd-8c29-4aca5c215001" if "719ce9a0" in reference else "file_1"
    files = FakeFileDAO([{ "file_id": file_id, "project_id": "proj_1" }])
    scope = await require_generation_request_access(
        scoped_request(), "owner", [reference], file_dao=files,
        entity_access_checker=resolve_entity, project_access_checker=allow_project,
        file_access_checker=allow_file,
    )
    assert scope["episode_id"] == "ep_1"


@pytest.mark.asyncio
@pytest.mark.parametrize("reference", [
    "/api/files/file_other/download",
    "https://media.example.com/api/files/file_other/download?x=1",
    "https://media.example.com/file_other.png",
    "https://media.example.com/storage/image/foreign.png",
])
@pytest.mark.parametrize("state", ["missing", "cross_project", "forbidden"])
async def test_local_file_aliases_never_bypass_ownership_or_fall_back_to_remote(reference, state, monkeypatch):
    monkeypatch.setattr("services.generation_access_service.assert_public_http_url", lambda source: None)
    files = FakeFileDAO([] if state == "missing" else [{
        "file_id": "file_other", "project_id": "proj_2" if state == "cross_project" else "proj_1",
    }])

    async def check_file(*args, **kwargs):
        if state == "forbidden":
            raise EntityAccessDenied("denied")
        return await allow_file(*args, **kwargs)

    with pytest.raises(GenerationAccessDenied):
        await require_generation_request_access(
            scoped_request(), "owner", [reference], file_dao=files,
            entity_access_checker=resolve_entity, project_access_checker=allow_project,
            file_access_checker=check_file,
        )


def test_collects_all_agent_frames_including_h3_segments():
    request = SimpleNamespace(
        image_path="first", image_path_1="angle1", image_path_6="angle6",
        image_BK="background", image_HU="subject", image_MB="mask",
        h3_long_video_segments=[
            {"image_path": "first"},
            {"image_path": "second", "image_path_end": "last"},
        ],
    )
    assert generation_source_references(request) == [
        "first", "angle1", "angle6", "background", "subject", "mask", "second", "last",
    ]
