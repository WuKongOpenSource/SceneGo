import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalTaskManager } from '../../services/globalTaskManager';
import { getActiveTasks, getTaskNotifications } from '../../services/taskNotificationService';

vi.mock('../../services/taskNotificationService', () => ({
  getActiveTasks: vi.fn(),
  getTaskNotifications: vi.fn(),
}));

const mockGetActiveTasks = vi.mocked(getActiveTasks);
const mockGetTaskNotifications = vi.mocked(getTaskNotifications);

function terminalTask(taskId: string, status: 'completed' | 'failed' = 'failed') {
  return {
    task_id: taskId,
    task_type: 'seedance_i2v',
    status,
    project_id: 'proj_1',
    category: 'video',
    source_page: 'generation',
    source_item_id: 'shot_1',
    display_name: 'Seedance shot generation',
    completed_at: new Date().toISOString(),
    entity_type: '',
    entity_id: '',
    file_role: '',
    episode_id: 'ep_1',
  };
}

describe('GlobalTaskManager notification polling', () => {
  it('preserves cancelled status without showing a failure notification', async () => {
    mockGetTaskNotifications.mockResolvedValue({ success: true, notifications: [{ ...terminalTask('cancelled'), status: 'cancelled' }] });
    mockGetActiveTasks.mockResolvedValue({ success: true, tasks: [] });
    const manager = new GlobalTaskManager();
    const events: any[] = [];
    manager.addEventListener((type, data) => events.push({ type, data }));
    await (manager as any).poll();
    expect(events.find(event => event.type === 'tasks_terminal').data.tasks[0].status).toBe('cancelled');
    expect(events.some(event => event.type === 'notification')).toBe(false);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveTasks.mockResolvedValue({ success: true, tasks: [] });
  });

  it('uses a notification baseline on first poll and does not toast historical failures', async () => {
    mockGetTaskNotifications.mockResolvedValueOnce({
      success: true,
      notifications: [terminalTask('old_failed_task', 'failed')],
    });

    const manager = new GlobalTaskManager();
    const events: string[] = [];
    manager.addEventListener((type) => events.push(type));

    await (manager as any).poll();

    expect(mockGetTaskNotifications).toHaveBeenCalledWith(undefined);
    expect(events).not.toContain('notification');
    expect(events).toContain('tasks_terminal');
  });

  it('emits only new notification ids after the baseline poll', async () => {
    mockGetTaskNotifications
      .mockResolvedValueOnce({ success: true, notifications: [terminalTask('baseline_failed', 'failed')] })
      .mockResolvedValueOnce({ success: true, notifications: [terminalTask('new_failed', 'failed')] })
      .mockResolvedValueOnce({ success: true, notifications: [terminalTask('new_failed', 'failed')] });

    const manager = new GlobalTaskManager();
    const notifications: string[] = [];
    manager.addEventListener((type, data) => {
      if (type === 'notification' && data.notification?.id) {
        notifications.push(data.notification.id);
      }
    });

    await (manager as any).poll();
    await (manager as any).poll();
    await (manager as any).poll();

    expect(notifications).toEqual(['new_failed']);
  });

  it('preserves unknown progress and normalizes backend percentages', async () => {
    mockGetActiveTasks.mockResolvedValueOnce({
      success: true,
      tasks: [
        {
          task_id: 'known_progress',
          task_type: 'seedance_i2v',
          status: 'processing',
          progress: 42,
          created_at: new Date().toISOString(),
        },
        {
          task_id: 'unknown_progress',
          task_type: 'seedance_i2v',
          status: 'processing',
          progress: null,
          created_at: new Date().toISOString(),
        },
      ],
    });
    mockGetTaskNotifications.mockResolvedValueOnce({ success: true, notifications: [] });

    const manager = new GlobalTaskManager();
    const snapshots: any[][] = [];
    manager.addEventListener((type, data) => {
      if (type === 'tasks_updated' && data.tasks) snapshots.push(data.tasks);
    });

    await (manager as any).poll();

    expect(snapshots[0][0].progress).toBe(0.42);
    expect(snapshots[0][1].progress).toBeUndefined();
  });

  it('preserves task type and storyboard navigation context from active tasks', async () => {
    mockGetActiveTasks.mockResolvedValueOnce({
      success: true,
      tasks: [
        {
          task_id: 'gemini_img_42',
          task_type: 'gemini_image',
          category: 'image',
          status: 'processing',
          display_name: 'AI 生图任务',
          project_id: 'proj_1',
          episode_id: 'ep_1',
          source_page: 'design',
          source_item_id: 'shot_06',
          entity_type: 'storyboard_item',
          entity_id: 'shot_06',
          file_role: 'generated_image',
          provider: 'gemini',
          model: 'nanobanana',
          created_at: new Date().toISOString(),
        },
        {
          task_id: 'invalid_source_page',
          task_type: 'gemini_image',
          status: 'processing',
          source_page: 'javascript:invalid',
          created_at: new Date().toISOString(),
        },
      ],
    });
    mockGetTaskNotifications.mockResolvedValueOnce({ success: true, notifications: [] });

    const manager = new GlobalTaskManager();
    const snapshots: any[][] = [];
    manager.addEventListener((type, data) => {
      if (type === 'tasks_updated' && data.tasks) snapshots.push(data.tasks);
    });

    await (manager as any).poll();

    expect(snapshots[0][0]).toMatchObject({
      taskType: 'gemini_image',
      projectId: 'proj_1',
      episodeId: 'ep_1',
      sourceItemId: 'shot_06',
      entityType: 'storyboard_item',
      entityId: 'shot_06',
      fileRole: 'generated_image',
      provider: 'gemini',
      modelName: 'nanobanana',
      sourcePage: 'generation',
    });
    expect(snapshots[0][1].sourcePage).toBe('editor');
  });

  it('reconciles terminal task state without creating a visible notification while SSE is connected', async () => {
    mockGetTaskNotifications
      .mockResolvedValueOnce({ success: true, notifications: [] })
      .mockResolvedValueOnce({
        success: true,
        notifications: [terminalTask('deepseek_text_1', 'completed')],
      });

    const manager = new GlobalTaskManager();
    const events: Array<{ type: string; taskStatus?: string }> = [];
    manager.addEventListener((type, data) => {
      events.push({ type, taskStatus: data.tasks?.[0]?.status });
    });

    await (manager as any).poll();
    (manager as any).sseConnected = true;
    await (manager as any).poll();

    expect(events).toContainEqual({ type: 'tasks_terminal', taskStatus: 'completed' });
    expect(events.filter(event => event.type === 'notification')).toEqual([]);
  });

  it('keeps low-frequency reconciliation polling while SSE is connected', async () => {
    vi.useFakeTimers();
    mockGetTaskNotifications.mockResolvedValue({ success: true, notifications: [] });
    const manager = new GlobalTaskManager();
    (manager as any).sseConnected = true;

    try {
      (manager as any).startPolling(15_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockGetActiveTasks).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(15_000);
      expect(mockGetActiveTasks).toHaveBeenCalledTimes(2);
    } finally {
      manager.stop();
      vi.useRealTimers();
    }
  });
});
