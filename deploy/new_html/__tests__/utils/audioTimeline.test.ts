import { describe, expect, it } from 'vitest';
import type { AudioClipInfo, StoryboardItemDB } from '../../types';
import {
  extractStoryboardDurationLabel,
  resolveAudioTimelineTotalMs,
  resolveShotDurationMs,
  resolveStoryboardPlannedDurationMs,
} from '../../utils/audioTimeline';

function makeItem(patch: Partial<StoryboardItemDB> = {}): StoryboardItemDB {
  return {
    itemId: 'shot-1',
    episodeId: 'episode-1',
    sortOrder: 1,
    sceneHeading: '',
    actionText: '',
    dialogue: '',
    cameraMovement: '',
    imagePrompt: '',
    videoPrompt: '',
    generatedImageUrl: null,
    boundAssets: [],
    configuredReferences: [],
    status: 'draft',
    dialogueAudioUrl: null,
    narrationAudioUrl: null,
    sfxAudioUrl: null,
    audioDurationMs: null,
    plannedDurationMs: null,
    ...patch,
  };
}

function makeClip(patch: Partial<AudioClipInfo> = {}): AudioClipInfo {
  return {
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
    ...patch,
  };
}

const clipKey = (clip: AudioClipInfo) => `${clip.itemId}_${clip.type}_${clip.characterName}`;

describe('audioTimeline', () => {
  it.each([[2500, 3000], [3000, 3000], [3200, 3700]])('keeps action time after %i ms of speech, including after refresh', (durationMs, expected) => {
    const item = makeItem({ plannedDurationMs: 3000 });
    const clip = makeClip({ durationMs, audioUrl: '/speech.wav' });
    expect(resolveShotDurationMs({ item, clips: [clip], localAudio: {}, clipKeyFn: clipKey })).toBe(expected);
    expect(resolveShotDurationMs({ item, clips: [{ ...clip, audioUrl: null }], localAudio: { [clipKey(clip)]: { url: '/speech.wav', durationMs } }, clipKeyFn: clipKey })).toBe(expected);
  });
  it('uses the persisted upstream duration for a silent shot', () => {
    const item = makeItem({ plannedDurationMs: 7200 });
    expect(resolveShotDurationMs({ item, clips: [], localAudio: {}, clipKeyFn: clipKey })).toBe(7200);
  });

  it('recovers an upstream duration from the original storyboard block', () => {
    const item = makeItem({
      videoScriptBlock: '镜头1\n时长（秒）：6.5\n画面描述：角色走入房间。',
    });
    expect(extractStoryboardDurationLabel(item)).toBe('6.5秒');
    expect(resolveStoryboardPlannedDurationMs(item)).toBe(6500);
  });

  it('keeps the upstream duration before dialogue audio is generated', () => {
    const item = makeItem({ plannedDurationMs: 5000, dialogue: '小悟：你好' });
    const clip = makeClip();
    expect(resolveShotDurationMs({ item, clips: [clip], localAudio: {}, clipKeyFn: clipKey })).toBe(5000);
  });

  it('adds ordered dubbing and silent-action durations for the shot', () => {
    const item = makeItem({ plannedDurationMs: 4000, dialogue: '多人对白' });
    item.audioSegments = [
      { segmentId: 'speech-1', kind: 'speech', sequenceIndex: 0, speaker: '小悟', text: '第一句' },
      { segmentId: 'silence-1', kind: 'silence', sequenceIndex: 1, durationMs: 2000, label: '走到门口' },
      { segmentId: 'speech-2', kind: 'speech', sequenceIndex: 2, speaker: '小空', text: '第二句' },
    ];
    const first = makeClip({ clipId: 'speech-1', characterName: '小悟', sequenceIndex: 0 });
    const second = makeClip({
      clipId: 'speech-2',
      characterName: '小空',
      type: 'narration',
      sequenceIndex: 2,
    });
    const localAudio = {
      [clipKey(first)]: { url: '/audio/first.mp3', durationMs: 5200 },
      [clipKey(second)]: { url: '/audio/second.mp3', durationMs: 8100 },
    };

    expect(resolveShotDurationMs({
      item,
      clips: [first, second],
      localAudio,
      clipKeyFn: clipKey,
    })).toBe(15800);
  });

  it('includes silent and dubbed shots in the total video duration', () => {
    const silent = makeItem({ itemId: 'shot-1', plannedDurationMs: 3000 });
    const dubbed = makeItem({ itemId: 'shot-2', plannedDurationMs: 4000, dialogue: '小悟：你好' });
    const clip = makeClip({
      itemId: 'shot-2',
      audioUrl: '/audio/dialogue.mp3',
      durationMs: 6500,
    });

    expect(resolveAudioTimelineTotalMs(
      [silent, dubbed],
      [clip],
      {},
      clipKey,
    )).toBe(10000);
  });
});
