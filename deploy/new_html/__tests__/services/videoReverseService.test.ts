import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listVideoReverseTasks } from '../../services/videoReverseService';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.setItem('auth_token', 'test-token');
});
describe('video reverse service', () => {
  it('filters task history by project and episode', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, tasks: [] }),
    });

    await listVideoReverseTasks({ project_id: 'proj_1', episode_id: 'ep_1', limit: 50 });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/video-reverse/tasks?project_id=proj_1&episode_id=ep_1&limit=50');
    expect(options.method).toBe('GET');
  });
});
