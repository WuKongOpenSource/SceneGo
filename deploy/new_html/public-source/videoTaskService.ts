import { apiFetch } from '../services/httpClient';
import {
  getMiniMaxVideoParamsError,
  getModelDisplayName,
  inferDashScopeTaskType,
  inferSeedanceTaskType,
  isComfyUIModel,
  isSeedanceVideoModel,
  markMiniMaxHailuoHiddenToday,
  normalizeMiniMaxVideoParams,
  normalizeSeedanceMediaForSubmission,
  normalizeSeedanceOutputResolution,
  getSeedanceOutputError,
  getSeedanceDurationError,
  seedanceModelForSubModel,
  seedanceSubModelForVideoModel,
  supportsSeedancePortraitReference,
  type DashScopeVideoParams,
  type SeedanceMediaInput,
  type SeedanceParams,
  type ShotType,
  type VideoModel,
} from '../services/videoModelService';
import { cancelTask, deleteTask } from '../services/taskControlService';
import { localConnectorUnavailable } from './runtimeUnavailable';
import { seedanceAudioError } from '../utils/seedanceAudio';
import { ensureVideoCharacterUniqueness } from '../utils/scriptPromptStandards';

export type { VideoTask } from '../services/videoTaskTypes';
export { cancelTask, deleteTask };
export { getTaskStatus, getTasks } from '../services/taskQueryService';

export interface H3LongVideoSegment {
  prompt: string;
  duration: number;
  image_path: string;
  image_path_end?: string;
}

export interface VideoGenerationOptions {
  duration?: number;
  resolution?: string;
  seed?: number;
  negative_prompt?: string;
  shot_type?: ShotType;
  minimax_model?: string;
  minimax_resolution?: '768P' | '1080P';
  minimax_prompt_optimizer?: boolean;
  h3_sage_attention?: boolean;
  h3_low_vram?: boolean;
  h3_long_video?: boolean;
  h3_long_video_segments?: H3LongVideoSegment[];
  h3_upscale_720p?: boolean;
}

type EntityOptions = {
  entity_type?: string;
  entity_id?: string;
  file_role?: string;
  project_id?: string;
  episode_id?: string;
  workspace_group_id?: string;
  preferred_agent_id?: string;
  preferred_node_id?: string;
  preferred_comfyui_port?: number;
  strict_preferred_routing?: boolean;
};

async function throwResponseError(response: Response, fallback: string): Promise<never> {
  const error = await response.json().catch(() => ({ detail: fallback }));
  const detail = error?.detail ?? error?.message;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const result: any = new Error(String(detail.message || detail.error || fallback));
    result.status = response.status;
    Object.assign(result, detail);
    if (detail.code === 'minimax_hailuo_daily_limit') {
      markMiniMaxHailuoHiddenToday();
    }
    throw result;
  }
  const result: any = new Error(typeof detail === 'string' && detail ? detail : fallback);
  result.status = response.status;
  throw result;
}

function attachEntity(body: Record<string, any>, entityOptions?: EntityOptions): void {
  if (!entityOptions) return;
  body.entity_type = entityOptions.entity_type;
  body.entity_id = entityOptions.entity_id;
  body.file_role = entityOptions.file_role || 'video';
  body.project_id = entityOptions.project_id;
  body.episode_id = entityOptions.episode_id;
  body.workspace_group_id = entityOptions.workspace_group_id;
}

export interface VideoTaskSubmission {
  task_id: string;
  cancel_deadline?: number;
  can_cancel?: boolean;
}

async function postGenerate(body: Record<string, any>, apiName: string, fallback: string): Promise<VideoTaskSubmission> {
  const response = await apiFetch('/api/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  }, { apiName });
  if (!response.ok) await throwResponseError(response, fallback);
  return response.json();
}

export function buildComfyUIVideoTaskPayload(): never {
  return localConnectorUnavailable();
}

export function normalizeVideoMediaRef(ref: string): string {
  const value = (ref || '').trim();
  if (!value) return '';
  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:') ||
    value.startsWith('/') ||
    value.startsWith('file_')
  ) return value;
  return `/uploads/${value.replace(/^uploads\//, '')}`;
}

export async function submitTask(
  imageFilename: string,
  imageFilenameEnd: string | null,
  prompt: string,
  model: VideoModel,
  _videoFilename?: string,
  _audioFilename?: string,
  shotType: ShotType = 'multi',
  entityOptions?: EntityOptions,
  generationOptions?: VideoGenerationOptions,
): Promise<VideoTaskSubmission> {
  if (isComfyUIModel(model)) localConnectorUnavailable();

  prompt = ensureVideoCharacterUniqueness(prompt);

  let body: Record<string, any>;
  if (model === 'MINI') {
    const minimaxParams = normalizeMiniMaxVideoParams({
      duration: generationOptions?.duration as 6 | 10 | undefined,
      resolution: generationOptions?.minimax_resolution,
      promptOptimizer: generationOptions?.minimax_prompt_optimizer,
    });
    const parameterError = getMiniMaxVideoParamsError(minimaxParams);
    if (parameterError) throw new Error(`MiniMax 参数无效：${parameterError}`);
    body = {
      task_type: imageFilenameEnd ? 'minimax_morph' : 'minimax_i2v',
      model: 'MINI',
      first_frame_image: normalizeVideoMediaRef(imageFilename),
      prompt,
      duration: minimaxParams.duration,
      minimax_model: generationOptions?.minimax_model,
      minimax_resolution: minimaxParams.resolution,
      minimax_prompt_optimizer: minimaxParams.promptOptimizer,
      priority: 2,
    };
    if (imageFilenameEnd) body.last_frame_image = normalizeVideoMediaRef(imageFilenameEnd);
  } else if (model === 'Sora2') {
    body = {
      task_type: imageFilenameEnd ? 'sora2_morph' : 'sora2_i2v',
      image_path: imageFilename,
      prompt,
      priority: 2,
    };
    if (imageFilenameEnd) body.image_path_end = imageFilenameEnd;
  } else if (isSeedanceVideoModel(model)) {
    const outputError = getSeedanceOutputError(seedanceSubModelForVideoModel(model), generationOptions?.resolution)
      || getSeedanceDurationError(seedanceSubModelForVideoModel(model), generationOptions?.duration);
    if (outputError) throw new Error(outputError);
    const media: SeedanceMediaInput[] = [];
    if (imageFilename) {
      media.push({
        kind: 'image',
        url: imageFilename.startsWith('http') ? imageFilename : `/uploads/${imageFilename}`,
        role: imageFilenameEnd ? 'first_frame' : undefined,
      });
    }
    if (imageFilenameEnd) {
      media.push({
        kind: 'image',
        url: imageFilenameEnd.startsWith('http') ? imageFilenameEnd : `/uploads/${imageFilenameEnd}`,
        role: 'last_frame',
      });
    }
    body = {
      task_type: inferSeedanceTaskType(media),
      sub_model: seedanceSubModelForVideoModel(model),
      model,
      duration: generationOptions?.duration ?? 5,
      resolution: normalizeSeedanceOutputResolution(generationOptions?.resolution),
      prompt,
      media_inputs: media,
      ratio: 'adaptive',
      generate_audio: true,
      priority: 2,
    };
  } else if (model === 'Veo') {
    body = {
      task_type: imageFilenameEnd ? 'veo_morph' : 'veo_i2v',
      image_path: imageFilename,
      prompt,
      priority: 2,
    };
    if (imageFilenameEnd) body.image_path_end = imageFilenameEnd;
  } else if (model === '大能') {
    if (imageFilenameEnd) throw new Error('大能模型不支持首尾帧模式');
    body = {
      task_type: 'wan26_i2v',
      image_path: imageFilename,
      prompt,
      resolution: generationOptions?.resolution || '1080P',
      duration: generationOptions?.duration ?? 5,
      shot_type: generationOptions?.shot_type || shotType,
      seed: generationOptions?.seed ?? -1,
      priority: 2,
    };
  } else if (model === 'Kling') {
    if (!imageFilename && !imageFilenameEnd) {
      body = { task_type: 'kling_t2v', prompt, mode: 'std', duration: 5, aspect_ratio: '16:9', audio: false, watermark: false, seed: -1, priority: 2 };
    } else if (imageFilenameEnd) {
      body = { task_type: 'kling_morph', prompt, image_path: imageFilename, image_path_end: imageFilenameEnd, mode: 'std', duration: 5, audio: false, watermark: false, seed: -1, priority: 2 };
    } else {
      body = { task_type: 'kling_i2v', prompt, image_path: imageFilename, mode: 'std', duration: 5, audio: false, watermark: false, seed: -1, priority: 2 };
    }
  } else if (model === 'Vidu') {
    if (!imageFilename && !imageFilenameEnd) throw new Error(`${getModelDisplayName('Vidu')}不支持纯文生视频，请至少提供 1 张参考图`);
    body = imageFilenameEnd
      ? { task_type: 'vidu_morph', prompt, image_path: imageFilename, image_path_end: imageFilenameEnd, sub_model: 'q3-turbo', resolution: '720P', duration: 5, audio: false, watermark: false, seed: -1, priority: 2 }
      : { task_type: 'vidu_r2v', prompt, media_inputs: [{ kind: 'image', url: imageFilename, role: 'reference_image' }], sub_model: 'q3', resolution: '720P', duration: 5, audio: false, watermark: false, seed: -1, priority: 2 };
  } else if (model === 'HappyHorse') {
    if (!imageFilename) throw new Error(`${getModelDisplayName('HappyHorse')}至少需要 1 张参考图`);
    if (imageFilenameEnd) throw new Error(`${getModelDisplayName('HappyHorse')}不支持首尾帧模式（仅多图参考）`);
    body = { task_type: 'happyhorse_r2v', prompt, media_inputs: [{ kind: 'image', url: imageFilename, role: 'reference_image' }], resolution: '720P', ratio: '16:9', duration: 5, watermark: false, seed: -1, priority: 2 };
  } else {
    throw new Error(`公开源码版未配置模型：${String(model)}`);
  }

  attachEntity(body, entityOptions);
  return postGenerate(body, 'submitTask', '任务提交失败');
}

// Keep shared UI signatures without exposing or executing the private connector.
export const submitUpscaleTask = async (
  _videoFilename: string,
  _entityOptions?: EntityOptions & { resolution?: string },
): Promise<{ task_id: string }> => localConnectorUnavailable();
export const submitInterpolateTask = async (
  _videoFilename: string,
  _targetFps: 30 | 60 | 120,
  _entityOptions?: EntityOptions,
): Promise<{ task_id: string }> => localConnectorUnavailable();
export const submitVoiceTask = async (
  _imageFilename: string,
  _videoFilename: string,
  _audioFilename: string,
  _prompt: string,
  _model: VideoModel = 'Wan2',
  _entityOptions?: EntityOptions,
  _generationOptions?: { duration?: number },
): Promise<{ task_id: string }> => localConnectorUnavailable();

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('当前浏览器不支持安全随机数，无法创建任务');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function formatUploadTime(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatGenerationTime(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

export async function submitTaskQueued(
  imageFilename: string,
  imageFilenameEnd: string | null,
  prompt: string,
  model: VideoModel,
  videoFilename?: string,
  audioFilename?: string,
  shotType: ShotType = 'multi',
  entityOptions?: EntityOptions,
  generationOptions?: VideoGenerationOptions,
): Promise<VideoTaskSubmission> {
  if (isComfyUIModel(model)) localConnectorUnavailable();
  return submitTask(imageFilename, imageFilenameEnd, prompt, model, videoFilename, audioFilename, shotType, entityOptions, generationOptions);
}

export const submitUpscaleTaskQueued = submitUpscaleTask;
export const submitInterpolateTaskQueued = submitInterpolateTask;
export const submitVoiceTaskQueued = submitVoiceTask;

export async function submitSeedanceTask(
  params: SeedanceParams,
  entityOptions?: EntityOptions,
  draftTaskId?: string,
  agentPlanCompat = false,
): Promise<VideoTaskSubmission> {
  const outputError = getSeedanceOutputError(params.sub_model, params.resolution)
    || getSeedanceDurationError(params.sub_model, params.duration);
  if (outputError) throw new Error(outputError);
  const mediaInputs = normalizeSeedanceMediaForSubmission(params.media_inputs, agentPlanCompat);
  if (params.portrait_reference_mode && (!supportsSeedancePortraitReference(params.sub_model) || params.reference_mode !== 'reference')) {
    throw new Error('仿真人参考仅支持 Seedance 2.0、Fast、Mini 的全能参考，请切换模式或手动关闭仿真人参考。');
  }
  const audioError = params.sub_model !== 'agent_plan' && seedanceAudioError(mediaInputs, params.reference_audio_policy);
  if (audioError) throw new Error(audioError);
  const jimeng = params.sub_model === 'jimeng_mini';
  if (jimeng && draftTaskId) throw new Error('即梦不支持复用样片任务，本次未提交。');
  const body: Record<string, any> = {
    task_type: jimeng ? 'jimeng_multimodal' : inferSeedanceTaskType(mediaInputs, !!draftTaskId),
    sub_model: params.sub_model,
    model: seedanceModelForSubModel(params.sub_model),
    model_scope: params.model_scope,
    prompt: ensureVideoCharacterUniqueness(params.prompt),
    media_inputs: mediaInputs,
    reference_audio_policy: params.reference_audio_policy || 'preserve',
    reference_mode: params.reference_mode,
    portrait_reference_mode: params.portrait_reference_mode,
    resolution: normalizeSeedanceOutputResolution(params.resolution),
    ratio: params.ratio || (jimeng ? '16:9' : 'adaptive'),
    duration: jimeng ? Math.max(4, Math.ceil(params.duration ?? 5)) : params.duration,
    seed: params.seed ?? -1,
    watermark: !!params.watermark,
    generate_audio: params.generate_audio !== false,
    camera_fixed: !!params.camera_fixed,
    priority: 2,
  };
  if (draftTaskId) body.draft_task_id = draftTaskId;
  attachEntity(body, entityOptions);
  return postGenerate(body, 'submitSeedanceTask', 'Seedance 任务提交失败');
}

export async function submitDashScopeVideoTask(
  params: DashScopeVideoParams,
  entityOptions?: EntityOptions,
): Promise<VideoTaskSubmission> {
  const media = params.media_inputs || [];
  const images = media.filter(item => item.kind === 'image');
  const firstFrame = images.find(item => item.role === 'first_frame');
  const lastFrame = images.find(item => item.role === 'last_frame');
  const referenceImages = images.filter(item => item !== firstFrame && item !== lastFrame);
  const body: Record<string, any> = {
    task_type: inferDashScopeTaskType(params.model, media),
    prompt: ensureVideoCharacterUniqueness(params.prompt || ''),
    duration: params.duration ?? 5,
    seed: params.seed ?? -1,
    watermark: !!params.watermark,
    priority: 2,
  };
  const resolveUrl = (item: SeedanceMediaInput): string => item.file_id || item.url;
  if (firstFrame) body.image_path = resolveUrl(firstFrame);
  if (lastFrame) body.image_path_end = resolveUrl(lastFrame);
  if (referenceImages.length) {
    body.media_inputs = referenceImages.map(item => ({ kind: 'image', url: resolveUrl(item), role: item.role || 'reference_image' }));
  }
  if (params.model === 'Kling') {
    body.mode = params.mode || 'std';
    if (params.aspect_ratio) body.aspect_ratio = params.aspect_ratio;
    if (params.audio !== undefined) body.audio = !!params.audio;
    if (params.sub_model_kling) body.sub_model = params.sub_model_kling;
  } else if (params.model === 'Vidu') {
    body.resolution = params.resolution || '720P';
    if (params.size) body.size = params.size;
    if (params.audio !== undefined) body.audio = !!params.audio;
    if (params.sub_model_vidu) body.sub_model = params.sub_model_vidu;
  } else {
    body.hh_resolution = params.hh_resolution || params.resolution || '1080P';
    body.hh_ratio = params.hh_ratio || params.ratio || '16:9';
    body.hh_duration = params.hh_duration ?? params.duration ?? 5;
    if (params.hh_watermark !== undefined) body.hh_watermark = !!params.hh_watermark;
    if (params.hh_seed !== undefined) body.hh_seed = params.hh_seed;
    body.resolution = body.hh_resolution;
    body.ratio = body.hh_ratio;
    body.duration = body.hh_duration;
  }
  attachEntity(body, entityOptions);
  return postGenerate(body, 'submitDashScopeVideoTask', `${params.model} 任务提交失败`);
}

export interface MixStoryboardAudioRequest {
  item_id: string;
  dialogue_url?: string;
  narration_url?: string;
  sfx_url?: string;
  dialogue_gain_db?: number;
  narration_gain_db?: number;
  sfx_gain_db?: number;
}

export interface MixStoryboardAudioResponse {
  success: boolean;
  mixed_audio_url: string;
  cached: boolean;
  duration_ms: number;
}

export async function mixStoryboardAudio(body: MixStoryboardAudioRequest): Promise<MixStoryboardAudioResponse> {
  const response = await apiFetch('/api/storyboard/mix-audio', {
    method: 'POST',
    body: JSON.stringify(body),
  }, { apiName: 'mixStoryboardAudio' });
  if (!response.ok) throw new Error(`mix-audio failed: ${response.status} ${await response.text()}`);
  return response.json();
}

export async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return output;
}
