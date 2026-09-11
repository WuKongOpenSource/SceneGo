import {
  SELECTABLE_MODELS,
  getModelDisplayName,
  isMiniMaxHailuoHiddenToday,
  isVideoModelKey,
  type VideoModel,
} from '@app/services/videoModelService';

export const STUDIO_TEXT_MODEL_CONFIGURED = 'gemini-2.5-flash';
export const STUDIO_TEXT_MODEL_LABEL = 'gemini-2.5-flash · 全能写作模型';

export const STUDIO_IMAGE_MODEL_CONFIGURED = 'doubao-seedream-5-0-lite-260128';
export const STUDIO_IMAGE_MODEL_LABEL = 'Doubao-Seedream-5.0-lite · 参考图生图模型';
export const STUDIO_IMAGE_MODEL_SHORT_LABEL = 'Doubao-Seedream-5.0-lite';
export const STUDIO_IMAGE_MODEL_POSE_LABEL = 'Doubao-Seedream-5.0-lite · 姿态生图模型';

export const STUDIO_VIDEO_MODEL_STANDARD: VideoModel = 'Seedance2';
export const STUDIO_VIDEO_MODEL_FAST: VideoModel = 'Seedance2Fast';
export const STUDIO_VIDEO_MODEL_STANDARD_LABEL = getModelDisplayName(STUDIO_VIDEO_MODEL_STANDARD);
export const STUDIO_VIDEO_MODEL_FAST_LABEL = getModelDisplayName(STUDIO_VIDEO_MODEL_FAST);

export const STUDIO_AUDIO_MODEL_SPEECH_HD = 'speech-hd';
export const STUDIO_AUDIO_MODEL_LABEL = 'speech-2.8-hd · 高清语音模型';

export const STUDIO_TEXT_MODEL_OPTIONS = [
  { l: STUDIO_TEXT_MODEL_LABEL, v: STUDIO_TEXT_MODEL_CONFIGURED },
] as const;

export const STUDIO_IMAGE_MODEL_OPTIONS = [
  { l: STUDIO_IMAGE_MODEL_LABEL, v: STUDIO_IMAGE_MODEL_CONFIGURED },
] as const;

export const STUDIO_VIDEO_MODEL_OPTIONS: ReadonlyArray<{ l: string; v: VideoModel }> = (
  SELECTABLE_MODELS.map(model => ({ l: getModelDisplayName(model), v: model }))
);

export function getStudioVideoModelOptions(): ReadonlyArray<{ l: string; v: VideoModel }> {
  return STUDIO_VIDEO_MODEL_OPTIONS;
}

export function getStudioVideoModelUnavailableReason(model: VideoModel): string | undefined {
  if (model === 'MINI' && isMiniMaxHailuoHiddenToday()) {
    return 'MiniMax Hailuo 今日调用额度已用完，明日 00:00 后自动恢复';
  }
  return undefined;
}

export const STUDIO_AUDIO_MODEL_OPTIONS = [
  { l: STUDIO_AUDIO_MODEL_LABEL, v: STUDIO_AUDIO_MODEL_SPEECH_HD },
] as const;

export function normalizeStudioTextModel(model?: string | null): string {
  const value = String(model || '').trim();
  if (!value || value.toLowerCase() === 'gemini') {
    return STUDIO_TEXT_MODEL_CONFIGURED;
  }
  return value;
}

export function normalizeStudioImageModel(model?: string | null): string {
  const value = String(model || '').trim();
  if (!value || value.toLowerCase() === 'nanobanana') {
    return STUDIO_IMAGE_MODEL_CONFIGURED;
  }
  return value;
}

export function studioImageModelOverride(model?: string | null): string | undefined {
  const normalized = normalizeStudioImageModel(model);
  return normalized === STUDIO_IMAGE_MODEL_CONFIGURED ? undefined : normalized;
}

export function normalizeStudioVideoModel(model?: string | null): VideoModel {
  const value = String(model || '').trim();
  const normalized = value.toLowerCase();
  if (
    !normalized
    || normalized === 'fast'
    || normalized === 'seedance2fast'
    || normalized === 'seedance-fast'
  ) {
    return STUDIO_VIDEO_MODEL_FAST;
  }
  if (
    normalized === 'standard'
    || normalized === 'seedance2'
    || normalized === 'seedance-standard'
  ) {
    return STUDIO_VIDEO_MODEL_STANDARD;
  }
  if (normalized === 'mini' || normalized === 'seedance2mini' || normalized === 'seedance-mini') {
    return 'Seedance2Mini';
  }
  if (isVideoModelKey(value) && SELECTABLE_MODELS.includes(value)) return value;
  return STUDIO_VIDEO_MODEL_FAST;
}

export function studioVideoCapabilityKey(model?: string | null): VideoModel {
  return normalizeStudioVideoModel(model);
}

export function getStudioVideoDuration(model: VideoModel, requested: number, resolution: string): number {
  if (model === 'Sora2') return 15;
  if (model === 'Veo') return 8;
  if (model === 'MINI') {
    if (resolution.toUpperCase() === '1080P') return 6;
    return requested >= 8 ? 10 : 6;
  }
  return Math.max(2, Math.min(15, Math.round(requested || 5)));
}

export function normalizeStudioAudioModel(model?: string | null): string {
  const value = String(model || '').trim();
  const normalized = value.toLowerCase();
  if (!normalized || normalized === 'minimax-speech-2.6-hd' || normalized === 'speech-2.6-hd' || normalized === 'speech-2.8-hd') {
    return STUDIO_AUDIO_MODEL_SPEECH_HD;
  }
  if (normalized === 'minimax-speech-2.6-turbo' || normalized === 'speech-2.6-turbo' || normalized === 'speech-2.8-turbo') {
    return 'speech-turbo';
  }
  if (normalized === 'speech-hd' || normalized === 'speech-turbo') {
    return normalized;
  }
  return STUDIO_AUDIO_MODEL_SPEECH_HD;
}
