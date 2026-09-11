import type { TaskGroup, UploadedImage } from '../services/videoTaskTypes';
import type { StoryboardMeta } from '../services/videoWorkspaceService';
import { resolveShotTargetDurationMs } from './durationMapping';

export interface VideoShotTiming {
  itemId: string;
  label: string;
  plannedMs: number | null;
  audioMs: number | null;
  targetMs: number | null;
}
export interface VideoGroupTiming {
  shots: VideoShotTiming[];
  plannedMs: number | null;
  audioMs: number | null;
  targetMs: number | null;
}
const positive = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Live script/audio metadata wins over a previous video-workspace snapshot.
 * Missing fields are not zero durations; explicit null clears stale audio. */
export function mergeVideoTimingMetadata(saved: Record<string, StoryboardMeta>, items: any[]): Record<string, StoryboardMeta> {
  const result = { ...saved };
  for (const item of items) {
    const id = String(item.item_id || item.itemId || '');
    if (!id) continue;
    const patch: Partial<StoryboardMeta> = {};
    for (const [snake, camel] of [['planned_duration_ms', 'plannedDurationMs'], ['audio_duration_ms', 'audioDurationMs']] as const) {
      if (snake in item || camel in item) patch[camel] = positive(snake in item ? item[snake] : item[camel]) ?? undefined;
    }
    result[id] = { ...result[id], ...patch };
  }
  return result;
}

/** Membership is group.ids, never the reference-image pool. Calibrate each shot
 * before summing so unused action time in one shot cannot erase another's tail. */
export function resolveVideoGroupTiming(
  group: Pick<TaskGroup, 'ids'>,
  images: UploadedImage[],
  metadata: Record<string, StoryboardMeta>,
): VideoGroupTiming {
  const seen = new Set<string>();
  const shots = group.ids.flatMap<VideoShotTiming>((id, index) => {
    const image = images.find(image => image.id === id);
    const itemId = image?.storyboardItemId || id;
    if (seen.has(itemId)) return [];
    seen.add(itemId);
    const meta = metadata[itemId];
    const plannedMs = positive(meta?.plannedDurationMs);
    const audioMs = positive(meta?.audioDurationMs);
    return [{ itemId, label: image?.storyboardShotLabel || `镜头${index + 1}`,
      plannedMs, audioMs,
      targetMs: plannedMs != null || audioMs != null ? resolveShotTargetDurationMs({
        plannedDurationMs: plannedMs ?? undefined, audioDurationMs: audioMs ?? undefined,
      }) : null,
    }];
  });
  const completeTotal = (key: 'plannedMs' | 'targetMs') => shots.length && shots.every(shot => shot[key] != null)
    ? shots.reduce((sum, shot) => sum + shot[key]!, 0) : null;
  return { shots, plannedMs: completeTotal('plannedMs'), targetMs: completeTotal('targetMs'),
    audioMs: shots.some(shot => shot.audioMs != null) ? shots.reduce((sum, shot) => sum + (shot.audioMs || 0), 0) : null };
}

export function resolveVideoSelectedSeconds(group: Pick<TaskGroup, 'duration' | 'durationUserOverride'>,
  timing: VideoGroupTiming, minSeconds: number, maxSeconds: number): number {
  // Preserve explicit legacy choices, including invalid ones, so preflight can
  // explain them instead of silently submitting/charging a different duration.
  if (group.durationUserOverride && positive(group.duration) != null) return Number(group.duration);
  const target = timing.targetMs != null ? Math.ceil(timing.targetMs / 1000) : positive(group.duration) ?? 5;
  return Math.max(minSeconds, Math.min(maxSeconds, target));
}

export const formatTimingSeconds = (ms: number | null): string => ms == null ? '未提供' : `${Number((ms / 1000).toFixed(3))}秒`;

export function getVideoDurationShortfall(timing: VideoGroupTiming, selectedSeconds: number): string | null {
  const target = timing.targetMs ?? timing.plannedMs;
  if (target == null || selectedSeconds * 1000 >= target) return null;
  return `当前选用 ${selectedSeconds} 秒，少于镜头校准时长 ${formatTimingSeconds(target)}（脚本 ${formatTimingSeconds(timing.plannedMs)}，已生成配音 ${formatTimingSeconds(timing.audioMs)}）。\n可能导致对白或动作无法完成，仍要生成视频吗？`;
}
