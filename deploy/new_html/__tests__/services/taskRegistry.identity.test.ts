import { describe, expect, it, vi } from 'vitest';
import { TaskRegistry, type RegisterInput } from '../../services/taskRegistry';
import type { RegisteredTask } from '../../types';

const front: RegisterInput = {
  taskId: 'comfyui_1_123', kind: 'angle-adjust', title: '角度调整 · 镜头2-3',
  targetPage: 'generation', initialStatus: 'running', targetEntityType: 'storyboard_item',
  targetEntityId: 'shot-23', targetItemId: 'shot-23', episodeId: 'episode-1', targetProjectId: 'project-1',
  metadata: { backendTaskId: 'backend-1' },
};
const server = (status: RegisteredTask['status']): RegisteredTask => ({
  taskId: 'backend-1', kind: 'other', title: 'i2i_fj', status, targetPage: 'global', createdAt: Date.now(),
});

describe('submitted task identity', () => {
  it('uses either ID to update one task, preserving shot scope and the friendly label', () => {
    const registry = new TaskRegistry(null);
    registry.register(front);
    registry.mergeFromServer([server('running')]);
    registry.update('backend-1', { progress: 0.4, title: 'i2i_fj', kind: 'other' });
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('backend-1')).toMatchObject({
      taskId: front.taskId, title: front.title, kind: 'angle-adjust', progress: 0.4, targetEntityId: 'shot-23',
    });
    expect(registry.countActiveByPage()).toEqual({ generation: 1 });
    const done = vi.fn();
    registry.onComplete(front.taskId, done);
    registry.mergeFromServer([server('completed')]);
    registry.complete('backend-1');
    registry.update('backend-1', { status: 'running' });
    expect(done).toHaveBeenCalledTimes(1);
    expect(registry.get(front.taskId)?.status).toBe('completed');
    expect(registry.countActiveByPage()).toEqual({});
    registry.remove('backend-1');
    expect(registry.list()).toEqual([]);
  });

  it.each(['running', 'completed', 'failed', 'cancelled'] as const)('collapses a backend row arriving before its submission link: %s', status => {
    const registry = new TaskRegistry(null);
    registry.mergeFromServer([server(status)]);
    registry.register({ ...front, metadata: undefined, initialStatus: 'queued' });
    registry.register(front);
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('backend-1')).toMatchObject({ taskId: front.taskId, status, title: front.title });
  });

  it('restores submitted tasks and collapses duplicate cached IDs, but does not replay unsubmitted work', () => {
    const submitted = { ...front, status: 'running', createdAt: Date.now() - 7_200_000 };
    const raw = JSON.stringify({ active: [submitted, { ...server('running'), createdAt: submitted.createdAt }, {
      ...submitted, taskId: 'comfyui_2_124', metadata: undefined,
    }] });
    const storage = { getItem: () => raw, setItem: vi.fn(), removeItem: vi.fn() } as unknown as Storage;
    const registry = new TaskRegistry(storage);
    registry.rehydrate();
    expect(registry.list()).toHaveLength(2);
    expect(registry.get(front.taskId)?.status).toBe('running');
    expect(registry.get('comfyui_2_124')?.status).toBe('failed');
    expect(registry.countActiveByPage()).toEqual({ generation: 1 });
    registry.mergeFromServer([server('completed')]);
    expect(registry.get(front.taskId)?.status).toBe('completed');
  });

  it('repairs a prior reload failure only when a backend association exists', () => {
    const storage = { getItem: () => JSON.stringify({ done: [{ ...front, status: 'failed',
      createdAt: Date.now(), error: '页面刷新后，本地排队任务已失效，请重新提交' }] }),
      setItem: vi.fn(), removeItem: vi.fn() } as unknown as Storage;
    const registry = new TaskRegistry(storage);
    expect(registry.rehydrate()[0].status).toBe('running');
  });

  it('never deduplicates independent requests by title, shot or timestamp', () => {
    const registry = new TaskRegistry(null);
    registry.register(front);
    registry.register({ ...front, taskId: 'comfyui_2_124', metadata: { backendTaskId: 'backend-2' } });
    expect(registry.countActiveByPage()).toEqual({ generation: 2 });
  });

  it('preserves result URLs when a terminal notification without URLs arrives', () => {
    const registry = new TaskRegistry(null);
    registry.register(front);
    registry.complete(front.taskId, { resultUrls: ['/storage/original.webp'] });
    registry.complete('backend-1');
    expect(registry.get(front.taskId)?.resultUrls).toEqual(['/storage/original.webp']);
  });

  it('reconciles an earlier local wait failure with a confirmed backend completion', () => {
    const registry = new TaskRegistry(null);
    registry.register(front);
    registry.fail(front.taskId, '查询超时');
    registry.mergeFromServer([server('completed')]);
    expect(registry.get(front.taskId)?.status).toBe('completed');
  });
});
