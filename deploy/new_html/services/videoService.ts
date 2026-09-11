/**
 * Compatibility facade for the old videoService import path.
 * New code should import the focused video services directly.
 */

export { getComfyUIQueueStatus } from '@runtime/comfyuiTaskQueue';
export * from '@runtime/videoTaskService';
export type {
    MergedCardSnapshot,
    TaskGroup,
    TaskState,
    TaskStatus,
    UploadedImage,
    VideoTask,
} from './videoTaskTypes';
export {
    computeReactiveDurationFromMeta,
    loadWorkspaceSession,
    patchWorkspaceSession,
    saveWorkspaceSession,
    type StoryboardMeta,
    type WorkspaceSession,
} from './videoWorkspaceService';
export {
    clearProjectVideoTasks,
    cropVideo,
    getProjectVideoTasks,
    reuploadVideo,
    secureMediaUrl,
    uploadAudio,
    uploadImage,
    uploadImageToComfyUI,
    uploadVideoFile,
    type ProjectVideoTask,
    type UploadOptions,
    type UploadProgress,
} from '@runtime/videoMediaService';
export {
    ALL_MODELS,
    SELECTABLE_MODELS,
    getModelDisplayName,
    inferDashScopeTaskType,
    inferSeedanceTaskType,
    isComfyUIModel,
    isDashScopeVideoModel,
    makeDefaultDashScopeParams,
    type DashScopeAspectRatio,
    type DashScopeResolution,
    type DashScopeVideoModel,
    type DashScopeVideoParams,
    type HappyHorseRatio,
    type HhRatio,
    type HhResolution,
    type KlingMode,
    type KlingMultiPromptItem,
    type KlingShotType,
    type KlingSubModel,
    type SeedanceMediaInput,
    type SeedanceMediaKind,
    type SeedanceMediaRole,
    type SeedanceParams,
    type ShotType,
    type ViduResolution,
    type ViduSubModel,
    type VideoModel,
} from './videoModelService';
