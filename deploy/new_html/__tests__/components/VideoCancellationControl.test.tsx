import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoCancellationControl, VideoGenerationPhase } from '../../components/video/VideoCancellationControl';
import { cancelTask } from '../../services/taskControlService';

vi.mock('../../services/taskControlService', () => ({ cancelTask: vi.fn(async () => ({ success: true })) }));
vi.mock('../../services/taskRegistry', () => ({ taskRegistry: { cancel: vi.fn() } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
describe('durable video undo window', () => {
  it('changes the card status at the deadline without waiting for a poll', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000000);
    render(<VideoGenerationPhase deadline={1010} />);
    expect(screen.getByText('可撤销 · 10 秒')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(screen.getByText('生成中')).toBeInTheDocument();
    expect(screen.queryByText(/排队中/)).not.toBeInTheDocument();
  });
  it('restores remaining seconds after remount, expires locally and cannot cancel after the deadline', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000000);
    const props = { taskId: 'server-id', deadline: 1010, canCancel: true, onCancelled: vi.fn(), onError: vi.fn() };
    const first = render(<VideoCancellationControl {...props} />);
    expect(screen.getByText('防误点：10 秒后提交 API')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    first.unmount();
    render(<VideoCancellationControl {...props} />);
    expect(screen.getByText('防误点：4 秒后提交 API')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(screen.queryByRole('button', { name: '取消生成' })).not.toBeInTheDocument();
    expect(screen.getByText('生成中，已结束撤销窗口')).toBeInTheDocument();
    expect(cancelTask).not.toHaveBeenCalled();
  });
  it('only reports cancellation after the server accepts it', async () => {
    const onCancelled = vi.fn();
    render(<VideoCancellationControl taskId="id" deadline={Date.now() / 1000 + 10} canCancel onCancelled={onCancelled} onError={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '取消生成' })));
    expect(cancelTask).toHaveBeenCalledWith('id');
    expect(onCancelled).toHaveBeenCalledOnce();
  });
});
