// Shared video model names, parameter types, and pure inference helpers.

const MINIMAX_H3_MODELS = ['MiniMaxH3', 'MiniMaxH3Fast', 'MiniMaxH3Mini'] as const;
const COMFYUI_MODELS: string[] = ['Wan2', 'LTXNode1', 'WanNode2', '一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶', ...MINIMAX_H3_MODELS];

export type VideoModel =
  | 'Wan2' | 'LTXNode1' | 'WanNode2' | '一阶' | '二阶' | '三阶' | '四阶' | '五阶' | '六阶' | '七阶'
  | 'MiniMaxH3' | 'MiniMaxH3Fast' | 'MiniMaxH3Mini'
  | 'Veo' | 'Sora2' | 'MINI' | '大能'
  | 'Seedance15' | 'Seedance2' | 'Seedance2Fast' | 'Seedance2Mini'
  | 'Kling' | 'Vidu' | 'HappyHorse';

export const DEFAULT_VIDEO_MODEL: VideoModel = 'Seedance15';

export type MiniMaxVideoModelName = string;
export type MiniMaxVideoDuration = 6 | 10;
export type MiniMaxVideoResolution = '768P' | '1080P';

export interface MiniMaxVideoParams {
  model: MiniMaxVideoModelName;
  duration: MiniMaxVideoDuration;
  resolution: MiniMaxVideoResolution;
  promptOptimizer: boolean;
}

export const DEFAULT_MINIMAX_VIDEO_PARAMS: MiniMaxVideoParams = {
  model: 'MiniMax-Hailuo-2.3',
  duration: 6,
  resolution: '768P',
  promptOptimizer: true,
};

export function normalizeMiniMaxVideoParams(
  params?: Partial<MiniMaxVideoParams> | null,
  defaultModel: MiniMaxVideoModelName = DEFAULT_MINIMAX_VIDEO_PARAMS.model,
): MiniMaxVideoParams {
  const model = String(params?.model || defaultModel || DEFAULT_MINIMAX_VIDEO_PARAMS.model).trim()
    || DEFAULT_MINIMAX_VIDEO_PARAMS.model;
  const resolution: MiniMaxVideoResolution = params?.resolution === '1080P' ? '1080P' : '768P';
  const requestedDuration: MiniMaxVideoDuration = Number(params?.duration) === 10 ? 10 : 6;

  return {
    model,
    duration: requestedDuration,
    resolution,
    promptOptimizer: params?.promptOptimizer !== false,
  };
}

export function getMiniMaxVideoParamsError(params: MiniMaxVideoParams): string | null {
  if (params.resolution === '1080P' && params.duration !== 6) {
    return '1080P 仅支持 6 秒；请选择 6 秒，或将清晰度改为 768P。';
  }
  return null;
}

export type DashScopeVideoModel = 'Kling' | 'Vidu' | 'HappyHorse';

export function isComfyUIModel(model: VideoModel): boolean {
  return COMFYUI_MODELS.includes(model);
}

export function isMiniMaxH3Model(model: VideoModel): boolean {
  return (MINIMAX_H3_MODELS as readonly string[]).includes(model);
}

export function isRetiredLocalVideoModel(model: VideoModel): boolean {
  return isComfyUIModel(model) && !isMiniMaxH3Model(model);
}

export function isDashScopeVideoModel(model: VideoModel): model is DashScopeVideoModel {
  return model === 'Kling' || model === 'Vidu' || model === 'HappyHorse';
}

export type ShotType = 'multi' | 'single';

export type SeedanceMediaKind = 'image' | 'video' | 'audio';
export type SeedanceMediaRole = 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio';

export interface SeedanceMediaInput {
  kind: SeedanceMediaKind;
  url: string;
  role?: SeedanceMediaRole;
  file_id?: string;
  /** Display/estimate hint; the server probes original audio before submission. */
  duration_seconds?: number;
}

export interface SeedanceParams {
  reference_audio_policy?: 'preserve' | 'trim_to_15';
  sub_model: 'agent_plan' | 'standard' | 'fast' | 'mini';
  model_scope?: string;
  reference_mode?: 'reference' | 'first_last';
  prompt: string;
  media_inputs: SeedanceMediaInput[];
  resolution?: '480p' | '720p' | '1080p';
  ratio?: 'adaptive' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9';
  duration?: number;
  seed?: number;
  watermark?: boolean;
  generate_audio?: boolean;
  camera_fixed?: boolean;
}

export type SeedanceVideoModel = 'Seedance15' | 'Seedance2' | 'Seedance2Fast' | 'Seedance2Mini';

export function getSeedanceDurationError(subModel: SeedanceParams['sub_model'], value?: number): string | null {
  const duration = value ?? 5;
  const max = subModel === 'agent_plan' ? 12 : 15;
  return Number.isInteger(duration) && duration >= 4 && duration <= max ? null
    : `Seedance ${subModel === 'agent_plan' ? '1.5 Pro' : '2.0'} 需要 4–${max} 秒整数时长，当前选用 ${duration} 秒；请调整后生成。`;
}

export function seedanceModelForSubModel(subModel: SeedanceParams['sub_model']): SeedanceVideoModel {
  return subModel === 'agent_plan' ? 'Seedance15' : subModel === 'fast' ? 'Seedance2Fast' : subModel === 'mini' ? 'Seedance2Mini' : 'Seedance2';
}

export function normalizeSeedanceOutputResolution(value?: string | null): string {
  return String(value ?? '').trim().toLowerCase() || '720p';
}

export function getSeedanceOutputError(subModel: SeedanceParams['sub_model'], value?: string | null): string | null {
  const resolution = normalizeSeedanceOutputResolution(value);
  if (!['480p', '720p', '1080p'].includes(resolution)) return 'Seedance 清晰度无效，请选择 480P、720P 或 1080P';
  return (subModel === 'fast' || subModel === 'mini') && resolution === '1080p'
    ? 'Seedance 2.0 Fast / Mini 仅支持 480P 或 720P，请调整清晰度后重试' : null;
}

export function isSeedanceVideoModel(model: VideoModel): model is SeedanceVideoModel {
  return model === 'Seedance15'
    || model === 'Seedance2'
    || model === 'Seedance2Fast'
    || model === 'Seedance2Mini';
}

export function isSeedanceAgentPlanModel(model: VideoModel | SeedanceVideoModel): boolean {
  return model === 'Seedance15';
}

export function supportsSeedanceMultimodalModel(model: VideoModel | SeedanceVideoModel): boolean {
  return isSeedanceVideoModel(model as VideoModel) && !isSeedanceAgentPlanModel(model);
}

export function seedanceSubModelForVideoModel(model: SeedanceVideoModel | VideoModel): SeedanceParams['sub_model'] {
  if (model === 'Seedance15') return 'agent_plan';
  if (model === 'Seedance2Fast') return 'fast';
  if (model === 'Seedance2Mini') return 'mini';
  return 'standard';
}

export function inferSeedanceTaskType(media: SeedanceMediaInput[], hasDraftId?: boolean): string {
  if (hasDraftId) return 'seedance_draft';
  if (!media || media.length === 0) return 'seedance_t2v';
  const images = media.filter((m) => m.kind === 'image');
  const hasFirst = images.some((m) => m.role === 'first_frame');
  const hasLast = images.some((m) => m.role === 'last_frame');
  if (hasFirst && hasLast) return 'seedance_morph';
  if (
    media.length === 1
    && images.length === 1
    && (!images[0].role || images[0].role === 'first_frame')
  ) return 'seedance_i2v';
  return 'seedance_multi';
}

export function normalizeSeedanceMediaForSubmission(
  media: SeedanceMediaInput[] = [],
  agentPlanCompat: boolean = false,
): SeedanceMediaInput[] {
  // Workspace image ids (for example `sb_*`) identify storyboard records, not
  // rows in the files table. Older merged cards could persist those ids as
  // `file_id`; submitting both that id and an otherwise valid URL makes the
  // server correctly reject the request. Keep the URL and discard only known
  // UI-only ids so existing saved cards repair themselves on their next run.
  const normalized = media.map((item) => {
    const fileId = String(item.file_id || '').trim();
    if (!fileId || fileId.startsWith('sb_') || fileId.startsWith('ref_')) {
      if (!Object.prototype.hasOwnProperty.call(item, 'file_id')) return item;
      const withoutUiId = { ...item };
      delete withoutUiId.file_id;
      return withoutUiId;
    }
    return item;
  });

  if (!agentPlanCompat || !normalized.length) return normalized;
  if (normalized.some((m) => m.kind !== 'image')) return normalized;

  const images = normalized.filter((m) => m.kind === 'image');
  if (images.length === 1) {
    return normalized.map((m) => (
      m.kind === 'image' ? { ...m, role: 'first_frame' } : m
    ));
  }
  if (images.length === 2) {
    let imageIndex = 0;
    return normalized.map((m) => {
      if (m.kind !== 'image') return m;
      imageIndex += 1;
      return { ...m, role: imageIndex === 1 ? 'first_frame' : 'last_frame' };
    });
  }
  return normalized;
}











export function validateSeedanceMediaInputs(
    media: SeedanceMediaInput[],
    supportsMultimodal: boolean = false,
): string | null {
    if (supportsMultimodal) return null;
    if (!media) return null;
    const hasVideo = media.some((m) => m.kind === 'video');
    if (hasVideo) {
        return 'Seedance 1.5 Pro 不支持参考视频，请移除 @视频 引用';
    }
    const imageCount = media.filter((m) => m.kind === 'image').length;
    if (imageCount > 2) {
        return 'Seedance 1.5 Pro 最多支持 2 张图片（单图或首尾帧），请减少到 ≤2 张图';
    }
    return null;
}

export type KlingMode = 'std' | 'pro';
export type KlingSubModel = 'standard' | 'omni';

export type ViduSubModel =
  | 'q3-mix' | 'q3' | 'q3-turbo' | 'q3-pro'
  | 'q2' | 'q2-pro' | 'q2-turbo';

export type DashScopeResolution = '540P' | '720P' | '1080P';
export type DashScopeAspectRatio = '16:9' | '9:16' | '1:1';
export type HappyHorseRatio = '16:9' | '9:16' | '3:4' | '4:3' | '4:5' | '5:4' | '1:1' | '9:21' | '21:9';

export type KlingShotType = 'intelligence' | 'customize';
export interface KlingMultiPromptItem {
  index: number;
  prompt: string;
  duration: number;
}

export type ViduResolution = DashScopeResolution;
export type HhResolution = '720P' | '1080P';
export type HhRatio = HappyHorseRatio;

export interface DashScopeVideoParams {
  model: DashScopeVideoModel;
  prompt: string;
  media_inputs?: SeedanceMediaInput[];

  duration?: number;
  seed?: number;
  watermark?: boolean;

  sub_model_kling?: KlingSubModel;
  mode?: KlingMode;
  aspect_ratio?: DashScopeAspectRatio;
  audio?: boolean;

  sub_model_vidu?: ViduSubModel;
  resolution?: DashScopeResolution;
  size?: string;

  ratio?: HappyHorseRatio;

  kling_multi_shot?: boolean;
  kling_shot_type?: KlingShotType;
  kling_multi_prompt?: KlingMultiPromptItem[];
  kling_keep_original_sound?: 'yes' | 'no';
  kling_active_mode?: 'auto' | 'omni' | 'multi';

  vidu_resolution?: ViduResolution;
  vidu_size?: string;
  vidu_seed?: number;
  vidu_audio?: boolean;

  hh_resolution?: HhResolution;
  hh_ratio?: HhRatio;
  hh_duration?: number;
  hh_watermark?: boolean;
  hh_seed?: number;
}

export function makeDefaultDashScopeParams(
  model: DashScopeVideoModel,
  prompt: string = '',
  seedMedia: SeedanceMediaInput[] = [],
  aspectRatio: '16:9' | '9:16' = '16:9',
): DashScopeVideoParams {
  const base: DashScopeVideoParams = {
    model,
    prompt,
    media_inputs: seedMedia,
    duration: 5,
    seed: -1,
    watermark: false,
  };

  if (model === 'Kling') {
    return {
      ...base,
      sub_model_kling: 'standard',
      mode: 'std',
      aspect_ratio: aspectRatio,
      audio: false,
      kling_multi_shot: false,
      kling_shot_type: 'intelligence',
      kling_multi_prompt: [],
      kling_keep_original_sound: 'no',
      kling_active_mode: 'auto',
    };
  }

  if (model === 'Vidu') {
    return {
      ...base,
      sub_model_vidu: 'q3',
      resolution: '720P',
      audio: false,
      vidu_resolution: '720P',
      vidu_size: aspectRatio === '9:16' ? '720*1280' : '1280*720',
      vidu_audio: false,
    };
  }

  return {
    ...base,
    resolution: '720P',
    ratio: aspectRatio,
    hh_resolution: '1080P',
    hh_ratio: aspectRatio,
    hh_duration: 5,
    hh_watermark: true,
  };
}

export function inferDashScopeTaskType(
  model: DashScopeVideoModel,
  media: SeedanceMediaInput[] = [],
): string {
  const images = media.filter((m) => m.kind === 'image');
  const hasFirst = images.some((m) => m.role === 'first_frame');
  const hasLast = images.some((m) => m.role === 'last_frame');

  if (model === 'Kling') {
    if (!media.length) return 'kling_t2v';
    if (hasFirst && hasLast) return 'kling_morph';
    if (hasFirst && !hasLast) return 'kling_i2v';
    return 'kling_refer';
  }

  if (model === 'Vidu') {
    if (hasFirst && hasLast) return 'vidu_morph';
    return 'vidu_r2v';
  }

  return 'happyhorse_r2v';
}

export function getModelDisplayName(model: VideoModel): string {
  const modelNameMap: Record<VideoModel, string> = {
    Wan2: 'Wan 2.2 · 本地节点模型',
    LTXNode1: 'LTX Video · 本地节点模型',
    WanNode2: 'Wan 2.2 · 本地节点模型',
    '一阶': 'Smooth · 本地节点模型',
    '二阶': 'Dawasi · 本地节点模型',
    '三阶': 'Hunyuan Video · 本地节点模型',
    '四阶': 'LTX Video · 本地节点模型',
    '五阶': 'Turbo 2.2 · 本地节点模型',
    '六阶': 'Turbo 2.1 · 本地节点模型',
    '七阶': 'SVD Wan · 本地节点模型',
    MiniMaxH3: 'MiniMax H3 · 本地节点模型',
    MiniMaxH3Fast: 'MiniMax H3 Fast · 本地节点模型',
    MiniMaxH3Mini: 'MiniMax H3 Mini · 本地节点模型',
    Veo: 'Veo 3.1 Fast · 高质量快速视频模型',
    MINI: 'MiniMax Hailuo 2.3 · 首尾帧标准视频模型',
    Sora2: 'Sora 2 · 长镜头视频模型',
    '大能': 'Wan 2.6 · 镜头叙事视频模型',
    Seedance15: 'Seedance 1.5 Pro · 首尾帧视频模型',
    Seedance2: 'Seedance 2.0 · 多模态标准视频模型',
    Seedance2Fast: 'Seedance 2.0 Fast · 多模态快速视频模型',
    Seedance2Mini: 'Seedance 2.0 Mini · 多模态简化视频模型',
    Kling: 'Kling V3 · 全能音画视频模型',
    Vidu: 'Vidu Q3 · 多参考视频模型',
    HappyHorse: 'HappyHorse 1.0 · 角色一致性视频模型',
  };
  return modelNameMap[model] || model;
}

export const ALL_MODELS: VideoModel[] = [
  'Wan2', 'LTXNode1', 'WanNode2', '一阶', '二阶', '三阶', '四阶', '五阶', '六阶', '七阶', ...MINIMAX_H3_MODELS,
  'Veo', 'Sora2', 'MINI', '大能',
  'Seedance15', 'Seedance2', 'Seedance2Fast', 'Seedance2Mini',
  'Kling', 'Vidu', 'HappyHorse',
];

export const SELECTABLE_MODELS: VideoModel[] = [
  // Online APIs are always listed first.
  'Seedance15', 'Seedance2', 'Seedance2Fast', 'Seedance2Mini',
  'MINI', 'Veo', 'Sora2', '大能',
  'Kling', 'Vidu', 'HappyHorse',
  // Legacy local keys remain readable, but only supported profiles are offered for new tasks.
  ...MINIMAX_H3_MODELS,
];

export const MINIMAX_HAILUO_LIMIT_EVENT = 'ostory:minimax-hailuo-limit-changed';
const MINIMAX_HAILUO_LIMIT_STORAGE_KEY = 'ostory:minimax-hailuo-limit-date';

export function getChinaDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function isMiniMaxHailuoHiddenToday(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MINIMAX_HAILUO_LIMIT_STORAGE_KEY) === getChinaDateKey();
  } catch {
    return false;
  }
}

export function markMiniMaxHailuoHiddenToday(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MINIMAX_HAILUO_LIMIT_STORAGE_KEY, getChinaDateKey());
  } catch {}
  window.dispatchEvent(new CustomEvent(MINIMAX_HAILUO_LIMIT_EVENT));
}

export function isMiniMaxHailuoDailyLimitError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === 'minimax_hailuo_daily_limit'
    || String(candidate?.message || '').includes('今日已达限额');
}

export function getVideoCreditEstimateParams(
  model: VideoModel,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const applyOverrides = (defaults: Record<string, unknown>): Record<string, unknown> => {
    const definedOverrides = Object.fromEntries(
      Object.entries(overrides).filter(([key, value]) => (
        key !== 'model'
        && value !== undefined
        && value !== null
        && value !== ''
      )),
    );
    return { ...defaults, ...definedOverrides, model };
  };
  const base: Record<string, unknown> = { model, duration_seconds: 5 };
  if (model === 'HappyHorse') return applyOverrides({ ...base, hh_resolution: '1080P' });
  if (model === 'Vidu') return applyOverrides({ ...base, sub_model: 'q3', vidu_resolution: '720P' });
  if (model === 'Kling') return applyOverrides({ ...base, resolution: '720P', audio: false });
  if (model === '大能') return applyOverrides({ ...base, resolution: '1080P' });
  if (model === 'MINI') {
    return applyOverrides({
      model,
      duration_seconds: 6,
      minimax_model: DEFAULT_MINIMAX_VIDEO_PARAMS.model,
      minimax_resolution: DEFAULT_MINIMAX_VIDEO_PARAMS.resolution,
    });
  }
  if (isSeedanceVideoModel(model)) {
    return applyOverrides({
      ...base,
      sub_model: seedanceSubModelForVideoModel(model),
      resolution: '720P',
    });
  }
  if (model === 'Sora2') return applyOverrides({ model, duration_seconds: 15, resolution: '720P' });
  if (model === 'Veo') return applyOverrides({ model, duration_seconds: 8, resolution: '720P' });
  return applyOverrides(base);
}

export function getVideoCreditFallbackCost(
  model: VideoModel,
  options: { h3_upscale_720p?: boolean } = {},
): number {
  if (model === 'HappyHorse') return 160;
  if (model === 'Seedance15') return 32;
  if (model === 'Seedance2') return 105;
  if (model === 'Seedance2Fast') return 85;
  if (model === 'Seedance2Mini') return 50;
  if (model === 'MiniMaxH3Mini') {
    return 5 + (options.h3_upscale_720p === true ? 5 : 0);
  }
  if (isMiniMaxH3Model(model)) {
    return 10 + (options.h3_upscale_720p === true ? 5 : 0);
  }
  return 10;
}

const ALL_MODEL_VALUES = new Set<string>(ALL_MODELS);

export interface VideoCapabilityModelLike {
  key?: string;
  label?: string;
  display_name?: string;
  description?: string;
  default_display_name?: string;
  default_description?: string;
  published?: boolean;
  unavailable_reason?: string;
  provider?: string;
  model_name?: string | null;
  model_options?: string[];
  model_option_labels?: Array<{
    operation?: string;
    model_name: string;
    label?: string;
    display_name?: string;
    description?: string;
  }>;
  available?: boolean;
  preferred_agent_id?: string | null;
  preferred_node_id?: string | null;
  preferred_comfyui_port?: number | null;
  strict_preferred_routing?: boolean;
}

export interface VideoModelOption {
  value: VideoModel;
  label: string;
  baseLabel: string;
  runtimeLabel: string;
  available: boolean;
  unavailableReason?: string;
  provider?: string;
  capability?: VideoCapabilityModelLike;
}

export function isVideoModelKey(value: string): value is VideoModel {
  return ALL_MODEL_VALUES.has(value);
}

function uniqueNonEmpty(values: Iterable<unknown>): string[] {
  const out: string[] = [];
  for (const item of values) {
    const value = String(item || '').trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

export function getVideoModelRuntimeNames(capability?: VideoCapabilityModelLike | null): string[] {
  if (!capability) return [];
  return uniqueNonEmpty([
    ...(Array.isArray(capability.model_options) ? capability.model_options : []),
    capability.model_name,
  ]);
}

export function formatVideoModelRuntimeLabel(capability?: VideoCapabilityModelLike | null): string {
  const names = getVideoModelRuntimeNames(capability);
  // A capability may route to several compatible provider models internally.
  // The selector names the preferred model only; the complete model_options
  // array remains on the capability for routing and parameter decisions.
  return names[0] || '';
}

export function formatVideoModelOptionLabel(
  model: VideoModel,
  capability?: VideoCapabilityModelLike | null,
): string {
  const backendLabel = String(capability?.label || '').trim();
  if (backendLabel) return backendLabel;
  return getModelDisplayName(model);
}

export function getVideoModelRuntimeOptions(
  capability?: VideoCapabilityModelLike | null,
): Array<{ value: string; label: string }> {
  const metadata = Array.isArray(capability?.model_option_labels)
    ? capability.model_option_labels
    : [];
  return getVideoModelRuntimeNames(capability).map(value => {
    const match = metadata.find(item => String(item.model_name || '').trim() === value);
    return {
      value,
      label: String(match?.display_name || match?.label || value).trim() || value,
    };
  });
}

export function buildVideoModelOptions(
  capabilities: readonly VideoCapabilityModelLike[] | null | undefined,
  fallbackModels: readonly VideoModel[] = SELECTABLE_MODELS,
): VideoModelOption[] {
  const capabilityByKey = new Map<string, VideoCapabilityModelLike>();
  for (const capability of capabilities || []) {
    const key = String(capability.key || '').trim();
    if (isVideoModelKey(key)) capabilityByKey.set(key, capability);
  }

  return sortVideoModelOptions(fallbackModels.filter(model => !isRetiredLocalVideoModel(model)).map((model) => {
    const capability = capabilityByKey.get(model);
    const published = capability?.published !== false;
    const available = Boolean(capability && published && capability.available === true);
    const runtimeLabel = formatVideoModelRuntimeLabel(capability);
    const label = formatVideoModelOptionLabel(model, capability);
    const unavailableReason = available
      ? undefined
      : !capability
        ? isComfyUIModel(model) ? '本地节点能力尚未确认，请检查节点状态与工作流' : '后台尚未配置该模型'
        : !published
          ? String(capability.unavailable_reason || '模型已在后台停用')
          : String(capability.unavailable_reason || '模型通道暂不可用');
    return {
      value: model,
      label,
      baseLabel: getModelDisplayName(model),
      runtimeLabel,
      available,
      unavailableReason,
      provider: capability?.provider || (isComfyUIModel(model) ? 'processing_cluster' : undefined),
      capability,
    };
  }));
}

export function sortVideoModelOptions(options: readonly VideoModelOption[]): VideoModelOption[] {
  const local = (option: VideoModelOption) => option.provider === 'processing_cluster' || isComfyUIModel(option.value);
  return [...options].sort((left, right) => (
    Number(local(left)) - Number(local(right))
    || Number(!left.available) - Number(!right.available)
    || (local(left) ? Number(!isMiniMaxH3Model(left.value)) - Number(!isMiniMaxH3Model(right.value)) : 0)
  ));
}

export function withCurrentVideoModelOption(
  options: readonly VideoModelOption[],
  currentModel: VideoModel,
  capabilities: readonly VideoCapabilityModelLike[] | null | undefined,
): VideoModelOption[] {
  if (isRetiredLocalVideoModel(currentModel)) return options.filter(option => !isRetiredLocalVideoModel(option.value));
  if (options.some(option => option.value === currentModel)) return [...options];
  const capability = (capabilities || []).find(item => item.key === currentModel);
  const label = formatVideoModelOptionLabel(currentModel, capability);
  return [{
    value: currentModel,
    label,
    baseLabel: getModelDisplayName(currentModel),
    runtimeLabel: formatVideoModelRuntimeLabel(capability),
    available: false,
    unavailableReason: String(capability?.unavailable_reason || (capability ? '当前模型暂不可用' : isComfyUIModel(currentModel) ? '本地节点能力尚未确认，请检查节点状态与工作流' : '后台尚未配置该模型')),
    provider: capability?.provider || (isComfyUIModel(currentModel) ? 'processing_cluster' : undefined),
    capability,
  }, ...options];
}
