import { computeReactiveDuration as computeReactiveDuration } from '../utils/durationMapping';
import { apiFetch } from './httpClient';
import type { DashScopeVideoParams, SeedanceParams } from './videoModelService';
import type { TaskGroup, TaskStatus, UploadedImage } from './videoTaskTypes';
import { buildStoryboardImageSyncPatch } from '../utils/videoStoryboardImageSync';

export interface StoryboardMeta {
  plannedDurationMs?: number;
  audioDurationMs?: number;
  audioUrls?: {
    dialogue?: string;
    narration?: string;
    sfx?: string;
  };
  mixedAudioUrl?: string;
  mixedAudioHash?: string;
  sceneHeading?: string;
  actionText?: string;
  dialogue?: string;
  lastSyncedAt?: number;
}

export interface WorkspaceSession {
  task_groups: TaskGroup[];
  uploaded_images: UploadedImage[];
  image_prompts: Record<string, string>;
  tasks_status: Record<string, TaskStatus>;
  seedance_params?: Record<string, SeedanceParams>;
  dashscope_params?: Record<string, DashScopeVideoParams>;
  storyboard_meta?: Record<string, StoryboardMeta>;
}

function mergeListByIdentity<T extends Record<string, any>>(lists: T[][], keys: string[]): T[] {
  const merged = new Map<string, T>();
  let anonymousIndex = 0;
  for (const list of lists) {
    for (const item of list || []) {
      const identity = keys.map(key => item?.[key]).find(Boolean);
      merged.set(identity ? String(identity) : `anonymous:${anonymousIndex++}`, item);
    }
  }
  return Array.from(merged.values());
}

export function mergeWorkspaceSessions(sessions: WorkspaceSession[]): WorkspaceSession {
  return {
    task_groups: mergeListByIdentity(
      sessions.map(session => session.task_groups || []),
      ['id', 'groupId', 'group_id', 'uuid'],
    ),
    uploaded_images: mergeListByIdentity(
      sessions.map(session => session.uploaded_images || []),
      ['uuid', 'id', 'itemId', 'item_id'],
    ),
    image_prompts: Object.assign({}, ...sessions.map(session => session.image_prompts || {})),
    tasks_status: Object.assign({}, ...sessions.map(session => session.tasks_status || {})),
    seedance_params: Object.assign({}, ...sessions.map(session => session.seedance_params || {})),
    dashscope_params: Object.assign({}, ...sessions.map(session => session.dashscope_params || {})),
    storyboard_meta: Object.assign({}, ...sessions.map(session => session.storyboard_meta || {})),
  };
}

export function importStoryboardIntoWorkspace(current: WorkspaceSession | null, incoming: WorkspaceSession): WorkspaceSession {
  if (!current) return incoming;
  const usedIds = new Set(current.task_groups.flatMap(group => group.ids));
  const newGroups = incoming.task_groups.filter(group => !group.ids.some(id => usedIds.has(id)));
  const newGroupIds = new Set(newGroups.map(group => group.uuid));
  const newParams = <T,>(values: Record<string, T> = {}) => Object.fromEntries(Object.entries(values).filter(([id]) => newGroupIds.has(id)));
  const images = new Map(current.uploaded_images.map(image => [image.id, image]));
  incoming.uploaded_images.forEach(image => {
    const previous = images.get(image.id);
    images.set(image.id, previous ? { ...image, ...previous } : image);
  });
  const merged: WorkspaceSession = {
    ...current,
    task_groups: [...current.task_groups, ...newGroups],
    uploaded_images: [...images.values()],
    image_prompts: { ...incoming.image_prompts, ...current.image_prompts },
    seedance_params: { ...current.seedance_params, ...newParams(incoming.seedance_params) },
    dashscope_params: { ...current.dashscope_params, ...newParams(incoming.dashscope_params) },
    storyboard_meta: { ...current.storyboard_meta, ...incoming.storyboard_meta },
  };
  const latest = Object.fromEntries(incoming.uploaded_images.filter(image => image.storyboardItemId && image.url)
    .map(image => [image.storyboardItemId!, image.url]));
  return { ...merged, ...buildStoryboardImageSyncPatch(merged, latest) };
}

const sessionWrites = new Map<string, Promise<{ success: boolean }>>();

export async function saveWorkspaceSession(session: WorkspaceSession, scope?: string): Promise<{ success: boolean }> {
  const key = scope || '';
  const snapshot = JSON.parse(JSON.stringify(session)) as WorkspaceSession;
  const pending = (sessionWrites.get(key) || Promise.resolve({ success: true }))
    .catch(() => ({ success: false }))
    .then(() => saveWorkspaceSessionRequest(snapshot, scope));
  sessionWrites.set(key, pending);
  void pending.finally(() => { if (sessionWrites.get(key) === pending) sessionWrites.delete(key); });
  return pending;
}

async function saveWorkspaceSessionRequest(
  session: WorkspaceSession,
  scope?: string,
): Promise<{ success: boolean }> {
  try {
    const response = await apiFetch('/api/workspace/save-session', {
      method: 'POST',
      body: JSON.stringify({ ...session, scope: scope || '' }),
    }, { apiName: 'saveWorkspaceSession' });

    if (!response.ok) {
      console.error('保存会话失败:', response.statusText);
      return { success: false };
    }

    return await response.json();
  } catch (e) {
    console.error('保存会话失败:', e);
    return { success: false };
  }
}

export async function loadWorkspaceSession(
  scope?: string,
): Promise<{ success: boolean; session: WorkspaceSession | null; error?: boolean }> {
  const params = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  try {
    const response = await apiFetch(`/api/workspace/load-session${params}`, {
      method: 'GET',
    }, { apiName: 'loadWorkspaceSession' });

    if (!response.ok) {
      console.error('加载会话失败:', response.statusText);
      return { success: false, session: null, error: true };
    }

    return await response.json();
  } catch (e) {
    console.error('加载会话失败:', e);
    return { success: false, session: null, error: true };
  }
}

export function computeReactiveDurationFromMeta(meta: Partial<StoryboardMeta>): number {
  return computeReactiveDuration({
    audioDurationMs: meta.audioDurationMs,
    plannedDurationMs: meta.plannedDurationMs,
  });
}

export async function patchWorkspaceSession(
  scope: string | undefined,
  mutator: (current: WorkspaceSession) => Partial<WorkspaceSession>,
): Promise<{ success: boolean }> {
  const cur = await loadWorkspaceSession(scope);
  if (!cur?.success || !cur.session) {
    console.warn('[patchWorkspaceSession] no current session; skip patch');
    return { success: false };
  }
  const patch = mutator(cur.session);
  return saveWorkspaceSession({ ...cur.session, ...patch }, scope);
}
