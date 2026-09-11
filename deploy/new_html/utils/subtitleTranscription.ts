import type { EnhanceMediaClip } from './enhanceSourceClips';
import type { EnhanceSubtitleCue } from './enhanceTimelineEditor';
import type { TimelineTranscriptionClip } from '../services/audioTranscriptionService';

export type SubtitleSource = 'video_original' | 'reference_dubbing';
export type SubtitleMergeMode = 'fill_gaps' | 'update_generated' | 'replace';
export interface SubtitleChunk extends TimelineTranscriptionClip { timelineStartMs: number; label: string }

export function subtitleTimelineKey(clips: EnhanceMediaClip[]): string {
  return JSON.stringify(clips.map(c => [c.id, c.url, c.type, c.audioKind, c.startTime, c.sourceOffset, c.duration, c.volume]));
}

export function buildSubtitleChunks(clips: EnhanceMediaClip[], source: SubtitleSource): SubtitleChunk[] {
  const end = Math.max(0, ...clips.filter(c => c.type === 'video').map(c => c.startTime + c.duration));
  const chunks: SubtitleChunk[] = [];
  for (const clip of clips.filter(c => source === 'video_original' ? c.type === 'video' : c.type === 'audio' && c.audioKind === 'voice' && (c.volume ?? 1) > 0)) {
    if (!clip.url) throw new Error('片段缺少音视频源，请刷新素材');
    if (![clip.startTime, clip.sourceOffset, clip.duration].every(Number.isFinite) || clip.startTime < 0 || clip.sourceOffset < 0 || clip.duration <= 0) throw new Error('片段裁剪范围无效，请先调整时间线');
    let remaining = Math.round(Math.min(clip.duration, end - clip.startTime) * 1000);
    let offset = 0;
    while (remaining >= 100) {
      let length = Math.min(60_000, remaining);
      if (remaining > length && remaining - length < 100) length -= 100;
      chunks.push({ clipId: clip.id, audioUrl: clip.url, mediaKind: clip.type,
        sourceOffsetMs: Math.round(clip.sourceOffset * 1000) + offset,
        durationMs: length, timelineStartMs: Math.round(clip.startTime * 1000) + offset,
        label: clip.sourceLabel || (clip.type === 'video' ? '视频原声' : '配音') });
      offset += length;
      remaining -= length;
    }
  }
  if (chunks.length > 200 || chunks.reduce((sum, c) => sum + c.durationMs, 0) > 3_600_000) throw new Error('单次最多识别 1 小时、200 个片段，请分次处理');
  return chunks.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
}

export const isAutomaticSubtitle = (cue: EnhanceSubtitleCue) => cue.id.startsWith('asr_') || cue.text.trim() === '请输入字幕';

export function mergeSubtitleResults(existing: EnhanceSubtitleCue[], generated: EnhanceSubtitleCue[], mode: SubtitleMergeMode) {
  const retained = mode === 'replace' ? [] : mode === 'update_generated' ? existing.filter(cue => !isAutomaticSubtitle(cue)) : existing;
  const added = generated.filter(cue => !retained.some(old => old.startTime < cue.startTime + cue.duration && cue.startTime < old.startTime + old.duration));
  return { subtitles: [...retained, ...added].sort((a, b) => a.startTime - b.startTime), added: added.length, skipped: generated.length - added.length };
}
