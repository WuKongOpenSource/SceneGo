import type { AudioTrack } from '../types';

export interface AudioTrackTimelineEdit {
  startMs: number;
  sourceOffsetMs: number;
  durationMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  volume: number;
}

const MIN_CLIP_DURATION_MS = 100;

function finiteMs(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function timelineParams(track: AudioTrack): Record<string, unknown> {
  const raw = track.generationParams?.timeline;
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

export function resolveAudioTrackTimeline(
  track: AudioTrack,
  episodeDurationMs: number,
): AudioTrackTimelineEdit {
  const params = timelineParams(track);
  const sourceDurationMs = Math.max(
    MIN_CLIP_DURATION_MS,
    finiteMs(track.durationMs, episodeDurationMs || MIN_CLIP_DURATION_MS),
  );
  const sourceOffsetMs = clamp(
    finiteMs(params.sourceOffsetMs ?? params.source_offset_ms),
    0,
    Math.max(0, sourceDurationMs - MIN_CLIP_DURATION_MS),
  );
  const maximumDurationMs = Math.max(
    MIN_CLIP_DURATION_MS,
    sourceDurationMs - sourceOffsetMs,
  );
  const defaultDurationMs = episodeDurationMs > 0
    ? Math.min(maximumDurationMs, episodeDurationMs)
    : maximumDurationMs;
  const durationMs = clamp(
    finiteMs(params.durationMs ?? params.duration_ms, defaultDurationMs),
    MIN_CLIP_DURATION_MS,
    maximumDurationMs,
  );
  const maximumStartMs = Math.max(0, episodeDurationMs - durationMs);
  const startMs = clamp(
    finiteMs(params.startMs ?? params.start_ms),
    0,
    maximumStartMs,
  );
  const fadeInMs = track.trackType === 'bgm'
    ? clamp(finiteMs(params.fadeInMs ?? params.fade_in_ms), 0, durationMs)
    : 0;
  const fadeOutMs = track.trackType === 'bgm'
    ? clamp(finiteMs(params.fadeOutMs ?? params.fade_out_ms), 0, durationMs - fadeInMs)
    : 0;
  const defaultVolume = track.trackType === 'bgm' ? 0.35 : 1;
  const parsedVolume = Number(params.volume ?? defaultVolume);
  const volume = clamp(Number.isFinite(parsedVolume) ? parsedVolume : defaultVolume, 0, 2);

  return {
    startMs,
    sourceOffsetMs,
    durationMs,
    fadeInMs,
    fadeOutMs,
    volume,
  };
}

export function moveAudioTrackTimeline(
  edit: AudioTrackTimelineEdit,
  deltaMs: number,
  episodeDurationMs: number,
): AudioTrackTimelineEdit {
  return {
    ...edit,
    startMs: clamp(
      edit.startMs + finiteMs(deltaMs),
      0,
      Math.max(0, episodeDurationMs - edit.durationMs),
    ),
  };
}

export function trimAudioTrackTimelineStart(
  edit: AudioTrackTimelineEdit,
  deltaMs: number,
  sourceDurationMs: number,
): AudioTrackTimelineEdit {
  const roundedDeltaMs = finiteMs(deltaMs);
  const minimumDeltaMs = -Math.min(edit.startMs, edit.sourceOffsetMs);
  const maximumDeltaMs = edit.durationMs - MIN_CLIP_DURATION_MS;
  const appliedDeltaMs = clamp(roundedDeltaMs, minimumDeltaMs, maximumDeltaMs);
  const durationMs = edit.durationMs - appliedDeltaMs;
  const fadeInMs = clamp(edit.fadeInMs, 0, durationMs);

  return {
    ...edit,
    startMs: edit.startMs + appliedDeltaMs,
    sourceOffsetMs: clamp(
      edit.sourceOffsetMs + appliedDeltaMs,
      0,
      Math.max(0, sourceDurationMs - MIN_CLIP_DURATION_MS),
    ),
    durationMs,
    fadeInMs,
    fadeOutMs: clamp(edit.fadeOutMs, 0, durationMs - fadeInMs),
  };
}

export function trimAudioTrackTimelineEnd(
  edit: AudioTrackTimelineEdit,
  deltaMs: number,
  sourceDurationMs: number,
  episodeDurationMs: number,
): AudioTrackTimelineEdit {
  const sourceRemainingMs = Math.max(
    MIN_CLIP_DURATION_MS,
    sourceDurationMs - edit.sourceOffsetMs,
  );
  const episodeRemainingMs = Math.max(
    MIN_CLIP_DURATION_MS,
    episodeDurationMs - edit.startMs,
  );
  const durationMs = clamp(
    edit.durationMs + finiteMs(deltaMs),
    MIN_CLIP_DURATION_MS,
    Math.min(sourceRemainingMs, episodeRemainingMs),
  );
  const fadeInMs = clamp(edit.fadeInMs, 0, durationMs);

  return {
    ...edit,
    durationMs,
    fadeInMs,
    fadeOutMs: clamp(edit.fadeOutMs, 0, durationMs - fadeInMs),
  };
}

export function patchAudioTrackTimeline(
  track: AudioTrack,
  edit: AudioTrackTimelineEdit,
): Record<string, unknown> {
  return {
    ...track.generationParams,
    timeline: {
      startMs: Math.max(0, Math.round(edit.startMs)),
      sourceOffsetMs: Math.max(0, Math.round(edit.sourceOffsetMs)),
      durationMs: Math.max(MIN_CLIP_DURATION_MS, Math.round(edit.durationMs)),
      fadeInMs: track.trackType === 'bgm' ? Math.max(0, Math.round(edit.fadeInMs)) : 0,
      fadeOutMs: track.trackType === 'bgm' ? Math.max(0, Math.round(edit.fadeOutMs)) : 0,
      volume: clamp(edit.volume, 0, 2),
    },
  };
}
