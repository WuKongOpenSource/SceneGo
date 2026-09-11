import { apiFetch } from './httpClient';
import type { VideoTask } from './videoTaskTypes';

export async function getTaskStatus(taskId: string, signal?: AbortSignal): Promise<VideoTask> {
  const response = await apiFetch(`/api/task/${taskId}`, signal ? { signal } : {}, { apiName: 'getTaskStatus' });
  if (!response.ok) {
    if (response.status === 404) throw new Error('TASK_NOT_FOUND');
    throw new Error('查询任务状态失败');
  }
  return response.json();
}

/** Both editions let the server authenticate cookies or a legacy bearer header. */
export async function getTasks(limit = 100): Promise<{ tasks: VideoTask[] }> {
  let response: Response;
  try {
    // HttpOnly cookies cannot be inspected here. Missing browser tokens must
    // never masquerade as empty history or prevent live-task reconciliation.
    response = await apiFetch(`/api/tasks?limit=${limit}`, {}, {
      apiName: 'getTasks', includeContentType: false,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('未授权')) throw new Error('登录已过期');
    throw error;
  }
  if (!response.ok) throw new Error('加载历史任务失败');
  const data = await response.json();
  // The legacy endpoint can report a query failure with HTTP 200.
  if (!data || data.success === false || !Array.isArray(data.tasks)) throw new Error('加载历史任务失败');
  return data;
}
