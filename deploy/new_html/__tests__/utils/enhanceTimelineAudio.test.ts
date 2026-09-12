import { describe, expect, it, vi } from 'vitest';
import { syncTimelineAudioPlayback } from '../../utils/enhanceTimelineAudio';

describe('enhanceTimelineAudio', () => {
  it('multiplies the selected volume by relative fade envelopes during playback', async () => {
    const audio = { currentTime: 0, paused: false, volume: 1, play: vi.fn(), pause: vi.fn() };
    const clips = [{ id: 'music', startTime: 5, duration: 10, sourceOffset: 20, volume: .4, fadeIn: 2, fadeOut: 4 }];
    for (const [time, volume] of [[5, 0], [6, .2], [8, .4], [13, .2]]) {
      await syncTimelineAudioPlayback({ clips, audioElements: new Map([['music', audio]]), currentTime: time, playing: true });
      expect(audio.volume).toBeCloseTo(volume);
    }
  });
  it('applies timeline volume and seeks an active clip to its aligned source position', async () => {
    const audio = {
      currentTime: 0,
      paused: true,
      volume: 1,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    };

    await syncTimelineAudioPlayback({
      clips: [{ id: 'voice_1', startTime: 5, duration: 4, sourceOffset: 1, volume: 0.4 }],
      audioElements: new Map([['voice_1', audio]]),
      currentTime: 6.5,
      playing: true,
    });

    expect(audio.currentTime).toBe(2.5);
    expect(audio.volume).toBe(0.4);
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it('pauses a disabled voice clip while allowing overlay tracks to keep playing', async () => {
    const voice = { currentTime: 0, paused: false, volume: 1, play: vi.fn(), pause: vi.fn() };
    const bgm = { currentTime: 0, paused: true, volume: 1, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() };

    await syncTimelineAudioPlayback({
      clips: [
        { id: 'voice', startTime: 0, duration: 5, enabled: false },
        { id: 'bgm', startTime: 0, duration: 5, enabled: true },
      ],
      audioElements: new Map([['voice', voice], ['bgm', bgm]]),
      currentTime: 1,
      playing: true,
    });

    expect(voice.pause).toHaveBeenCalledOnce();
    expect(voice.play).not.toHaveBeenCalled();
    expect(bgm.play).toHaveBeenCalledOnce();
  });
});
