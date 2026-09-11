import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoTask } from '../../services/videoTaskTypes';
import {
  __resetVideoTaskPollerForTesting, attachVideoPollCallbacks, detachVideoPollCallbacks,
  getVideoPollTaskId, isVideoPollActive, startVideoPoll, stopVideoPoll,
} from '../../services/videoTaskPoller';

const mocks = vi.hoisted(() => ({
  getTaskStatus: vi.fn(),
  registry: { register: vi.fn(), update: vi.fn(), complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() },
}));
vi.mock('@runtime/videoTaskService', () => ({ getTaskStatus: mocks.getTaskStatus }));
vi.mock('../../services/taskRegistry', () => ({ taskRegistry: mocks.registry }));

function deferred() {
  let resolve!: (value: VideoTask) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<VideoTask>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const result = (status: VideoTask['status'], progress = 5): VideoTask => ({
  task_id: 'task', task_type: 'seedance_multi', status, progress, created_at: '',
});
const callbacks = () => ({ onComplete: vi.fn(), onProgress: vi.fn(), onFail: vi.fn() });

beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); });
afterEach(() => { __resetVideoTaskPollerForTesting(); vi.useRealTimers(); });

describe('video task poll ownership', () => {
  it('releases a hung status request and observes the same generation again', async () => {
    mocks.getTaskStatus.mockImplementationOnce((_taskId, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })).mockResolvedValue(result('completed', 100));
    const cbs = callbacks();
    startVideoPoll('card', { taskId: 'task', title: 'Video', callbacks: cbs });
    await vi.advanceTimersByTimeAsync(33000);
    expect(mocks.getTaskStatus).toHaveBeenCalledTimes(2);
    expect(mocks.getTaskStatus.mock.calls.every(([id]) => id === 'task')).toBe(true);
    expect(cbs.onFail).not.toHaveBeenCalled();
    expect(cbs.onComplete).toHaveBeenCalledOnce();
  });

  it('never overlaps status queries when the network is slower than the interval', async () => {
    const slow = deferred();
    mocks.getTaskStatus.mockReturnValueOnce(slow.promise).mockResolvedValue(result('completed', 100));
    const cbs = callbacks();
    startVideoPoll('card', { taskId: 'task', title: 'Video', callbacks: cbs });
    await vi.advanceTimersByTimeAsync(9000);
    expect(mocks.getTaskStatus).toHaveBeenCalledTimes(1);
    slow.resolve(result('processing'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(cbs.onComplete).toHaveBeenCalledOnce();
    expect(isVideoPollActive('card')).toBe(false);
  });

  it.each(['completed', 'processing', 'failed'] as const)('ignores late %s after stopping a poll', async status => {
    const slow = deferred();
    mocks.getTaskStatus.mockReturnValueOnce(slow.promise);
    const cbs = callbacks();
    startVideoPoll('card', { taskId: 'old', title: 'Video', callbacks: cbs });
    stopVideoPoll('card');
    slow.resolve(result(status));
    await vi.advanceTimersByTimeAsync(0);
    expect(cbs.onComplete).not.toHaveBeenCalled();
    expect(cbs.onProgress).not.toHaveBeenCalled();
    expect(cbs.onFail).not.toHaveBeenCalled();
    expect(mocks.registry.complete).not.toHaveBeenCalled();
    expect(mocks.registry.update).not.toHaveBeenCalled();
    expect(mocks.registry.fail).not.toHaveBeenCalled();
  });

  it.each(['completed', 'not-found'] as const)('an old task %s cannot stop its replacement', async outcome => {
    const old = deferred();
    const next = deferred();
    mocks.getTaskStatus.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const oldCbs = callbacks();
    const newCbs = callbacks();
    startVideoPoll('card', { taskId: 'old', title: 'Old', callbacks: oldCbs });
    startVideoPoll('card', { taskId: 'new', title: 'New', callbacks: newCbs });
    if (outcome === 'completed') old.resolve(result('completed'));
    else old.reject(new Error('TASK_NOT_FOUND'));
    await vi.advanceTimersByTimeAsync(0);
    expect(getVideoPollTaskId('card')).toBe('new');
    expect(newCbs.onComplete).not.toHaveBeenCalled();
    expect(newCbs.onFail).not.toHaveBeenCalled();
    expect(oldCbs.onComplete).not.toHaveBeenCalled();
    next.resolve(result('completed', 100));
    await vi.advanceTimersByTimeAsync(0);
    expect(newCbs.onComplete).toHaveBeenCalledOnce();
    expect(mocks.registry.complete).toHaveBeenCalledWith('new');
  });

  it.each([['pending', 'queued'], ['running', 'processing']] as const)('reports the server %s state', async (status, mapped) => {
    mocks.getTaskStatus.mockResolvedValue(result(status, 38));
    const cbs = callbacks();
    startVideoPoll('card', { taskId: 'task', title: 'Video', callbacks: cbs });
    await vi.advanceTimersByTimeAsync(0);
    expect(cbs.onProgress).toHaveBeenCalledWith(38, mapped);
    expect(mocks.registry.update).toHaveBeenCalledWith('task', expect.objectContaining({ progress: 0.38 }));
  });

  it('keeps querying after a transient error without failing the generation', async () => {
    mocks.getTaskStatus.mockRejectedValueOnce(new Error('network')).mockResolvedValue(result('completed'));
    const cbs = callbacks();
    startVideoPoll('card', { taskId: 'task', title: 'Video', callbacks: cbs });
    await vi.advanceTimersByTimeAsync(3000);
    expect(cbs.onFail).not.toHaveBeenCalled();
    expect(cbs.onComplete).toHaveBeenCalledOnce();
  });

  it('uses reattached callbacks without starting another request for the same task', async () => {
    const slow = deferred();
    mocks.getTaskStatus.mockReturnValueOnce(slow.promise);
    const oldCbs = callbacks();
    const newCbs = callbacks();
    startVideoPoll('card', { taskId: 'task', title: 'Video', callbacks: oldCbs });
    detachVideoPollCallbacks('card');
    attachVideoPollCallbacks('card', newCbs);
    startVideoPoll('card', { taskId: 'task', title: 'Video' });
    slow.resolve(result('completed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getTaskStatus).toHaveBeenCalledOnce();
    expect(oldCbs.onComplete).not.toHaveBeenCalled();
    expect(newCbs.onComplete).toHaveBeenCalledOnce();
  });
});
