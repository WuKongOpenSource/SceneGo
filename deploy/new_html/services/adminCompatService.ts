import { apiJson } from './httpClient';

export async function getUsers(): Promise<{
  success: boolean;
  users: any[];
}> {
  return apiJson<any>('/api/admin/users', { method: 'GET' }, 'getUsers');
}

export async function createUser(userData: any): Promise<{
  success: boolean;
  user: any;
}> {
  return apiJson<any>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(userData),
  }, 'createUser');
}

export async function updateUserPermissions(userId: string, permissions: any): Promise<{
  success: boolean;
}> {
  return apiJson<any>(`/api/admin/users/${userId}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissions }),
  }, 'updateUserPermissions');
}

export async function deleteUser(userId: string): Promise<{
  success: boolean;
}> {
  return apiJson<any>(`/api/admin/users/${userId}`, { method: 'DELETE' }, 'deleteUser');
}

export async function getGenerationLogs(limit: number = 100): Promise<{
  success: boolean;
  logs: any[];
}> {
  return apiJson<any>(`/api/admin/logs?limit=${limit}`, { method: 'GET' }, 'getGenerationLogs');
}

export async function getSystemStats(groupBy?: 'user' | 'org'): Promise<{
  success: boolean;
  stats: any;
  group_by?: 'none' | 'user' | 'org';
  breakdown?: any[];
}> {
  const qs = groupBy ? `?group_by=${groupBy}` : '';
  return apiJson<any>(`/api/admin/stats${qs}`, { method: 'GET' }, 'getSystemStats');
}
