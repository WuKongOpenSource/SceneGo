import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAudioTrack } = vi.hoisted(() => ({
  createAudioTrack: vi.fn(),
}));

vi.mock('@runtime/audioGenerationService', () => ({
  createAudioTrack,
}));

import { AudioClipReferenceModal } from '../../components/audio/AudioClipReferenceModal';

describe('AudioClipReferenceModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAudioTrack.mockResolvedValue({ success: true });
  });

  it('references a generated dubbing clip without regenerating or uploading it', async () => {
    const onCreated = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <AudioClipReferenceModal
        episodeId="ep_1"
        targetTrackType="bgm"
        clips={[{
          clipId: 'clip_1',
          itemId: 'shot_1',
          sortOrder: 1,
          sequenceIndex: 0,
          type: 'dialogue',
          text: '你好，欢迎回来。',
          characterName: '小明',
          audioUrl: '/storage/audio/clip_1.mp3',
          durationMs: 2_500,
          voiceId: 'voice_1',
        }]}
        localAudio={{}}
        clipKeyFn={clip => clip.clipId}
        onCreated={onCreated}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('radio'));
    fireEvent.click(screen.getByRole('button', { name: '引用到 BGM' }));

    await waitFor(() => {
      expect(createAudioTrack).toHaveBeenCalledWith('ep_1', expect.objectContaining({
        track_type: 'bgm',
        audio_url: '/storage/audio/clip_1.mp3',
        duration_ms: 2_500,
        start_item_id: 'shot_1',
        generation_params: expect.objectContaining({
          source: 'dubbing_reference',
          source_clip_id: 'clip_1',
        }),
      }));
    });
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
