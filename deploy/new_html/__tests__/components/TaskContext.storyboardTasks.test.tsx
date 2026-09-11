import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskProvider, useTaskManager } from '../../contexts/TaskContext';
import { taskRegistry } from '../../services/taskRegistry';
import { StoryboardTaskCards } from '../../components/StoryboardTaskCards';
import { storyboardToolTasks } from '../../utils/storyboardTaskStatus';

const runtime = vi.hoisted(() => ({ listener: null as ((type: string, data: any) => void) | null }));
vi.mock('../../services/globalTaskManager', () => ({ globalTaskManager: {
  start: vi.fn(), stop: vi.fn(), addEventListener: (listener: typeof runtime.listener) => { runtime.listener = listener; return () => {}; },
} }));
vi.mock('../../services/accountStorage', () => ({ getStoredUserId: () => 'test-account' }));
vi.mock('../../services/taskRegistryRecovery', () => ({ recoverSubmittedRegistryTasks: vi.fn() }));
vi.mock('../../services/taskNotificationService', () => ({
  getNotifications: vi.fn().mockResolvedValue({ success: true, notifications: [] }),
  getUnreadNotificationCount: vi.fn().mockResolvedValue({ success: true, count: 0 }),
}));
function Cards() {
  const { registeredTasks } = useTaskManager();
  return <StoryboardTaskCards tasks={storyboardToolTasks(registeredTasks, { shotId: 'shot-23', episodeId: 'episode-1' })} />;
}
beforeEach(() => {
  runtime.listener = null;
  taskRegistry.setStorage(null);
  taskRegistry.setUserScope('test-account');
  taskRegistry.reset();
});
afterEach(() => { cleanup(); taskRegistry.reset(); });

describe('task runtime to storyboard cards', () => {
  it('uses the backend ID for one live card and invalidates results on baseline completion without a toast', async () => {
    taskRegistry.register({ taskId: 'comfyui_1_100', kind: 'angle-adjust', title: '角度调整 · 镜头2-3',
      targetPage: 'generation', initialStatus: 'running', targetEntityType: 'storyboard_item', targetEntityId: 'shot-23',
      targetItemId: 'shot-23', episodeId: 'episode-1', metadata: { backendTaskId: 'server-1' } });
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const changed = vi.fn();
    window.addEventListener('ostory:episode-data-changed', changed);
    render(<QueryClientProvider client={client}><TaskProvider><Cards /></TaskProvider></QueryClientProvider>);
    await waitFor(() => expect(runtime.listener).not.toBeNull());
    const task = { id: 'server-1', category: 'comfyui', taskType: 'i2i_fj', displayName: 'i2i_fj',
      status: 'running', progress: 0.1, sourcePage: 'generation', entityType: 'storyboard_item', entityId: 'shot-23', episodeId: 'episode-1' };
    act(() => runtime.listener!('tasks_updated', { tasks: [task] }));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByText('角度调整 · 生成中 10%')).toBeInTheDocument();
    act(() => runtime.listener!('tasks_terminal', { tasks: [{ ...task, status: 'completed' }] }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(taskRegistry.get('server-1')?.title).toBe('角度调整 · 镜头2-3');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['entityFiles', 'storyboard_item', 'shot-23'] });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0].detail).toMatchObject({ entityId: 'shot-23', status: 'completed' });
    act(() => runtime.listener!('progress', { taskId: 'server-1', progress: 0.2 }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    window.removeEventListener('ostory:episode-data-changed', changed);
  });

  it('restores a backend-only angle task into its shot after refresh', async () => {
    render(<QueryClientProvider client={new QueryClient()}><TaskProvider><Cards /></TaskProvider></QueryClientProvider>);
    await waitFor(() => expect(runtime.listener).not.toBeNull());
    act(() => runtime.listener!('tasks_updated', { tasks: [{ id: 'server-2', category: 'comfyui', taskType: 'i2i_fj',
      displayName: 'i2i_fj', status: 'running', sourcePage: 'generation', entityType: 'storyboard_item',
      entityId: 'shot-23', episodeId: 'episode-1' }] }));
    expect(screen.getByText('角度调整 · 生成中')).toBeInTheDocument();
    expect(taskRegistry.list()).toHaveLength(1);
  });
});
