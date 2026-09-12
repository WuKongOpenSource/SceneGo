import type { AudioTrack, StoryboardItemDB, VideoSegment } from '../types';
import { resolveAudioTrackTimeline } from './audioTrackTimeline';

export interface EnhanceMediaClip {
  id: string;
  sourceId?: string;
  url: string;
  thumbnailUrl?: string;
  referenceImageUrl?: string;
  model?: string;
  comfyFilename?: string;
  sourceLabel?: string;
  audioKind?: 'voice' | 'bgm' | 'sfx';
  audioTrackId?: string;
  sourceDuration?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  transitionAfter?: 'cut' | 'fade' | 'black';
  transitionDuration?: number;
  startTime: number;
  duration: number;
  sourceOffset: number;
  type: 'video' | 'audio';
  settings?: { upscale: boolean; interpolate: boolean; lipSync: boolean };
}

type UrlResolver = (url: string) => string;

function itemId(item: StoryboardItemDB & Record<string, any>): string {
  return String(item.itemId ?? item.item_id ?? '');
}

function itemSort(item: StoryboardItemDB & Record<string, any>): number {
  const raw = item.sortOrder ?? item.sort_order;
  return typeof raw === 'number' ? raw : 0;
}

function itemDurationMs(item: StoryboardItemDB & Record<string, any>): number {
  const raw = item.audioDurationMs ?? item.audio_duration_ms ?? item.plannedDurationMs ?? item.planned_duration_ms;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

export function withEntityFileVideoFallbacks(
  videoSegments: VideoSegment[],
  fallbackVideoUrls: Record<string, string>,
): VideoSegment[] {
  return videoSegments.map(segment => {
    if (!segment.segmentId || segment.videoUrl) return segment;
    const fallbackUrl = fallbackVideoUrls[segment.segmentId];
    return fallbackUrl ? { ...segment, videoUrl: fallbackUrl } : segment;
  });
}

export function buildEnhanceSourceClips(
  videoSegments: VideoSegment[],
  storyboardAudioItems: StoryboardItemDB[],
  audioTracks: AudioTrack[],
  secureMediaUrl: UrlResolver = url => url,
): EnhanceMediaClip[] {
  const allClips: EnhanceMediaClip[] = [];
  let videoTime = 0;

  const sortedSegs = [...videoSegments].sort((a, b) => a.sortOrder - b.sortOrder);
  const storyboardById = new Map(
    storyboardAudioItems.map(item => [itemId(item as StoryboardItemDB & Record<string, any>), item]),
  );
  const videoTimelineByStoryboardId = new Map<string, { startMs: number; durationMs: number }>();
  for (let i = 0; i < sortedSegs.length; i++) {
    const seg = sortedSegs[i];
    const storyboard = seg.storyboardItemId ? storyboardById.get(seg.storyboardItemId) : undefined;
    const dur = (seg.durationMs || 5000) / 1000;
    const videoUrl = seg.videoUrl ? secureMediaUrl(seg.videoUrl) : '';
    if (videoUrl) {
      if (seg.storyboardItemId) {
        videoTimelineByStoryboardId.set(seg.storyboardItemId, {
          startMs: Math.round(videoTime * 1000),
          durationMs: Math.round(dur * 1000),
        });
      }
      allClips.push({
        id: seg.segmentId || `vid_${i}`,
        sourceId: seg.segmentId || `vid_${i}`,
        url: videoUrl,
        thumbnailUrl: seg.thumbnailUrl ? secureMediaUrl(seg.thumbnailUrl) : undefined,
        referenceImageUrl: storyboard?.generatedImageUrl
          ? secureMediaUrl(storyboard.generatedImageUrl)
          : undefined,
        model: seg.model,
        startTime: videoTime,
        duration: dur,
        sourceDuration: dur,
        sourceOffset: 0,
        type: 'video',
        settings: { upscale: false, interpolate: false, lipSync: false },
      });
    }
    videoTime += dur;
  }

  const sortedItems = [...storyboardAudioItems].sort((a, b) =>
    itemSort(a as StoryboardItemDB & Record<string, any>) - itemSort(b as StoryboardItemDB & Record<string, any>)
  );
  for (const raw of sortedItems) {
    const item = raw as StoryboardItemDB & Record<string, any>;
    const id = itemId(item);
    if (!id) continue;
    const videoAnchor = videoTimelineByStoryboardId.get(id);
    if (!videoAnchor) continue;
    const startTime = videoAnchor.startMs / 1000;
    const duration = itemDurationMs(item) / 1000;
    const mixedUrl = item.mixedAudioUrl ?? item.mixed_audio_url;
    if (mixedUrl) {
      allClips.push({
        id: `aud_sb_${id}_mixed`,
        url: secureMediaUrl(String(mixedUrl)),
        startTime,
        duration,
        sourceOffset: 0,
        type: 'audio',
        sourceLabel: '参考配音',
        audioKind: 'voice',
      });
      continue;
    }

    const audioParts = [
      ['dialogue', item.dialogueAudioUrl ?? item.dialogue_audio_url],
      ['narration', item.narrationAudioUrl ?? item.narration_audio_url],
      ['sfx', item.sfxAudioUrl ?? item.sfx_audio_url],
    ] as const;
    for (const [kind, url] of audioParts) {
      if (!url) continue;
      allClips.push({
        id: `aud_sb_${id}_${kind}`,
        url: secureMediaUrl(String(url)),
        startTime,
        duration,
        sourceOffset: 0,
        type: 'audio',
        sourceLabel: kind === 'dialogue' ? '参考对白' : kind === 'narration' ? '参考旁白' : '参考音效',
        audioKind: kind === 'sfx' ? 'sfx' : 'voice',
      });
    }
  }

  for (const track of audioTracks) {
    if (!track.audioUrl) continue;
    const episodeDurationMs = Math.max(100, Math.round(videoTime * 1000));
    const timeline = resolveAudioTrackTimeline(track, episodeDurationMs);
    const hasPersistedTimeline = Boolean(track.generationParams?.timeline && typeof track.generationParams.timeline === 'object');
    const anchoredStartMs = track.startItemId
      ? videoTimelineByStoryboardId.get(track.startItemId)?.startMs
      : undefined;
    const startMs = hasPersistedTimeline ? timeline.startMs : anchoredStartMs ?? timeline.startMs;
    const kind = track.trackType === 'bgm' ? 'bgm' : track.trackType === 'sfx_global' ? 'sfx' : 'voice';
    allClips.push({
      id: `aud_track_${track.trackId}`,
      url: secureMediaUrl(track.audioUrl),
      startTime: startMs / 1000,
      duration: timeline.durationMs / 1000,
      sourceOffset: timeline.sourceOffsetMs / 1000,
      type: 'audio',
      sourceLabel: track.name || '音频轨道',
      audioKind: kind,
      audioTrackId: track.trackId,
      sourceDuration: Math.max(0.1, (track.durationMs || timeline.durationMs) / 1000),
      volume: timeline.volume,
      fadeIn: timeline.fadeInMs / 1000,
      fadeOut: timeline.fadeOutMs / 1000,
    });
  }

  return allClips;
}
