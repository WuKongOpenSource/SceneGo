import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AudioHistoryPicker } from '../../components/audio/AudioHistoryPicker';

const listMediaItems = vi.fn();
const useMediaItem = vi.fn();
const createAudioTrack = vi.fn();

vi.mock('../../services/mediaLibraryService', () => ({
  listMediaItems: (...args: unknown[]) => listMediaItems(...args),
  useMediaItem: (...args: unknown[]) => useMediaItem(...args),
}));
vi.mock('@runtime/audioGenerationService', () => ({
  createAudioTrack: (...args: unknown[]) => createAudioTrack(...args),
}));
vi.mock('../../services/httpClient', () => ({ safeBrowserResourceUrl: (value: string) => value }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AudioHistoryPicker', () => {
  it('adds a reusable history item to the current episode track', async () => {
    listMediaItems.mockResolvedValue({ items: [{
      library_item_id: 'library-1',
      file_id: 'file-1',
      file_url: '/storage/music.mp3',
      item_type: 'audio',
      title: '月球茶馆配乐',
      tags: ['bgm'],
      source: 'music_generation',
      description: '',
      duration_seconds: 65,
    }] });
    createAudioTrack.mockResolvedValue({ success: true });
    useMediaItem.mockResolvedValue({ success: true });
    const onCreated = vi.fn().mockResolvedValue(undefined);

    render(<AudioHistoryPicker episodeId="ep-1" projectId="project-1" kind="bgm" onCreated={onCreated} />);
    fireEvent.click(await screen.findByRole('button', { name: '添加到当前分集' }));

    await waitFor(() => expect(createAudioTrack).toHaveBeenCalledWith('ep-1', expect.objectContaining({
      track_type: 'bgm',
      audio_url: '/storage/music.mp3',
      duration_ms: 65_000,
    })));
    expect(onCreated).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '已添加' })).toBeDisabled();
  });
});
