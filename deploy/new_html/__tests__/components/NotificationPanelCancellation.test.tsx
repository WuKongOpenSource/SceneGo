import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationPanel } from '../../components/NotificationPanel';

const state = vi.hoisted(() => ({ tasks: [] as any[], cancel: vi.fn() }));
vi.mock('../../contexts/TaskContext', () => ({ useTaskManager: () => ({
  registeredTasks: state.tasks, unreadCount: 0, markAllRead: vi.fn(),
  refreshNotifications: vi.fn(), removeTask: vi.fn(), cancelTask: state.cancel,
}) }));

describe('notification queue cancellation controls', () => {
  beforeEach(() => {
    state.cancel.mockReset();
    state.tasks = [{ taskId: 'queued', kind: 'video-i2v', title: 'Queued video', status: 'queued', targetPage: 'generation', createdAt: Date.now() }];
  });

  it('shows a visible cancellation action and the server rejection', async () => {
    state.cancel.mockRejectedValue(new Error('任务已提交执行，无法取消'));
    render(<MemoryRouter><NotificationPanel /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '1 个任务运行中' }));
    const cancel = screen.getByRole('button', { name: '取消排队并退还积分' });
    expect(cancel.className).not.toContain('opacity-0');
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('无法取消'));
    expect(state.cancel).toHaveBeenCalledWith('queued');
  });

  it('disables cancellation after the server reports submission', () => {
    state.tasks[0] = { ...state.tasks[0], status: 'running', metadata: { canCancel: false } };
    render(<MemoryRouter><NotificationPanel /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '1 个任务运行中' }));
    const cancel = screen.getByRole('button', { name: '取消排队并退还积分' }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    expect(cancel.title).toContain('已提交执行');
    fireEvent.click(cancel);
    expect(state.cancel).not.toHaveBeenCalled();
  });
});
