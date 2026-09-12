import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EnhancePage } from '../../pages/EnhancePage';

const state = vi.hoisted(() => ({ items: [] as any[], writes: [] as any[], save: vi.fn(), episode: {
  projectId: 'p', episodeId: 'ep', selectedScriptId: '', isLoading: false, error: null,
  loadSlices: vi.fn(), forceReloadSlicesQuiet: vi.fn(), reload: vi.fn(),
  videoSegments: [{ segmentId: 'v', videoUrl: '/v.mp4', durationMs: 10000, sortOrder: 0 }],
  audioTracks: [{ trackId: 'm', trackType: 'bgm', audioUrl: '/m.mp3', name: '测试音乐', durationMs: 30000, generationParams: {} }],
} }));
vi.mock('../../contexts/EpisodeContext', () => ({ useEpisode: () => state.episode }));
vi.mock('../../services/scriptTimelineService', () => ({
  getTimelineTracks: async () => ({ tracks: [{ track_id: 't', track_name: '优化合成时间线', items: state.items }] }),
  updateTimelineTrack: (...args: any[]) => state.save(...args), createTimelineTrack: vi.fn(),
}));
vi.mock('../../services/entityFileService', () => ({ fetchEpisodeEnhanceFiles: async () => [], uploadEntityFile: vi.fn() }));
vi.mock('../../services/episodeDataService', () => ({ getStoryboardItems: async () => ({ success: true, items: [] }) }));
vi.mock('../../services/videoWorkflowService', () => ({ DEFAULT_COMPOSE_AUDIO_MODE: 'video_original',
  getComposeStatus: async () => ({ status: 'idle' }), startCompose: vi.fn(), preflightCompose: vi.fn(), updateVideoSegment: vi.fn() }));
vi.mock('../../services/httpClient', () => ({ secureApiUrl: (url: string) => url, apiFetch: vi.fn() }));
vi.mock('@runtime/clusterNodeService', () => ({ getPreferredGpuNodeId: () => '', fetchClusterNodes: async () => ({ nodes: [], message: '' }),
  isClusterNodeUsable: () => false, clusterNodePreferenceId: () => '', setPreferredGpuNodeId: vi.fn(), DEFAULT_GPU_NODE_NAME: 'node' }));
vi.mock('@runtime/videoTaskService', () => ({ submitInterpolateTaskQueued: vi.fn(), submitUpscaleTaskQueued: vi.fn(), submitVoiceTaskQueued: vi.fn() }));
vi.mock('@runtime/videoMediaService', () => ({ uploadAudio: vi.fn() }));
vi.mock('../../services/videoTaskPoller', () => ({ getKnownVideoTaskIds: () => [], startVideoPoll: vi.fn(), attachVideoPollCallbacks: vi.fn() }));
vi.mock('../../components/InlineCreditEstimate', () => ({ InlineCreditEstimate: () => null }));
vi.mock('../../components/SubtitleTranscriptionModal', () => ({ SubtitleTranscriptionModal: () => null }));
vi.mock('../../components/audio/MusicModal', () => ({ MusicModal: () => null }));
vi.mock('../../components/audio/SfxModal', () => ({ SfxModal: () => null }));

beforeEach(() => {
  state.items = [];
  state.writes = [];
  state.save.mockReset().mockImplementation(async (_id, data) => { state.items = data.items; state.writes.push(data.items); return { success: true }; });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

it('saves actual drag position and keyboard volume, and restores them on remount', async () => {
  const view = render(<EnhancePage />);
  const clip = await screen.findByTestId('enhance-audio-aud_track_m');
  fireEvent.mouseDown(clip, { clientX: 100 });
  fireEvent.mouseMove(document, { clientX: 820, shiftKey: true });
  fireEvent.mouseUp(document);
  await waitFor(() => expect(state.items.find(i => i.kind === 'audio')).toMatchObject({ startMs: 36000 }));
  const slider = screen.getByRole('slider', { name: '音频音量' });
  fireEvent.change(slider, { target: { value: '0.12' } });
  fireEvent.keyUp(slider, { key: 'ArrowLeft' });
  await waitFor(() => expect(state.items.find(i => i.kind === 'audio')).toMatchObject({ startMs: 36000, volume: 0.12 }));
  view.unmount();
  render(<EnhancePage />);
  const restored = await screen.findByTestId('enhance-audio-aud_track_m');
  expect(restored.style.left).toBe('720px');
  fireEvent.mouseDown(restored, { clientX: 820 });
  fireEvent.mouseUp(document);
  expect(screen.getByRole('slider', { name: '音频音量' })).toHaveValue('0.12');
});

it('serializes overlapping saves and flushes the latest edit when leaving immediately', async () => {
  let release!: () => void;
  state.save.mockImplementationOnce((_id, data) => new Promise<void>(resolve => {
    release = () => { state.items = data.items; state.writes.push(data.items); resolve(); };
  }));
  const view = render(<EnhancePage />);
  const clip = await screen.findByTestId('enhance-audio-aud_track_m');
  fireEvent.mouseDown(clip); fireEvent.mouseUp(document);
  const slider = screen.getByRole('slider', { name: '音频音量' });
  fireEvent.change(slider, { target: { value: '0.2' } });
  fireEvent.keyUp(slider, { key: 'ArrowLeft' });
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
  fireEvent.change(slider, { target: { value: '0' } });
  view.unmount();
  await act(async () => { release(); });
  await waitFor(() => expect(state.items.find(i => i.kind === 'audio')).toMatchObject({ volume: 0 }));
  expect(state.writes.map(items => items.find((i: any) => i.kind === 'audio').volume)).toEqual([0.2, 0]);
});
