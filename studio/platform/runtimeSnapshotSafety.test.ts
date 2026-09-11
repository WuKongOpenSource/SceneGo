import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as canvas from '@app/services/canvasService';
import { createOstoryRuntime } from './ostoryRuntime';
import type { StudioSnapshot } from '../services/runtime';

vi.mock('@app/services/canvasService', () => ({
  createCanvasBoard: vi.fn(), createCanvasNode: vi.fn(), getCanvasBoards: vi.fn(),
  getCanvasBoardDetail: vi.fn(), updateCanvasNode: vi.fn(),
}));

const snapshot: StudioSnapshot = { schemaVersion: 1, assets: [], workflows: [], nodes: [], connections: [], groups: [] };
const board = { board_id: 'board-1', episode_id: 'episode-1', name: '创剧自由创作' };
const detail = (value: unknown = snapshot) => ({ board, nodes: [{ node_id: 'state-1', node_type: 'studio_state', data: { studio_schema_version: 1, snapshot: value } }] });
const runtime = () => createOstoryRuntime({ projectId: 'project-1', episodeId: 'episode-1', returnTo: '/projects' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(canvas.getCanvasBoards).mockResolvedValue({ boards: [board] });
  vi.mocked(canvas.getCanvasBoardDetail).mockResolvedValue(detail());
  vi.mocked(canvas.updateCanvasNode).mockResolvedValue({ success: true });
});

describe('Studio persistence safety', () => {
  it('does not save before loading the current workspace', async () => {
    await expect(runtime().saveSnapshot(snapshot)).rejects.toThrow();
    expect(canvas.updateCanvasNode).not.toHaveBeenCalled();
    expect(canvas.createCanvasBoard).not.toHaveBeenCalled();
    expect(canvas.createCanvasNode).not.toHaveBeenCalled();
  });

  it('does not replace a newer schema with a new canvas', async () => {
    vi.mocked(canvas.getCanvasBoardDetail).mockResolvedValue(detail({ ...snapshot, schemaVersion: 2 }));
    const instance = runtime();
    await expect(instance.loadSnapshot()).rejects.toThrow();
    await expect(instance.saveSnapshot(snapshot)).rejects.toThrow();
    expect(canvas.updateCanvasNode).not.toHaveBeenCalled();
  });

  it('does not turn a malformed state payload into an empty workspace', async () => {
    vi.mocked(canvas.getCanvasBoardDetail).mockResolvedValue({ board, nodes: [{ node_id: 'state-1', node_type: 'studio_state', data: '{broken' }] });
    const instance = runtime();
    await expect(instance.loadSnapshot()).rejects.toThrow();
    await expect(instance.saveSnapshot(snapshot)).rejects.toThrow();
    expect(canvas.updateCanvasNode).not.toHaveBeenCalled();
  });

  it('keeps writes disabled after a failed read', async () => {
    const instance = runtime();
    vi.mocked(canvas.getCanvasBoardDetail).mockRejectedValueOnce(new Error('offline'));
    await expect(instance.loadSnapshot()).rejects.toThrow('offline');
    await expect(instance.saveSnapshot(snapshot)).rejects.toThrow();
    expect(canvas.updateCanvasNode).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, { success: false, boards: [] }, { boards: [null] }])('never creates a workspace from an invalid board list: %j', async listed => {
    vi.mocked(canvas.getCanvasBoards).mockResolvedValue(listed);
    await expect(runtime().loadSnapshot()).rejects.toThrow();
    expect(canvas.createCanvasBoard).not.toHaveBeenCalled();
    expect(canvas.createCanvasNode).not.toHaveBeenCalled();
  });

  it.each([{}, { success: false, nodes: [] }, { nodes: [null] }, { nodes: 'invalid' }])('never creates state after an incomplete board read: %j', async value => {
    vi.mocked(canvas.getCanvasBoardDetail).mockResolvedValue(value);
    await expect(runtime().loadSnapshot()).rejects.toThrow();
    expect(canvas.createCanvasNode).not.toHaveBeenCalled();
  });

  it.each([{}, null, { snapshot: undefined }, { snapshot, studio_schema_version: 2 }, { snapshot: { ...snapshot, nodes: [null] } }])('fails closed on malformed state data: %j', async data => {
    const response = detail();
    response.nodes[0].data = data as any;
    vi.mocked(canvas.getCanvasBoardDetail).mockResolvedValue(response);
    const instance = runtime();
    await expect(instance.loadSnapshot()).rejects.toThrow();
    await expect(instance.saveSnapshot(snapshot)).rejects.toThrow();
    expect(canvas.updateCanvasNode).not.toHaveBeenCalled();
  });

  it.each([snapshot, null])('loads valid existing or explicitly empty workspaces without creating state', async value => {
    vi.mocked(canvas.getCanvasBoardDetail).mockResolvedValue(detail(value));
    const instance = runtime();
    await expect(instance.loadSnapshot()).resolves.toEqual(value);
    await instance.saveSnapshot(snapshot);
    expect(canvas.updateCanvasNode).toHaveBeenCalledWith('state-1', { data: { studio_schema_version: 1, snapshot } });
    expect(canvas.createCanvasBoard).not.toHaveBeenCalled();
    expect(canvas.createCanvasNode).not.toHaveBeenCalled();
  });

  it('preserves legacy camel-case identifiers and JSON state payloads', async () => {
    vi.mocked(canvas.getCanvasBoards).mockResolvedValue({ boards: [{ boardId: 'legacy-board', episodeId: 'episode-1' }] });
    vi.mocked(canvas.getCanvasBoardDetail).mockResolvedValue({ nodes: [{ id: 'legacy-node', type: 'studio_state', data: JSON.stringify({ snapshot }) }] });
    const instance = runtime();
    await expect(instance.loadSnapshot()).resolves.toEqual(snapshot);
    await instance.saveSnapshot(snapshot);
    expect(canvas.updateCanvasNode).toHaveBeenCalledWith('legacy-node', expect.anything());
  });

  it('creates state only after confirmed empty list and board reads, coalescing concurrent loads', async () => {
    vi.mocked(canvas.getCanvasBoards).mockResolvedValue({ success: true, boards: [] });
    vi.mocked(canvas.createCanvasBoard).mockResolvedValue({ success: true, board });
    vi.mocked(canvas.getCanvasBoardDetail).mockResolvedValueOnce({ nodes: [] }).mockResolvedValue(detail(null));
    vi.mocked(canvas.createCanvasNode).mockResolvedValue({ success: true, node: { node_id: 'state-1' } });
    const instance = runtime();
    await expect(Promise.all([instance.loadSnapshot(), instance.loadSnapshot()])).resolves.toEqual([null, null]);
    expect(canvas.createCanvasBoard).toHaveBeenCalledOnce();
    expect(canvas.createCanvasNode).toHaveBeenCalledExactlyOnceWith('board-1', 'studio_state', 0, 0, { studio_schema_version: 1, snapshot: null });
  });

  it('rejects duplicate or disappeared state records instead of choosing a writable default', async () => {
    const duplicate = detail();
    duplicate.nodes.push({ ...duplicate.nodes[0], node_id: 'state-2' });
    vi.mocked(canvas.getCanvasBoardDetail).mockResolvedValueOnce(duplicate);
    const instance = runtime();
    await expect(instance.loadSnapshot()).rejects.toThrow();
    vi.mocked(canvas.getCanvasBoardDetail).mockResolvedValueOnce(detail()).mockResolvedValueOnce({ nodes: [] });
    await expect(instance.loadSnapshot()).rejects.toThrow();
    expect(canvas.createCanvasNode).not.toHaveBeenCalled();
    await expect(instance.saveSnapshot(snapshot)).rejects.toThrow();
  });

  it('rediscovers identities after a failed load and recovers without creating another board', async () => {
    vi.mocked(canvas.getCanvasBoardDetail).mockRejectedValueOnce(new Error('offline'));
    const instance = runtime();
    await expect(instance.loadSnapshot()).rejects.toThrow();
    await expect(instance.loadSnapshot()).resolves.toEqual(snapshot);
    await instance.saveSnapshot(snapshot);
    expect(canvas.getCanvasBoards).toHaveBeenCalledTimes(2);
    expect(canvas.createCanvasBoard).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, { success: false }])('requires an explicit save acknowledgement and permits retry: %j', async result => {
    const instance = runtime();
    await instance.loadSnapshot();
    vi.mocked(canvas.updateCanvasNode).mockResolvedValueOnce(result);
    await expect(instance.saveSnapshot(snapshot)).rejects.toThrow();
    await expect(instance.saveSnapshot(snapshot)).resolves.toBeUndefined();
    expect(canvas.updateCanvasNode).toHaveBeenCalledTimes(2);
  });

  it('serializes saves and captures each enqueue value without altering original URLs', async () => {
    const first = deferred<any>();
    const instance = runtime();
    await instance.loadSnapshot();
    vi.mocked(canvas.updateCanvasNode).mockReturnValueOnce(first.promise);
    const original = { ...snapshot, assets: [{ url: '/storage/original.png', title: 'first' }] };
    const one = instance.saveSnapshot(original);
    const two = instance.saveSnapshot({ ...snapshot, assets: [{ url: '/storage/second.png' }] });
    original.assets[0].title = 'changed after enqueue';
    await vi.waitFor(() => expect(canvas.updateCanvasNode).toHaveBeenCalledOnce());
    expect(vi.mocked(canvas.updateCanvasNode).mock.calls[0][1].data.snapshot.assets).toEqual([{ url: '/storage/original.png', title: 'first' }]);
    first.resolve({ success: true });
    await Promise.all([one, two]);
    expect(vi.mocked(canvas.updateCanvasNode).mock.calls[1][1].data.snapshot.assets).toEqual([{ url: '/storage/second.png' }]);
  });

  it('waits for in-flight writes on reload and invalidates queued stale writes', async () => {
    const pending = deferred<any>();
    const instance = runtime();
    await instance.loadSnapshot();
    vi.mocked(canvas.updateCanvasNode).mockReturnValueOnce(pending.promise);
    const first = instance.saveSnapshot(snapshot);
    await vi.waitFor(() => expect(canvas.updateCanvasNode).toHaveBeenCalledOnce());
    const stale = instance.saveSnapshot(snapshot);
    const staleCheck = expect(stale).rejects.toThrow('重新加载');
    const readsBefore = vi.mocked(canvas.getCanvasBoardDetail).mock.calls.length;
    const reload = instance.loadSnapshot();
    await expect(instance.saveSnapshot(snapshot)).rejects.toThrow();
    expect(canvas.getCanvasBoardDetail).toHaveBeenCalledTimes(readsBefore);
    pending.resolve({ success: true });
    await first;
    await staleCheck;
    await expect(reload).resolves.toEqual(snapshot);
    expect(canvas.updateCanvasNode).toHaveBeenCalledOnce();
    await instance.saveSnapshot(snapshot);
    expect(canvas.updateCanvasNode).toHaveBeenCalledTimes(2);
  });
});
