import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  state.episode.videoSegments = [{ segmentId: 'v', videoUrl: '/v.mp4', durationMs: 10000, sortOrder: 0 }];
  state.episode.audioTracks[0].trackType = 'bgm';
  state.writes = [];
  state.save.mockReset().mockImplementation(async (_id, data) => { state.items = data.items; state.writes.push(data.items); return { success: true }; });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(3);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function openSeekEditor() {
  const view = render(<EnhancePage />);
  await screen.findByTestId('enhance-audio-aud_track_m');
  const viewport = screen.getByTestId('enhance-timeline-viewport');
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 800 } as DOMRect);
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 800 });
  return { ...view, viewport, head: screen.getByTestId('enhance-timeline-playhead') };
}

it.each(['timeline-ruler', 'track-video', 'track-voice', 'track-bgm', 'track-sfx', 'track-subtitles', 'timeline-seek-surface'])(
  'seeks on %s and stays fixed after mouseup without changing timeline data', async target => {
    const { head } = await openSeekEditor();
    const surface = screen.getByTestId(`enhance-${target}`);
    fireEvent.mouseDown(surface, { button: 0, buttons: 1, clientX: 180 });
    expect(head.style.left).toBe('80px');
    fireEvent.mouseUp(window, { button: 0, clientX: 180 });
    fireEvent.click(surface, { clientX: 180 });
    fireEvent.mouseMove(window, { clientX: 500, buttons: 0 });
    fireEvent.mouseMove(window, { clientX: 550, buttons: 1 });
    expect(head.style.left).toBe('80px');
    expect(screen.getByTitle('保存时间线（Ctrl+S）')).toHaveTextContent('已保存');
    expect(state.save).not.toHaveBeenCalled();
  },
);

it('uses the scrolled viewport and current zoom even when clicking a ruler label', async () => {
  const { head, viewport } = await openSeekEditor();
  fireEvent.click(screen.getByTitle('缩放到适合窗口'));
  expect(screen.getByText('76px/s')).toBeInTheDocument();
  viewport.scrollLeft = 120;
  const label = screen.getByTestId('enhance-timeline-ruler').querySelector('span')!;
  fireEvent.mouseDown(label, { button: 0, buttons: 1, clientX: 360 });
  fireEvent.mouseUp(window, { button: 0, clientX: 360 });
  expect(head.style.left).toBe('380px');
  expect(screen.getByTitle('时:分:秒:帧（30 FPS）')).toHaveTextContent('00:00:05:00');
});

it('finishes a scrub at the release coordinate and clamps both timeline edges', async () => {
  const { head } = await openSeekEditor();
  const ruler = screen.getByTestId('enhance-timeline-ruler');
  fireEvent.mouseDown(ruler, { button: 0, buttons: 1, clientX: 120 });
  fireEvent.mouseMove(window, { buttons: 1, clientX: 200 });
  fireEvent.mouseUp(window, { button: 0, clientX: 260 });
  expect(head.style.left).toBe('160px');
  fireEvent.mouseMove(window, { buttons: 0, clientX: 800 });
  expect(head.style.left).toBe('160px');
  fireEvent.mouseDown(ruler, { button: 0, clientX: -100 });
  expect(head.style.left).toBe('0px');
  fireEvent.mouseUp(window, { button: 0, clientX: 1000 });
  expect(head.style.left).toBe('200px');
});

it.each(['blur', 'released-buttons'])('ends an interrupted scrub on %s', async reason => {
  const { head } = await openSeekEditor();
  fireEvent.mouseDown(screen.getByTestId('enhance-track-sfx'), { button: 0, buttons: 1, clientX: 180 });
  fireEvent.mouseMove(window, { buttons: 1, clientX: 200 });
  if (reason === 'blur') fireEvent.blur(window);
  else fireEvent.mouseMove(window, { buttons: 0, clientX: 400 });
  fireEvent.mouseMove(window, { buttons: 1, clientX: 600 });
  fireEvent.mouseUp(window, { button: 0, clientX: 600 });
  expect(head.style.left).toBe('80px');
});

it('pauses playback when positioning the playhead and leaves it stopped', async () => {
  const view = await openSeekEditor();
  vi.useFakeTimers();
  fireEvent.click(screen.getByTitle('播放'));
  expect(screen.getByTitle('暂停')).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByTestId('enhance-track-subtitles'), { button: 0, buttons: 1, clientX: 180 });
  fireEvent.mouseUp(window, { button: 0, clientX: 180 });
  expect(screen.getByTitle('播放')).toBeInTheDocument();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(1000); });
  expect(view.head.style.left).toBe('80px');
  view.unmount();
});

it.each(['cut', 'fade', 'black'])('keeps playing across a %s transition after the old play rejects', async transition => {
  state.episode.videoSegments = [
    { segmentId: 'v', videoUrl: '/v.mp4', durationMs: 1000, sortOrder: 0 },
    { segmentId: 'v2', videoUrl: '/v2.mp4', durationMs: 3000, sortOrder: 1 },
  ];
  state.items = [
    { kind: 'video', sourceId: 'v', clipId: 'v', durationMs: 1000, transitionAfter: transition, transitionDurationMs: 500 },
    { kind: 'video', sourceId: 'v2', clipId: 'v2', durationMs: 3000 },
  ];
  const view = await openSeekEditor();
  const firstVideo = screen.getByLabelText('当前时间线视频预览');
  let reject!: (error: unknown) => void;
  vi.spyOn(firstVideo as HTMLVideoElement, 'play').mockImplementation(() => new Promise<void>((_, rej) => { reject = rej; }));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  fireEvent.click(screen.getByTitle('播放'));
  await act(async () => { vi.advanceTimersByTime(1100); });
  if (transition === 'black') {
    expect(screen.getByLabelText('黑幕转场预览')).toBeInTheDocument();
    expect(screen.getByTitle('暂停')).toBeInTheDocument();
  }
  await act(async () => { reject(new DOMException('element replaced', 'AbortError')); });
  await act(async () => { vi.advanceTimersByTime(600); });
  expect(screen.getByLabelText('当前时间线视频预览')).toHaveAttribute('src', '/v2.mp4');
  expect(screen.getByTitle('暂停')).toBeInTheDocument();
  expect(parseFloat(view.head.style.left)).toBeGreaterThan(30);
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle('暂停'));
  const position = view.head.style.left;
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(view.head.style.left).toBe(position);
  view.unmount();
});

it('waits for slow video data without switching to paused or skipping timeline content', async () => {
  const view = await openSeekEditor();
  const video = screen.getByLabelText('当前时间线视频预览') as HTMLVideoElement;
  const audio = document.querySelector('audio')!;
  const pauseAudio = vi.spyOn(audio, 'pause');
  const ready = vi.spyOn(video, 'readyState', 'get').mockReturnValue(1);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  fireEvent.click(screen.getByTitle('播放'));
  fireEvent.waiting(video);
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(view.head.style.left).toBe('0px');
  expect(screen.getByTitle('暂停')).toBeInTheDocument();
  expect(screen.getByText('视频缓冲中，就绪后自动继续')).toBeInTheDocument();
  expect(pauseAudio).toHaveBeenCalled();
  ready.mockReturnValue(3); fireEvent.canPlay(video);
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(parseFloat(view.head.style.left)).toBeCloseTo(10);
  expect(screen.queryByText('视频缓冲中，就绪后自动继续')).not.toBeInTheDocument();
  view.unmount();
});

it('does not seek for right-click, track controls, media dragging or trimming', async () => {
  const { head } = await openSeekEditor();
  fireEvent.mouseDown(screen.getByTestId('enhance-timeline-ruler'), { button: 2, clientX: 300 });
  fireEvent.mouseUp(window, { button: 2, clientX: 300 });
  fireEvent.click(screen.getByTitle('锁定音乐轨'));
  fireEvent.click(screen.getByTitle('解锁音乐轨'));
  const clip = screen.getByTestId('enhance-audio-aud_track_m');
  fireEvent.mouseDown(clip, { button: 0, clientX: 100 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 820, shiftKey: true });
  fireEvent.mouseUp(document, { button: 0, clientX: 820 });
  expect(head.style.left).toBe('0px');
  expect(clip.style.left).toBe('720px');
  fireEvent.mouseDown(clip.querySelector('[title="拖动裁剪出点"]')!, { button: 0, clientX: 1320 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 1300 });
  fireEvent.mouseUp(document, { button: 0, clientX: 1300 });
  expect(head.style.left).toBe('0px');
  expect(clip.style.width).toBe('180px');
  await waitFor(() => expect(state.items.find(i => i.kind === 'audio')).toMatchObject({ startMs: 36000, durationMs: 9000 }));
});

it('removes seek listeners and pending frames when leaving the editor', async () => {
  const view = await openSeekEditor();
  const remove = vi.spyOn(window, 'removeEventListener');
  const cancel = vi.spyOn(window, 'cancelAnimationFrame');
  fireEvent.mouseDown(screen.getByTestId('enhance-timeline-ruler'), { button: 0, buttons: 1, clientX: 200 });
  fireEvent.mouseMove(window, { buttons: 1, clientX: 400 });
  view.unmount();
  expect(remove).toHaveBeenCalledWith('mousemove', expect.any(Function));
  expect(remove).toHaveBeenCalledWith('mouseup', expect.any(Function));
  expect(remove).toHaveBeenCalledWith('blur', expect.any(Function));
  expect(cancel).toHaveBeenCalled();
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

it('saves and restores independent sound-effect fades', async () => {
  state.episode.audioTracks[0].trackType = 'sfx_global';
  const view = render(<EnhancePage />);
  fireEvent.mouseDown(await screen.findByTestId('enhance-audio-aud_track_m')); fireEvent.mouseUp(document);
  const fadeIn = screen.getByRole('spinbutton', { name: /开头渐入/ });
  fireEvent.change(fadeIn, { target: { value: '2' } }); fireEvent.blur(fadeIn);
  const fadeOut = screen.getByRole('spinbutton', { name: /末尾渐出/ });
  fireEvent.change(fadeOut, { target: { value: '3' } }); fireEvent.blur(fadeOut);
  await waitFor(() => expect(state.items.find(i => i.kind === 'audio')).toMatchObject({ fadeInMs: 2000, fadeOutMs: 3000 }));
  view.unmount(); render(<EnhancePage />);
  fireEvent.mouseDown(await screen.findByTestId('enhance-audio-aud_track_m')); fireEvent.mouseUp(document);
  expect(screen.getByRole('spinbutton', { name: /开头渐入/ })).toHaveValue(2);
  expect(screen.getByRole('spinbutton', { name: /末尾渐出/ })).toHaveValue(3);
});

it('inserts an independent black clip and saves its editable duration', async () => {
  render(<EnhancePage />);
  await screen.findByTestId('enhance-audio-aud_track_m');
  fireEvent.click(screen.getByRole('button', { name: '插入黑幕' }));
  const duration = screen.getByRole('spinbutton', { name: /黑幕时长/ });
  fireEvent.change(duration, { target: { value: '' } });
  fireEvent.change(duration, { target: { value: '2.5' } }); fireEvent.blur(duration);
  await waitFor(() => expect(state.items.find(i => i.kind === 'black')).toMatchObject({ durationMs: 2500 }));
  fireEvent.click(screen.getByRole('button', { name: '删除黑幕' }));
  await waitFor(() => expect(screen.queryByText('黑幕片段')).not.toBeInTheDocument());
});
