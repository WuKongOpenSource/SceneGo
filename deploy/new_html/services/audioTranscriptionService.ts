import { apiJson } from './httpClient';

export interface TimelineTranscriptionClip {
  clipId: string;
  audioUrl: string;
  mediaKind: 'audio' | 'video';
  sourceOffsetMs: number;
  durationMs: number;
}

export interface TimelineTranscriptionSegment {
  clipId: string;
  startMs: number;
  endMs: number;
  text: string;
}

export async function transcribeTimelineAudio(
  episodeId: string,
  projectId: string | undefined,
  clips: TimelineTranscriptionClip[],
  signal?: AbortSignal,
): Promise<TimelineTranscriptionSegment[]> {
  const response = await apiJson<any>(
    `/api/episodes/${encodeURIComponent(episodeId)}/audio/transcribe-timeline`,
    {
      method: 'POST',
      signal,
      body: JSON.stringify({
        episode_id: episodeId,
        project_id: projectId,
        clips: clips.map(clip => ({
          clip_id: clip.clipId,
          audio_url: clip.audioUrl,
          media_kind: clip.mediaKind,
          source_offset_ms: clip.sourceOffsetMs,
          duration_ms: clip.durationMs,
        })),
      }),
    },
    'AI 语音字幕生成',
  );
  if (!Array.isArray(response?.subtitles)) throw new Error('字幕识别结果格式无效');
  return response.subtitles.map((item: any) => {
    const clip = clips.find(candidate => candidate.clipId === item?.clip_id);
    if (!clip || typeof item.text !== 'string' || !item.text.trim()
      || !Number.isFinite(item.start_ms) || !Number.isFinite(item.end_ms)
      || item.start_ms < 0 || item.start_ms >= clip.durationMs
      || item.end_ms <= item.start_ms || item.end_ms > clip.durationMs + 150) {
      throw new Error('字幕识别结果时间点无效');
    }
    return { clipId: item.clip_id, startMs: item.start_ms, endMs: Math.min(clip.durationMs, item.end_ms), text: item.text.trim() };
  });
}

export async function getAudioTranscriptionCapability(
  episodeId: string,
): Promise<{ available: boolean; reason?: string }> {
  return apiJson<{ available: boolean; reason?: string }>(
    `/api/episodes/${encodeURIComponent(episodeId)}/audio/transcription-capability`,
    { method: 'GET' },
    'AI 语音字幕能力',
  );
}
