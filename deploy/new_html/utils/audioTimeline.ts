import type { AudioClipInfo, StoryboardItemDB } from '../types';
import { estimateDurationMs, resolveShotTargetDurationMs } from './durationMapping';

export type LocalAudioMap = Record<string, { url: string; durationMs?: number }>;

function positiveDurationMs(value: unknown): number | null {
  const durationMs = Number(value);
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null;
}

export function extractStoryboardDurationLabel(item: StoryboardItemDB): string | undefined {
  const source = [
    item.videoScriptBlock,
    item.actionText,
    item.sceneHeading,
  ].filter(Boolean).join('\n');
  const match = source.match(
    /(?:时长|时间)(?:\s*[（(]\s*秒\s*[)）])?\s*[：:]\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?/i,
  );
  return match ? `${match[1]}秒` : undefined;
}

export function resolveStoryboardPlannedDurationMs(item: StoryboardItemDB): number {
  return positiveDurationMs(item.plannedDurationMs)
    ?? estimateDurationMs({
      durationStr: extractStoryboardDurationLabel(item),
      dialogueText: item.dialogue || '',
    });
}

export interface ResolveShotDurationOptions {
  item: StoryboardItemDB;
  clips: AudioClipInfo[];
  localAudio: LocalAudioMap;
  clipKeyFn: (clip: AudioClipInfo) => string;
}

export function resolveShotDurationMs({
  item,
  clips,
  localAudio,
  clipKeyFn,
}: ResolveShotDurationOptions): number {
  const itemClips = clips
    .filter(clip => clip.itemId === item.itemId)
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const generatedDurations = itemClips.map(clip => {
      const local = localAudio[clipKeyFn(clip)];
      if (local?.url) return positiveDurationMs(local.durationMs);
      if (clip.audioUrl) return positiveDurationMs(clip.durationMs);
      return null;
    });

  if (generatedDurations.some((durationMs) => durationMs != null)) {
    const speechDurationMs = generatedDurations.reduce((total, durationMs, index) => (
      total + (durationMs ?? estimateDurationMs({ dialogueText: itemClips[index]?.text || '' }))
    ), 0);
    const silenceDurationMs = (item.audioSegments || [])
      .filter(segment => segment.kind === 'silence')
      .reduce((total, segment) => total + (positiveDurationMs(segment.durationMs) || 0), 0);
    return resolveShotTargetDurationMs({
      plannedDurationMs: resolveStoryboardPlannedDurationMs(item),
      audioDurationMs: speechDurationMs + silenceDurationMs,
    });
  }
  return resolveStoryboardPlannedDurationMs(item);
}

export function resolveAudioTimelineTotalMs(
  storyboardItems: StoryboardItemDB[],
  clips: AudioClipInfo[],
  localAudio: LocalAudioMap,
  clipKeyFn: (clip: AudioClipInfo) => string,
): number {
  return storyboardItems.reduce(
    (total, item) => total + resolveShotDurationMs({ item, clips, localAudio, clipKeyFn }),
    0,
  );
}
