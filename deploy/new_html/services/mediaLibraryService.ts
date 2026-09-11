




import { apiBlob, apiJson } from './httpClient';

export type MediaItemType = 'image' | 'video' | 'audio' | 'text' | 'other';
export type PermissionScope = 'private' | 'project' | 'team' | 'public_link';

export interface MediaLibraryItem {
  library_item_id: string;
  file_id: string;
  user_id: string;
  project_id: string | null;
  episode_id: string | null;
  team_id: string | null;
  item_type: MediaItemType;
  source: string;
  title: string | null;
  description: string;
  tags: string[];
  permission_scope: PermissionScope;
  is_favorite: boolean;
  use_count: number;
  source_task_id: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  metadata: Record<string, any>;

  visibility?: 'private' | 'org-default';

  folder_id?: string | null;
  created_at: string;
  updated_at: string;


  file_name?: string;
  file_url?: string;
  file_type?: string;
  mime_type?: string;
  file_size_bytes?: number;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  thumbnail_url?: string | null;
}

export interface ListItemsResponse {
  success: boolean;
  items: MediaLibraryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListItemsParams {
  project_id?: string;
  episode_id?: string;
  include_shared?: boolean;
  item_type?: MediaItemType;
  source?: string;
  permission_scope?: PermissionScope;
  is_favorite?: boolean;
  keyword?: string;
  tag?: string;

  folder_id?: string;
  limit?: number;
  offset?: number;

  org_id?: string;
}

export interface UpdateItemPayload {
  title?: string;
  description?: string;
  tags?: string[];
  permission_scope?: PermissionScope;
  is_favorite?: boolean;
  project_id?: string;
  episode_id?: string;

  folder_id?: string | null;
}

export interface UploadOptions {
  projectId?: string;
  episodeId?: string;
  permissionScope?: PermissionScope;
  title?: string;
  description?: string;
  tags?: string[];

  visibility?: 'private' | 'org-default';
  orgId?: string;

  folderId?: string;
}


export interface MediaFolder {
  folder_id: string;
  project_id: string;
  parent_folder_id: string | null;
  name: string;
  folder_order: number;
  created_at: string;
  updated_at: string;
}

export interface UseItemPayload {
  usage_context: string;
  task_id?: string;
  project_id?: string;
  target_entity_type?: string;
  target_entity_id?: string;
}

function buildQuery(params: Record<string, any>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export async function listMediaItems(params: ListItemsParams = {}): Promise<ListItemsResponse> {
  const qs = buildQuery(params);
  return apiJson(`/api/media-library/items${qs}`, {
    method: 'GET',
  }, 'listMediaItems');
}

export async function getMediaItem(libraryItemId: string): Promise<{ success: boolean; item: MediaLibraryItem }> {
  return apiJson(`/api/media-library/items/${libraryItemId}`, {
    method: 'GET',
  }, 'getMediaItem');
}

export async function uploadMediaItem(file: File, options: UploadOptions = {}): Promise<{
  success: boolean;
  library_item_id: string;
  file_id: string;
  file_url: string;
  item: MediaLibraryItem;
}> {
  const form = new FormData();
  form.append('file', file);
  if (options.projectId) form.append('project_id', options.projectId);
  if (options.episodeId) form.append('episode_id', options.episodeId);
  if (options.permissionScope) form.append('permission_scope', options.permissionScope);
  if (options.title) form.append('title', options.title);
  if (options.description) form.append('description', options.description);
  if (options.tags) form.append('tags', JSON.stringify(options.tags));
  if (options.visibility) form.append('visibility', options.visibility);
  if (options.orgId) form.append('org_id', options.orgId);
  if (options.folderId) form.append('folder_id', options.folderId);

  return apiJson('/api/media-library/upload', {
    method: 'POST',
    body: form,
  }, 'uploadMediaItem', { includeContentType: false });
}

export async function updateMediaItem(
  libraryItemId: string,
  payload: UpdateItemPayload,
): Promise<{ success: boolean; item: MediaLibraryItem }> {
  return apiJson(`/api/media-library/items/${libraryItemId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }, 'updateMediaItem');
}

export async function deleteMediaItem(libraryItemId: string, reason?: string): Promise<{ success: boolean }> {
  const qs = reason ? `?${new URLSearchParams({ reason }).toString()}` : '';
  return apiJson(`/api/media-library/items/${libraryItemId}${qs}`, {
    method: 'DELETE',
  }, 'deleteMediaItem');
}

export async function useMediaItem(libraryItemId: string, payload: UseItemPayload): Promise<{ success: boolean; usage: any }> {
  return apiJson(`/api/media-library/items/${libraryItemId}/use`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 'useMediaItem');
}

export async function batchDownloadMediaItems(libraryItemIds: string[]): Promise<Blob> {
  return apiBlob('/api/media-library/batch-download', {
    method: 'POST',
    body: JSON.stringify({ library_item_ids: libraryItemIds }),
  }, 'batchDownloadMediaItems');
}



export async function listMediaFolders(projectId: string): Promise<{ success: boolean; folders: MediaFolder[] }> {
  const qs = buildQuery({ project_id: projectId });
  return apiJson(`/api/media-library/folders${qs}`, {
    method: 'GET',
  }, 'listMediaFolders');
}

export async function createMediaFolder(payload: {
  project_id: string;
  name: string;
  parent_folder_id?: string | null;
  folder_order?: number;
}): Promise<{ success: boolean; folder: MediaFolder }> {
  return apiJson('/api/media-library/folders', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 'createMediaFolder');
}

export async function updateMediaFolder(
  folderId: string,
  payload: { name?: string; parent_folder_id?: string | null; folder_order?: number },
): Promise<{ success: boolean; folder: MediaFolder }> {
  return apiJson(`/api/media-library/folders/${folderId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }, 'updateMediaFolder');
}

export async function deleteMediaFolder(folderId: string): Promise<{ success: boolean }> {
  return apiJson(`/api/media-library/folders/${folderId}`, {
    method: 'DELETE',
  }, 'deleteMediaFolder');
}
