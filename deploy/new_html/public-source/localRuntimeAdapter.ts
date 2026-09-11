import { localConnectorUnavailable } from './runtimeUnavailable';

/**
 * Public extension contract for an operator-owned local processing adapter.
 *
 * This file intentionally contains no transport, endpoint, workflow, node,
 * queue, model, credential, or scheduling implementation.  An operator who
 * wants local processing must implement and security-review the adapter in
 * their own source tree, then register it before the React application starts.
 */
export type PublicLocalRuntimeOperation =
  | 'media.upload'
  | 'material.process'
  | 'image.adjust-angle'
  | 'image.human-multi-angle'
  | 'image.around-angle'
  | 'image.generate'
  | 'image.workflow.generate'
  | 'image.material.process'
  | 'image.workflow.generate-and-wait'
  | 'image.human-multi-angle-and-wait'
  | 'image.around-angle-and-wait'
  | 'image.adjust-angle-and-wait'
  | 'image.matting'
  | 'image.matting-and-wait'
  | 'image.fusion'
  | 'image.fusion-and-wait'
  | 'image.panorama-360'
  | 'image.panorama-360-and-wait'
  | 'image.panorama-fusion'
  | 'image.panorama-fusion-and-wait'
  | 'image.storyboard.auto'
  | 'image.storyboard.auto-and-wait'
  | 'image.storyboard.multi-grid'
  | 'task.enqueue'
  | 'task.status'
  | 'task.wait'
  | 'task.wait-all-images'
  | 'runtime.nodes.list'
  | 'runtime.route.resolve';

export interface PublicLocalRuntimeInvocation {
  operation: PublicLocalRuntimeOperation;
  /** Positional arguments supplied by the existing public UI call site. */
  args: readonly unknown[];
}

export interface PublicLocalRuntimeAdapter {
  /** Human-readable identifier chosen by the operator; never a secret. */
  readonly id: string;
  invoke(request: PublicLocalRuntimeInvocation): Promise<unknown>;
}

let registeredAdapter: PublicLocalRuntimeAdapter | undefined;

export function registerPublicLocalRuntimeAdapter(adapter: PublicLocalRuntimeAdapter): void {
  if (!adapter || typeof adapter.invoke !== 'function' || !String(adapter.id || '').trim()) {
    throw new TypeError('本地处理适配器必须提供非空 id 和 invoke 方法。');
  }
  if (registeredAdapter && registeredAdapter !== adapter) {
    throw new Error('本地处理适配器已经注册，禁止在运行期间静默替换。');
  }
  registeredAdapter = adapter;
}

export function hasPublicLocalRuntimeAdapter(): boolean {
  return Boolean(registeredAdapter);
}

export async function invokePublicLocalRuntime<TResult = unknown>(
  operation: PublicLocalRuntimeOperation,
  args: readonly unknown[],
): Promise<TResult> {
  if (!registeredAdapter) return localConnectorUnavailable();
  return registeredAdapter.invoke({ operation, args }) as Promise<TResult>;
}

/** Test-only reset; production bootstrap code must register at most once. */
export function resetPublicLocalRuntimeAdapterForTesting(): void {
  registeredAdapter = undefined;
}
