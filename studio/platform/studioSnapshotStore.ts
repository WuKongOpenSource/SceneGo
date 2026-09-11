import { createCanvasBoard, createCanvasNode, getCanvasBoardDetail, getCanvasBoards, updateCanvasNode } from '@app/services/canvasService';
import type { StudioSnapshot } from '../services/runtime';

const BOARD_NAME = '创剧自由创作';
const STATE_NODE_TYPE = 'studio_state';
const SCHEMA_VERSION = 1;
type JsonRecord = Record<string, any>;
const isRecord = (value: unknown): value is JsonRecord => !!value && typeof value === 'object' && !Array.isArray(value);
const boardIdOf = (board: JsonRecord) => board.board_id || board.boardId || '';
const nodeIdOf = (node: JsonRecord) => node.node_id || node.nodeId || node.id || '';
const nodeTypeOf = (node: JsonRecord) => node.node_type || node.nodeType || node.type || '';

export function stripEmbeddedMedia<T>(value: T): T {
  if (typeof value === 'string') return (value.startsWith('data:') ? '' : value) as T;
  if (Array.isArray(value)) return value.map(stripEmbeddedMedia) as T;
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripEmbeddedMedia(item)])) as T;
  return value;
}

export function parseStudioSnapshot(value: unknown): StudioSnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION) return null;
  if (!['assets', 'workflows', 'nodes', 'connections', 'groups'].every(key => Array.isArray(value[key]) && value[key].every(isRecord))) return null;
  return value as StudioSnapshot;
}

function checkedNodes(detail: unknown): JsonRecord[] {
  if (!isRecord(detail) || detail.success === false || !Array.isArray(detail.nodes) || !detail.nodes.every(isRecord)) {
    throw new Error('画布读取不完整，请重试；原有内容未更改');
  }
  return detail.nodes;
}

function readState(node: JsonRecord): StudioSnapshot | null {
  let data = node.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { throw new Error('画布快照无法解析，已停止保存以保护原有内容'); }
  }
  if (!isRecord(data) || !Object.hasOwn(data, 'snapshot') || (data.studio_schema_version !== undefined && data.studio_schema_version !== SCHEMA_VERSION)) {
    throw new Error('画布快照版本或结构不受支持，已停止保存');
  }
  // Only an explicit null represents an initialized but unused workspace.
  // Missing, corrupt or newer data must never be replaced with default nodes.
  if (data.snapshot === null) return null;
  const snapshot = parseStudioSnapshot(data.snapshot);
  if (!snapshot) throw new Error('画布快照版本或结构不受支持，已停止保存');
  return snapshot;
}

/** One instance owns one episode; writes are permitted only after a validated read. */
export function createStudioSnapshotStore(projectId: string, episodeId: string) {
  let boardId = '';
  let stateNodeId = '';
  let loaded = false;
  let revision = 0;
  let loadPromise: Promise<StudioSnapshot | null> | null = null;
  let saveTail: Promise<void> = Promise.resolve();

  async function locateState(): Promise<void> {
    if (boardId && stateNodeId) return;
    const listed = await getCanvasBoards(projectId, episodeId);
    if (!isRecord(listed) || listed.success === false || !Array.isArray(listed.boards) || !listed.boards.every(isRecord)) {
      throw new Error('画布列表读取不完整，请重试');
    }
    const boards: JsonRecord[] = listed.boards;
    const board = boards.find(item => (item.episode_id || item.episodeId) === episodeId && item.name === BOARD_NAME)
      || boards.find(item => (item.episode_id || item.episodeId) === episodeId);
    if (board) boardId = boardIdOf(board);
    else {
      const created = await createCanvasBoard(projectId, BOARD_NAME, '按分集隔离的自由创作工作区', episodeId);
      if (created?.success !== true) throw new Error('自由创作画布创建失败');
      boardId = boardIdOf(created?.board || {});
    }
    if (!boardId) throw new Error('自由创作画布创建失败');
    const nodes = checkedNodes(await getCanvasBoardDetail(boardId));
    const states = nodes.filter(node => nodeTypeOf(node) === STATE_NODE_TYPE);
    if (states.length > 1) throw new Error('画布存在多个状态记录，已停止保存，请联系管理员检查');
    if (states.length) stateNodeId = nodeIdOf(states[0]);
    else {
      const created = await createCanvasNode(boardId, STATE_NODE_TYPE, 0, 0, { studio_schema_version: SCHEMA_VERSION, snapshot: null });
      if (created?.success !== true) throw new Error('自由创作状态节点创建失败');
      stateNodeId = nodeIdOf(created?.node || {});
    }
    if (!stateNodeId) throw new Error('自由创作状态节点创建失败');
  }

  function loadSnapshot(): Promise<StudioSnapshot | null> {
    if (loadPromise) return loadPromise;
    loaded = false;
    revision += 1;
    loadPromise = (async () => {
      // A reload must not race queued writes or re-enable a stale pending save.
      await saveTail.catch(() => undefined);
      await locateState();
      const nodes = checkedNodes(await getCanvasBoardDetail(boardId));
      const states = nodes.filter(node => nodeTypeOf(node) === STATE_NODE_TYPE);
      const node = states.find(item => nodeIdOf(item) === stateNodeId);
      if (!node || states.length !== 1) throw new Error('画布状态记录发生变化，已停止保存，请重试');
      const snapshot = readState(node);
      loaded = true;
      return snapshot;
    })().catch(error => {
      boardId = '';
      stateNodeId = '';
      throw error;
    }).finally(() => { loadPromise = null; });
    return loadPromise;
  }

  async function saveSnapshot(snapshot: StudioSnapshot): Promise<void> {
    if (!loaded) throw new Error('画布尚未成功加载，禁止保存');
    if (!parseStudioSnapshot(snapshot)) throw new Error('画布快照结构无效，禁止保存');
    const expectedRevision = revision;
    const serialized = stripEmbeddedMedia(snapshot);
    const next = saveTail.catch(() => undefined).then(async () => {
      if (!loaded || expectedRevision !== revision) throw new Error('画布正在重新加载，请稍后重试保存');
      const result = await updateCanvasNode(stateNodeId, { data: { studio_schema_version: SCHEMA_VERSION, snapshot: serialized } });
      if (result?.success !== true) throw new Error('画布保存失败，请重试');
    });
    saveTail = next;
    return next;
  }

  return { loadSnapshot, saveSnapshot };
}
