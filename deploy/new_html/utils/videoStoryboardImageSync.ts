import type { DashScopeVideoParams, SeedanceParams } from '../services/videoModelService';
import type { WorkspaceSession } from '../services/videoWorkspaceService';
import type { TaskGroup } from '../services/videoTaskTypes';

type PromptParams = SeedanceParams | DashScopeVideoParams;

// Card-local removal/replacement is an explicit choice, not an outdated storyboard reference.
function syncableIds(group: TaskGroup): string[] {
  return (group.ids || []).map(id => Object.prototype.hasOwnProperty.call(group.sourceImageOverrides || {}, id) ? '' : id);
}

function normalizeUrl(value: unknown): string {
  return typeof value === 'string' ? value.split('?')[0] : '';
}

function storyboardIdOfImage(image: any): string {
  const explicit = image?.storyboardItemId;
  if (explicit) return explicit.toString();
  const id = image?.id;
  return typeof id === 'string' && id.startsWith('sb_') ? id : '';
}

function primaryStoryboardImageIndex(params: PromptParams): number {
  return (params.media_inputs || []).findIndex(media => {
    if (!media || media.kind !== 'image') return false;
    const role = media.role || 'reference_image';
    return role === 'reference_image' || role === 'first_frame';
  });
}

function syncStoryboardImageAtRole<T extends PromptParams>(
  params: T,
  latestUrl: string,
  role: 'reference_image' | 'first_frame' | 'last_frame',
): T {
  const mediaInputs = params.media_inputs || [];
  const currentIndex = role === 'last_frame'
    ? mediaInputs.findIndex(media => media?.kind === 'image' && media.role === 'last_frame')
    : primaryStoryboardImageIndex(params);
  if (currentIndex < 0) {
    return {
      ...params,
      media_inputs: role === 'last_frame'
        ? [...mediaInputs, { kind: 'image', url: latestUrl, role }]
        : [{ kind: 'image', url: latestUrl, role }, ...mediaInputs],
    } as T;
  }

  const current = mediaInputs[currentIndex];
  if (normalizeUrl(current.url) === latestUrl) return params;

  const nextMediaInputs = [...mediaInputs];
  nextMediaInputs[currentIndex] = {
    ...current,
    url: latestUrl,
    file_id: undefined,
  };
  return { ...params, media_inputs: nextMediaInputs } as T;
}

function syncStoryboardImagesForGroup<T extends PromptParams>(
  params: T,
  storyboardIds: string[],
  latestImageById: Record<string, string>,
): T {
  const firstUrl = latestImageById[storyboardIds[0]];
  const lastUrl = storyboardIds.length === 2 ? latestImageById[storyboardIds[1]] : '';
  let next = params;
  if (firstUrl) {
    const role = storyboardIds.length === 2 ? 'first_frame' : 'reference_image';
    next = syncStoryboardImageAtRole(next, firstUrl, role);
  }
  if (lastUrl) next = syncStoryboardImageAtRole(next, lastUrl, 'last_frame');
  return next;
}

export function countOutdatedStoryboardImages(
  session: WorkspaceSession,
  latestImageById: Record<string, string>,
): number {
  const outdatedIds = new Set<string>();
  for (const image of session.uploaded_images || []) {
    const id = storyboardIdOfImage(image);
    const latestUrl = latestImageById[id];
    if (latestUrl && normalizeUrl(image.url) !== latestUrl) outdatedIds.add(id);
  }

  for (const group of session.task_groups || []) {
    for (const params of [session.seedance_params?.[group.uuid], session.dashscope_params?.[group.uuid]]) {
      if (!params) continue;
      const ids = syncableIds(group);
      const firstUrl = latestImageById[ids[0]];
      const firstIndex = primaryStoryboardImageIndex(params);
      if (firstUrl && (firstIndex < 0 || normalizeUrl(params.media_inputs?.[firstIndex]?.url) !== firstUrl)) {
        outdatedIds.add(ids[0]);
      }
      if (ids.length === 2) {
        const lastUrl = latestImageById[ids[1]];
        const lastIndex = (params.media_inputs || []).findIndex(media => media?.kind === 'image' && media.role === 'last_frame');
        if (lastUrl && (lastIndex < 0 || normalizeUrl(params.media_inputs?.[lastIndex]?.url) !== lastUrl)) {
          outdatedIds.add(ids[1]);
        }
      }
    }
  }
  return outdatedIds.size;
}

export function buildStoryboardImageSyncPatch(
  session: WorkspaceSession,
  latestImageById: Record<string, string>,
): Pick<WorkspaceSession, 'uploaded_images' | 'seedance_params' | 'dashscope_params'> {
  const uploadedImages = (session.uploaded_images || []).map(image => {
    const id = storyboardIdOfImage(image);
    const latestUrl = latestImageById[id];
    return latestUrl && normalizeUrl(image.url) !== latestUrl
      ? { ...image, url: latestUrl, storageUrl: latestUrl, isPlaceholder: false }
      : image;
  });
  const seedanceParams = { ...(session.seedance_params || {}) };
  const dashScopeParams = { ...(session.dashscope_params || {}) };

  for (const group of session.task_groups || []) {
    if (seedanceParams[group.uuid]) {
      seedanceParams[group.uuid] = syncStoryboardImagesForGroup(
        seedanceParams[group.uuid],
        syncableIds(group),
        latestImageById,
      );
    }
    if (dashScopeParams[group.uuid]) {
      dashScopeParams[group.uuid] = syncStoryboardImagesForGroup(
        dashScopeParams[group.uuid],
        syncableIds(group),
        latestImageById,
      );
    }
  }

  return {
    uploaded_images: uploadedImages,
    seedance_params: seedanceParams,
    dashscope_params: dashScopeParams,
  };
}
