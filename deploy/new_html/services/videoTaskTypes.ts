import type {
  DashScopeVideoParams,
  MiniMaxVideoParams,
  SeedanceMediaInput,
  SeedanceParams,
  ShotType,
  VideoModel,
} from './videoModelService';

export type TaskState = 'idle' | 'pending' | 'running' | 'processing' | 'done' | 'failed';

export interface UploadedImage {
  id: string;
  fileId?: string;
  url: string;
  filename: string;
  storageUrl?: string;
  comfyuiFilename?: string;
  uploadTime: number;
  isUploading?: boolean;
  uploadFailed?: boolean;
  uploadProgress?: number;
  isPlaceholder?: boolean;
  storyboardItemId?: string;
  sortOrder?: number;
  /** Canonical script/storyboard position persisted with the video workspace. */
  storyboardSegmentKey?: string;
  storyboardSegmentNo?: number;
  storyboardLocalShotNo?: number;
  storyboardShotLabel?: string;
  isStoryboardSegmentStart?: boolean;
  tags?: string[];
  linkedGroupUuids?: string[];
}

export interface TaskGroup {
  uuid: string;
  videoSegmentId?: string;
  ids: string[];
  model: VideoModel;
  createdAt?: number;
  shotType?: ShotType;
  duration?: number;
  durationUserOverride?: boolean;
  minimaxParams?: MiniMaxVideoParams;
  /** Parameters declared by /api/video/capabilities for the selected model. */
  videoParams?: Record<string, string | number | boolean>;
  /** Opt-in request for the verified MiniMax H3 SageAttention workflow. */
  h3SageAttention?: boolean;
  /** Opt-in request for the guarded MiniMax H3 Director multi-segment workflow. */
  h3LongVideo?: boolean;
  /** After H3 unloads, serially upscale its result to a 720P delivery file. */
  h3Upscale720p?: boolean;
  mergedFrom?: MergedCardSnapshot[];
}

export interface MergedCardSnapshot {
  uuid: string;
  ids: string[];
  model: VideoModel;
  prompt: string;
  shotType?: ShotType;
  duration?: number;
  durationUserOverride?: boolean;
  h3SageAttention?: boolean;
  mediaInputs?: SeedanceMediaInput[];
  seedanceParams?: SeedanceParams;
  dashScopeParams?: DashScopeVideoParams;
  /** Historical outputs owned by this child before it joined a merged card. */
  taskStatus?: TaskStatus;
}

export interface TaskStatus {
  state?: TaskState;
  taskId?: string;
  progress?: number;
  result?: string;
  videos?: string[];
  videoGenerateTimes?: number[];
  /** Model used for each entry in videos; indexes are kept aligned. */
  videoModels?: Array<VideoModel | undefined>;
  /** Upload metadata keyed by the canonical media path, independent of history indexes. */
  uploadedVideos?: Record<string, { fileId: string; filename: string; durationMs: number }>;
  /** Captured at submission so changing the card model cannot relabel a running result. */
  pendingVideoModel?: VideoModel;
  totalGenerationTime?: number;
  isUpscaled?: boolean;
  isExpired?: boolean;
  keepResult?: boolean;
  selected?: boolean;
  originalResult?: string;
  error?: string;
}

export interface VideoTask {
    can_cancel?: boolean;
  task_id: string;
  status: 'queued' | 'pending' | 'running' | 'processing' | 'completed' | 'failed' | 'cancelled';
  task_type: string;
  created_at: string;
  completed_at?: string;
  started_at?: string;
  progress?: number;
  data?: {
    prompt?: string;
    model?: string;
    sub_model?: string;
    entity_id?: string;
    episode_id?: string;
    workspace_group_id?: string;
  };
  result?: {
    videos?: Array<{ url: string; filename?: string; generateTime?: number }>;
    images?: Array<{ url: string; filename?: string }>;
    error?: string;
  };
  error?: string;
}
