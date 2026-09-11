import { apiJson } from './httpClient';

export interface VideoModelCapability {
  key: string;
  label: string;
  display_name?: string;
  description?: string;
  default_display_name?: string;
  default_description?: string;
  published?: boolean;
  unavailable_reason?: string;
  provider: string;
  model_name?: string | null;
  model_options?: string[];
  model_option_labels?: Array<{
    operation?: string;
    model_name: string;
    label?: string;
    display_name?: string;
    description?: string;
  }>;
  task_types: string[];
  media_inputs: string[];
  supports_original_audio?: boolean;
  supports_cancel?: boolean;
  requires_gpu_node?: boolean;
  requires_processing_node?: boolean;
  available?: boolean;
  preferred_agent_id?: string | null;
  preferred_node_id?: string | null;
  preferred_comfyui_port?: number | null;
  strict_preferred_routing?: boolean;
  query_mode: 'async' | 'queue' | string;
  parameter_rules: Record<string, unknown>;
}

export interface VideoCapabilityNumberRule {
  type?: 'integer' | 'number' | string;
  default?: number;
  minimum?: number;
  maximum?: number;
  options?: number[];
}

export interface VideoCapabilityStringRule {
  type?: 'string' | string;
  default?: string;
}

export type VideoCapabilityParameterRule =
  | string[]
  | number[]
  | VideoCapabilityNumberRule
  | VideoCapabilityStringRule
  | { type?: 'boolean' | string; default?: boolean }
  | string;

export function getVideoCapability(
  manifest: VideoCapabilityManifest | null | undefined,
  modelKey: string,
): VideoModelCapability | undefined {
  return manifest?.models.find(model => model.key === modelKey);
}

export interface VideoCapabilityManifest {
  seedance_omni: boolean;
  comfyui_available: boolean;
  manifest_version: string;
  model_scope?: string;
  models: VideoModelCapability[];
}

const UNAVAILABLE_VIDEO_CAPABILITIES: VideoCapabilityManifest = {
  seedance_omni: false,
  comfyui_available: false,
  manifest_version: 'unavailable',
  models: [],
};

let videoCapabilitiesCache: VideoCapabilityManifest | null = null;
let videoCapabilitiesPromise: Promise<VideoCapabilityManifest> | null = null;
const scopedVideoCapabilitiesCache = new Map<string, VideoCapabilityManifest>();
const scopedVideoCapabilitiesPromise = new Map<string, Promise<VideoCapabilityManifest>>();

function normalizeCapabilityScope(scope?: string): string {
  const value = String(scope || 'workflow').trim().toLowerCase();
  return value || 'workflow';
}

export function fetchVideoCapabilities(
  scope: string = 'workflow',
  options: { force?: boolean } = {},
): Promise<VideoCapabilityManifest> {
  const cacheKey = normalizeCapabilityScope(scope);
  if (!options.force && cacheKey === 'workflow' && videoCapabilitiesCache) return Promise.resolve(videoCapabilitiesCache);
  const scopedCache = scopedVideoCapabilitiesCache.get(cacheKey);
  if (!options.force && scopedCache) return Promise.resolve(scopedCache);

  let promise = options.force
    ? null
    : (cacheKey === 'workflow' ? videoCapabilitiesPromise : scopedVideoCapabilitiesPromise.get(cacheKey));
  if (!promise) {
    const query = cacheKey === 'workflow' ? '' : `?scope=${encodeURIComponent(cacheKey)}`;
    promise = apiJson<VideoCapabilityManifest>(
      `/api/video/capabilities${query}`,
      { method: 'GET' },
      'fetchVideoCapabilities',
    )
      .then((data) => {
        const normalized: VideoCapabilityManifest = {
          seedance_omni: !!data.seedance_omni,
          comfyui_available: !!data.comfyui_available,
          manifest_version: String(data.manifest_version || 'legacy'),
          model_scope: String(data.model_scope || cacheKey),
          models: Array.isArray(data.models) ? data.models : [],
        };
        if (cacheKey === 'workflow') videoCapabilitiesCache = normalized;
        scopedVideoCapabilitiesCache.set(cacheKey, normalized);
        return normalized;
      })
      .catch(() => {
        const unavailable = { ...UNAVAILABLE_VIDEO_CAPABILITIES, model_scope: cacheKey };
        if (cacheKey === 'workflow') videoCapabilitiesCache = unavailable;
        scopedVideoCapabilitiesCache.set(cacheKey, unavailable);
        return unavailable;
      });
    if (cacheKey === 'workflow') videoCapabilitiesPromise = promise;
    scopedVideoCapabilitiesPromise.set(cacheKey, promise);
  }
  return promise;
}

export function fetchSeedanceOmni(scope?: string): Promise<boolean> {
  return fetchVideoCapabilities(scope).then(data => data.seedance_omni);
}

export function fetchComfyuiAvailable(scope?: string): Promise<boolean> {
  return fetchVideoCapabilities(scope).then(data => data.comfyui_available);
}

export interface ComposeStatus {
  success?: boolean;
  status: 'idle' | 'running' | 'done' | 'failed';
  total: number;
  done: number;
  url?: string | null;
  duration?: number;
  error?: string | null;
  audio_mode?: ComposeAudioMode;
}

export type ComposeAudioMode = 'video_original' | 'reference_dubbing';
export const DEFAULT_COMPOSE_AUDIO_MODE: ComposeAudioMode = 'video_original';

export interface ComposeTimelineItem {
  clip_id: string;
  segment_id: string;
  start_ms: number;
  duration_ms: number;
  source_offset_ms: number;
  source_duration_ms?: number;
  source_identity?: string;
  duration_corrected?: boolean;
  transition_after?: 'cut' | 'fade' | 'black';
  transition_duration_ms?: number;
}

export interface ComposeSubtitleCue {
  cue_id: string;
  text: string;
  start_ms: number;
  duration_ms: number;
}

export interface ComposeSubtitleStyle {
  font_size: number;
  text_color: string;
  background_color: string;
  background_opacity: number;
  position: 'top' | 'center' | 'bottom';
  position_x?: number;
  position_y?: number;
}

export interface VideoTake {
  segment_id: string;
  take_id?: string | null;
  video_url: string;
  thumbnail_url?: string | null;
  created_at?: string | null;
  is_selected?: boolean;
}

export interface VideoShot {
  item_id: string;
  sort_order: number;
  scene?: string;
  dialogue?: string;
  takes: VideoTake[];
  selected_segment_id?: string | null;
}

export async function createVideoSegment(episodeId: string, data: any) {
  return apiJson<any>(`/api/episodes/${episodeId}/video-segments`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, 'createVideoSegment');
}

export async function updateVideoSegment(segmentId: string, data: any) {
  return apiJson<any>(`/api/video-segments/${segmentId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateVideoSegment');
}

export async function getVideoTakes(episodeId: string): Promise<{ success: boolean; shots: VideoShot[] }> {
  return apiJson<any>(`/api/episodes/${episodeId}/video-takes`, { method: 'GET' }, 'getVideoTakes');
}

export async function startCompose(
  episodeId: string,
  selections?: Record<string, string>,
  audioMode: ComposeAudioMode = DEFAULT_COMPOSE_AUDIO_MODE,
  timeline?: ComposeTimelineItem[],
  subtitles?: ComposeSubtitleCue[],
  subtitleStyle?: ComposeSubtitleStyle,
): Promise<ComposeStatus> {
  return apiJson<any>(`/api/episodes/${episodeId}/compose`, {
    method: 'POST',
    body: JSON.stringify({
      ...(selections ? { selections } : {}),
      audio_mode: audioMode,
      ...(timeline?.length ? { timeline } : {}),
      ...(subtitles ? { subtitles } : {}),
      ...(subtitleStyle ? { subtitle_style: subtitleStyle } : {}),
    }),
  }, 'startCompose');
}

export async function getComposeStatus(episodeId: string): Promise<ComposeStatus> {
  return apiJson<any>(`/api/episodes/${episodeId}/compose/status`, { method: 'GET' }, 'getComposeStatus');
}

export async function preflightCompose(
  episodeId: string,
  timeline: ComposeTimelineItem[],
): Promise<{ success: boolean; timeline: ComposeTimelineItem[]; corrected: boolean }> {
  return apiJson<any>(`/api/episodes/${episodeId}/compose/preflight`, {
    method: 'POST',
    body: JSON.stringify({ timeline }),
  }, 'preflightCompose');
}
