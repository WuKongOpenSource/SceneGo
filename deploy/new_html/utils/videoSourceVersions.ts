import type { EntityFile } from '../services/entityFileService';
import type { EnhanceMediaClip } from './enhanceSourceClips';

export function videoSourceSettings(file?: EntityFile): NonNullable<EnhanceMediaClip['settings']> {
  let metadata = file?.metadata;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
  }
  const records = [metadata, metadata?.generation_params].filter(value => value && typeof value === 'object') as Record<string, unknown>[];
  const values = records.flatMap(record => ['model', 'task_type', 'requested_workflow_type', 'workflow_name']
    .map(key => String(record[key] || '').trim().toLowerCase()));
  const kinds = file?.enhancementKinds ?? [];
  // Legacy verified HD results may still identify their underlying engine.
  const rawTiming = metadata?.timing_contract;
  const timing = rawTiming && typeof rawTiming === 'object' ? rawTiming as Record<string, unknown> : undefined;
  const verifiedHd = timing
    && typeof timing.source_duration_ms === 'number' && timing.source_duration_ms > 0
    && timing.output_duration_ms === timing.source_duration_ms
    && typeof timing.source_frame_count === 'number' && Number.isInteger(timing.source_frame_count) && timing.source_frame_count > 0
    && Boolean(timing.source_fps);
  return {
    upscale: Boolean(verifiedHd) || kinds.includes('upscale') || values.some(v => ['upscale', 'viedo_upscaler', 'video_upscale', 'video-upscale'].includes(v)),
    interpolate: kinds.includes('interpolate') || values.some(v => ['interpolate', 'video_interpolate', 'frame_interpolation'].includes(v)),
    lipSync: kinds.includes('lipSync') || values.some(v => ['video_voice', 'video_infinitetalk', 'lipsync', 'lip_sync'].includes(v)),
  };
}

export function videoSourceLabels(settings?: EnhanceMediaClip['settings']): string[] {
  return [settings?.upscale ? '已高清化' : '', settings?.interpolate ? '已补帧' : '', settings?.lipSync ? '已对口型' : ''].filter(Boolean);
}

export function applyVideoSource(clips: EnhanceMediaClip[], sourceId: string, file: EntityFile, url: string): EnhanceMediaClip[] {
  return clips.map(clip => clip.type === 'video' && !clip.isBlack && (clip.sourceId || clip.id) === sourceId ? {
    ...clip, url, thumbnailUrl: undefined, enhancement: videoSourceSettings(file),
    sourceDuration: file.durationSeconds || clip.sourceDuration,
  } : clip);
}
