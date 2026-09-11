import { describe, expect, it } from 'vitest';
import type { AudioTrack } from '../../types';
import {
  moveAudioTrackTimeline,
  patchAudioTrackTimeline,
  resolveAudioTrackTimeline,
  trimAudioTrackTimelineEnd,
  trimAudioTrackTimelineStart,
} from '../../utils/audioTrackTimeline';

function track(
  trackType: AudioTrack['trackType'],
  generationParams: Record<string, any> = {},
): AudioTrack {
  return {
    trackId: `${trackType}_1`,
    episodeId: 'ep_1',
    trackType,
    name: trackType,
    audioUrl: '/storage/audio/test.mp3',
    durationMs: 10_000,
    startItemId: null,
    endItemId: null,
    generationParams,
  };
}

describe('audioTrackTimeline', () => {
  it('resolves legacy tracks with sensible BGM and SFX defaults', () => {
    expect(resolveAudioTrackTimeline(track('bgm'), 20_000)).toEqual({
      startMs: 0,
      sourceOffsetMs: 0,
      durationMs: 10_000,
      fadeInMs: 0,
      fadeOutMs: 0,
      volume: 0.35,
    });
    expect(resolveAudioTrackTimeline(track('sfx_global'), 20_000).volume).toBe(1);
  });

  it('moves clips within the episode boundary', () => {
    const edit = resolveAudioTrackTimeline(track('sfx_global'), 20_000);
    expect(moveAudioTrackTimeline(edit, 6_500, 20_000).startMs).toBe(6_500);
    expect(moveAudioTrackTimeline(edit, 50_000, 20_000).startMs).toBe(10_000);
  });

  it('trims the start while preserving the timeline end', () => {
    const edit = {
      ...resolveAudioTrackTimeline(track('sfx_global'), 20_000),
      startMs: 2_000,
      sourceOffsetMs: 1_000,
      durationMs: 8_000,
    };
    const trimmed = trimAudioTrackTimelineStart(edit, 1_500, 10_000);
    expect(trimmed.startMs).toBe(3_500);
    expect(trimmed.sourceOffsetMs).toBe(2_500);
    expect(trimmed.durationMs).toBe(6_500);
  });

  it('trims the end without exceeding source or episode duration', () => {
    const edit = {
      ...resolveAudioTrackTimeline(track('sfx_global'), 20_000),
      startMs: 8_000,
      sourceOffsetMs: 2_000,
      durationMs: 4_000,
    };
    expect(trimAudioTrackTimelineEnd(edit, 20_000, 10_000, 20_000).durationMs).toBe(8_000);
  });

  it('persists BGM fades and zero volume but strips fades from SFX', () => {
    const bgm = track('bgm', { source: 'upload' });
    const bgmPatch = patchAudioTrackTimeline(bgm, {
      startMs: 1_000,
      sourceOffsetMs: 500,
      durationMs: 6_000,
      fadeInMs: 800,
      fadeOutMs: 1_200,
      volume: 0,
    });
    expect(bgmPatch).toEqual({
      source: 'upload',
      timeline: {
        startMs: 1_000,
        sourceOffsetMs: 500,
        durationMs: 6_000,
        fadeInMs: 800,
        fadeOutMs: 1_200,
        volume: 0,
      },
    });
    const resolved = resolveAudioTrackTimeline(
      { ...bgm, generationParams: bgmPatch },
      20_000,
    );
    expect(resolved.volume).toBe(0);

    const sfxPatch = patchAudioTrackTimeline(track('sfx_global'), {
      ...resolved,
      fadeInMs: 800,
      fadeOutMs: 1_200,
    });
    expect((sfxPatch.timeline as Record<string, number>).fadeInMs).toBe(0);
    expect((sfxPatch.timeline as Record<string, number>).fadeOutMs).toBe(0);
  });
});
