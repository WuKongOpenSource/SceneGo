import { describe, expect, it, vi } from 'vitest';
import { TaskRegistry } from '../../services/taskRegistry';
import { recoverSubmittedRegistryTasks } from '../../services/taskRegistryRecovery';
import type { VideoTask } from '../../services/videoTaskTypes';

function setup() {
  const registry = new TaskRegistry(null);
  registry.register({ taskId: 'comfyui_1_100', kind: 'angle-adjust', title: '角度调整',
    targetPage: 'generation', initialStatus: 'running', metadata: { backendTaskId: 'server-task' } });
  registry.register({ taskId: 'comfyui_2_101', kind: 'human-multi-angle', title: '多角度人物',
    targetPage: 'generation', initialStatus: 'queued' });
  return registry;
}

describe('submitted task reconciliation after refresh', () => {
  it('only queries known submitted IDs, settles them and never replays local queued work', async () => {
    const registry = setup();
    const done = vi.fn();
    registry.onComplete('comfyui_1_100', done);
    const query = vi.fn().mockResolvedValue({ status: 'completed', progress: 100 });
    await recoverSubmittedRegistryTasks(registry, new AbortController().signal, query);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('server-task', expect.any(AbortSignal));
    expect(registry.get('server-task')).toMatchObject({ status: 'completed', progress: 1 });
    expect(done).toHaveBeenCalledTimes(1);
    expect(registry.get('comfyui_2_101')?.status).toBe('queued');
  });

  it('normalizes processing progress and preserves active state during a network failure', async () => {
    const registry = setup();
    await recoverSubmittedRegistryTasks(registry, new AbortController().signal,
      vi.fn().mockResolvedValue({ status: 'processing', progress: 10 }));
    expect(registry.get('server-task')).toMatchObject({ status: 'running', progress: 0.1 });
    await recoverSubmittedRegistryTasks(registry, new AbortController().signal, vi.fn().mockRejectedValue(new Error('network')));
    expect(registry.get('server-task')?.status).toBe('running');
  });

  it('ignores an old response after account change/unmount', async () => {
    const registry = setup();
    const controller = new AbortController();
    let finish!: (value: VideoTask) => void;
    const query = vi.fn(() => new Promise<VideoTask>(resolve => { finish = resolve; }));
    const pending = recoverSubmittedRegistryTasks(registry, controller.signal, query);
    controller.abort();
    registry.setUserScope('another-account');
    finish({ task_id: 'server-task', status: 'completed', task_type: 'i2i_fj', created_at: '' });
    await pending;
    expect(registry.list()).toEqual([]);
  });

  it('settles a missing task explicitly instead of leaving an endless spinner', async () => {
    const registry = setup();
    await recoverSubmittedRegistryTasks(registry, new AbortController().signal, vi.fn().mockRejectedValue(new Error('TASK_NOT_FOUND')));
    expect(registry.get('server-task')).toMatchObject({ status: 'failed', error: expect.stringContaining('未自动重新提交') });
  });
});
