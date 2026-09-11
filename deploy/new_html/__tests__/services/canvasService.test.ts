import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createCanvasBoard,
  createCanvasConnection,
  createCanvasNode,
  deleteCanvasBoard,
  deleteCanvasConnection,
  deleteCanvasNode,
  getCanvasBoardDetail,
  getCanvasBoards,
  updateCanvasBoard,
  updateCanvasNode,
} from '../../services/canvasService';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse(data: any) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => data,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.setItem('auth_token', 'test-token');
});

describe('canvas service', () => {
  it('creates, lists, updates, and deletes canvas boards', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true, board_id: 'board_1' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, boards: [] }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, board: { id: 'board_1' } }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await createCanvasBoard('proj_1', 'Board', 'Scene layout', 'ep_1');
    await getCanvasBoards('proj_1', 'ep_1');
    await getCanvasBoardDetail('board_1');
    await updateCanvasBoard('board_1', { name: 'Updated' });
    await deleteCanvasBoard('board_1');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/canvas/boards');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      project_id: 'proj_1',
      name: 'Board',
      description: 'Scene layout',
      episode_id: 'ep_1',
    });
    expect(mockFetch.mock.calls[1][0]).toBe('/api/canvas/boards?project_id=proj_1&episode_id=ep_1');
    expect(mockFetch.mock.calls[1][1].method).toBe('GET');
    expect(mockFetch.mock.calls[2][0]).toBe('/api/canvas/boards/board_1');
    expect(mockFetch.mock.calls[3][0]).toBe('/api/canvas/boards/board_1');
    expect(mockFetch.mock.calls[3][1].method).toBe('PUT');
    expect(JSON.parse(mockFetch.mock.calls[3][1].body)).toEqual({ name: 'Updated' });
    expect(mockFetch.mock.calls[4][0]).toBe('/api/canvas/boards/board_1');
    expect(mockFetch.mock.calls[4][1].method).toBe('DELETE');
  });

  it('creates, updates, and deletes canvas nodes', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true, node_id: 'node_1' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await createCanvasNode('board_1', 'shot', 120, 240, { title: 'Shot 1' });
    await updateCanvasNode('node_1', { x: 180, y: 260 });
    await deleteCanvasNode('node_1');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/canvas/nodes');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      board_id: 'board_1',
      node_type: 'shot',
      x: 120,
      y: 240,
      data: { title: 'Shot 1' },
    });
    expect(mockFetch.mock.calls[1][0]).toBe('/api/canvas/nodes/node_1');
    expect(mockFetch.mock.calls[1][1].method).toBe('PUT');
    expect(mockFetch.mock.calls[2][0]).toBe('/api/canvas/nodes/node_1');
    expect(mockFetch.mock.calls[2][1].method).toBe('DELETE');
  });

  it('creates and deletes canvas connections', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true, connection_id: 'conn_1' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await createCanvasConnection('board_1', 'source_1', 'target_1', 'out', 'in');
    await deleteCanvasConnection('conn_1');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/canvas/connections');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      board_id: 'board_1',
      source_node_id: 'source_1',
      target_node_id: 'target_1',
      source_port: 'out',
      target_port: 'in',
    });
    expect(mockFetch.mock.calls[1][0]).toBe('/api/canvas/connections/conn_1');
    expect(mockFetch.mock.calls[1][1].method).toBe('DELETE');
  });
});
