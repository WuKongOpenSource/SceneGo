import { apiJson } from './httpClient';

export interface ContentTake {
  take_id: string;
  entity_type: string;
  entity_id: string;
  entity_lineage_id?: string | null;
  slot: string;
  file_id?: string | null;
  source_type: string;
  source_id?: string | null;
  source_task_id?: string | null;
  effective_url?: string | null;
  effective_thumbnail_url?: string | null;
  is_selected?: boolean;
  is_late?: boolean;
  created_at?: string | null;
}

export interface ContentBinding {
  binding_id: string;
  project_id: string;
  episode_id?: string | null;
  storyboard_item_id?: string | null;
  tag_key: string;
  scope: 'project' | 'shot';
  asset_id?: string | null;
  file_id?: string | null;
  effective_url?: string | null;
  locked: boolean;
  is_disabled?: boolean;
  binding_version: number;
}

export interface ContentStaleEvent {
  stale_event_id: string;
  project_id?: string | null;
  episode_id?: string | null;
  target_entity_type: string;
  target_entity_id: string;
  target_lineage_id?: string | null;
  target_slot: string;
  source_entity_type: string;
  source_entity_id?: string | null;
  reason_code: string;
  detail?: Record<string, unknown>;
  status: 'pending' | 'ignored' | 'regenerated';
  created_at?: string | null;
  resolved_at?: string | null;
}

export async function listContentTakes(entityType: string, entityId: string, slot: string) {
  const query = new URLSearchParams({ entity_type: entityType, entity_id: entityId, slot });
  return apiJson<{ success: boolean; items: ContentTake[]; total: number }>(
    `/api/content-takes?${query.toString()}`,
    { method: 'GET' },
    'listContentTakes',
  );
}

export async function selectContentTake(
  takeId: string,
  entityType: string,
  entityId: string,
  slot: string,
) {
  return apiJson<any>(`/api/content-takes/${takeId}/select`, {
    method: 'PUT',
    body: JSON.stringify({ entity_type: entityType, entity_id: entityId, slot }),
  }, 'selectContentTake');
}

export async function listStaleContent(
  episodeId: string,
  status: ContentStaleEvent['status'] = 'pending',
) {
  const query = new URLSearchParams({ status });
  return apiJson<{ success: boolean; items: ContentStaleEvent[]; total: number }>(
    `/api/episodes/${episodeId}/stale-content?${query.toString()}`,
    { method: 'GET' },
    'listStaleContent',
  );
}

export async function resolveStaleContent(
  staleEventId: string,
  status: 'ignored' | 'regenerated',
  note?: string,
) {
  return apiJson<{ success: boolean; event: ContentStaleEvent }>(
    `/api/stale-content/${staleEventId}/resolve`,
    { method: 'PUT', body: JSON.stringify({ status, note }) },
    'resolveStaleContent',
  );
}

export async function listContentBindings(
  projectId: string,
  options: { episodeId?: string; storyboardItemId?: string } = {},
) {
  const query = new URLSearchParams();
  if (options.episodeId) query.set('episode_id', options.episodeId);
  if (options.storyboardItemId) query.set('storyboard_item_id', options.storyboardItemId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiJson<{ success: boolean; items: ContentBinding[]; total: number }>(
    `/api/projects/${projectId}/content-bindings${suffix}`,
    { method: 'GET' },
    'listContentBindings',
  );
}

export async function putContentBinding(
  projectId: string,
  binding: {
    episode_id?: string;
    storyboard_item_id?: string;
    tag_key: string;
    scope: 'project' | 'shot';
    asset_id?: string;
    file_id?: string;
    is_disabled?: boolean;
    locked?: boolean;
  },
) {
  return apiJson<any>(`/api/projects/${projectId}/content-bindings`, {
    method: 'PUT',
    body: JSON.stringify(binding),
  }, 'putContentBinding');
}

export async function deleteContentBinding(projectId: string, bindingId: string) {
  return apiJson<any>(`/api/projects/${projectId}/content-bindings/${bindingId}`, {
    method: 'DELETE',
  }, 'deleteContentBinding');
}

export async function resolveContentBindings(
  projectId: string,
  storyboardItemId: string,
  tagKeys: string[],
) {
  return apiJson<any>(`/api/projects/${projectId}/content-bindings/resolve`, {
    method: 'POST',
    body: JSON.stringify({ storyboard_item_id: storyboardItemId, tag_keys: tagKeys }),
  }, 'resolveContentBindings');
}
