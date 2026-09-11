import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { AudioStagePage } from '../../pages/AudioStagePage';
import type { DubbingCardProps } from '../../components/audio/DubbingCard';
import type { StoryboardAudioSegment } from '../../types';
import { getStoryboardItems } from '../../services/episodeDataService';
import { minimaxTTS } from '@runtime/audioGenerationService';
import { pollTtsTaskUntilDone } from '../../services/ttsTaskPoller';
import { updateStoryboardItem } from '../../services/storyboardMutationService';
import { crmConfirm, crmMessage } from '../../admin/crmUI';
import { taskRegistry } from '../../services/taskRegistry';

const state = vi.hoisted(() => ({
  episode: {
    assets: [], characterVoices: [], audioTracks: [], projectId: 'project-1',
    episodeId: 'episode-1', selectedScriptId: 'script-1', script: null,
    isLoading: false, error: null, reload: vi.fn(), loadSlices: vi.fn(), forceReloadSlicesQuiet: vi.fn(),
  } as any,
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
      <span data-testid={`audio-${props.clipKey}`}>{props.audioUrl}</span>
      {props.error && <span role="alert">{props.error}</span>}
      <button disabled={props.isGenerating} onClick={props.onGenerate}>单段 {props.clipKey}</button>
    </div>
  ),
}));

function speech(id: string, audioUrl: string | null = null): StoryboardAudioSegment {
  return { segmentId: id, kind: 'speech', sequenceIndex: 0, speaker: '旁白', text: `台词 ${id}`, audioUrl };
}

function loadClips(segments: StoryboardAudioSegment[]) {
  vi.mocked(getStoryboardItems).mockResolvedValue({
    success: true, total: 1,
    items: [{ item_id: 'shot-1', episode_id: 'episode-1', sort_order: 1, audio_segments: segments }],
  } as any);
}

async function openPage() {
  const view = render(<MemoryRouter><AudioStagePage /></MemoryRouter>);
  await screen.findByRole('heading', { name: '声音工作台' });
  return view;
}

const batchButton = () => screen.getByRole('button', { name: /全部生成|全部重新生成|批量处理中/ });
async function waitForBatchDone() {
  await waitFor(() => expect(batchButton()).toBeEnabled());
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  state.episode.episodeId = 'episode-1';
  state.episode.selectedScriptId = 'script-1';
  state.episode.characterVoices = [];
  loadClips([speech('clip-1'), speech('clip-2')]);
  vi.mocked(crmConfirm).mockResolvedValue(true);
  vi.mocked(updateStoryboardItem).mockResolvedValue({ success: true } as any);
  let sequence = 0;
  vi.mocked(minimaxTTS).mockImplementation(async () => ({ task_id: `task-${++sequence}` } as any));
  vi.mocked(pollTtsTaskUntilDone).mockImplementation(async taskId => ({ audio_url: `/audio/${taskId}.mp3`, duration_ms: 2000 } as any));
});
afterEach(cleanup);

describe('AudioStagePage batch generation', () => {
  it('generates every clip again after the first batch and persists stable segment identities', async () => {
    await openPage();
    fireEvent.click(batchButton());
    await waitFor(() => expect(taskRegistry.complete).toHaveBeenCalledTimes(2));
    await waitForBatchDone();
    expect(crmConfirm).not.toHaveBeenCalled();
    expect(batchButton()).toHaveTextContent('全部重新生成');
    fireEvent.click(batchButton());
    await waitFor(() => expect(taskRegistry.complete).toHaveBeenCalledTimes(4));
    await waitForBatchDone();
    expect(crmConfirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('创作点数') }));
    expect(minimaxTTS).toHaveBeenCalledTimes(4);
    const patch = vi.mocked(updateStoryboardItem).mock.calls.at(-1)![1] as any;
    expect(patch.audio_segments.map((segment: StoryboardAudioSegment) => [segment.segmentId, segment.audioUrl])).toEqual([
      ['clip-1', '/audio/task-3.mp3'], ['clip-2', '/audio/task-4.mp3'],
    ]);
  });

  it('includes existing audio alongside missing audio after confirmation', async () => {
    loadClips([speech('clip-1', '/audio/old.mp3'), speech('clip-2')]);
    await openPage();
    fireEvent.click(batchButton());
    await waitFor(() => expect(taskRegistry.complete).toHaveBeenCalledTimes(2));
    expect(crmConfirm).toHaveBeenCalledTimes(1);
    expect(minimaxTTS).toHaveBeenCalledTimes(2);
  });

  it('does not submit or replace existing audio when regeneration is cancelled', async () => {
    loadClips([speech('clip-1', '/audio/old.mp3')]);
    vi.mocked(crmConfirm).mockResolvedValue(false);
    await openPage();
    fireEvent.click(batchButton());
    await waitFor(() => expect(crmConfirm).toHaveBeenCalledTimes(1));
    await waitForBatchDone();
    expect(minimaxTTS).not.toHaveBeenCalled();
    expect(updateStoryboardItem).not.toHaveBeenCalled();
    expect(screen.getByTestId('audio-clip-1')).toHaveTextContent('/audio/old.mp3');
  });

  it('locks the batch before the confirmation resolves to prevent duplicate submission', async () => {
    loadClips([speech('clip-1', '/audio/old.mp3')]);
    let confirm!: (answer: boolean) => void;
    vi.mocked(crmConfirm).mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
    await openPage();
    fireEvent.click(batchButton());
    fireEvent.click(batchButton());
    expect(crmConfirm).toHaveBeenCalledTimes(1);
    await act(async () => confirm(true));
    await waitFor(() => expect(taskRegistry.complete).toHaveBeenCalledTimes(1));
    expect(minimaxTTS).toHaveBeenCalledTimes(1);
  });

  it('preserves failed audio and continues the batch, then allows another attempt', async () => {
    loadClips([speech('clip-1', '/audio/old.mp3'), speech('clip-2')]);
    vi.mocked(pollTtsTaskUntilDone).mockRejectedValueOnce(new Error('Provider unavailable'));
    await openPage();
    fireEvent.click(batchButton());
    await waitFor(() => expect(taskRegistry.complete).toHaveBeenCalledTimes(1));
    await waitForBatchDone();
    expect(taskRegistry.fail).toHaveBeenCalledWith('tts:clip-1', expect.stringContaining('Provider unavailable'));
    expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable');
    expect(screen.getByTestId('audio-clip-1')).toHaveTextContent('/audio/old.mp3');
    fireEvent.click(batchButton());
    await waitFor(() => expect(taskRegistry.complete).toHaveBeenCalledTimes(3));
    await waitForBatchDone();
    expect(minimaxTTS).toHaveBeenCalledTimes(4);
  });

  it('uses the current voice and persisted text settings for regeneration', async () => {
    loadClips([speech('clip-1', '/audio/old.mp3')]);
    state.episode.characterVoices = [{ characterName: '旁白', voiceModelId: 'new-voice', voiceParams: { speed: 1.2 } }];
    sessionStorage.setItem('ostory:page-state:v1:AudioStagePage:localOverrides:episode-1', JSON.stringify({
      'clip-1': { text: '修改后的台词', pitch: 2 },
    }));
    await openPage();
    fireEvent.click(batchButton());
    await waitFor(() => expect(taskRegistry.complete).toHaveBeenCalledTimes(1));
    expect(minimaxTTS).toHaveBeenCalledWith(expect.objectContaining({ text: '修改后的台词', voice_id: 'new-voice', speed: 1.2, pitch: 2 }), expect.any(AbortSignal));
  });

  it('aborts waiting on unmount and does not submit the remaining batch', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(pollTtsTaskUntilDone).mockImplementation((_id, opts) => new Promise((_resolve, reject) => {
      signal = opts!.signal;
      signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const view = await openPage();
    fireEvent.click(batchButton());
    await waitFor(() => expect(pollTtsTaskUntilDone).toHaveBeenCalledTimes(1));
    await act(async () => view.unmount());
    expect(signal?.aborted).toBe(true);
    expect(minimaxTTS).toHaveBeenCalledTimes(1);
  });

  it('does not start an old batch after switching episodes during confirmation', async () => {
    loadClips([speech('clip-1', '/audio/old.mp3')]);
    let confirm!: (answer: boolean) => void;
    vi.mocked(crmConfirm).mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
    const view = await openPage();
    fireEvent.click(batchButton());
    expect(crmConfirm).toHaveBeenCalledTimes(1);
    state.episode.episodeId = 'episode-2';
    view.rerender(<MemoryRouter><AudioStagePage /></MemoryRouter>);
    await screen.findByRole('heading', { name: '声音工作台' });
    await act(async () => confirm(true));
    expect(minimaxTTS).not.toHaveBeenCalled();
    expect(batchButton()).toBeEnabled();
  });

  it('skips a clip already generating individually without aborting or submitting it twice', async () => {
    let finish!: (value: any) => void;
    vi.mocked(pollTtsTaskUntilDone).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: '单段 clip-1' }));
    await waitFor(() => expect(pollTtsTaskUntilDone).toHaveBeenCalledTimes(1));
    fireEvent.click(batchButton());
    await waitFor(() => expect(taskRegistry.complete).toHaveBeenCalledTimes(1));
    expect(minimaxTTS).toHaveBeenCalledTimes(2);
    expect(vi.mocked(minimaxTTS).mock.calls[0][1]?.aborted).toBe(false);
    await act(async () => finish({ audio_url: '/audio/individual.mp3', duration_ms: 2000 }));
    expect(taskRegistry.complete).toHaveBeenCalledTimes(2);
    expect(minimaxTTS).toHaveBeenCalledTimes(2);
  });

  it('explains an empty batch instead of silently returning', async () => {
    loadClips([speech('clip-1')]);
    sessionStorage.setItem('ostory:page-state:v1:AudioStagePage:localOverrides:episode-1', JSON.stringify({
      'clip-1': { text: '   ' },
    }));
    await openPage();
    fireEvent.click(batchButton());
    expect(crmMessage.warning).toHaveBeenCalledWith(expect.stringContaining('当前没有可生成的配音'));
    expect(minimaxTTS).not.toHaveBeenCalled();
    expect(batchButton()).toBeEnabled();
  });
});
