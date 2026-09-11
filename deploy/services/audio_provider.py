
import os
from typing import Dict, Any, Optional

AUDIO_UPLOAD_DIR = os.getenv("AUDIO_UPLOAD_DIR", "persistent_storage/audio")
MINIMAX_DEFAULT_VOICE = "presenter_male"
MINIMAX_LEGACY_VOICE_ALIASES = {
    "narrator": MINIMAX_DEFAULT_VOICE,
    "male_young": "male-qn-qingse",
    "female_young": "female-shaonv",
    "elder": "audiobook_male_2",
    "child": "cute_boy",
}


class AudioProvider:


    async def generate_speech(
        self, text: str, persona: str = 'narrator', emotion: str = 'neutral',
        **kwargs
    ) -> Dict[str, Any]:
        raise NotImplementedError("Subclass must implement generate_speech")

    async def generate_sfx(self, description: str, **kwargs) -> Dict[str, Any]:
        raise NotImplementedError("Subclass must implement generate_sfx")

    async def generate_music(
        self, description: str, duration_ms: Optional[int] = None, **kwargs
    ) -> Dict[str, Any]:
        raise NotImplementedError("Subclass must implement generate_music")


class MinimaxAudioProvider(AudioProvider):





    def __init__(self):
        pass

    @staticmethod
    def _client():
        from external_api.audio.minimax_audio import get_minimax_audio_client
        return get_minimax_audio_client()

    async def generate_speech(
        self, text: str, persona: str = 'narrator', emotion: str = 'neutral',
        **kwargs
    ) -> Dict[str, Any]:
        requested_voice = str(kwargs.get('voice_id') or persona or '').strip()
        voice_id = MINIMAX_LEGACY_VOICE_ALIASES.get(
            requested_voice,
            requested_voice or MINIMAX_DEFAULT_VOICE,
        )

        speed = kwargs.get('speed', 1.0)
        pitch = kwargs.get('pitch', 0)

        return await self._client().tts_sync(
            text=text,
            voice_id=voice_id,
            speed=speed,
            pitch=pitch,
            emotion=emotion,
        )

    async def generate_sfx(self, description: str, **kwargs) -> Dict[str, Any]:


        result = await self._client().music_generate(
            prompt=description,
            is_instrumental=True,
            model=kwargs.get('model'),
            refer_voice=kwargs.get('refer_voice', ''),
            refer_instrumental=kwargs.get('refer_instrumental', ''),
        )
        return {
            "audio_url": result.get("audio_url", ""),
            "duration_ms": result.get("duration_ms", 0),
        }

    async def generate_music(
        self, description: str, duration_ms: Optional[int] = None, **kwargs
    ) -> Dict[str, Any]:
        lyrics = kwargs.get('lyrics', '')
        refer_voice = kwargs.get('refer_voice', '')
        refer_instrumental = kwargs.get('refer_instrumental', '')
        result = await self._client().music_generate(
            lyrics=lyrics,
            prompt=kwargs.get('prompt', description),
            model=kwargs.get('model'),
            is_instrumental=kwargs.get('is_instrumental', not bool(lyrics)),
            lyrics_optimizer=kwargs.get('lyrics_optimizer', False),
            refer_voice=refer_voice,
            refer_instrumental=refer_instrumental,
        )
        return {
            "audio_url": result.get("audio_url", ""),
            "duration_ms": result.get("duration_ms", 0),
        }


def get_audio_provider(provider_name: str = 'minimax') -> AudioProvider:

    providers = {
        'minimax': MinimaxAudioProvider,
    }
    cls = providers.get(provider_name)
    if not cls:
        raise ValueError(f"Unknown audio provider: {provider_name}")
    return cls()
