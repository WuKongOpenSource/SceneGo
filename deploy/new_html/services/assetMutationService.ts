import { apiJson } from './httpClient';

export interface CreateAssetPayload {
  project_id: string;
  asset_type: string;
  name: string;
  episode_id?: string;
  script_id?: string;
  description?: string;
  reference_images?: string[];
}

export async function createAsset(data: CreateAssetPayload) {
  return apiJson<any>('/api/assets', {
    method: 'POST',
    body: JSON.stringify(data),
  }, 'createAsset');
}

export async function updateAsset(assetId: string, data: Record<string, any>) {
  return apiJson<any>(`/api/assets/${assetId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateAsset');
}

export async function deleteAsset(assetId: string) {
  return apiJson<any>(`/api/assets/${assetId}`, { method: 'DELETE' }, 'deleteAsset');
}

export async function shareAsset(assetId: string, targetEpisodeId: string, targetScriptId: string) {
  return apiJson<any>(`/api/assets/${assetId}/share`, {
    method: 'POST',
    body: JSON.stringify({ target_episode_id: targetEpisodeId, target_script_id: targetScriptId }),
  }, 'shareAsset');
}

export interface SyncExistingAssetCandidate {
  asset_id: string;
  asset_type: 'character' | 'scene' | 'prop';
  name: string;
  description?: string;
  source_episode_id?: string | null;
  source_episode_label?: string;
  script_id?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  image_count?: number;
  has_design?: boolean;
  exists_in_target?: boolean;
  target_asset_id?: string | null;
  target_has_design?: boolean;
  created_at?: string | null;
}

export async function listSyncExistingAssetDesignCandidates(projectId: string, data: {
  episode_id: string;
  script_id?: string;
  asset_types?: string[];
}) {
  const params = new URLSearchParams();
  params.set('episode_id', data.episode_id);
  if (data.script_id) params.set('script_id', data.script_id);
  if (data.asset_types?.length) params.set('asset_types', data.asset_types.join(','));
  return apiJson<{ success: boolean; candidates: SyncExistingAssetCandidate[]; candidate_count: number }>(
    `/api/projects/${projectId}/assets/sync-existing-designs/candidates?${params.toString()}`,
    { method: 'GET' },
    'listSyncExistingAssetDesignCandidates',
  );
}

export async function syncExistingAssetDesigns(projectId: string, data: {
  episode_id: string;
  script_id?: string;
  asset_types?: string[];
  overwrite?: boolean;
  source_asset_ids?: string[];
}) {
  return apiJson<any>(`/api/projects/${projectId}/assets/sync-existing-designs`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, 'syncExistingAssetDesigns');
}
