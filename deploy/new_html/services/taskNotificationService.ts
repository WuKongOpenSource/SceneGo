import { apiJson } from './httpClient';

export async function getActiveTasks() {
    return apiJson<any>('/api/tasks/active', { method: 'GET' }, 'getActiveTasks');
}

export async function getTaskNotifications(since?: number) {
    const url = since
        ? `/api/tasks/notifications?since=${since}`
        : '/api/tasks/notifications';
    return apiJson<any>(url, { method: 'GET' }, 'getTaskNotifications');
}

export async function getUnreadNotificationCount() {
    return apiJson<any>('/api/notifications/unread-count', { method: 'GET' }, 'getUnreadNotificationCount');
}

export async function getNotifications(status?: string, limit = 50, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) params.set('status', status);
    return apiJson<any>(`/api/notifications?${params}`, { method: 'GET' }, 'getNotifications');
}

export async function markNotificationRead(notificationId: string) {
    return apiJson<any>(`/api/notifications/${notificationId}/read`, { method: 'POST' }, 'markNotificationRead');
}

export async function markAllNotificationsRead() {
    return apiJson<any>('/api/notifications/read-all', { method: 'POST' }, 'markAllNotificationsRead');
}

export async function dismissNotification(notificationId: string) {
    return apiJson<any>(`/api/notifications/${notificationId}`, { method: 'DELETE' }, 'dismissNotification');
}
