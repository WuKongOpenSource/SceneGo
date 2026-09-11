import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoPage } from '../../components/VideoPage';
import { loadWorkspaceSession, saveWorkspaceSession, type WorkspaceSession } from '../../services/videoWorkspaceService';
import { importVideoResult, readUploadedVideoDuration, readVideoResultDuration } from '../../services/videoUploadService';
import { __resetVideoTaskPollerForTesting } from '../../services/videoTaskPoller';

vi.mock('../../hooks/useSeedanceCandidates', () => ({ useSeedanceCandidates: () => ({ candidates: [], isLoading: false }) }));
vi.mock('../../components/video/CapabilityVideoPanel', () => ({ CapabilityVideoPanel: () => null }));
vi.mock('@runtime/GpuNodeSelector', () => ({ GpuNodeSelector: () => null }));
vi.mock('../../services/videoWorkspaceService', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/videoWorkspaceService')>(),
  loadWorkspaceSession: vi.fn(), saveWorkspaceSession: vi.fn(),
}));
vi.mock('../../services/videoUploadService', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/videoUploadService')>(),
  readUploadedVideoDuration: vi.fn(), readVideoResultDuration: vi.fn(), importVideoResult: vi.fn(),
}));
vi.mock('../../services/episodeDataService', () => ({ getVideoSegments: vi.fn(async () => ({ segments: [] })) }));
vi.mock('../../services/videoVoiceReferenceService', () => ({
  getVideoVoiceReferences: vi.fn(async () => ({ references: [] })),
  createVideoVoiceReference: vi.fn(), extractVideoReferenceAudio: vi.fn(), normalizeVideoVoiceReference: vi.fn(),
}));
const fetchMock = vi.fn();
const emptySession: WorkspaceSession = { task_groups: [], uploaded_images: [], image_prompts: {}, tasks_status: {} };
const file = new File(['video'], 'outside.mp4', { type: 'video/mp4' });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('auth_token', 'test-token');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ success: true, tasks: [], models: [], balance: 100 }) });
  vi.mocked(loadWorkspaceSession).mockResolvedValue({ success: true, session: emptySession });
  vi.mocked(saveWorkspaceSession).mockResolvedValue({ success: true });
  vi.mocked(readUploadedVideoDuration).mockResolvedValue(12432);
  vi.mocked(readVideoResultDuration).mockResolvedValue(6123);
  vi.mocked(importVideoResult).mockResolvedValue({ segmentId: 'seg-upload', fileId: 'file-upload', fileUrl: '/api/files/file-upload', filename: file.name, durationMs: 12432 });
});
afterEach(() => { cleanup(); __resetVideoTaskPollerForTesting(); vi.unstubAllGlobals(); });

async function uploadToPage() {
  fireEvent.click(await screen.findByRole('button', { name: '上传外部视频' }));
  fireEvent.change(screen.getByLabelText('选择视频文件'), { target: { files: [file] } });
  await screen.findByText(/outside.mp4 ·/);
  fireEvent.click(screen.getByRole('button', { name: '上传并导入' }));
}

describe('VideoPage external video persistence', () => {
  it('does not overwrite an unreadable workspace with an empty snapshot', async () => {
    vi.mocked(loadWorkspaceSession).mockResolvedValue({ success: false, session: null, error: true });
    render(<VideoPage sessionScope="ep-1" />);
    await screen.findByText('工作区读取失败，已暂停保存以保护现有卡片，请刷新重试');
    await new Promise(resolve => setTimeout(resolve, 650));
    expect(saveWorkspaceSession).not.toHaveBeenCalled();
  });

  it('persists an intentionally emptied workspace instead of restoring its last card after reload', async () => {
    vi.mocked(loadWorkspaceSession).mockResolvedValue({ success: true, session: {
      ...emptySession, task_groups: [{ uuid: 'blank', ids: ['image'], model: 'Seedance15' }],
      uploaded_images: [{ id: 'image', url: '', filename: '', isPlaceholder: true, uploadTime: 0 }],
    } });
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<VideoPage sessionScope="ep-1" />);
    fireEvent.click(await screen.findByRole('button', { name: '清空' }));
    await waitFor(() => expect(vi.mocked(saveWorkspaceSession).mock.calls.at(-1)?.[0]).toMatchObject({
      task_groups: [], uploaded_images: [], image_prompts: {}, tasks_status: {},
    }));
  });

  it('submits a manual Seedance card only after a real video segment and both original frames are saved', async () => {
    vi.mocked(loadWorkspaceSession).mockResolvedValue({ success: true, session: {
      ...emptySession,
      task_groups: [{ uuid: 'manual-card', ids: ['blank-local-id'], model: 'Seedance15' }],
      uploaded_images: [{ id: 'blank-local-id', url: '/first.png', filename: '', uploadTime: 0 }],
      seedance_params: { 'manual-card': { sub_model: 'agent_plan', prompt: 'building a house', resolution: '720p', duration: 5, media_inputs: [
        { kind: 'image', url: '/first.png', role: 'first_frame' }, { kind: 'image', url: '/last.png', role: 'last_frame' },
      ] } },
    } });
    fetchMock.mockImplementation(async (url: string, options: any) => ({ ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }), json: async () =>
        options?.method === 'POST' && url.includes('/video-segments') ? { success: true, segment: { segment_id: 'seg-real' } }
          : options?.method === 'POST' && url.endsWith('/api/generate') ? { task_id: 'generated-task' }
          : { success: true, tasks: [], models: [], balance: 100 },
    }));
    render(<VideoPage sessionScope="ep-1" episodeId="ep-1" projectId="project-1" />);
    const generate = await screen.findByRole('button', { name: /^生成$/ });
    fireEvent.click(generate); fireEvent.click(generate);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith('/api/generate') && options?.method === 'POST')).toBe(true));
    const creates = fetchMock.mock.calls.filter(([url, options]) => String(url).includes('/video-segments') && options?.method === 'POST');
    expect(creates).toHaveLength(1);
    expect(JSON.parse(creates[0][1].body).storyboard_item_id).toBeNull();
    const submits = fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith('/api/generate') && options?.method === 'POST');
    expect(submits).toHaveLength(1);
    expect(JSON.parse(submits[0][1].body)).toMatchObject({ entity_id: 'seg-real', entity_type: 'video_segment', workspace_group_id: 'manual-card', sub_model: 'agent_plan',
      media_inputs: [{ kind: 'image', url: expect.stringContaining('/first.png'), role: 'first_frame' }, { kind: 'image', url: expect.stringContaining('/last.png'), role: 'last_frame' }] });
    const saved = vi.mocked(saveWorkspaceSession).mock.calls.find(([session]) => session.task_groups[0]?.videoSegmentId === 'seg-real')?.[0];
    expect(saved?.seedance_params?.['manual-card'].media_inputs).toHaveLength(2);
  });

  it('does not submit against a fabricated segment id when segment creation fails', async () => {
    vi.mocked(loadWorkspaceSession).mockResolvedValue({ success: true, session: {
      ...emptySession, task_groups: [{ uuid: 'manual', ids: ['blank-local'], model: 'Seedance15' }],
      uploaded_images: [{ id: 'blank-local', url: '/first.png', filename: '', uploadTime: 0 }],
    } });
    render(<VideoPage sessionScope="ep-1" episodeId="ep-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /^生成$/ }));
    await screen.findByText('视频记录保存失败，本次未提交生成，请稍后重试');
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith('/api/generate') && options?.method === 'POST')).toBe(false);
  });
  it.each(['HappyHorse', 'Seedance15'] as const)('fills a blank %s card from project originals and restores it without generating', async model => {
    const session: WorkspaceSession = {
      ...emptySession,
      task_groups: [{ uuid: 'blank-card', ids: ['blank-image'], model, duration: 5 }],
      uploaded_images: [{ id: 'blank-image', url: '', filename: '空卡片', isPlaceholder: true, uploadTime: 1 }],
      image_prompts: { 'blank-image': '保留我写的动作' },
      tasks_status: { 'blank-card': { state: 'done', result: '/old.mp4', videos: ['/old.mp4'] } },
    };
    vi.mocked(loadWorkspaceSession).mockResolvedValue({ success: true, session });
    const materialLibrary = { 角色: [{ id: 'asset-image', assetId: 'asset-1', fileId: 'file_original', type: 'image' as const,
      assetType: 'character' as const, name: '角色', url: '/api/files/file_original', thumbnail: '/thumb.jpg', source: 'asset', timestamp: 0 }] };
    const refresh = vi.fn(async () => {});
    const view = render(<VideoPage sessionScope="ep-1" episodeId="ep-1" projectId="project-1" materialLibrary={materialLibrary} onRefreshProjectMaterials={refresh} />);
    fireEvent.click(await screen.findByRole('button', { name: '项目素材' }));
    await screen.findByTitle('添加 角色');
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle('添加 角色'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '项目素材' })).not.toBeInTheDocument());
    const [saved, scope] = vi.mocked(saveWorkspaceSession).mock.calls[0];
    expect(scope).toBe('ep-1');
    expect(saved.task_groups).toEqual(session.task_groups);
    expect(saved.image_prompts).toEqual(session.image_prompts);
    expect(saved.tasks_status['blank-card'].videos).toEqual(['/old.mp4']);
    expect(saved.uploaded_images[0]).toMatchObject({ id: 'blank-image', url: '/api/files/file_original',
      storageUrl: '/api/files/file_original', fileId: 'file_original', isPlaceholder: false });
    if (model === 'Seedance15') {
      expect(saved.seedance_params?.['blank-card'].media_inputs).toContainEqual({ kind: 'image', role: 'first_frame', url: '/api/files/file_original' });
      expect(saved.seedance_params?.['blank-card'].prompt).toBe('保留我写的动作');
    } else {
      expect(saved.dashscope_params?.['blank-card'].media_inputs).toContainEqual({ kind: 'image', role: 'reference_image', url: '/api/files/file_original', file_id: 'file_original' });
    }
    view.unmount();
    vi.mocked(loadWorkspaceSession).mockResolvedValue({ success: true, session: saved });
    const restored = render(<VideoPage sessionScope="ep-1" episodeId="ep-1" projectId="project-1" materialLibrary={materialLibrary} />);
    await waitFor(() => expect(restored.container.querySelector('img[src*="/api/files/file_original"]')).not.toBeNull());
    expect(screen.queryByRole('button', { name: '项目素材' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, options]) => options?.method === 'POST' && /generate|tasks|upload/.test(String(url)))).toBe(false);
  });

  it('retries a failed project-material save without replacing card ids or duplicating media', async () => {
    vi.mocked(loadWorkspaceSession).mockResolvedValue({ success: true, session: {
      ...emptySession, task_groups: [{ uuid: 'blank', ids: ['image'], model: 'Seedance15' }],
      uploaded_images: [{ id: 'image', url: '', filename: '', isPlaceholder: true, uploadTime: 0 }],
    } });
    vi.mocked(saveWorkspaceSession).mockResolvedValueOnce({ success: false }).mockResolvedValue({ success: true });
    render(<VideoPage sessionScope="ep-1" materialLibrary={{ 角色: [{ id: 'asset', name: '角色', url: '/original.png', type: 'image', source: 'asset', timestamp: 0 }] }} />);
    fireEvent.click(await screen.findByRole('button', { name: '项目素材' }));
    fireEvent.click(await screen.findByTitle('添加 角色'));
    expect(await screen.findByRole('alert')).toHaveTextContent('工作区保存失败');
    fireEvent.click(screen.getByTitle('添加 角色'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '项目素材' })).not.toBeInTheDocument());
    const [saved] = vi.mocked(saveWorkspaceSession).mock.calls[1];
    expect(saved.task_groups[0].ids).toEqual(['image']);
    expect(saved.uploaded_images).toHaveLength(1);
    expect(saved.seedance_params?.blank.media_inputs).toEqual([{ kind: 'image', role: 'first_frame', url: '/original.png' }]);
  });

  it('fills an empty last frame without replacing the first frame', async () => {
    vi.mocked(loadWorkspaceSession).mockResolvedValue({ success: true, session: {
      ...emptySession, task_groups: [{ uuid: 'pair', ids: ['first', 'last'], model: 'Seedance15' }],
      uploaded_images: [
        { id: 'first', url: '/first.png', filename: 'first', uploadTime: 0 },
        { id: 'last', url: '', filename: '', isPlaceholder: true, uploadTime: 0 },
      ],
    } });
    render(<VideoPage sessionScope="ep-1" materialLibrary={{ 场景: [{ id: 'asset', name: '场景', url: '/last.png', type: 'image', source: 'asset', timestamp: 0 }] }} />);
    fireEvent.click(await screen.findByRole('button', { name: '项目素材' }));
    fireEvent.click(await screen.findByTitle('添加 场景'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '项目素材' })).not.toBeInTheDocument());
    const [saved] = vi.mocked(saveWorkspaceSession).mock.calls[0];
    expect(saved.uploaded_images[0].url).toBe('/first.png');
    expect(saved.seedance_params?.pair.media_inputs).toEqual([
      { kind: 'image', role: 'first_frame', url: '/first.png' },
      { kind: 'image', role: 'last_frame', url: '/last.png' },
    ]);
  });

  it('blocks a retired historical model even before capabilities have loaded', async () => {
    vi.mocked(loadWorkspaceSession).mockResolvedValue({ success: true, session: {
      ...emptySession,
      task_groups: [{ uuid: 'legacy-card', ids: ['sb_1'], model: 'Wan2' }],
      uploaded_images: [{ id: 'sb_1', url: '/image.png', filename: 'image.png', uploadTime: 0 }],
      tasks_status: {},
    } });
    render(<VideoPage sessionScope="ep-1" episodeId="ep-1" projectId="project-1" />);
    await screen.findByText('选择可用模型');
    const generate = await screen.findByRole('button', { name: /^生成$/ });
    expect(generate).toBeDisabled();
    expect(generate).toHaveAttribute('title', '该本地模型已停用，请手动选择可用模型');
    fireEvent.click(generate);
    expect(fetchMock.mock.calls.some(([url, options]) => (
      String(url).includes('/api/generate') && options?.method === 'POST'
    ))).toBe(false);
  });

  it.each([
    { state: 'pending', model: 'Seedance2Mini', subModel: 'mini' },
    { state: 'failed', model: 'Seedance2Fast', subModel: 'fast' },
  ] as const)('restores a completed $model result over a stale $state card without resubmission', async ({ state, model, subModel }) => {
    vi.mocked(loadWorkspaceSession).mockResolvedValue({ success: true, session: {
      ...emptySession,
      task_groups: [{ uuid: 'card-1', ids: ['sb_1'], model }],
      uploaded_images: [{ id: 'sb_1', url: '/image.png', filename: 'image.png', uploadTime: 0 }],
      tasks_status: { 'card-1': { state, taskId: 'accepted-video', error: state === 'failed' ? 'old timeout' : undefined, progress: 5, videos: ['/old.mp4'], result: '/old.mp4' } },
    } });
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => String(url).startsWith('/api/tasks?') ? {
        tasks: [{ task_id: 'accepted-video', task_type: 'seedance_multi', status: 'completed', created_at: '',
          data: { sub_model: subModel, episode_id: 'ep-1', entity_id: 'old-segment-without-storyboard-link' },
          result: { videos: [{ url: '/recovered.mp4' }] } }],
      } : { success: true, tasks: [], models: [], balance: 100, status: 'processing', progress: 5 },
    }));
    const view = render(<VideoPage sessionScope="ep-1" episodeId="ep-1" projectId="project-1" />);
    await waitFor(() => expect(view.container.querySelector('video[src*="/recovered.mp4"]')).not.toBeNull());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/task/accepted-video'))).toBe(false);
    expect(view.container.querySelector('video[src*="/old.mp4"]')).not.toBeNull();
    expect(screen.queryByText('处理中 5%')).not.toBeInTheDocument();
    expect(screen.queryByText('old timeout')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).includes('/tasks') && options?.method === 'POST')).toBe(false);
  });

  it('imports a real result, persists it under the episode and restores it after remount', async () => {
    const view = render(<VideoPage sessionScope="ep-1" episodeId="ep-1" projectId="project-1" />);
    await uploadToPage();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText(`外部上传 · ${file.name}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '视频抽帧' })).toBeInTheDocument();
    const [session, scope] = vi.mocked(saveWorkspaceSession).mock.calls[0];
    expect(scope).toBe('ep-1');
    expect(session.task_groups).toHaveLength(1);
    const group = session.task_groups[0];
    expect(group.videoSegmentId).toBe('seg-upload');
    expect(session.uploaded_images[0]).toMatchObject({ isPlaceholder: true, filename: 'outside.mp4' });
    expect(session.tasks_status[group.uuid]).toMatchObject({
      state: 'done', result: '/api/files/file-upload', videos: ['/api/files/file-upload'],
      uploadedVideos: { '/api/files/file-upload': { fileId: 'file-upload', durationMs: 12432 } },
    });
    expect(importVideoResult).toHaveBeenCalledWith(expect.objectContaining({ episodeId: 'ep-1', selectForEnhance: true, durationMs: 12432 }), expect.anything());
    view.unmount();
    vi.mocked(loadWorkspaceSession).mockResolvedValue({ success: true, session });
    render(<VideoPage sessionScope="ep-1" episodeId="ep-1" projectId="project-1" />);
    expect(await screen.findByText(`外部上传 · ${file.name}`)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).includes('/tasks') && options?.method === 'POST')).toBe(false);
  });

  it('reports workspace save failure and retries without adding a duplicate card or result', async () => {
    vi.mocked(saveWorkspaceSession).mockResolvedValueOnce({ success: false }).mockResolvedValue({ success: true });
    render(<VideoPage sessionScope="ep-1" episodeId="ep-1" projectId="project-1" />);
    await uploadToPage();
    await screen.findByText(/视频已保存，但工作区同步失败/);
    fireEvent.click(screen.getByRole('button', { name: '上传并导入' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const [session] = vi.mocked(saveWorkspaceSession).mock.calls[1];
    expect(session.task_groups).toHaveLength(1);
    expect(session.tasks_status[session.task_groups[0].uuid].videos).toHaveLength(1);
    expect(vi.mocked(importVideoResult).mock.calls[1][1]).toBe(vi.mocked(importVideoResult).mock.calls[0][1]);
  });

  it('does not publish a completed card when the upload service fails', async () => {
    vi.mocked(importVideoResult).mockRejectedValueOnce(new Error('文件太大'));
    render(<VideoPage sessionScope="ep-1" episodeId="ep-1" projectId="project-1" />);
    await uploadToPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('文件太大');
    expect(saveWorkspaceSession).not.toHaveBeenCalled();
    expect(screen.queryByText(`外部上传 · ${file.name}`)).not.toBeInTheDocument();
  });

  it('appends to an existing shot and switches between uploaded and generated videos with the correct duration', async () => {
    vi.mocked(loadWorkspaceSession).mockResolvedValue({ success: true, session: {
      ...emptySession,
      task_groups: [{ uuid: 'card-1', ids: ['sb_1'], model: 'HappyHorse', videoSegmentId: 'seg-upload' }],
      uploaded_images: [{ id: 'sb_1', storyboardItemId: 'sb_1', url: '/image.png', filename: 'image.png', uploadTime: 0 }],
      tasks_status: { 'card-1': { state: 'done', videos: ['/old.mp4'], result: '/old.mp4', videoModels: ['HappyHorse'] } },
    } });
    render(<VideoPage sessionScope="ep-1" episodeId="ep-1" projectId="project-1" />);
    fireEvent.click(await screen.findByTitle('上传外部视频到此镜头'));
    chooseFileForExisting();
    await screen.findByText(/outside.mp4 ·/);
    expect(screen.getByRole('checkbox', { name: '将此视频设为优化合成使用' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '上传并导入' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(importVideoResult).toHaveBeenCalledWith(expect.objectContaining({ storyboardItemId: 'sb_1', segmentId: 'seg-upload', selectForEnhance: false }), expect.anything());
    const [session] = vi.mocked(saveWorkspaceSession).mock.calls[0];
    expect(session.task_groups).toHaveLength(1);
    expect(session.tasks_status['card-1'].result).toBe('/old.mp4');
    expect(session.tasks_status['card-1'].videos).toEqual(['/old.mp4', '/api/files/file-upload']);
    fireEvent.click(screen.getByRole('button', { name: '设为美化' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/video-segments/seg-upload' && JSON.parse(init.body).duration_ms === 12432)).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: '设为美化' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '设为美化' }));
    await waitFor(() => expect(readVideoResultDuration).toHaveBeenCalledWith('/old.mp4'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/video-segments/seg-upload' && JSON.parse(init.body).duration_ms === 6123)).toBe(true));
    await waitFor(() => {
      expect(vi.mocked(saveWorkspaceSession).mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(vi.mocked(saveWorkspaceSession).mock.calls.at(-1)?.[0].tasks_status['card-1'].result).toBe('/old.mp4');
    });
  });

  it('finishes saving in the original episode when navigation unmounts the uploading page', async () => {
    let finish!: (value: any) => void;
    vi.mocked(importVideoResult).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(<VideoPage sessionScope="ep-1" episodeId="ep-1" projectId="project-1" />);
    await uploadToPage();
    expect(importVideoResult).toHaveBeenCalledOnce();
    view.unmount();
    render(<VideoPage sessionScope="ep-2" episodeId="ep-2" projectId="project-1" />);
    await screen.findByRole('button', { name: '上传外部视频' });
    await act(async () => finish({ segmentId: 'seg-upload', fileId: 'file-upload', fileUrl: '/api/files/file-upload', filename: file.name, durationMs: 12432 }));
    expect(saveWorkspaceSession).toHaveBeenCalledWith(expect.objectContaining({ task_groups: [expect.objectContaining({ videoSegmentId: 'seg-upload' })] }), 'ep-1');
    expect(screen.queryByText(`外部上传 · ${file.name}`)).not.toBeInTheDocument();
  });
});

function chooseFileForExisting() {
  fireEvent.change(screen.getByLabelText('选择视频文件'), { target: { files: [file] } });
}
