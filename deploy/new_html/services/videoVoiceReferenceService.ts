import { apiJson } from './httpClient';
import type { VideoVoiceReference } from '../types';

export async function getVideoVoiceReferences(projectId: string) {
  return apiJson<{ success: boolean; references: VideoVoiceReference[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/video-voice-references`,
    { method: 'GET' },
    'getVideoVoiceReferences',
  );
}

export async function createVideoVoiceReference(data: {
  project_id: string;
  episode_id: string;
  character_name: string;
  source_video_url: string;
  storyboard_item_id?: string;
  video_segment_id?: string;
  video_model?: string;
}) {
  return apiJson<{ success: boolean; reference: VideoVoiceReference }>(
    '/api/video-voice-references/from-video',
    { method: 'POST', body: JSON.stringify(data) },
    'createVideoVoiceReference',
  );
}

export async function extractVideoReferenceAudio(data: {
  project_id: string;
  episode_id: string;
  source_video_url: string;
  storyboard_item_id?: string;
  video_segment_id?: string;
  video_model?: string;
}) {
  return apiJson<{
    success: boolean;
    file_id?: string;
    audio_url: string;
    source_video_url: string;
  }>(
    '/api/video-voice-references/extract-audio',
    { method: 'POST', body: JSON.stringify(data) },
    'extractVideoReferenceAudio',
  );
}

export async function deleteVideoVoiceReference(referenceId: string) {
  return apiJson<{ success: boolean }>(
    `/api/video-voice-references/${encodeURIComponent(referenceId)}`,
    { method: 'DELETE' },
    'deleteVideoVoiceReference',
  );
}

export function normalizeVideoVoiceReference(raw: any): VideoVoiceReference {
  return {
    referenceId: raw.reference_id ?? raw.referenceId ?? '',
    projectId: raw.project_id ?? raw.projectId ?? '',
    episodeId: raw.episode_id ?? raw.episodeId ?? null,
    storyboardItemId: raw.storyboard_item_id ?? raw.storyboardItemId ?? null,
    videoSegmentId: raw.video_segment_id ?? raw.videoSegmentId ?? null,
    characterName: raw.character_name ?? raw.characterName ?? '',
    sourceVideoUrl: raw.source_video_url ?? raw.sourceVideoUrl ?? '',
    referenceAudioUrl: raw.reference_audio_url ?? raw.referenceAudioUrl ?? '',
    videoModel: raw.video_model ?? raw.videoModel ?? null,
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    createdAt: raw.created_at ?? raw.createdAt ?? '',
    updatedAt: raw.updated_at ?? raw.updatedAt ?? '',
  };
}
