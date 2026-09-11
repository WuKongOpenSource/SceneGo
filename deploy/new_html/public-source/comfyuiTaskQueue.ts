import { invokePublicLocalRuntime } from './localRuntimeAdapter';

export interface ComfyQueueRegistryMeta {
  taskType?: string;
  displayName?: string;
  [key: string]: unknown;
}

export interface QueueEvent {
  type: string;
  queueLength: number;
  isProcessing: boolean;
}

const status = { queueLength: 0, isProcessing: false, currentTask: null };

export const comfyuiTaskQueue = {
  enqueue: (...args: unknown[]) => invokePublicLocalRuntime('task.enqueue', args),
  getStatus: () => status,
  addEventListener: () => () => undefined,
  _resetForTesting: () => undefined,
};

export const enqueueComfyUITask = (...args: unknown[]): Promise<any> => (
  invokePublicLocalRuntime('task.enqueue', args)
);
export const getComfyUIQueueStatus = () => status;
export const onComfyUIQueueEvent = () => () => undefined;
