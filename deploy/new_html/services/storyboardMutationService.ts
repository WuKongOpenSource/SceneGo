import { apiJson } from './httpClient';

export async function createStoryboardItem(episodeId: string, data: any) {
  return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, 'createStoryboardItem');
}

export async function deleteStoryboardItem(itemId: string) {
  return apiJson<any>(`/api/storyboard-items/${itemId}`, { method: 'DELETE' }, 'deleteStoryboardItem');
}

export async function updateStoryboardItem(itemId: string, data: any) {
  return apiJson<any>(`/api/storyboard-items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateStoryboardItem');
}

export async function deleteAllStoryboardItems(episodeId: string, scriptId?: string) {
  const params = new URLSearchParams();
  if (scriptId) params.set('script_id', scriptId);
  const qs = params.toString() ? `?${params}` : '';
  return apiJson<any>(
    `/api/episodes/${episodeId}/storyboard-items/all${qs}`,
    { method: 'DELETE' },
    'deleteAllStoryboardItems',
  );
}

export async function reorderStoryboardItems(episodeId: string, itemIds: string[]) {
  return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items/reorder`, {
    method: 'POST',
    body: JSON.stringify({ item_ids: itemIds }),
  }, 'reorderStoryboardItems');
}

export async function exportScript(episodeId: string, data: {
  project_id: string;
  original_content: string;
  script_content: string;
  storyboard_items: any[];
  characters: { name: string; description: string }[];
  scenes: { name: string; description: string }[];
  props?: { name: string; description: string }[];
  script_id?: string | null;
  preserve_existing_storyboards?: boolean;
}) {
  return apiJson<any>(`/api/episodes/${episodeId}/export-script`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, 'exportScript');
}
