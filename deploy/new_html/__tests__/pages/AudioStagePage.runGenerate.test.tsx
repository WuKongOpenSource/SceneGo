




















import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AudioStagePage } from '../../pages/AudioStagePage';
import type { DubbingCardProps } from '../../components/audio/DubbingCard';
import { getStoryboardItems } from '../../services/episodeDataService';
import { minimaxTTS } from '@runtime/audioGenerationService';
import { pollTtsTaskUntilDone, type TtsResult } from '../../services/ttsTaskPoller';
import { updateStoryboardItem } from '../../services/storyboardMutationService';
import { taskRegistry } from '../../services/taskRegistry';

const state = vi.hoisted(() => ({
  episode: {
    assets: [], characterVoices: [], audioTracks: [], projectId: 'project-1',
    episodeId: 'episode-1', selectedScriptId: 'script-1', script: null,
    isLoading: false, error: null, reload: vi.fn(), forceReloadSlices: vi.fn(),
  },
}));
vi.mock('../../contexts/EpisodeContext', () => ({ useEpisode: () => state.episode }));
vi.mock('../../services/episodeDataService', () => ({ getStoryboardItems: vi.fn(), syncStoryboardItems: vi.fn() }));
vi.mock('../../services/storyboardMutationService', () => ({ updateStoryboardItem: vi.fn() }));
vi.mock('@runtime/audioGenerationService', () => ({ minimaxTTS: vi.fn() }));
vi.mock('../../services/ttsTaskPoller', () => ({ pollTtsTaskUntilDone: vi.fn(), TtsTimeoutError: class extends Error {} }));
vi.mock('../../services/taskRegistry', () => ({ taskRegistry: { register: vi.fn(), complete: vi.fn(), fail: vi.fn() } }));
vi.mock('../../services/httpClient', () => ({ safeBrowserResourceUrl: (url: string) => url }));
vi.mock('../../admin/crmUI', () => ({ crmConfirm: vi.fn(), crmMessage: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('../../components/audio/VoiceSidebar', () => ({ VoiceSidebar: () => null }));
vi.mock('../../components/audio/MultiTrackTimeline', () => ({ MultiTrackTimeline: () => null }));
vi.mock('../../components/audio/MusicModal', () => ({ MusicModal: () => null }));
vi.mock('../../components/audio/MusicAssetSidebar', () => ({ MusicAssetSidebar: () => null }));
vi.mock('../../components/audio/DubbingCard', () => ({
  DubbingCard: (props: DubbingCardProps) => (
    <div>
      <span data-testid="clip-audio">{props.audioUrl}</span>
      {props.error && <span role="alert">{props.error}</span>}
      <button disabled={props.isGenerating} onClick={props.onGenerate}>生成单段配音</button>
    </div>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

const result: TtsResult = { audio_url: '/audio/new.mp3', duration_ms: 2350 };
const page = () => <MemoryRouter><AudioStagePage /></MemoryRouter>;
const generateButton = () => screen.getByRole('button', { name: '生成单段配音' });

async function openPage() {
  const view = render(page());
  await screen.findByRole('button', { name: '生成单段配音' });
  return view;
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  state.episode.episodeId = 'episode-1';
  state.episode.selectedScriptId = 'script-1';
  vi.mocked(getStoryboardItems).mockImplementation(async () => ({
    success: true, total: 1,
    items: [{
      item_id: 'shot-1', episode_id: state.episode.episodeId, sort_order: 1,
      audio_segments: [{ segmentId: 'clip-1', kind: 'speech', sequenceIndex: 0, speaker: '旁白', text: '新的台词', audioUrl: '/audio/old.mp3' }],
    }],
  }) as any);
  vi.mocked(minimaxTTS).mockResolvedValue({ task_id: 'task-1' } as any);
  vi.mocked(pollTtsTaskUntilDone).mockResolvedValue(result);
  vi.mocked(updateStoryboardItem).mockResolvedValue({ success: true } as any);
});
afterEach(cleanup);

describe('AudioStagePage individual generation', () => {
  it('submits and polls the same task, then completes only after saving its segment', async () => {
    const save = deferred<any>();
    vi.mocked(updateStoryboardItem).mockImplementation(() => save.promise);
    await openPage();
    fireEvent.click(generateButton());
    await waitFor(() => expect(updateStoryboardItem).toHaveBeenCalledTimes(1));

    expect(minimaxTTS).toHaveBeenCalledWith(expect.objectContaining({
      text: '新的台词', entity_type: 'storyboard_item', entity_id: 'shot-1',
      episode_id: 'episode-1', file_role: 'narration_audio:clip-1',
    }), expect.any(AbortSignal));
    const signal = vi.mocked(minimaxTTS).mock.calls[0][1];
    expect(pollTtsTaskUntilDone).toHaveBeenCalledWith('task-1', expect.objectContaining({ signal }));
    expect(taskRegistry.register).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'tts:clip-1', targetProjectId: 'project-1', episodeId: 'episode-1', targetItemId: 'shot-1',
    }));
    expect(updateStoryboardItem).toHaveBeenCalledWith('shot-1', expect.objectContaining({
      narration_audio_url: '/audio/new.mp3', audio_duration_ms: 2350,
      audio_segments: [expect.objectContaining({
        segmentId: 'clip-1', text: '新的台词', audioUrl: '/audio/new.mp3', durationMs: 2350,
      })],
    }));
    expect(taskRegistry.complete).not.toHaveBeenCalled();
    expect(generateButton()).toBeDisabled();

    await act(async () => save.resolve({ success: true }));
    await waitFor(() => expect(taskRegistry.complete).toHaveBeenCalledWith('tts:clip-1', {
      resultUrls: ['/audio/new.mp3'], progress: 1,
    }));
    expect(taskRegistry.fail).not.toHaveBeenCalled();
    expect(generateButton()).toBeEnabled();
    expect(screen.getByTestId('clip-audio')).toHaveTextContent('/audio/new.mp3');
  });

  it('reports polling failure without overwriting audio and releases the clip for retry', async () => {
    vi.mocked(pollTtsTaskUntilDone).mockRejectedValueOnce(new Error('Provider unavailable'));
    await openPage();
    fireEvent.click(generateButton());
    await waitFor(() => expect(taskRegistry.fail).toHaveBeenCalledWith('tts:clip-1', 'Provider unavailable'));
    expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable');
    expect(screen.getByTestId('clip-audio')).toHaveTextContent('/audio/old.mp3');
    expect(updateStoryboardItem).not.toHaveBeenCalled();
    expect(taskRegistry.complete).not.toHaveBeenCalled();
    expect(generateButton()).toBeEnabled();

    fireEvent.click(generateButton());
    await waitFor(() => expect(taskRegistry.complete).toHaveBeenCalledTimes(1));
    expect(minimaxTTS).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['episodeId', 'selectedScriptId'] as const)('aborts waiting when %s changes and never saves the cancelled result', async scope => {
    let signal: AbortSignal | undefined;
    vi.mocked(pollTtsTaskUntilDone).mockImplementationOnce((_task, options) => new Promise((_resolve, reject) => {
      signal = options?.signal;
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const view = await openPage();
    fireEvent.click(generateButton());
    await waitFor(() => expect(pollTtsTaskUntilDone).toHaveBeenCalledTimes(1));
    expect(signal?.aborted).toBe(false);

    state.episode[scope] = 'next-scope';
    view.rerender(page());
    await waitFor(() => expect(taskRegistry.fail).toHaveBeenCalledWith('tts:clip-1', '已取消'));
    expect(signal?.aborted).toBe(true);
    expect(updateStoryboardItem).not.toHaveBeenCalled();
    expect(taskRegistry.complete).not.toHaveBeenCalled();
    await waitFor(() => expect(generateButton()).toBeEnabled());

    fireEvent.click(generateButton());
    await waitFor(() => expect(taskRegistry.complete).toHaveBeenCalledTimes(1));
    expect(minimaxTTS).toHaveBeenCalledTimes(2);
    expect(vi.mocked(minimaxTTS).mock.calls[1][1]?.aborted).toBe(false);
  });
});
