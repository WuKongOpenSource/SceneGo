import { describe, expect, it } from 'vitest';
import {
  resolveBoundCharacterVoice,
  resolveEffectiveSpeaker,
  resolveVoiceGenerationSettings,
} from '../../utils/audioVoiceBinding';
import type { AudioClipInfo, CharacterVoice } from '../../types';

function makeVoice(characterName: string, voiceModelId: string): CharacterVoice {
  return {
    voiceId: `voice-${characterName}`,
    projectId: 'project-1',
    assetId: null,
    characterName,
    voiceProvider: 'minimax',
    voiceModelId,
    voiceName: `${characterName}音色`,
    voiceParams: { speed: 1.2, pitch: 1, emotion: 'happy' },
    sampleAudioUrl: null,
    createdAt: '2026-07-24T00:00:00Z',
    updatedAt: '2026-07-24T00:00:00Z',
  };
}

const clip: AudioClipInfo = {
  clipId: 'shot-1:speech:1',
  itemId: 'shot-1',
  sortOrder: 1,
  sequenceIndex: 0,
  type: 'dialogue',
  text: '你好',
  characterName: '小悟',
  audioUrl: null,
  durationMs: null,
  voiceId: null,
};

describe('audio voice binding', () => {
  it('uses the selected character binding instead of the original speaker binding', () => {
    const voices = new Map([
      ['小悟', makeVoice('小悟', 'voice-wukong')],
      ['小空', makeVoice('小空', 'voice-space')],
    ]);
    const speaker = resolveEffectiveSpeaker(clip, { speaker: '小空' });
    const voice = resolveBoundCharacterVoice(voices, speaker);
    const settings = resolveVoiceGenerationSettings(voice, {});

    expect(speaker).toBe('小空');
    expect(settings).toEqual({
      voiceId: 'voice-space',
      emotion: 'happy',
      speed: 1.2,
      pitch: 1,
    });
  });

  it('uses narrator binding and only falls back when no binding exists', () => {
    const narrator = makeVoice('旁白', 'voice-narrator');
    expect(resolveVoiceGenerationSettings(narrator, {}).voiceId).toBe('voice-narrator');
    expect(resolveVoiceGenerationSettings(undefined, {}).voiceId).toBe('presenter_male');
  });
});
