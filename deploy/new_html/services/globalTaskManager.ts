



import type { GlobalTask, SourcePage, TaskNotification } from '../types';
import { secureApiUrl } from './httpClient';
import { getActiveTasks, getTaskNotifications } from './taskNotificationService';

function normalizeProgress(value: unknown): number | undefined {
    if (value == null || value === '' || typeof value === 'boolean') return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    const normalized = numeric > 1 ? numeric / 100 : numeric;
    return Math.min(1, Math.max(0, normalized));
}

const SOURCE_PAGES = new Set<string>([
    'editor',
    'script',
    'design',
    'materials',
    'audio',
    'storyboard',
    'generation',
    'video',
    'enhance',
    'postprocess',
    'canvas',
    'history',
    'media-library',
    'final',
    'video-reverse',
    'image-upscale',
    'global',
] satisfies SourcePage[]);

function isSourcePage(value: string): value is SourcePage {
    return SOURCE_PAGES.has(value);
}

export type TaskEventType = 'tasks_updated' | 'tasks_terminal' | 'notification' | 'progress';
export type TaskEventCallback = (
    type: TaskEventType,
    data: {
        tasks?: GlobalTask[];
        notification?: TaskNotification;
        taskId?: string;
        progress?: number;
        message?: string;






        raw?: Record<string, unknown>;
    }
) => void;

export class GlobalTaskManager {
    private listeners: TaskEventCallback[] = [];
    private pollingTimer: ReturnType<typeof setInterval> | null = null;
    private lastPollTime = 0;
    private activeTasks: GlobalTask[] = [];
    private pollingIntervalMs: number | null = null;
    private readonly fallbackPollIntervalMs = 5000;
    private readonly reconciliationPollIntervalMs = 15000;
    private eventSource: EventSource | null = null;
    private sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private sseConnected = false;
    private notificationBaselineReady = false;
    private emittedNotificationIds: Set<string> = new Set();
    private maxRememberedNotificationIds = 300;

    start() {
        if (this.eventSource || this.pollingTimer) return;
        this.trySSE();
    }

    stop() {
        this.stopSSE();
        this.stopPolling();
    }

    private trySSE() {
        try {
            // EventSource cannot set Authorization headers. The same-origin
            // HttpOnly session cookie is sent automatically and keeps JWTs out
            // of URLs, access logs, and browser history.
            this.eventSource = new EventSource(secureApiUrl('/api/tasks/stream'));

            this.eventSource.onopen = () => {
                console.log('[TaskManager] SSE 已连接');
                this.sseConnected = true;


                this.startPolling(this.reconciliationPollIntervalMs);
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleSSEMessage(data);
                } catch (e) {
                    console.warn('[TaskManager] SSE 消息解析失败:', e);
                }
            };

            this.eventSource.onerror = () => {
                console.warn('[TaskManager] SSE 断开，降级轮询');
                this.stopSSE();
                this.startPollingFallback();
                this.sseReconnectTimer = setTimeout(() => {
                    if (!this.eventSource) this.trySSE();
                }, 10000);
            };
        } catch {
            this.startPollingFallback();
        }
    }

    private stopSSE() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.sseConnected = false;
        if (this.sseReconnectTimer) {
            clearTimeout(this.sseReconnectTimer);
            this.sseReconnectTimer = null;
        }
    }

    private handleSSEMessage(data: any) {
        if (data.type === 'task_complete' || data.type === 'task_failed') {
            if (data.type === 'task_complete' && typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('credits:updated'));
            }
            const notification: TaskNotification = {
                id: data.task_id,
                type: this.mapTaskType(data.task_type || ''),
                status: data.type === 'task_complete' ? 'completed' : 'failed',
                message: `${data.display_name || data.task_type || '任务'} ${data.type === 'task_complete' ? '已完成' : '失败'}`,
                targetView: 'Video' as any,
                targetProjectId: data.project_id,
                targetPage: this.normalizeTaskSourcePage(data.source_page, data.entity_type),
                timestamp: Date.now(),
                taskId: data.task_id,
                taskType: data.task_type || undefined,
                entityType: data.entity_type || undefined,
                entityId: data.entity_id || undefined,
                fileRole: data.file_role || undefined,
                episodeId: data.episode_id || undefined,
                targetItemId: data.source_item_id || data.entity_id || undefined,
                provider: data.provider || undefined,
                modelName: data.model || data.model_name || undefined,
            };
            if (this.rememberNotificationId(notification.id)) {
                this.emit('notification', { notification });
            }
            this.poll();
        } else {
            this.emit('progress', {
                taskId: data.task_id,
                progress: normalizeProgress(data.progress),
                message: data.message,


                raw: data,
            });
        }
    }

    private startPollingFallback() {
        this.startPolling(this.fallbackPollIntervalMs);
        console.log('[TaskManager] 轮询已启动');
    }

    private startPolling(intervalMs: number) {
        if (this.pollingTimer && this.pollingIntervalMs === intervalMs) return;
        this.stopPolling();
        void this.poll();
        this.pollingIntervalMs = intervalMs;
        this.pollingTimer = setInterval(() => void this.poll(), intervalMs);
    }

    private stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
        this.pollingIntervalMs = null;
    }

    private async poll() {
        const pollStartedAt = Date.now();
        const isBaselinePoll = !this.notificationBaselineReady;


        const since = this.lastPollTime ? Math.max(0, this.lastPollTime - 60_000) : undefined;

        try {
            const [activeRes, notifRes] = await Promise.all([
                getActiveTasks().catch(() => null),
                getTaskNotifications(since).catch(() => null)
            ]);

            if (activeRes?.success && activeRes.tasks) {
                this.activeTasks = activeRes.tasks.map((t: any) => ({
                    id: t.task_id,
                    category: t.category || t.task_type,
                    taskType: t.task_type || undefined,
                    status: t.status === 'processing' ? 'running' : t.status,
                    canCancel: t.can_cancel,
                    displayName: t.display_name || t.task_type,
                    projectId: t.project_id || '',
                    sourcePage: this.normalizeTaskSourcePage(t.source_page, t.entity_type),
                    sourceItemId: t.source_item_id || t.entity_id,
                    entityType: t.entity_type || undefined,
                    entityId: t.entity_id || undefined,
                    fileRole: t.file_role || undefined,
                    episodeId: t.episode_id || undefined,
                    provider: t.provider || undefined,
                    modelName: t.model || undefined,
                    progress: normalizeProgress(t.progress),
                    createdAt: new Date(t.created_at).getTime()
                }));
                this.emit('tasks_updated', { tasks: this.activeTasks });
            }

            if (notifRes?.success && Array.isArray(notifRes.notifications)) {
                const terminalTasks = notifRes.notifications.map((n: any) => ({
                    id: n.task_id,
                    category: n.category || n.task_type,
                    taskType: n.task_type || undefined,
                    status: n.status === 'cancelled' ? 'cancelled' : n.status === 'completed' ? 'completed' : 'failed',
                    displayName: n.display_name || n.task_type,
                    projectId: n.project_id || '',
                    sourcePage: this.normalizeTaskSourcePage(n.source_page, n.entity_type),
                    sourceItemId: n.source_item_id || n.entity_id,
                    entityType: n.entity_type || undefined,
                    entityId: n.entity_id || undefined,
                    fileRole: n.file_role || undefined,
                    episodeId: n.episode_id || undefined,
                    provider: n.provider || undefined,
                    modelName: n.model || undefined,
                    createdAt: new Date(n.created_at).getTime(),
                    completedAt: new Date(n.completed_at).getTime(),
                    error: n.error_message || undefined,
                })).filter((task: GlobalTask) => Boolean(task.id));
                if (terminalTasks.length > 0) {
                    if (terminalTasks.some((task: GlobalTask) => task.status === 'cancelled')) {
                        window.dispatchEvent(new CustomEvent('credits:updated'));
                    }


                    this.emit('tasks_terminal', { tasks: terminalTasks });
                }
                this.notificationBaselineReady = true;
                this.lastPollTime = pollStartedAt;
            }

            if (!this.sseConnected && !isBaselinePoll && notifRes?.success && notifRes.notifications?.length) {
                for (const n of notifRes.notifications) {
                    if (n.status === 'cancelled') continue;
                    const notification: TaskNotification = {
                        id: n.task_id,
                        type: this.mapTaskType(n.task_type),
                        status: n.status === 'completed' ? 'completed' : 'failed',
                        message: `${n.display_name || n.task_type} ${n.status === 'completed' ? '已完成' : '失败'}`,
                        targetView: 'Editor' as any,
                        targetProjectId: n.project_id,
                        targetPage: this.normalizeTaskSourcePage(n.source_page, n.entity_type),
                        targetItemId: n.source_item_id || n.entity_id,
                        timestamp: new Date(n.completed_at).getTime(),
                        taskId: n.task_id,
                        taskType: n.task_type || undefined,
                        entityType: n.entity_type || undefined,
                        entityId: n.entity_id || undefined,
                        fileRole: n.file_role || undefined,
                        episodeId: n.episode_id || undefined,
                        provider: n.provider || undefined,
                        modelName: n.model || undefined,
                    };
                    if (this.rememberNotificationId(notification.id)) {
                        this.emit('notification', { notification });
                    }
                }
            } else if (isBaselinePoll && notifRes?.success && notifRes.notifications?.length) {
                for (const n of notifRes.notifications) {
                    this.rememberNotificationId(n.task_id);
                }
            }
        } catch (e) {
            console.warn('[TaskManager] 轮询失败:', e);
        }
    }

    private rememberNotificationId(id: string | null | undefined): boolean {
        if (!id) return true;
        if (this.emittedNotificationIds.has(id)) return false;
        this.emittedNotificationIds.add(id);
        if (this.emittedNotificationIds.size > this.maxRememberedNotificationIds) {
            const oldest = this.emittedNotificationIds.values().next().value;
            if (oldest) this.emittedNotificationIds.delete(oldest);
        }
        return true;
    }

    private mapTaskType(taskType: string): 'video' | 'image' | 'material' | 'text' {
        const normalized = taskType.toLowerCase();
        if (normalized.includes('video') || normalized.includes('i2v') || normalized.includes('morph') || normalized.includes('upscale')) return 'video';
        if (normalized.includes('text') || normalized.includes('rewrite') || normalized.includes('storyboard')) return 'text';
        if (normalized.includes('material')) return 'material';
        return 'image';
    }

    private normalizeTaskSourcePage(sourcePage?: string, entityType?: string): SourcePage {
        const normalizedPage = sourcePage || 'editor';
        // Older storyboard image tasks persisted `design`, even though their
        // generated assets belong to a shot in the generation workspace.
        if (entityType === 'storyboard_item' && normalizedPage === 'design') {
            return 'generation';
        }
        return isSourcePage(normalizedPage) ? normalizedPage : 'editor';
    }

    isSSEConnected(): boolean {
        return this.sseConnected;
    }

    getActiveTasks(): GlobalTask[] {
        return this.activeTasks;
    }

    addEventListener(callback: TaskEventCallback): () => void {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    private emit(type: TaskEventType, data: any) {
        this.listeners.forEach(cb => {
            try { cb(type, data); } catch (e) { console.error('[TaskManager] 事件处理错误:', e); }
        });
    }
}

export const globalTaskManager = new GlobalTaskManager();
