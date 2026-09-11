import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TaskProvider, useTaskManager } from '../../contexts/TaskContext';
import { taskRegistry } from '../../services/taskRegistry';
import { cancelTask } from '../../services/taskControlService';

vi.mock('../../services/taskControlService', () => ({ cancelTask: vi.fn() }));
vi.mock('../../admin/adminRoute', () => ({ isAdminPath: () => true }));

describe('TaskContext cancellation confirmation', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}><TaskProvider>{children}</TaskProvider></QueryClientProvider>
  );
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('does not cancel locally after a rejected server request', async () => {
    const { result } = renderHook(() => useTaskManager(), { wrapper });
    result.current.registerTask({ taskId: 'reject-cancel', kind: 'video-i2v', title: 'Video', targetPage: 'generation', initialStatus: 'queued' });
    vi.mocked(cancelTask).mockRejectedValue(new Error('已经提交'));
    await act(async () => {
      await expect(result.current.cancelTask('reject-cancel')).rejects.toThrow('已经提交');
    });
    expect(taskRegistry.get('reject-cancel')?.status).toBe('queued');
    expect(taskRegistry.get('reject-cancel')?.metadata?.cancelPending).toBe(false);
  });

  it('keeps a confirmed cancellation terminal despite stale progress or failure polls', async () => {
    const { result } = renderHook(() => useTaskManager(), { wrapper });
    result.current.registerTask({ taskId: 'confirm-cancel', kind: 'video-i2v', title: 'Video', targetPage: 'generation', initialStatus: 'queued' });
    vi.mocked(cancelTask).mockResolvedValue({ success: true, status: 'cancelled', refund_status: 'completed', message: '已退还积分' });
    await act(async () => { expect(await result.current.cancelTask('confirm-cancel')).toBe('已退还积分'); });
    taskRegistry.update('confirm-cancel', { status: 'running', progress: 0.1 });
    taskRegistry.fail('confirm-cancel', 'stale failure');
    expect(taskRegistry.get('confirm-cancel')?.status).toBe('cancelled');
    expect(taskRegistry.get('confirm-cancel')?.metadata?.refundStatus).toBe('completed');
  });

  it('uses the backend id after browser-queued work has been submitted', async () => {
    const { result } = renderHook(() => useTaskManager(), { wrapper });
    result.current.registerTask({ taskId: 'frontend-id', kind: 'video-i2v', title: 'Video', targetPage: 'generation', initialStatus: 'queued', metadata: { backendTaskId: 'server-id' } });
    vi.mocked(cancelTask).mockResolvedValue({ success: true, status: 'cancelled', refund_status: 'completed', message: '已退还积分' });
    await act(async () => { await result.current.cancelTask('frontend-id'); });
    expect(cancelTask).toHaveBeenCalledWith('server-id');
    expect(taskRegistry.get('frontend-id')?.status).toBe('cancelled');
  });
});
