import pytest

from services.audio_access_service import (
    AudioObjectAccessDenied,
    require_audio_episode_access,
    require_audio_track_access,
    require_character_voice_access,
)
from services.project_access_service import ProjectAccessDenied


class EpisodeDAO:
    @staticmethod
    async def get_project_id(episode_id):
        return "project_1" if episode_id == "ep_1" else None


class AudioTrackDAO:
    @staticmethod
    async def get_by_id(track_id):
        return {"track_id": track_id, "episode_id": "ep_1"} if track_id == "track_1" else None


class CharacterVoiceDAO:
    @staticmethod
    async def get_by_id(voice_id):
        return {"voice_id": voice_id, "project_id": "project_1"} if voice_id == "voice_1" else None


async def allow(project_id, identity, role):
    assert project_id == "project_1"
    assert identity == "user_1"
    return {"role": role}


async def deny(*_args, **_kwargs):
    raise ProjectAccessDenied("denied")


async def test_audio_episode_access_resolves_project_and_role():
    assert await require_audio_episode_access(
        "ep_1",
        "user_1",
        "readonly",
        episode_dao=EpisodeDAO,
        project_access_checker=allow,
    ) == "project_1"


async def test_audio_track_access_requires_project_membership():
    row = await require_audio_track_access(
        "track_1",
        "user_1",
        "member",
        audio_track_dao=AudioTrackDAO,
        episode_dao=EpisodeDAO,
        project_access_checker=allow,
    )
    assert row["episode_id"] == "ep_1"

    with pytest.raises(AudioObjectAccessDenied):
        await require_audio_track_access(
            "track_1",
            "user_2",
            "member",
            audio_track_dao=AudioTrackDAO,
            episode_dao=EpisodeDAO,
            project_access_checker=deny,
        )


async def test_character_voice_access_requires_project_membership():
    row = await require_character_voice_access(
        "voice_1",
        "user_1",
        "member",
        character_voice_dao=CharacterVoiceDAO,
        project_access_checker=allow,
    )
    assert row["project_id"] == "project_1"

    with pytest.raises(AudioObjectAccessDenied):
        await require_character_voice_access(
            "missing",
            "user_1",
            "member",
            character_voice_dao=CharacterVoiceDAO,
            project_access_checker=allow,
        )
