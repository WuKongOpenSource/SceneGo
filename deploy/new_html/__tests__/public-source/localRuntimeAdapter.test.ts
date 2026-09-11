import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasPublicLocalRuntimeAdapter,
  invokePublicLocalRuntime,
  registerPublicLocalRuntimeAdapter,
  resetPublicLocalRuntimeAdapterForTesting,
} from '../../public-source/localRuntimeAdapter';

describe('public local runtime adapter contract', () => {
  beforeEach(() => resetPublicLocalRuntimeAdapterForTesting());

  it('fails closed when the operator has not supplied an implementation', async () => {
    expect(hasPublicLocalRuntimeAdapter()).toBe(false);
    await expect(invokePublicLocalRuntime('media.upload', ['source.png'])).rejects.toThrow(
      '公开源码版不包含发行方开发的本地处理连接器',
    );
  });

  it('forwards only the abstract operation and arguments to the registered adapter', async () => {
    const invoke = vi.fn().mockResolvedValue({ task_id: 'operator-task' });
    const adapter = { id: 'operator-owned-adapter', invoke };
    registerPublicLocalRuntimeAdapter(adapter);

    await expect(invokePublicLocalRuntime('material.process', ['image.png', 'image_upscale']))
      .resolves.toEqual({ task_id: 'operator-task' });
    expect(invoke).toHaveBeenCalledWith({
      operation: 'material.process',
      args: ['image.png', 'image_upscale'],
    });
  });

  it('does not allow silent adapter replacement during runtime', () => {
    registerPublicLocalRuntimeAdapter({ id: 'first', invoke: vi.fn() });
    expect(() => registerPublicLocalRuntimeAdapter({ id: 'second', invoke: vi.fn() }))
      .toThrow('禁止在运行期间静默替换');
  });
});
