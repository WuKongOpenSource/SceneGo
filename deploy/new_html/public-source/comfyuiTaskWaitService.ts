import { invokePublicLocalRuntime } from './localRuntimeAdapter';
import type { SourcePage, TaskKind } from '../types';

export interface ComfyUITaskRegistryMeta {
  title: string;
  kind: TaskKind;
  targetPage?: SourcePage;
  targetEntityId?: string;
  targetEntityType?: string;
  targetProjectId?: string;
  episodeId?: string;
  fileRole?: string;
  targetItemId?: string;
  frontendKey?: string;
  taskType?: string;
  displayName?: string;
  [key: string]: unknown;
}

export interface GeneratedImageResult {
  url: string;
  fileId: string | null;
  file_id?: string;
  [key: string]: unknown;
}

export const getComfyUIQueueStatus = () => ({
  queueLength: 0,
  isProcessing: false,
  currentTask: null,
});

export function toQueueMeta(value: ComfyUITaskRegistryMeta): ComfyUITaskRegistryMeta {
  return value;
}

export function normalizeComfyUITaskError(
  _error: unknown,
  _context?: Pick<ComfyUITaskRegistryMeta, 'kind' | 'title'>,
): string {
  return '本地处理连接器不可用';
}

export const checkComfyUITaskStatus = (...args: unknown[]): Promise<any> => (
  invokePublicLocalRuntime('task.status', args)
);
export const waitForComfyUITask = (...args: unknown[]): Promise<any> => (
  invokePublicLocalRuntime('task.wait', args)
);
export const waitForComfyUITaskAllImages = (...args: unknown[]): Promise<any> => (
  invokePublicLocalRuntime('task.wait-all-images', args)
);
