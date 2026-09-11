import { describe, expect, it, vi } from 'vitest';
import { SliceRequests } from '../../utils/sliceRequests';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('scoped slice requests', () => {
  it('shares concurrent reads and reuses successful loads', async () => {
    const cache = new SliceRequests();
    const gate = deferred();
    const loader = vi.fn(() => gate.promise);
    const calls = Array.from({ length: 30 }, () => cache.load('ep:audio', loader));
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    gate.resolve();
    await Promise.all(calls);
    await cache.load('ep:audio', loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('coalesces mutation refreshes after an older request, never caching stale mutation data', async () => {
    const cache = new SliceRequests();
    const gate = deferred();
    const first = cache.load('ep:audio', () => gate.promise);
    const refresh = vi.fn(async () => {});
    const requests = Array.from({ length: 10 }, () => cache.load('ep:audio', refresh, true));
    expect(refresh).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([first, ...requests]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('retries failures and isolates episodes and script scopes', async () => {
    const cache = new SliceRequests();
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    await expect(cache.load('ep1:s1', load)).rejects.toThrow('offline');
    await cache.load('ep1:s1', load);
    await cache.load('ep1:s2', load);
    await cache.load('ep2:s1', load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('does not cache or revalidate requests from a cleared scope', async () => {
    const cache = new SliceRequests();
    const gate = deferred();
    const old = cache.load('ep', () => gate.promise);
    const refresh = vi.fn(async () => {});
    const queued = cache.load('ep', refresh, true);
    cache.clear();
    gate.resolve();
    await Promise.all([old, queued]);
    expect(refresh).not.toHaveBeenCalled();
    await cache.load('ep', refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
