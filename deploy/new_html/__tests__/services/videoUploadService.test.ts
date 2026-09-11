import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendUploadedVideo, importVideoResult, readUploadedVideoDuration, readVideoResultDuration, validateVideoUpload, VIDEO_UPLOAD_MAX_BYTES, type VideoImportDraft } from '../../services/videoUploadService';
import { uploadEntityFile, linkEntityFile } from '../../services/entityFileService';
import { getVideoSegments } from '../../services/episodeDataService';
import { createVideoSegment, updateVideoSegment } from '../../services/videoWorkflowService';
import { mergeTaskStatusHistories } from '../../utils/videoTaskMerge';
import { buildEnhanceSourceClips } from '../../utils/enhanceSourceClips';

vi.mock('../../services/entityFileService', () => ({ uploadEntityFile: vi.fn(), linkEntityFile: vi.fn() }));
vi.mock('../../services/episodeDataService', () => ({ getVideoSegments: vi.fn() }));
vi.mock('../../services/videoWorkflowService', () => ({ createVideoSegment: vi.fn(), updateVideoSegment: vi.fn() }));

const file = new File(['video'], 'external.mp4', { type: 'video/mp4' });
const options = { file, episodeId: 'ep-1', workspaceGroupId: 'card-1', sortOrder: 2, durationMs: 12432, selectForEnhance: true };
const uploaded = { fileId: 'file-1', fileUrl: '/api/files/file-1' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(uploadEntityFile).mockResolvedValue(uploaded);
  vi.mocked(getVideoSegments).mockResolvedValue({ segments: [] });
  vi.mocked(createVideoSegment).mockResolvedValue({ segment: { segment_id: 'seg-1' } });
  vi.mocked(linkEntityFile).mockResolvedValue({} as any);
  vi.mocked(updateVideoSegment).mockResolvedValue({ success: true });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('external video result import', () => {
  it('uploads with episode ownership and creates a registered standalone segment with its actual duration', async () => {
    const result = await importVideoResult(options, {});
    expect(uploadEntityFile).toHaveBeenCalledWith(file, 'episode', 'ep-1', 'video', 'ep-1');
    expect(createVideoSegment).toHaveBeenCalledWith('ep-1', {
      storyboard_item_id: null, sort_order: 2, generation_mode: 'upload', model: 'upload', input_params: { workspace_group_id: 'card-1' },
    });
    expect(linkEntityFile).toHaveBeenCalledWith('file-1', 'video_segment', 'seg-1', 'video', false);
    expect(updateVideoSegment).toHaveBeenCalledWith('seg-1', { video_url: uploaded.fileUrl, duration_ms: 12432, model: 'upload', status: 'completed' });
    expect(result).toMatchObject({ ...uploaded, segmentId: 'seg-1', filename: 'external.mp4', durationMs: 12432 });
    const clips = buildEnhanceSourceClips([{ segmentId: result.segmentId, sortOrder: 2, videoUrl: result.fileUrl, durationMs: result.durationMs } as any], [], []);
    expect(clips[0]).toMatchObject({ id: 'seg-1', url: uploaded.fileUrl, duration: 12.432 });
  });

  it('adds a candidate to an existing shot without replacing its selected video', async () => {
    vi.mocked(getVideoSegments).mockResolvedValue({ segments: [{ segment_id: 'existing', storyboard_item_id: 'sb-1', video_url: '/old.mp4' }] });
    await importVideoResult({ ...options, storyboardItemId: 'sb-1', selectForEnhance: false }, {});
    expect(createVideoSegment).not.toHaveBeenCalled();
    expect(linkEntityFile).toHaveBeenCalledWith('file-1', 'video_segment', 'existing', 'video', false);
    expect(updateVideoSegment).not.toHaveBeenCalled();
  });

  it('recovers a standalone segment by its workspace group and does not create another', async () => {
    vi.mocked(getVideoSegments).mockResolvedValue({ segments: [{ segmentId: 'existing', inputParams: { workspace_group_id: 'card-1' } }] });
    await importVideoResult(options, {});
    expect(createVideoSegment).not.toHaveBeenCalled();
    expect(updateVideoSegment).toHaveBeenCalledWith('existing', expect.anything());
  });

  it('retries a failed segment update without uploading, creating or linking twice', async () => {
    const draft: VideoImportDraft = {};
    vi.mocked(updateVideoSegment).mockRejectedValueOnce(new Error('保存失败'));
    await expect(importVideoResult(options, draft)).rejects.toThrow('保存失败');
    await importVideoResult(options, draft);
    expect(uploadEntityFile).toHaveBeenCalledOnce();
    expect(createVideoSegment).toHaveBeenCalledOnce();
    expect(linkEntityFile).toHaveBeenCalledOnce();
    expect(updateVideoSegment).toHaveBeenCalledTimes(2);
  });

  it('does not create a segment after rejected upload and does not hide access errors', async () => {
    vi.mocked(uploadEntityFile).mockRejectedValueOnce(new Error('文件太大'));
    await expect(importVideoResult(options, {})).rejects.toThrow('文件太大');
    expect(createVideoSegment).not.toHaveBeenCalled();
    vi.mocked(getVideoSegments).mockRejectedValueOnce(new Error('权限不足'));
    await expect(importVideoResult(options, {})).rejects.toThrow('权限不足');
    expect(createVideoSegment).not.toHaveBeenCalled();
    expect(updateVideoSegment).not.toHaveBeenCalled();
  });

  it('rejects a stale target segment rather than silently attaching to a new segment', async () => {
    await expect(importVideoResult({ ...options, segmentId: 'deleted' }, {})).rejects.toThrow('目标视频片段已失效');
    expect(createVideoSegment).not.toHaveBeenCalled();
  });

  it('normalizes missing browser MIME and validates scope, format, size and duration before writes', async () => {
    await importVideoResult({ ...options, file: new File(['video'], 'external.MOV') }, {});
    expect(vi.mocked(uploadEntityFile).mock.calls[0][0].type).toBe('video/quicktime');
    expect(() => validateVideoUpload(new File([], 'empty.mp4'))).toThrow('为空');
    expect(() => validateVideoUpload(new File(['x'], 'fake.exe', { type: 'video/mp4' }))).toThrow('请选择');
    expect(() => validateVideoUpload(new File(['x'], 'fake.mp4', { type: 'text/html' }))).toThrow('请选择');
    expect(() => validateVideoUpload({ name: 'big.mp4', size: VIDEO_UPLOAD_MAX_BYTES + 1, type: 'video/mp4' } as File)).toThrow('1 GB');
    await expect(importVideoResult({ ...options, episodeId: '' }, {})).rejects.toThrow('分集');
    await expect(importVideoResult({ ...options, durationMs: NaN }, {})).rejects.toThrow('时长');
    expect(uploadEntityFile).toHaveBeenCalledOnce();
  });

  it('preserves history, labels and selection through retries, URL normalization and merging', () => {
    const old = { state: 'failed' as const, result: '/old.mp4', videos: ['/old.mp4'], videoModels: ['MiniMaxH3' as const], error: 'old error' };
    const result = { ...uploaded, filename: file.name, durationMs: 12432 };
    const next = appendUploadedVideo(old, result, false);
    expect(next.result).toBe('/old.mp4');
    expect(next.videos).toEqual(['/old.mp4', uploaded.fileUrl]);
    expect(next.videoModels).toEqual(['MiniMaxH3', undefined]);
    expect(next.error).toBeUndefined();
    expect(appendUploadedVideo(next, { ...result, fileUrl: 'https://example.test/api/files/file-1?token=x' }, true).videos).toHaveLength(2);
    expect(mergeTaskStatusHistories([old, next])?.uploadedVideos?.[uploaded.fileUrl]).toEqual({ fileId: 'file-1', filename: file.name, durationMs: 12432 });
  });
});

describe('uploaded video metadata lifecycle', () => {
  function mockVideo(duration = 12.432) {
    const video = { duration, videoWidth: 1920, onloadedmetadata: null as null | (() => void), onerror: null as null | (() => void), load: vi.fn(), removeAttribute: vi.fn(), src: '' };
    vi.spyOn(document, 'createElement').mockReturnValue(video as any);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:upload') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    return video;
  }

  it('reads milliseconds and releases the object URL and video decoder', async () => {
    const video = mockVideo();
    const promise = readUploadedVideoDuration(file);
    video.onloadedmetadata!();
    await expect(promise).resolves.toBe(12432);
    expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(video.load).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:upload');
  });
  it('rejects unsupported or invalid media with actionable errors', async () => {
    const video = mockVideo(Infinity);
    const promise = readUploadedVideoDuration(file);
    video.onloadedmetadata!();
    await expect(promise).rejects.toThrow('有效的视频时长');
  });
  it('measures an existing result when switching away from an uploaded clip without retaining the uploaded duration', async () => {
    const video = mockVideo(5.21);
    const promise = readVideoResultDuration('/api/files/existing-result');
    expect(video.src).toBe('/api/files/existing-result');
    video.onloadedmetadata!();
    await expect(promise).resolves.toBe(5210);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
  it('aborts metadata work on file changes and cleans up timers', async () => {
    vi.useFakeTimers();
    mockVideo();
    const controller = new AbortController();
    const promise = readUploadedVideoDuration(file, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it('times out metadata loading and releases resources', async () => {
    vi.useFakeTimers();
    mockVideo();
    const promise = readUploadedVideoDuration(file);
    const assertion = expect(promise).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
});
