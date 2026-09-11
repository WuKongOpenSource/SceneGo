




import { apiJson } from './httpClient';

export type VideoReverseStatus =
  | 'pending' | 'splitting' | 'extracting_frames' | 'analyzing'
  | 'building_prompts' | 'completed' | 'failed' | 'cancelled';

export interface VideoReverseTask {
  reverse_task_id: string;
  task_id: string | null;
  user_id: string;
  project_id: string | null;
  episode_id: string | null;
  video_file_id: string;
  video_library_item_id: string | null;
  duration_seconds: number | null;
  frame_strategy: string;
  language: string;
  status: VideoReverseStatus;
  progress: number;
  overall_prompt_zh: string;
  overall_prompt_en: string;
  overall_negative_prompt: string;
  structured_prompt: Record<string, any>;
  frame_file_ids: string[];
  credit_cost: number;
  error_message: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;


  video_file_url?: string;
  video_file_name?: string;
  video_thumbnail_url?: string | null;
}

export interface VideoReverseSegment {
  segment_id: string;
  reverse_task_id: string;
  sort_order: number;
  start_seconds: number;
  end_seconds: number;
  frame_file_ids: string[];
  frame_files?: Array<{
    file_id: string;
    file_url: string;
    thumbnail_url?: string | null;
    file_name?: string;
  }>;
  keyframe_file_id?: string;
  keyframe_file_url?: string;
  description: string;
  prompt_zh: string;
  prompt_en: string;
  camera_description: string;
  motion_description: string;
  metadata: Record<string, any>;
  created_at: string;
}

export async function estimateVideoReverse(payload: {
  video_file_id?: string;
  duration_seconds?: number;
  frame_count?: number;
}): Promise<{
  success: boolean;
  feature_key: string;
  enabled: boolean;
  estimated_cost: number;
  rule_version?: string;
  balance: number | null;
  enough: boolean;
  duration_seconds?: number;
}> {
  return apiJson('/api/video-reverse/estimate', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 'estimateVideoReverse');
}

export async function createVideoReverseTask(payload: {
  video_file_id: string;
  project_id?: string;
  episode_id?: string;
  frame_strategy?: string;
  frames_per_segment?: number;
  language?: string;
}): Promise<{
  success: boolean;
  reverse_task_id: string;
  task_id: string;
  estimated_cost: number;
  duration_seconds: number;
  status: string;
}> {
  return apiJson('/api/video-reverse/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 'createVideoReverseTask');
}

export async function listVideoReverseTasks(params: {
  project_id?: string;
  episode_id?: string;
  status_filter?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ success: boolean; tasks: VideoReverseTask[]; limit: number; offset: number }> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  return apiJson(`/api/video-reverse/tasks${qs}`, {
    method: 'GET',
  }, 'listVideoReverseTasks');
}

export async function getVideoReverseTask(reverseTaskId: string): Promise<{
  success: boolean;
  task: VideoReverseTask;
  segments: VideoReverseSegment[];
}> {
  return apiJson(`/api/video-reverse/tasks/${reverseTaskId}`, {
    method: 'GET',
  }, 'getVideoReverseTask');
}

export async function cancelVideoReverseTask(reverseTaskId: string): Promise<{ success: boolean }> {
  return apiJson(`/api/video-reverse/tasks/${reverseTaskId}/cancel`, {
    method: 'POST',
  }, 'cancelVideoReverseTask');
}

export async function retryVideoReverseTask(reverseTaskId: string): Promise<{
  success: boolean;
  reverse_task_id: string;
  task_id: string;
}> {
  return apiJson(`/api/video-reverse/tasks/${reverseTaskId}/retry`, {
    method: 'POST',
  }, 'retryVideoReverseTask');
}
