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

  it.each(['ComfyUI 正在生成 120/121', undefined])('hides misleading overall percentages, bars and ETA from legacy upscale tasks (%s)', stage => {
    state.tasks[0] = { ...state.tasks[0], kind: 'video-upscale', status: 'running', progress: 120 / 121 * 0.8 + 0.1,
      metadata: { stage, step: 120, totalSteps: 121, etaSeconds: 10, canCancel: false } };
    render(<MemoryRouter><NotificationPanel /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '1 个任务运行中' }));
    expect(screen.getByText('视频放大处理中')).toBeInTheDocument();
    expect(screen.getByText('正在处理视频，暂无法估算整体进度')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/89%|120\/121|剩 10s/);
    expect(document.querySelector('[style*="width:"]')).toBeNull();
    expect(screen.getByRole('button', { name: '取消排队并退还积分' })).toBeDisabled();
  });

  it('updates upscale phases even when the new phase starts at a lower local count', () => {
    state.tasks[0] = { ...state.tasks[0], kind: 'video-upscale', status: 'running', progress: 0.9,
      metadata: { stage: '视频放大：AI 放大中 · 当前阶段 120/121' } };
    const view = render(<MemoryRouter><NotificationPanel /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '1 个任务运行中' }));
    expect(screen.getByText('当前阶段 120/121，不代表整体完成比例')).toBeInTheDocument();
    state.tasks = [{ ...state.tasks[0], progress: 0.1, metadata: { stage: '视频放大：编码视频 · 当前阶段 1/121' } }];
    view.rerender(<MemoryRouter><NotificationPanel /></MemoryRouter>);
    expect(screen.getByText('编码视频')).toBeInTheDocument();
    expect(screen.getByText('当前阶段 1/121，不代表整体完成比例')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/120\/121|10%|90%/);
    state.tasks = [{ ...state.tasks[0], metadata: { stage: '正在保存生成结果' }, progress: 0.95 }];
    view.rerender(<MemoryRouter><NotificationPanel /></MemoryRouter>);
    expect(screen.getByText('上传保存')).toBeInTheDocument();
    expect(screen.queryByText('已完成')).not.toBeInTheDocument();
  });

  it.each([['queued', '排队中'], ['completed', '已完成'], ['failed', '失败'], ['cancelled', '已取消']])('preserves authoritative %s status', (status, label) => {
    state.tasks[0] = { ...state.tasks[0], kind: 'video-upscale', status: 'running', progress: 0.89 };
    const view = render(<MemoryRouter><NotificationPanel /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '1 个任务运行中' }));
    state.tasks = [{ ...state.tasks[0], status }];
    view.rerender(<MemoryRouter><NotificationPanel /></MemoryRouter>);
    expect(screen.getByText(label, { exact: true, selector: 'span.text-xs' })).toBeInTheDocument();
    expect(screen.queryByText('视频放大处理中')).not.toBeInTheDocument();
  });

  it('retains progress for other task kinds', () => {
    state.tasks[0] = { ...state.tasks[0], status: 'running', progress: 0.5 };
    render(<MemoryRouter><NotificationPanel /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '1 个任务运行中' }));
    expect(screen.getByText('执行中 · 50%')).toBeInTheDocument();
    expect(document.querySelector('[style*="width: 50%"]')).not.toBeNull();
  });
});
