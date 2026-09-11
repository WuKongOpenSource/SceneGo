import { uploadEntityFile, linkEntityFile } from './entityFileService';
import { getVideoSegments } from './episodeDataService';
import { createVideoSegment, updateVideoSegment } from './videoWorkflowService';
import type { TaskStatus } from './videoTaskTypes';
import { normalizeVideoResultKey } from '../utils/videoResultPresentation';

export const VIDEO_UPLOAD_ACCEPT = 'video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov';
export const VIDEO_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;
const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};

export function validateVideoUpload(file: File): void {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!VIDEO_MIME_BY_EXTENSION[extension] || (file.type && !file.type.startsWith('video/'))) {
    throw new Error('请选择 MP4、MOV、WebM 或 M4V 视频文件');
  }
  if (!file.size) throw new Error('视频文件为空，请重新选择');
  if (file.size > VIDEO_UPLOAD_MAX_BYTES) throw new Error('视频不能超过 1 GB；服务器可能设置更小的上传限制');
}

function readVideoDuration(source: File | string, signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const durationMs = Math.round(video.duration * 1000);
      const width = video.videoWidth;
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      if (typeof source !== 'string') URL.revokeObjectURL(url);
      if (error) reject(error);
      else if (!Number.isFinite(durationMs) || durationMs <= 0 || !width) {
        reject(new Error('无法读取有效的视频时长，请转为 H.264 编码的 MP4 后重试'));
      } else resolve(durationMs);
    };
    const abort = () => finish(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('读取视频超时，请检查文件或转为 MP4 后重试')), 15000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => finish();
    video.onerror = () => finish(new Error('浏览器无法读取此视频，请转为 H.264 编码的 MP4 后重试'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else video.src = url;
  });
}

export function readUploadedVideoDuration(file: File, signal?: AbortSignal): Promise<number> {
  validateVideoUpload(file);
  return readVideoDuration(file, signal);
}

export function readVideoResultDuration(url: string): Promise<number> {
  return readVideoDuration(url);
}

export interface VideoImportDraft {
  uploadedFile?: { fileId: string; fileUrl: string };
  segmentId?: string;
  linked?: boolean;
}

export interface VideoImportOptions {
  episodeId: string;
  workspaceGroupId: string;
  storyboardItemId?: string;
  segmentId?: string;
  sortOrder: number;
  file: File;
  durationMs: number;
  selectForEnhance: boolean;
}

export async function importVideoResult(options: VideoImportOptions, draft: VideoImportDraft) {
  validateVideoUpload(options.file);
  if (!options.episodeId) throw new Error('请先进入一个分集后再上传视频');
  if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) throw new Error('视频时长无效');
  if (!draft.uploadedFile) {
    const extension = options.file.name.split('.').pop()!.toLowerCase();
    const file = options.file.type ? options.file : new File([options.file], options.file.name, {
      type: VIDEO_MIME_BY_EXTENSION[extension],
    });
    draft.uploadedFile = await uploadEntityFile(file, 'episode', options.episodeId, 'video', options.episodeId);
  }
  if (!draft.segmentId) {
    const response = await getVideoSegments(options.episodeId);
    const existing = (response.segments || []).find((segment: any) => {
      const id = segment.segment_id ?? segment.segmentId;
      const itemId = segment.storyboard_item_id ?? segment.storyboardItemId;
      const params = segment.input_params ?? segment.inputParams;
      if (options.segmentId) return id === options.segmentId;
      return (options.storyboardItemId && itemId === options.storyboardItemId)
        || params?.workspace_group_id === options.workspaceGroupId;
    });
    if (options.segmentId && !existing) throw new Error('目标视频片段已失效，请刷新后重试');
    if (existing) draft.segmentId = existing.segment_id ?? existing.segmentId;
    else {
      const created = await createVideoSegment(options.episodeId, {
        storyboard_item_id: options.storyboardItemId || null,
        sort_order: options.sortOrder,
        generation_mode: 'upload',
        model: 'upload',
        input_params: { workspace_group_id: options.workspaceGroupId },
      });
      draft.segmentId = created?.segment?.segment_id ?? created?.segment?.segmentId;
    }
    if (!draft.segmentId) throw new Error('保存视频片段失败，请重试');
  }
  if (!draft.linked) {
    await linkEntityFile(draft.uploadedFile.fileId, 'video_segment', draft.segmentId, 'video', false);
    draft.linked = true;
  }
  if (options.selectForEnhance) {
    await updateVideoSegment(draft.segmentId, {
      video_url: draft.uploadedFile.fileUrl,
      duration_ms: options.durationMs,
      status: 'completed',
      model: 'upload',
    });
  }
  return { ...draft.uploadedFile, segmentId: draft.segmentId, durationMs: options.durationMs, filename: options.file.name };
}

export function appendUploadedVideo(
  status: TaskStatus | undefined,
  video: { fileUrl: string; fileId: string; filename: string; durationMs: number },
  selectForEnhance: boolean,
): TaskStatus {
  const current = status || {};
  const videos = current.videos || [];
  const key = String(normalizeVideoResultKey(video.fileUrl));
  const exists = videos.some(url => normalizeVideoResultKey(url) === key);
  return {
    ...current,
    state: 'done', progress: 100, error: undefined, isExpired: false,
    ...(selectForEnhance ? { result: video.fileUrl, keepResult: true, isUpscaled: false } : {}),
    videos: exists ? videos : [...videos, video.fileUrl],
    videoModels: exists ? current.videoModels : [...videos.map((_, i) => current.videoModels?.[i]), undefined],
    videoGenerateTimes: exists ? current.videoGenerateTimes : [...videos.map((_, i) => current.videoGenerateTimes?.[i] || 0), 0],
    uploadedVideos: { ...current.uploadedVideos, [key]: {
      fileId: video.fileId, filename: video.filename, durationMs: video.durationMs,
    } },
  };
}
