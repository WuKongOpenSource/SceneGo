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
): Promise<TimelineTranscriptionSegment[]> {
  const response = await apiJson<any>(
    `/api/episodes/${encodeURIComponent(episodeId)}/audio/transcribe-timeline`,
    {
      method: 'POST',
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
  return (response.subtitles || []).map((item: any) => ({
    clipId: String(item.clip_id || ''),
    startMs: Number(item.start_ms || 0),
    endMs: Number(item.end_ms || 0),
    text: String(item.text || '').trim(),
  })).filter((item: TimelineTranscriptionSegment) => (
    item.clipId && item.text && item.endMs > item.startMs
  ));
}

export async function getAudioTranscriptionCapability(
  episodeId: string,
): Promise<{ available: boolean }> {
  return apiJson<{ available: boolean }>(
    `/api/episodes/${encodeURIComponent(episodeId)}/audio/transcription-capability`,
    { method: 'GET' },
    'AI 语音字幕能力',
  );
}
