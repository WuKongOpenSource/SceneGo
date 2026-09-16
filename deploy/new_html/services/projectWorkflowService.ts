import { apiJson } from './httpClient';

export interface UpdateProjectPayload {
  group_id?: string | null;
  project_name?: string;
  description?: string;
  cover_url?: string;
  tags?: string[];
}

export interface UpdateProjectMemberPayload {
  role?: string;
  responsibility?: string;
}

export interface UpdateEpisodePayload {
  episode_name?: string;
  description?: string;
  status?: string;
  settings?: Record<string, any>;
  sort_order?: number;
}

export async function saveProject(projectData: any): Promise<{ success: boolean; project_id: string }> {
  return apiJson<any>('/api/projects/save', {
    method: 'POST',
    body: JSON.stringify(projectData),
  }, 'saveProject');
}

export async function listProjects(
  limit: number = 100,
  orgId?: string,
): Promise<{ success: boolean; projects: any[] }> {
  const qs = new URLSearchParams();
  if (limit !== 100) qs.set('limit', String(limit));
  if (orgId) qs.set('org_id', orgId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiJson<any>(`/api/projects/list${suffix}`, { method: 'GET' }, 'listProjects');
}

export async function getProject(projectId: string): Promise<{ success: boolean; project: any }> {
  return apiJson<any>(`/api/projects/${projectId}`, { method: 'GET' }, 'getProject');
}

export async function updateProject(projectId: string, data: UpdateProjectPayload) {
  const result = await apiJson<any>(`/api/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateProject');
  if (result.success && typeof data.project_name === 'string') {
    window.dispatchEvent(new CustomEvent('projects:updated', { detail: { projectId, projectName: data.project_name } }));
  }
  return result;
}

export async function deleteProject(projectId: string): Promise<{ success: boolean }> {
  return apiJson<any>(`/api/projects/${projectId}`, { method: 'DELETE' }, 'deleteProject');
}

export async function exportToVideo(projectId: string, selectedItems: string[]): Promise<{
  success: boolean;
  exported_count: number;
  video_tasks: any[];
}> {
  return apiJson<any>(`/api/projects/${projectId}/export-to-video`, {
    method: 'POST',
    body: JSON.stringify({ selected_items: selectedItems }),
  }, 'exportToVideo');
}

export async function getProjectMembers(projectId: string) {
  return apiJson<any>(`/api/projects/${projectId}/members`, { method: 'GET' }, 'getProjectMembers');
}

export async function addProjectMember(projectId: string, userId: string, role = 'member', responsibility = 'all') {
  return apiJson<any>(`/api/projects/${projectId}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, role, responsibility }),
  }, 'addProjectMember');
}

export async function updateProjectMember(projectId: string, memberUserId: string, data: UpdateProjectMemberPayload) {
  return apiJson<any>(`/api/projects/${projectId}/members/${memberUserId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateProjectMember');
}

export async function removeProjectMember(projectId: string, memberUserId: string) {
  return apiJson<any>(`/api/projects/${projectId}/members/${memberUserId}`, { method: 'DELETE' }, 'removeProjectMember');
}

export async function getEpisodes(projectId: string) {
  return apiJson<any>(`/api/projects/${projectId}/episodes`, { method: 'GET' }, 'getEpisodes');
}

export async function createEpisode(projectId: string, episodeName = '', description = '') {
  return apiJson<any>(`/api/projects/${projectId}/episodes`, {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, episode_name: episodeName, description }),
  }, 'createEpisode');
}

export async function updateEpisode(episodeId: string, data: UpdateEpisodePayload) {
  return apiJson<any>(`/api/episodes/${episodeId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateEpisode');
}

export async function duplicateEpisode(episodeId: string) {
  return apiJson<any>(`/api/episodes/${episodeId}/duplicate`, {
    method: 'POST',
  }, 'duplicateEpisode');
}

export async function reorderEpisodes(projectId: string, episodeIds: string[]) {
  return apiJson<any>(`/api/projects/${projectId}/episodes/reorder`, {
    method: 'POST',
    body: JSON.stringify({ episode_ids: episodeIds }),
  }, 'reorderEpisodes');
}

export async function deleteEpisode(episodeId: string) {
  return apiJson<any>(`/api/episodes/${episodeId}`, { method: 'DELETE' }, 'deleteEpisode');
}
