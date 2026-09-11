import { apiJson, buildAuthHeaders, handleUnauthorized, secureApiUrl } from '../services/httpClient';
import { localConnectorUnavailable } from './runtimeUnavailable';

export interface UploadProgress {
  percent: number;
  loaded: number;
  total: number;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

export interface ProjectVideoTask {
  image_url?: string;
  scene?: string;
  storyboard_id?: string;
  video_prompt?: string;
  action_text?: string;
  dialogue?: string;
  resolved_bindings?: Array<{
    binding_id?: string;
    binding_version?: number;
    tag_key?: string;
    scope?: 'project' | 'shot';
    asset_id?: string | null;
    file_id?: string | null;
    file_url?: string | null;
    is_disabled?: boolean;
    locked?: boolean;
  }>;
  [key: string]: any;
}

function xhrUpload(url: string, formData: FormData, options: UploadOptions = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    const headers = buildAuthHeaders(undefined, { requireAuth: false, includeContentType: false });
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || !options.onProgress) return;
      options.onProgress({
        percent: Math.round((event.loaded / event.total) * 100),
        loaded: event.loaded,
        total: event.total,
      });
    };
    if (options.signal) options.signal.addEventListener('abort', () => xhr.abort());
    xhr.onload = () => {
      if (xhr.status === 401) {
        try {
          handleUnauthorized('uploadMedia');
        } catch (error) {
          reject(error);
        }
        return;
      }
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.detail || `上传失败 (${xhr.status})`));
      } catch {
        reject(new Error(`上传失败 (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    xhr.onabort = () => reject(new DOMException('上传已取消', 'AbortError'));
    xhr.ontimeout = () => reject(new Error('上传超时'));
    xhr.send(formData);
  });
}

async function withRetry<T>(operation: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error: any) {
      if (error?.name === 'AbortError') throw error;
      if (attempt < maxRetries && !error?.message?.includes('401')) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new Error('上传失败');
}

function ensureAuthenticated(): void {
  buildAuthHeaders(undefined, { includeContentType: false, authErrorMessage: '请先登录' });
}

export function secureMediaUrl(url: string, options: { absolute?: boolean } = {}): string {
  return secureApiUrl(url, { absolute: options.absolute, requireAuth: false });
}

export async function readVideoDurationSeconds(file: File, timeoutMs = 5_000): Promise<number | null> {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return null;
  let objectUrl: string;
  try {
    objectUrl = URL.createObjectURL(file);
  } catch {
    return null;
  }
  return new Promise(resolve => {
    const video = document.createElement('video');
    let settled = false;
    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      resolve(duration);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number(video.duration);
      finish(Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) / 1000 : null);
    };
    video.onerror = () => finish(null);
    video.src = objectUrl;
  });
}

export async function uploadImage(file: File, options?: UploadOptions): Promise<{
  file_id: string;
  filename: string;
  server_filename?: string;
  storage_url: string;
  url: string;
  path: string;
  size: number;
}> {
  ensureAuthenticated();
  const formData = new FormData();
  formData.append('file', file);
  const result = await withRetry(() => xhrUpload('/api/upload', formData, options));
  result.url = result.storage_url || result.url;
  return result;
}

export async function uploadImageToComfyUI(): Promise<never> {
  return localConnectorUnavailable();
}

export async function uploadAudio(file: File, startTime = 0, duration = 5, options?: UploadOptions): Promise<{
  file_id?: string;
  filename: string;
  url: string;
}> {
  ensureAuthenticated();
  const formData = new FormData();
  formData.append('file', file);
  const result = await withRetry(() => xhrUpload('/api/upload', formData, options));
  result.url = result.storage_url || result.url;
  // Keep reference audio on the application server. The source edition must
  // not silently depend on a private local-node trimming implementation.
  void startTime;
  void duration;
  return result;
}

export async function uploadVideoFile(file: File, options?: UploadOptions): Promise<{
  filename: string;
  storage_url: string;
  url: string;
  path: string;
  size: number;
  duration_seconds: number | null;
}> {
  const durationPromise = readVideoDurationSeconds(file);
  const uploaded = await uploadImage(file, options);
  return { ...uploaded, duration_seconds: await durationPromise };
}

export async function getProjectVideoTasks(projectId: string): Promise<ProjectVideoTask[]> {
  const data = await apiJson<{ project?: { video_tasks?: ProjectVideoTask[] } }>(
    `/api/projects/${projectId}/workspace`,
    { method: 'GET' },
    'getProjectVideoTasks',
  );
  return Array.isArray(data.project?.video_tasks) ? data.project.video_tasks : [];
}

export async function clearProjectVideoTasks(projectId: string): Promise<void> {
  await apiJson(`/api/projects/${projectId}/clear-video-tasks`, { method: 'POST' }, 'clearProjectVideoTasks');
}

export async function cropVideo(videoFilename: string, startTime: number, endTime: number): Promise<{
  filename: string;
  url: string;
}> {
  return apiJson('/api/video/crop', {
    method: 'POST',
    body: JSON.stringify({ video_filename: videoFilename, start_time: startTime, end_time: endTime }),
  }, 'cropVideo');
}

export async function reuploadVideo(): Promise<never> {
  return localConnectorUnavailable();
}
