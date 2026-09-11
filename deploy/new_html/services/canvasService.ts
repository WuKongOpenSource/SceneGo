import { apiJson } from './httpClient';

export interface CanvasBoardPayload {
  name?: string;
  description?: string;
}

export interface CanvasNodePayload {
  [key: string]: any;
}

export async function createCanvasBoard(
  projectId: string,
  name = '未命名画布',
  description = '',
  episodeId?: string,
) {
  return apiJson<any>('/api/canvas/boards', {
    method: 'POST',
    body: JSON.stringify({
      project_id: projectId,
      name,
      description,
      ...(episodeId ? { episode_id: episodeId } : {}),
    }),
  }, 'createCanvasBoard');
}

export async function getCanvasBoards(projectId: string, episodeId?: string) {
  const qs = new URLSearchParams({ project_id: projectId });
  if (episodeId) qs.set('episode_id', episodeId);
  return apiJson<any>(`/api/canvas/boards?${qs.toString()}`, { method: 'GET' }, 'getCanvasBoards');
}

export async function getCanvasBoardDetail(boardId: string) {
  return apiJson<any>(`/api/canvas/boards/${boardId}`, { method: 'GET' }, 'getCanvasBoardDetail');
}

export async function updateCanvasBoard(boardId: string, data: CanvasBoardPayload) {
  return apiJson<any>(`/api/canvas/boards/${boardId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateCanvasBoard');
}

export async function deleteCanvasBoard(boardId: string) {
  return apiJson<any>(`/api/canvas/boards/${boardId}`, { method: 'DELETE' }, 'deleteCanvasBoard');
}

export async function createCanvasNode(boardId: string, nodeType: string, x = 0, y = 0, data?: CanvasNodePayload) {
  return apiJson<any>('/api/canvas/nodes', {
    method: 'POST',
    body: JSON.stringify({ board_id: boardId, node_type: nodeType, x, y, data }),
  }, 'createCanvasNode');
}

export async function updateCanvasNode(nodeId: string, data: CanvasNodePayload) {
  return apiJson<any>(`/api/canvas/nodes/${nodeId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateCanvasNode');
}

export async function deleteCanvasNode(nodeId: string) {
  return apiJson<any>(`/api/canvas/nodes/${nodeId}`, { method: 'DELETE' }, 'deleteCanvasNode');
}

export async function createCanvasConnection(
  boardId: string,
  sourceNodeId: string,
  targetNodeId: string,
  sourcePort?: string | null,
  targetPort?: string | null,
  label?: string | null
) {
  const body: Record<string, any> = {
    board_id: boardId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
  };
  if (sourcePort) body.source_port = sourcePort;
  if (targetPort) body.target_port = targetPort;
  if (label) body.label = label;
  return apiJson<any>('/api/canvas/connections', {
    method: 'POST',
    body: JSON.stringify(body),
  }, 'createCanvasConnection');
}

export async function deleteCanvasConnection(connectionId: string) {
  return apiJson<any>(`/api/canvas/connections/${connectionId}`, { method: 'DELETE' }, 'deleteCanvasConnection');
}
