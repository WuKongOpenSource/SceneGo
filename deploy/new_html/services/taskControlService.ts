import { apiFetch } from './httpClient';
import { cancelPendingSubmission } from './pendingTaskCancellation';

async function throwTaskControlError(response: Response, fallback: string): Promise<never> {
    const error = await response.json().catch(() => ({ detail: fallback }));
    const detail = error?.detail ?? error?.message;
    throw new Error(typeof detail === 'string' && detail ? detail : fallback);
}

export interface TaskCancellationResult {
    success: boolean;
    status: 'cancelled';
    refund_status: 'completed' | 'pending';
    message: string;
}

const cancellations = new Map<string, Promise<TaskCancellationResult>>();

export function cancelTask(taskId: string): Promise<TaskCancellationResult> {
    const existing = cancellations.get(taskId);
    if (existing) return existing;
    const request = requestCancellation(taskId).finally(() => cancellations.delete(taskId));
    cancellations.set(taskId, request);
    return request;
}

async function requestCancellation(taskId: string): Promise<TaskCancellationResult> {
    if (cancelPendingSubmission(taskId)) {
        return { success: true, status: 'cancelled', refund_status: 'completed', message: '任务已取消，尚未提交，未扣积分' };
    }
    const response = await apiFetch(`/api/task/${taskId}`, {
        method: 'DELETE',
    }, { apiName: 'cancelTask' });

    if (!response.ok) {
        await throwTaskControlError(response, '取消失败');
    }
    const result = await response.json() as TaskCancellationResult;
    if (!result.success) throw new Error(result.message || '取消失败');
    window.dispatchEvent(new CustomEvent('credits:updated'));
    return result;
}

export async function deleteTask(taskId: string): Promise<void> {
    const response = await apiFetch(`/api/task/${taskId}/delete`, {
        method: 'DELETE',
    }, { apiName: 'deleteTask' });

    if (!response.ok) {
        await throwTaskControlError(response, '删除失败');
    }
}
