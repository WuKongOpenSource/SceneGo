import { ALL_MODELS, type VideoModel } from './videoModelService';
import type { TaskGroup, TaskStatus, VideoTask } from './videoTaskTypes';
import { sanitizeProcessingTerminology } from '../utils/processingTerminology';
import { captureVideoPromptHistory, videoPromptKey } from '../utils/videoPromptHistory';

const ACTIVE_VIDEO_TASK_STATES = new Set(['queued', 'pending', 'running', 'processing']);
const RECONCILABLE_VIDEO_TASK_STATES = new Set([...ACTIVE_VIDEO_TASK_STATES, 'completed', 'failed', 'cancelled']);

export interface VideoTaskReconciliationResult {
  statuses: Record<string, TaskStatus>;
  resumable: Array<{ uuid: string; taskId: string }>;
}

function createdAtValue(task: VideoTask): number {
  const value = Date.parse(String(task.created_at || ''));
  return Number.isFinite(value) ? value : 0;
}

export function getVideoTaskModel(task: VideoTask): VideoModel | undefined {
  // task_type records the route that actually ran and is authoritative for
  // API-backed tasks. Several legacy request shapes either omitted `model` or
  // inherited the generic Wan2 schema default, so data.model alone is unsafe.
  const taskType = String(task.task_type || '').toLowerCase();
  if (['minimax_i2v', 'minimax_morph'].includes(taskType)) return 'MINI';
  if (taskType.startsWith('sora2_')) return 'Sora2';
  if (taskType.startsWith('veo_')) return 'Veo';
  if (taskType.startsWith('wan26_')) return '大能';
  if (taskType.startsWith('kling_')) return 'Kling';
  if (taskType.startsWith('vidu_')) return 'Vidu';
  if (taskType.startsWith('happyhorse_')) return 'HappyHorse';
  if (taskType.startsWith('seedance_')) {
    const subModel = String(task.data?.sub_model || '').toLowerCase();
    if (subModel === 'agent_plan') return 'Seedance15';
    if (subModel === 'fast') return 'Seedance2Fast';
    if (subModel === 'mini') return 'Seedance2Mini';
    return 'Seedance2';
  }
  const raw = String(task.data?.model || '').trim() as VideoModel;
  return ALL_MODELS.includes(raw) ? raw : undefined;
}

/**
 * Reconcile persisted workspace cards with the server's authoritative live tasks.
 *
 * New submissions carry workspace_group_id. Older submissions are recovered via
 * their video_segment entity_id so a reload before the debounced session save
 * cannot leave an old "failed" badge on a task that is actually still running.
 */
export function reconcileActiveVideoTasks(
  groups: TaskGroup[],
  currentStatuses: Record<string, TaskStatus>,
  serverTasks: VideoTask[],
  segmentIdByGroup: Record<string, string> = {},
  episodeId?: string,
  normalizeVideoUrl: (url: string) => string = url => url,
): VideoTaskReconciliationResult {
  const groupUuids = new Set(groups.map(group => group.uuid));
  const groupByTaskId = new Map<string, string>();
  Object.entries(currentStatuses).forEach(([uuid, status]) => {
    if (groupUuids.has(uuid) && status.taskId) groupByTaskId.set(status.taskId, uuid);
  });
  const groupBySegmentId = new Map<string, string>();
  Object.entries(segmentIdByGroup).forEach(([uuid, segmentId]) => {
    if (groupUuids.has(uuid) && segmentId) groupBySegmentId.set(String(segmentId), uuid);
  });

  const tasksByGroup = new Map<string, VideoTask[]>();
  for (const task of serverTasks || []) {
    if (!task?.task_id || !RECONCILABLE_VIDEO_TASK_STATES.has(String(task.status || '').toLowerCase())) continue;
    const data = task.data || {};
    if (episodeId && data.episode_id && String(data.episode_id) !== String(episodeId)) continue;

    const workspaceGroupId = String(data.workspace_group_id || '').trim();
    const entityId = String(data.entity_id || '').trim();
    const uuid = groupUuids.has(workspaceGroupId)
      ? workspaceGroupId
      : groupUuids.has(entityId)
        ? entityId
        : groupBySegmentId.get(entityId) || groupByTaskId.get(task.task_id);
    if (!uuid) continue;

    const matches = tasksByGroup.get(uuid) || [];
    matches.push(task);
    tasksByGroup.set(uuid, matches);
  }

  const statuses = { ...currentStatuses };
  const resumable: Array<{ uuid: string; taskId: string }> = [];
  tasksByGroup.forEach((matchedTasks, uuid) => {
    const orderedTasks = [...matchedTasks].sort((left, right) => createdAtValue(left) - createdAtValue(right));
    const task = orderedTasks[orderedTasks.length - 1];
    const previous: TaskStatus = statuses[uuid] || {};
    const progress = Number(task.progress);
    const model = getVideoTaskModel(task) || previous.pendingVideoModel;

    // Repair every stored result from every completed task, not only the newest
    // task for the group. A card can contain results produced by several model
    // selections; using only the newest task left older MiniMax files carrying
    // the legacy GenerateRequest default `Wan2` label.
    const previousVideos = previous.videos || [];
    const previousTimes = previous.videoGenerateTimes || [];
    const previousModels = previousVideos.map((_, index) => previous.videoModels?.[index]);
    const videos = [...previousVideos];
    const times = [...previousTimes];
    const models = [...previousModels];
    let videoPrompts = { ...previous.videoPrompts };
    orderedTasks
      .filter(candidate => candidate.status === 'completed')
      .forEach(completedTask => {
        const completedModel = getVideoTaskModel(completedTask);
        const generated = (completedTask.result?.videos || [])
        .map(video => ({
          url: normalizeVideoUrl(String(video?.url || '').trim()),
          generateTime: Number(video?.generateTime || 0),
        }))
        .filter(video => Boolean(video.url));
        videoPrompts = captureVideoPromptHistory({ ...previous, videoPrompts }, completedTask, generated.map(video => video.url));
        generated.forEach(video => {
          const normalized = video.url.split('?')[0];
          const existingIndex = videos.findIndex(existing => String(existing).split('?')[0] === normalized);
          if (existingIndex >= 0) {
            if (completedModel) models[existingIndex] = completedModel;
            if (video.generateTime > 0) times[existingIndex] = video.generateTime;
            return;
          }
          videos.push(video.url);
          times.push(video.generateTime);
          models.push(completedModel);
        });
      });

    const cappedVideos = videos.slice(-12);
    const cappedTimes = times.slice(-12);
    const cappedModels = models.slice(-12);

    // History can have been requested before a new submission was accepted, or
    // exclude it at the page boundary. Absence cannot settle that live task.
    if (previous.taskId && ACTIVE_VIDEO_TASK_STATES.has(previous.state || '')
      && !orderedTasks.some(candidate => candidate.task_id === previous.taskId)) {
      statuses[uuid] = {
        ...previous,
        videos: cappedVideos,
        videoGenerateTimes: cappedTimes,
        videoModels: cappedModels,
        videoPrompts,
      };
      resumable.push({ uuid, taskId: previous.taskId });
      return;
    }

    if (task.status === 'failed' || task.status === 'cancelled') {
      statuses[uuid] = {
        ...previous,
        state: 'failed',
        taskId: task.task_id,
        pendingVideoModel: undefined,
        pendingVideoPrompt: undefined,
        videos: cappedVideos,
        videoGenerateTimes: cappedTimes,
        videoModels: cappedModels,
        videoPrompts,
        keepResult: true,
        error: sanitizeProcessingTerminology(task.error || (task.status === 'cancelled' ? '任务已取消' : '任务失败')),
      };
      return;
    }

    if (task.status === 'completed') {
      statuses[uuid] = {
        ...previous,
        state: 'done',
        taskId: task.task_id,
        progress: 100,
        result: previous.result && cappedVideos.some(url => videoPromptKey(url) === videoPromptKey(previous.result!))
          ? previous.result : cappedVideos[cappedVideos.length - 1] || '',
        videos: cappedVideos,
        videoGenerateTimes: cappedTimes,
        videoModels: cappedModels,
        videoPrompts,
        pendingVideoModel: undefined,
        pendingVideoPrompt: undefined,
        keepResult: true,
        error: undefined,
      };
      return;
    }

    statuses[uuid] = {
      ...previous,
      state: task.status === 'queued' || task.status === 'pending' ? 'pending' : 'processing',
      taskId: task.task_id,
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
      videos: cappedVideos,
      videoGenerateTimes: cappedTimes,
      videoModels: cappedModels,
      videoPrompts,
      pendingVideoModel: model,
      pendingVideoPrompt: typeof task.data?.prompt === 'string' ? task.data.prompt
        : previous.taskId === task.task_id ? previous.pendingVideoPrompt : undefined,
      keepResult: true,
      error: undefined,
    };
    resumable.push({ uuid, taskId: task.task_id });
  });

  return { statuses, resumable };
}
