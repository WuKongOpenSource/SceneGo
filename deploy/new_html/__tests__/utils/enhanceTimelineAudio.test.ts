import { describe, expect, it, vi } from 'vitest';
import { syncTimelineAudioPlayback } from '../../utils/enhanceTimelineAudio';

describe('enhanceTimelineAudio', () => {
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
});
