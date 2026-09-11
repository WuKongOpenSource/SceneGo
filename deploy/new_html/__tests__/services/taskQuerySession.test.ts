import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTasks, getTaskStatus } from '@runtime/videoTaskService';
import { reconcileActiveVideoTasks } from '../../services/videoTaskReconciliation';
import { expectSessionTransport } from '../../test/sessionTransport';

describe('task queries with a server-owned session', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

  function respond(data: unknown, status = 200) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(data), {
      status, headers: { 'content-type': 'application/json' },
    }));
  }

  it('requests history without a JavaScript-visible token and recovers a live video', async () => {
    const task = { task_id: 'live-video', task_type: 'seedance_i2v', status: 'processing', progress: 63,
      data: { workspace_group_id: 'group-1', episode_id: 'ep-1', sub_model: 'mini' } };
    const fetchSpy = respond({ tasks: [task] });
    const history = await getTasks();
    expect(history.tasks).toEqual([task]);
    expect(fetchSpy).toHaveBeenCalledWith('/api/tasks?limit=100', expect.objectContaining({ credentials: 'same-origin' }));
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
    const recovered = reconcileActiveVideoTasks([{ uuid: 'group-1', ids: ['shot-1'], model: 'Seedance2Mini' }], {}, history.tasks, {}, 'ep-1');
    expect(recovered.statuses['group-1']).toMatchObject({ taskId: 'live-video', progress: 63, state: 'processing' });
    expect(recovered.resumable).toEqual([{ uuid: 'group-1', taskId: 'live-video' }]);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('retains edition-specific legacy authentication without hiding history', async () => {
    localStorage.setItem('auth_token', 'test-token');
    const fetchSpy = respond({ tasks: [] });
    await expect(getTasks(25)).resolves.toEqual({ tasks: [] });
    expect(fetchSpy).toHaveBeenCalledWith('/api/tasks?limit=25', expect.anything());
    expectSessionTransport(fetchSpy.mock.calls[0][1]!);
  });

  it('does not turn server-side query failures into an empty history', async () => {
    respond({ success: false, tasks: [] });
    await expect(getTasks()).rejects.toThrow('加载历史任务失败');
  });

  it.each([403, 500, 503])('surfaces HTTP %i without inventing an empty history', async status => {
    respond({ detail: 'unavailable' }, status);
    await expect(getTasks()).rejects.toThrow('加载历史任务失败');
  });

  it('preserves network failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    await expect(getTasks()).rejects.toThrow('offline');
  });

  it('handles a real 401 through the shared logout path', async () => {
    const location = { pathname: '/login', search: '', hash: '', href: '/login' };
    vi.stubGlobal('window', { location });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('username', 'stale-user');
    const fetchSpy = respond({}, 401);
    await expect(getTasks()).rejects.toThrow('登录已过期');
    expect(localStorage.getItem('username')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('polls an individual task using the same cookie transport', async () => {
    const fetchSpy = respond({ task_id: 'live-video', status: 'completed' });
    await expect(getTaskStatus('live-video')).resolves.toMatchObject({ status: 'completed' });
    expect(fetchSpy).toHaveBeenCalledWith('/api/task/live-video', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('keeps the missing-task sentinel used by pollers', async () => {
    respond({}, 404);
    await expect(getTaskStatus('deleted')).rejects.toThrow('TASK_NOT_FOUND');
  });
});
