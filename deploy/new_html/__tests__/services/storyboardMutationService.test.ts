import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectSessionTransport } from '../../test/sessionTransport';
import {
  createStoryboardItem,
  deleteAllStoryboardItems,
  deleteStoryboardItem,
  exportScript,
  reorderStoryboardItems,
} from '../../services/storyboardMutationService';

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

describe('storyboard mutation service', () => {
  it('creates storyboard items through the episode endpoint', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, item_id: 'sb_1' }));

    await createStoryboardItem('ep_1', { dialogue: 'hello' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items');
    expect(opts.method).toBe('POST');
    expectSessionTransport(opts);
    expect(JSON.parse(opts.body).dialogue).toBe('hello');
  });

  it('deletes a single storyboard item', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await deleteStoryboardItem('sb_1');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/storyboard-items/sb_1');
    expect(opts.method).toBe('DELETE');
  });

  it('deletes all storyboard items for a script scope', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await deleteAllStoryboardItems('ep_1', 'script_1');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items/all?script_id=script_1');
    expect(opts.method).toBe('DELETE');
  });

  it('reorders storyboard items', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await reorderStoryboardItems('ep_1', ['sb_2', 'sb_1']);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items/reorder');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).item_ids).toEqual(['sb_2', 'sb_1']);
  });

  it('exports script and storyboard payloads', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, file_id: 'file_1' }));

    await exportScript('ep_1', {
      project_id: 'proj_1',
      original_content: 'original',
      script_content: 'script',
      storyboard_items: [{ item_id: 'sb_1' }],
      characters: [{ name: 'hero', description: 'lead' }],
      scenes: [{ name: 'room', description: 'interior' }],
      script_id: 'script_1',
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/export-script');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).script_id).toBe('script_1');
  });
});
