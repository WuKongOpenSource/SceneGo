import { TaskRegistry } from './taskRegistry';
import { getTaskStatus } from './taskQueryService';

/** Reconcile submitted browser aliases against the app task store, never resubmit. */
export async function recoverSubmittedRegistryTasks(
  registry: TaskRegistry,
  signal: AbortSignal,
  query = getTaskStatus,
): Promise<void> {
  const tasks = registry.list({ status: ['pending', 'queued', 'running'] })
    .filter(task => typeof task.metadata?.backendTaskId === 'string' && task.metadata.backendTaskId)
    .slice(0, 50);
  let nextIndex = 0;
  await Promise.all([0, 1].map(async () => {
    while (!signal.aborted && nextIndex < tasks.length) {
      const task = tasks[nextIndex++];
      const backendId = String(task.metadata!.backendTaskId);
      const controller = new AbortController();
      const stop = () => controller.abort();
      signal.addEventListener('abort', stop, { once: true });
      const timeout = setTimeout(stop, 10_000);
      try {
        const result = await query(backendId, controller.signal);
        if (signal.aborted || controller.signal.aborted || registry.get(task.taskId)?.createdAt !== task.createdAt) continue;
        const status = result.status === 'processing' ? 'running' : result.status;
        if (!['queued', 'pending', 'running', 'completed', 'failed', 'cancelled'].includes(status)) continue;
        const progress = typeof result.progress === 'number'
          ? Math.max(0, Math.min(1, result.progress > 1 ? result.progress / 100 : result.progress)) : undefined;
        registry.update(backendId, {
          status, progress: status === 'completed' ? 1 : progress,
          error: result.error || result.result?.error,
          metadata: { canCancel: result.can_cancel },
        });
      } catch (error) {
        if (!signal.aborted && error instanceof Error && error.message === 'TASK_NOT_FOUND') {
          registry.fail(backendId, '任务记录不存在或已不可访问，请在生成历史中核对；未自动重新提交。');
        }
        // A network outage does not mean that generation failed. Normal runtime
        // polling will continue reconciling active/terminal records.
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', stop);
      }
    }
  }));
}
