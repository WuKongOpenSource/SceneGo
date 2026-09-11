import type { AudioClipInfo, CharacterVoice, ClipOverride } from '../types';

const MINIMAX_DEFAULT_VOICE = 'presenter_male';

const LEGACY_VOICE_ALIAS: Record<string, string> = {
  narrator: 'presenter_male',
  male_young: 'male-qn-qingse',
  female_young: 'female-shaonv',
  elder: 'audiobook_male_2',
  child: 'cute_boy',
};

export function resolveEffectiveSpeaker(
  clip: Pick<AudioClipInfo, 'characterName'>,
  override?: Pick<ClipOverride, 'speaker'>,
): string {
  return (override?.speaker || clip.characterName || '旁白').trim() || '旁白';
}

export function resolveBoundCharacterVoice(
  voiceMap: Map<string, CharacterVoice>,
  speaker: string,
): CharacterVoice | undefined {
  return voiceMap.get(speaker.trim());
}

export function resolveMinimaxVoiceId(modelId?: string | null): string {
  const raw = (modelId || '').trim();
  if (!raw) return MINIMAX_DEFAULT_VOICE;
  return LEGACY_VOICE_ALIAS[raw] || raw;
}

export function resolveVoiceGenerationSettings(
  voice: CharacterVoice | undefined,
  override: ClipOverride,
): {
  voiceId: string;
  emotion: string | undefined;
  speed: number;
  pitch: number;
} {
  const voiceParams = (voice?.voiceParams || {}) as Record<string, any>;
  const setting = (voiceParams.setting || voiceParams) as Record<string, any>;
  return {
    voiceId: resolveMinimaxVoiceId(voice?.voiceModelId),
    emotion: override.emotion ?? setting.emotion,
    speed: override.speed ?? setting.speed ?? 1.0,
    pitch: override.pitch ?? setting.pitch ?? 0,
  };
}
