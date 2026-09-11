from __future__ import annotations

import pytest

from services.provider_object_access_service import (
    ProviderObjectAccessDenied,
    filter_minimax_voice_payload,
    find_minimax_voice,
    owned_provider_object_ids,
    record_provider_object,
    reject_foreign_provider_object,
    require_provider_object_owner,
)


class FakeProviderObjectDAO:
    rows = {}

    @classmethod
    def reset(cls):
        cls.rows = {}

    @classmethod
    async def upsert(cls, **kwargs):
        key = (kwargs["provider"], kwargs["object_type"], kwargs["object_id"])
        cls.rows[key] = dict(kwargs)
        return cls.rows[key]

    @classmethod
    async def get(cls, *, provider, object_type, object_id):
        return cls.rows.get((provider, object_type, object_id))

    @classmethod
    async def list_ids(cls, *, provider, object_types, user_id):
        return [
            object_id
            for (row_provider, row_type, object_id), row in cls.rows.items()
            if row_provider == provider and row_type in object_types and row["user_id"] == user_id
        ]


def setup_function():
    FakeProviderObjectDAO.reset()


async def test_provider_object_owner_round_trip_and_foreign_rejection():
    await record_provider_object(
        provider="minimax",
        object_type="minimax_file",
        object_id="file_1",
        owner_identity="yuan",
        provider_object_dao=FakeProviderObjectDAO,
    )

    owned = await require_provider_object_owner(
        provider="minimax",
        object_type="minimax_file",
        object_id="file_1",
        owner_identity="yuan",
        provider_object_dao=FakeProviderObjectDAO,
    )
    assert owned["user_id"] == "yuan"

    with pytest.raises(ProviderObjectAccessDenied):
        await require_provider_object_owner(
            provider="minimax",
            object_type="minimax_file",
            object_id="file_1",
            owner_identity="other",
            provider_object_dao=FakeProviderObjectDAO,
        )


async def test_reject_foreign_allows_system_or_untracked_voice_but_blocks_foreign_custom_voice():
    await reject_foreign_provider_object(
        provider="minimax",
        object_types=("minimax_voice_cloning", "minimax_voice_generation"),
        object_id="female-shaonv",
        owner_identity="yuan",
        provider_object_dao=FakeProviderObjectDAO,
    )
    await record_provider_object(
        provider="minimax",
        object_type="minimax_voice_cloning",
        object_id="clone_1",
        owner_identity="other",
        provider_object_dao=FakeProviderObjectDAO,
    )

    with pytest.raises(ProviderObjectAccessDenied):
        await reject_foreign_provider_object(
            provider="minimax",
            object_types=("minimax_voice_cloning", "minimax_voice_generation"),
            object_id="clone_1",
            owner_identity="yuan",
            provider_object_dao=FakeProviderObjectDAO,
        )


async def test_voice_payload_keeps_system_voices_and_filters_custom_buckets():
    for voice_id, owner in (("clone_mine", "yuan"), ("design_mine", "yuan"), ("clone_other", "other")):
        await record_provider_object(
            provider="minimax",
            object_type="minimax_voice_generation" if voice_id.startswith("design") else "minimax_voice_cloning",
            object_id=voice_id,
            owner_identity=owner,
            provider_object_dao=FakeProviderObjectDAO,
        )
    owned = await owned_provider_object_ids(
        provider="minimax",
        object_types=("minimax_voice_cloning", "minimax_voice_generation"),
        owner_identity="yuan",
        provider_object_dao=FakeProviderObjectDAO,
    )
    payload = filter_minimax_voice_payload(
        {
            "success": True,
            "system_voice": [{"voice_id": "female-shaonv"}],
            "voice_cloning": [{"voice_id": "clone_mine"}, {"voice_id": "clone_other"}],
            "voice_generation": [{"voice_id": "design_mine"}],
        },
        owned,
    )

    assert [item["voice_id"] for item in payload["system_voice"]] == ["female-shaonv"]
    assert [item["voice_id"] for item in payload["voice_cloning"]] == ["clone_mine"]
    assert find_minimax_voice(payload, "design_mine")["bucket"] == "voice_generation"
    assert find_minimax_voice(payload, "clone_other") is None
