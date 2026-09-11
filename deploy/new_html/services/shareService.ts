




import { apiJson } from './httpClient';

export type ShareResourceType = 'project' | 'media' | 'group';
export type ShareTargetType = 'org' | 'project';

export interface ResourceShare {
  share_id: string;
  resource_type: ShareResourceType;
  resource_id: string;
  share_target_type: ShareTargetType;
  share_target_id: string;
  share_target_name?: string;
  granted_by_user_id: string;
  granted_at: string;
}

export async function listShares(
  resource_type: ShareResourceType,
  resource_id: string,
): Promise<{ success: boolean; shares: ResourceShare[] }> {
  const qs = new URLSearchParams({ resource_type, resource_id });
  return apiJson(`/api/shares?${qs.toString()}`, { method: 'GET' }, 'listShares');
}

export async function createShare(body: {
  resource_type: ShareResourceType;
  resource_id: string;
  share_target_type: ShareTargetType;
  share_target_id: string;
}): Promise<{ success: boolean; share: ResourceShare }> {
  return apiJson('/api/shares', {
    method: 'POST',
    body: JSON.stringify(body),
  }, 'createShare');
}

export async function deleteShare(share_id: string): Promise<{ success: boolean }> {
  return apiJson(`/api/shares/${share_id}`, { method: 'DELETE' }, 'deleteShare');
}
