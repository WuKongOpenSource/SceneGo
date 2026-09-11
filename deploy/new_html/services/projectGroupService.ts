import { apiJson } from './httpClient';

export interface ProjectGroup {
  group_id: string;
  group_name: string;
  user_id: string;
  project_count?: number;
}

export async function listProjectGroups(): Promise<ProjectGroup[]> {
  const result = await apiJson<{ groups: ProjectGroup[] }>('/api/project-groups', {}, '项目分组');
  return result.groups || [];
}

export async function saveProjectGroup(name: string, groupId?: string) {
  const groupName = name.trim();
  if (!groupName || Array.from(groupName).length > 255) throw new Error('分组名称需为 1-255 个字符');
  return apiJson<{ group: ProjectGroup }>(groupId ? `/api/project-groups/${encodeURIComponent(groupId)}` : '/api/project-groups', {
    method: groupId ? 'PUT' : 'POST', body: JSON.stringify({ group_name: groupName }),
  }, '保存项目分组');
}

export async function deleteProjectGroup(groupId: string) {
  return apiJson(`/api/project-groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' }, '删除项目分组');
}
