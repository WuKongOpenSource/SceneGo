import { describe, expect, it } from 'vitest';
import { TaskRegistry } from '../../services/taskRegistry';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function registerCompletedTask(registry: TaskRegistry, taskId: string) {
  registry.register({
    taskId,
    kind: 'script-segment',
    title: taskId,
    targetPage: 'script',
  });
  registry.complete(taskId);
}

describe('TaskRegistry user scope', () => {
  it('does not rehydrate another account task cache', () => {
    const storage = new MemoryStorage();
    const yuanRegistry = new TaskRegistry(storage);
    yuanRegistry.setUserScope('Yuan');
    registerCompletedTask(yuanRegistry, 'yuan-task');

    const wuqiRegistry = new TaskRegistry(storage);
    wuqiRegistry.setUserScope('user_alpha');
    expect(wuqiRegistry.rehydrate()).toEqual([]);

    const restoredYuanRegistry = new TaskRegistry(storage);
    restoredYuanRegistry.setUserScope('Yuan');
    expect(restoredYuanRegistry.rehydrate().map(task => task.taskId)).toEqual(['yuan-task']);
  });

  it('ignores and removes the legacy cache without an account namespace', () => {
    const storage = new MemoryStorage();
    storage.setItem('ostory:task-registry:v1', JSON.stringify({
      active: [],
      done: [{ taskId: 'legacy-other-user-task' }],
    }));

    const registry = new TaskRegistry(storage);
    registry.setUserScope('user_alpha');

    expect(registry.rehydrate()).toEqual([]);
    expect(storage.getItem('ostory:task-registry:v1')).toBeNull();
  });

  it('lets an authoritative server terminal state close a locally running task', () => {
    const registry = new TaskRegistry(new MemoryStorage());
    registry.setUserScope('yuan');
    registry.register({
      taskId: 'deepseek_text_1',
      kind: 'script-segment',
      title: '剧本修改',
      targetPage: 'script',
      initialStatus: 'running',
      targetProjectId: 'project_1',
    });
    let completedCallbacks = 0;
    registry.onComplete('deepseek_text_1', () => {
      completedCallbacks += 1;
    });

    const stats = registry.mergeFromServer([{
      taskId: 'deepseek_text_1',
      notificationId: 'notification_1',
      kind: 'script-segment',
      title: '剧本修改',
      status: 'completed',
      progress: 1,
      createdAt: Date.now() - 40_000,
      startedAt: Date.now() - 39_000,
      completedAt: Date.now(),
      targetPage: 'script',
    }]);

    expect(stats).toEqual({ added: 0, skipped: 0, updated: 1 });
    expect(registry.get('deepseek_text_1')).toMatchObject({
      status: 'completed',
      progress: 1,
      notificationId: 'notification_1',
      targetProjectId: 'project_1',
    });
    expect(completedCallbacks).toBe(1);
  });
});
