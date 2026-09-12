import type { EnhanceMediaClip } from './enhanceSourceClips';

export const MIN_TIMELINE_CLIP_DURATION = 0.1;
export const MIN_SUBTITLE_DURATION = 0.2;

export type EnhanceSubtitlePosition = 'top' | 'center' | 'bottom';

export interface EnhanceSubtitleCue {
  id: string;
  text: string;
  startTime: number;
  duration: number;
}

export interface EnhanceSubtitleStyle {
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  position: EnhanceSubtitlePosition;
  positionX?: number;
  positionY?: number;
}

export const DEFAULT_ENHANCE_SUBTITLE_STYLE: EnhanceSubtitleStyle = {
  fontSize: 42,
  textColor: '#FFFFFF',
  backgroundColor: '#000000',
  backgroundOpacity: 0.55,
  position: 'bottom',
};

export interface PersistedEnhanceTimelineItem {
  kind: 'video' | 'excluded_video' | 'audio' | 'audio_sources' | 'subtitle' | 'subtitle_style';
  sourceIds?: string[];
  volume?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  clipId?: string;
  sourceId?: string;
  cueId?: string;
  text?: string;
  startMs?: number;
  durationMs?: number;
  sourceOffsetMs?: number;
  fontSize?: number;
  textColor?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  position?: EnhanceSubtitlePosition;
  positionX?: number;
  positionY?: number;
  transitionAfter?: EnhanceMediaClip['transitionAfter'];
  transitionDurationMs?: number;
  settings?: EnhanceMediaClip['settings'];
}

export interface ComposeTimelineItem {
  clip_id: string;
  segment_id: string;
  start_ms: number;
  duration_ms: number;
  source_offset_ms: number;
  source_duration_ms?: number;
  source_identity?: string;
  duration_corrected?: boolean;
  transition_after?: NonNullable<EnhanceMediaClip['transitionAfter']>;
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
  position: EnhanceSubtitlePosition;
  position_x?: number;
  position_y?: number;
}

export interface SnapResult {
  time: number;
  guide: number | null;
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeHexColor(value: unknown, fallback: string): string {
  const color = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : fallback;
}

export function normalizeEnhanceSubtitleStyle(value: unknown): EnhanceSubtitleStyle {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const position = raw.position === 'top' || raw.position === 'center' || raw.position === 'bottom'
    ? raw.position
    : DEFAULT_ENHANCE_SUBTITLE_STYLE.position;
  return {
    fontSize: Math.round(clamp(finite(raw.fontSize, DEFAULT_ENHANCE_SUBTITLE_STYLE.fontSize), 16, 96)),
    textColor: normalizeHexColor(raw.textColor, DEFAULT_ENHANCE_SUBTITLE_STYLE.textColor),
    backgroundColor: normalizeHexColor(raw.backgroundColor, DEFAULT_ENHANCE_SUBTITLE_STYLE.backgroundColor),
    backgroundOpacity: roundTime(clamp(
      finite(raw.backgroundOpacity, DEFAULT_ENHANCE_SUBTITLE_STYLE.backgroundOpacity),
      0,
      1,
    )),
    position,
    ...(typeof raw.positionX === 'number' && Number.isFinite(raw.positionX)
      ? { positionX: roundTime(clamp(raw.positionX, 0, 100)) } : {}),
    ...(typeof raw.positionY === 'number' && Number.isFinite(raw.positionY)
      ? { positionY: roundTime(clamp(raw.positionY, 0, 100)) } : {}),
  };
}

/** Percent coordinates use the same top/center/bottom anchor as ASS output. */
export function resolveSubtitleCoordinates(style: EnhanceSubtitleStyle): { x: number; y: number } {
  const normalized = normalizeEnhanceSubtitleStyle(style);
  return {
    x: normalized.positionX ?? 50,
    y: normalized.positionY ?? ({ top: 6, center: 50, bottom: 94 }[normalized.position]),
  };
}

export function normalizeEnhanceSubtitleCue(value: unknown): EnhanceSubtitleCue | null {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) return null;
  return {
    id: raw.id.slice(0, 200),
    text: String(raw.text || '').replace(/\r\n?/g, '\n').slice(0, 500),
    startTime: roundTime(Math.max(0, finite(raw.startTime))),
    duration: roundTime(clamp(finite(raw.duration, 3), MIN_SUBTITLE_DURATION, 3600)),
  };
}

export function moveSubtitleCue(
  subtitles: EnhanceSubtitleCue[],
  cueId: string,
  startTime: number,
  timelineDuration = Number.POSITIVE_INFINITY,
): EnhanceSubtitleCue[] {
  return subtitles.map(cue => cue.id === cueId
    ? {
        ...cue,
        startTime: roundTime(clamp(
          finite(startTime),
          0,
          Math.max(0, timelineDuration - cue.duration),
        )),
      }
    : cue);
}

export function trimSubtitleCue(
  subtitles: EnhanceSubtitleCue[],
  cueId: string,
  side: 'left' | 'right',
  deltaSeconds: number,
  timelineDuration = Number.POSITIVE_INFINITY,
): EnhanceSubtitleCue[] {
  return subtitles.map(cue => {
    if (cue.id !== cueId) return cue;
    if (side === 'left') {
      const applied = clamp(
        finite(deltaSeconds),
        -cue.startTime,
        cue.duration - MIN_SUBTITLE_DURATION,
      );
      return {
        ...cue,
        startTime: roundTime(cue.startTime + applied),
        duration: roundTime(cue.duration - applied),
      };
    }
    return {
      ...cue,
      duration: roundTime(clamp(
        cue.duration + finite(deltaSeconds),
        MIN_SUBTITLE_DURATION,
        Math.max(MIN_SUBTITLE_DURATION, timelineDuration - cue.startTime),
      )),
    };
  });
}

function cloneClip(clip: EnhanceMediaClip): EnhanceMediaClip {
  return {
    ...clip,
    settings: clip.settings ? { ...clip.settings } : undefined,
  };
}

export function cloneEnhanceClips(clips: EnhanceMediaClip[]): EnhanceMediaClip[] {
  return clips.map(cloneClip);
}

export function clipEnd(clip: EnhanceMediaClip): number {
  return clip.startTime + clip.duration;
}

function transitionGap(clip: EnhanceMediaClip): number {
  if (clip.transitionAfter !== 'black') return 0;
  return roundTime(clamp(finite(clip.transitionDuration, 0.5), 0.1, 3));
}

export function layoutVideoClips(clips: EnhanceMediaClip[]): EnhanceMediaClip[] {
  const videos = clips
    .filter(clip => clip.type === 'video')
    .slice()
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  let cursor = 0;
  const positioned = new Map<string, EnhanceMediaClip>();
  for (const [index, clip] of videos.entries()) {
    const duration = Math.max(MIN_TIMELINE_CLIP_DURATION, finite(clip.duration, MIN_TIMELINE_CLIP_DURATION));
    positioned.set(clip.id, { ...clip, startTime: roundTime(cursor), duration: roundTime(duration) });
    cursor += duration + (index < videos.length - 1 ? transitionGap(clip) : 0);
  }
  return clips.map(clip => positioned.get(clip.id) || clip);
}

export function timelineSnapPoints(
  clips: EnhanceMediaClip[],
  excludeClipId?: string,
  playhead?: number,
): number[] {
  const points = new Set<number>([0]);
  if (Number.isFinite(playhead)) points.add(roundTime(Math.max(0, playhead || 0)));
  for (const clip of clips) {
    if (clip.id === excludeClipId) continue;
    points.add(roundTime(Math.max(0, clip.startTime)));
    points.add(roundTime(Math.max(0, clipEnd(clip))));
  }
  return [...points].sort((a, b) => a - b);
}

export function resolveTimelineSnap(
  rawTime: number,
  points: number[],
  thresholdSeconds: number,
): SnapResult {
  let guide: number | null = null;
  let closest = Math.max(0, finite(rawTime));
  let distance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const nextDistance = Math.abs(point - rawTime);
    if (nextDistance <= thresholdSeconds && nextDistance < distance) {
      distance = nextDistance;
      closest = point;
      guide = point;
    }
  }
  return { time: roundTime(Math.max(0, closest)), guide };
}

export function splitTimelineClip(
  clips: EnhanceMediaClip[],
  clipId: string,
  splitTime: number,
  nextId: string,
): EnhanceMediaClip[] {
  const index = clips.findIndex(clip => clip.id === clipId);
  if (index < 0) return clips;
  const clip = clips[index];
  const relative = splitTime - clip.startTime;
  if (relative < MIN_TIMELINE_CLIP_DURATION || clip.duration - relative < MIN_TIMELINE_CLIP_DURATION) {
    return clips;
  }
  const left = {
    ...clip,
    duration: roundTime(relative),
    ...(clip.type === 'video' ? { transitionAfter: 'cut' as const, transitionDuration: undefined } : {}),
  };
  const right = {
    ...clip,
    id: nextId,
    sourceId: clip.sourceId || clip.id,
    startTime: roundTime(splitTime),
    sourceOffset: roundTime(clip.sourceOffset + relative),
    duration: roundTime(clip.duration - relative),
  };
  const next = cloneEnhanceClips(clips);
  next.splice(index, 1, left, right);
  return clip.type === 'video' ? layoutVideoClips(next) : next;
}

export function deleteTimelineClip(
  clips: EnhanceMediaClip[],
  clipId: string,
  ripple = true,
): EnhanceMediaClip[] {
  const target = clips.find(clip => clip.id === clipId);
  const next = clips.filter(clip => clip.id !== clipId);
  return target?.type === 'video' && ripple ? layoutVideoClips(next) : next;
}

export function duplicateTimelineClip(
  clips: EnhanceMediaClip[],
  clipId: string,
  nextId: string,
): EnhanceMediaClip[] {
  const index = clips.findIndex(clip => clip.id === clipId);
  if (index < 0) return clips;
  const source = clips[index];
  const duplicate: EnhanceMediaClip = {
    ...cloneClip(source),
    id: nextId,
    sourceId: source.sourceId || source.id,
    startTime: roundTime(clipEnd(source)),
  };
  const next = cloneEnhanceClips(clips);
  if (source.type === 'video') {
    next[index] = { ...next[index], transitionAfter: 'cut', transitionDuration: undefined };
  }
  next.splice(index + 1, 0, duplicate);
  return source.type === 'video' ? layoutVideoClips(next) : next;
}

export function moveTimelineClip(
  clips: EnhanceMediaClip[],
  clipId: string,
  targetStart: number,
  options: { ripple?: boolean; snap?: boolean; playhead?: number; snapThreshold?: number } = {},
): { clips: EnhanceMediaClip[]; guide: number | null } {
  const target = clips.find(clip => clip.id === clipId);
  if (!target) return { clips, guide: null };
  const snapResult = options.snap === false
    ? { time: roundTime(Math.max(0, targetStart)), guide: null }
    : resolveTimelineSnap(
        targetStart,
        timelineSnapPoints(clips, clipId, options.playhead),
        options.snapThreshold ?? 0.2,
      );
  if (target.type !== 'video' || options.ripple === false) {
    return {
      clips: clips.map(clip => clip.id === clipId ? { ...clip, startTime: snapResult.time } : clip),
      guide: snapResult.guide,
    };
  }

  const videos = clips
    .filter(clip => clip.type === 'video' && clip.id !== clipId)
    .slice()
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  const insertIndex = videos.findIndex(clip => snapResult.time < clip.startTime + clip.duration / 2);
  videos.splice(insertIndex < 0 ? videos.length : insertIndex, 0, target);
  let cursor = 0;
  const positioned = new Map<string, EnhanceMediaClip>();
  for (const [index, clip] of videos.entries()) {
    positioned.set(clip.id, { ...clip, startTime: roundTime(cursor) });
    cursor += clip.duration + (index < videos.length - 1 ? transitionGap(clip) : 0);
  }
  return {
    clips: clips.map(clip => positioned.get(clip.id) || clip),
    guide: snapResult.guide,
  };
}

export function trimTimelineClip(
  clips: EnhanceMediaClip[],
  clipId: string,
  side: 'left' | 'right',
  deltaSeconds: number,
  ripple = true,
): EnhanceMediaClip[] {
  const target = clips.find(clip => clip.id === clipId);
  if (!target) return clips;
  const sourceDuration = Math.max(target.sourceDuration || Number.POSITIVE_INFINITY, MIN_TIMELINE_CLIP_DURATION);
  let applied = finite(deltaSeconds);
  if (side === 'left') {
    const availableBefore = target.type === 'video' && ripple
      ? target.sourceOffset
      : Math.min(target.startTime, target.sourceOffset);
    applied = Math.max(-availableBefore, applied);
    applied = Math.min(target.duration - MIN_TIMELINE_CLIP_DURATION, applied);
  } else {
    const maxGrowth = sourceDuration - target.sourceOffset - target.duration;
    applied = Math.min(maxGrowth, applied);
    applied = Math.max(MIN_TIMELINE_CLIP_DURATION - target.duration, applied);
  }
  const next = clips.map(clip => {
    if (clip.id !== clipId) return clip;
    if (side === 'left') {
      return {
        ...clip,
        startTime: roundTime(clip.startTime + applied),
        sourceOffset: roundTime(clip.sourceOffset + applied),
        duration: roundTime(clip.duration - applied),
      };
    }
    return { ...clip, duration: roundTime(clip.duration + applied) };
  });
  return target.type === 'video' && ripple ? layoutVideoClips(next) : next;
}

export function serializeEnhanceTimeline(
  clips: EnhanceMediaClip[],
  knownVideoSourceIds: string[],
  subtitles: EnhanceSubtitleCue[] = [],
  subtitleStyle: EnhanceSubtitleStyle = DEFAULT_ENHANCE_SUBTITLE_STYLE,
  knownAudioSourceIds: string[] = [],
): PersistedEnhanceTimelineItem[] {
  const videoClips = clips.filter(clip => clip.type === 'video');
  const presentSources = new Set(videoClips.map(clip => clip.sourceId || clip.id));
  const normalizedStyle = normalizeEnhanceSubtitleStyle(subtitleStyle);
  return [
    ...videoClips.map(clip => ({
      kind: 'video' as const,
      clipId: clip.id,
      sourceId: clip.sourceId || clip.id,
      startMs: Math.round(clip.startTime * 1000),
      durationMs: Math.round(clip.duration * 1000),
      sourceOffsetMs: Math.round(clip.sourceOffset * 1000),
      ...(clip.transitionAfter && clip.transitionAfter !== 'cut' ? {
        transitionAfter: clip.transitionAfter,
        transitionDurationMs: Math.round(clamp(finite(clip.transitionDuration, 0.5), 0.1, 3) * 1000),
      } : {}),
      settings: clip.settings ? { ...clip.settings } : undefined,
    })),
    ...knownVideoSourceIds
      .filter(sourceId => !presentSources.has(sourceId))
      .map(sourceId => ({ kind: 'excluded_video' as const, sourceId })),
    { kind: 'audio_sources', sourceIds: [...new Set([
      ...knownAudioSourceIds, ...clips.filter(c => c.type === 'audio').map(c => c.sourceId || c.id),
    ])] },
    ...clips.filter(c => c.type === 'audio').map(clip => ({
      kind: 'audio' as const, clipId: clip.id, sourceId: clip.sourceId || clip.id,
      startMs: Math.round(clip.startTime * 1000), durationMs: Math.round(clip.duration * 1000),
      sourceOffsetMs: Math.round(clip.sourceOffset * 1000),
      volume: clamp(finite(clip.volume, clip.audioKind === 'bgm' ? 0.35 : 1), 0, 1),
      fadeInMs: Math.round((clip.fadeIn || 0) * 1000), fadeOutMs: Math.round((clip.fadeOut || 0) * 1000),
    })),
    ...subtitles.flatMap(cue => {
      const normalized = normalizeEnhanceSubtitleCue(cue);
      return normalized ? [{
        kind: 'subtitle' as const,
        cueId: normalized.id,
        text: normalized.text,
        startMs: Math.round(normalized.startTime * 1000),
        durationMs: Math.round(normalized.duration * 1000),
      }] : [];
    }),
    {
      kind: 'subtitle_style' as const,
      fontSize: normalizedStyle.fontSize,
      textColor: normalizedStyle.textColor,
      backgroundColor: normalizedStyle.backgroundColor,
      backgroundOpacity: normalizedStyle.backgroundOpacity,
      position: normalizedStyle.position,
      ...(normalizedStyle.positionX !== undefined ? { positionX: normalizedStyle.positionX } : {}),
      ...(normalizedStyle.positionY !== undefined ? { positionY: normalizedStyle.positionY } : {}),
    },
  ];
}

export function restoreEnhanceTimeline(
  sourceClips: EnhanceMediaClip[],
  items: PersistedEnhanceTimelineItem[],
): EnhanceMediaClip[] {
  const sourceVideos = sourceClips.filter(clip => clip.type === 'video');
  const sourceAudio = sourceClips.filter(clip => clip.type === 'audio');
  const sourceById = new Map(sourceVideos.map(clip => [clip.sourceId || clip.id, clip]));
  const excluded = new Set(items
    .filter(item => item.kind === 'excluded_video' && item.sourceId)
    .map(item => String(item.sourceId)));
  const restored: EnhanceMediaClip[] = [];
  const usedSources = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'video') continue;
    if (!item.sourceId) continue;
    const source = sourceById.get(item.sourceId);
    if (!source) continue;
    usedSources.add(item.sourceId);
    restored.push({
      ...source,
      id: item.clipId || source.id,
      sourceId: item.sourceId,
      startTime: Math.max(0, finite(item.startMs) / 1000),
      duration: Math.max(MIN_TIMELINE_CLIP_DURATION, finite(item.durationMs, source.duration * 1000) / 1000),
      sourceOffset: Math.max(0, finite(item.sourceOffsetMs) / 1000),
      transitionAfter: item.transitionAfter === 'fade' || item.transitionAfter === 'black'
        ? item.transitionAfter
        : 'cut',
      transitionDuration: item.transitionAfter === 'fade' || item.transitionAfter === 'black'
        ? clamp(finite(item.transitionDurationMs, 500) / 1000, 0.1, 3)
        : undefined,
      settings: item.settings ? { ...item.settings } : source.settings,
    });
  }
  let cursor = restored.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
  for (const source of sourceVideos) {
    const sourceId = source.sourceId || source.id;
    if (usedSources.has(sourceId) || excluded.has(sourceId)) continue;
    restored.push({ ...source, startTime: roundTime(cursor) });
    cursor += source.duration;
  }
  const audioById = new Map(sourceAudio.map(clip => [clip.sourceId || clip.id, clip]));
  const knownAudio = new Set(items.filter(item => item.kind === 'audio_sources').flatMap(item => item.sourceIds || []));
  const restoredAudio = items.flatMap(item => {
    if (item.kind !== 'audio' || !item.sourceId) return [];
    const source = audioById.get(item.sourceId);
    if (!source) return [];
    knownAudio.add(item.sourceId);
    return [{ ...source, id: item.clipId || source.id, sourceId: item.sourceId,
      startTime: Math.max(0, finite(item.startMs) / 1000),
      duration: Math.max(MIN_TIMELINE_CLIP_DURATION, finite(item.durationMs, source.duration * 1000) / 1000),
      sourceOffset: Math.max(0, finite(item.sourceOffsetMs) / 1000),
      volume: clamp(finite(item.volume, source.volume ?? 1), 0, 1),
      fadeIn: Math.max(0, finite(item.fadeInMs) / 1000), fadeOut: Math.max(0, finite(item.fadeOutMs) / 1000),
    }];
  });
  return [...layoutVideoClips(restored), ...restoredAudio,
    ...sourceAudio.filter(clip => !knownAudio.has(clip.sourceId || clip.id))];
}

export function restoreEnhanceSubtitles(
  items: PersistedEnhanceTimelineItem[],
): EnhanceSubtitleCue[] {
  return items.flatMap(item => {
    if (item.kind !== 'subtitle' || !item.cueId) return [];
    const cue = normalizeEnhanceSubtitleCue({
      id: item.cueId,
      text: item.text,
      startTime: finite(item.startMs) / 1000,
      duration: finite(item.durationMs, 3000) / 1000,
    });
    return cue ? [cue] : [];
  }).sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
}

export function restoreEnhanceSubtitleStyle(
  items: PersistedEnhanceTimelineItem[],
): EnhanceSubtitleStyle {
  const item = items.find(candidate => candidate.kind === 'subtitle_style');
  return normalizeEnhanceSubtitleStyle(item ? {
    fontSize: item.fontSize,
    textColor: item.textColor,
    backgroundColor: item.backgroundColor,
    backgroundOpacity: item.backgroundOpacity,
    position: item.position,
    positionX: item.positionX,
    positionY: item.positionY,
  } : DEFAULT_ENHANCE_SUBTITLE_STYLE);
}

export function composeTimelineItems(clips: EnhanceMediaClip[]): ComposeTimelineItem[] {
  return clips
    .filter(clip => clip.type === 'video')
    .slice()
    .sort((a, b) => a.startTime - b.startTime)
    .map(clip => ({
      clip_id: clip.id,
      segment_id: clip.sourceId || clip.id,
      start_ms: Math.round(clip.startTime * 1000),
      duration_ms: Math.max(100, Math.round(clip.duration * 1000)),
      source_offset_ms: Math.max(0, Math.round(clip.sourceOffset * 1000)),
      source_duration_ms: Math.max(100, Math.round((clip.sourceDuration || clip.duration) * 1000)),
      ...(clip.transitionAfter && clip.transitionAfter !== 'cut' ? {
        transition_after: clip.transitionAfter,
        transition_duration_ms: Math.round(clamp(finite(clip.transitionDuration, 0.5), 0.1, 3) * 1000),
      } : {}),
    }));
}

export function composeSubtitleItems(subtitles: EnhanceSubtitleCue[]): ComposeSubtitleCue[] {
  return subtitles.flatMap(cue => {
    const normalized = normalizeEnhanceSubtitleCue(cue);
    if (!normalized || !normalized.text.trim()) return [];
    return [{
      cue_id: normalized.id,
      text: normalized.text,
      start_ms: Math.round(normalized.startTime * 1000),
      duration_ms: Math.round(normalized.duration * 1000),
    }];
  }).sort((a, b) => a.start_ms - b.start_ms || a.cue_id.localeCompare(b.cue_id));
}

export function composeSubtitleStyle(style: EnhanceSubtitleStyle): ComposeSubtitleStyle {
  const normalized = normalizeEnhanceSubtitleStyle(style);
  return {
    font_size: normalized.fontSize,
    text_color: normalized.textColor,
    background_color: normalized.backgroundColor,
    background_opacity: normalized.backgroundOpacity,
    position: normalized.position,
    ...(normalized.positionX !== undefined ? { position_x: normalized.positionX } : {}),
    ...(normalized.positionY !== undefined ? { position_y: normalized.positionY } : {}),
  };
}

export function formatTimelineTime(seconds: number, fps = 30): string {
  const safe = Math.max(0, finite(seconds));
  const wholeSeconds = Math.floor(safe);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;
  const frames = Math.min(fps - 1, Math.floor((safe - wholeSeconds) * fps));
  return [hours, minutes, secs, frames].map(value => String(value).padStart(2, '0')).join(':');
}
