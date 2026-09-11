import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectSessionTransport } from '../../test/sessionTransport';
import {
  getAssets,
  getAudioTracks,
  getEpisodeScript,
  getStoryboardItems,
  getVideoSegments,
  updateStoryboardItem,
} from '../../services/episodeDataService';

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

describe('getAssets', () => {
  it('calls correct URL with project and episode filter', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, assets: [] }));
    await getAssets('proj_1', 'ep_1');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/projects/proj_1/assets');
    expect(url).toContain('episode_id=ep_1');
    expectSessionTransport(opts);
  });

  it('supports script scoped asset queries', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, assets: [] }));
    await getAssets('proj_1', 'ep_1', undefined, 'script_1');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/projects/proj_1/assets?episode_id=ep_1&script_id=script_1');
  });

  it('works without optional params', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, assets: [] }));
    await getAssets('proj_1');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/projects/proj_1/assets');
  });
});

describe('getStoryboardItems', () => {
  it('calls correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, items: [] }));
    await getStoryboardItems('ep_1');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items');
  });

  it('supports script filter and pagination query', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, items: [], total: 58 }));
    await getStoryboardItems('ep_1', 'script_1', { limit: 10, offset: 20, includeTotal: true });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items?script_id=script_1&limit=10&offset=20&include_total=true');
  });

  it('keeps an empty selected script isolated by default', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, items: [], total: 0 }));
    const result = await getStoryboardItems('ep_1', 'script_empty', { limit: 10, includeTotal: true });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(0);
  });

  it('falls back to episode storyboard only when explicitly requested', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true, items: [], total: 0 }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, items: [{ item_id: 'sb_1' }], total: 1 }));
    const result = await getStoryboardItems('ep_1', 'stale_script', {
      limit: 10,
      includeTotal: true,
      fallbackToEpisode: true,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/episodes/ep_1/storyboard-items?script_id=stale_script&limit=10&include_total=true');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/episodes/ep_1/storyboard-items?limit=10&include_total=true');
    expect(result.items).toHaveLength(1);
    expect(result.fallbackScriptId).toBe('stale_script');
  });

  it('normalizes backend storyboard fallback metadata', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      success: true,
      items: [{ item_id: 'sb_1' }],
      total: 23,
      fallback_script_id: 'stale_script',
      fallback_reason: 'stale_script_storyboard',
    }));
    const result = await getStoryboardItems('ep_1', 'stale_script', { limit: 10, includeTotal: true });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(1);
    expect(result.fallbackScriptId).toBe('stale_script');
    expect(result.fallbackReason).toBe('stale_script_storyboard');
  });

  it('supports lightweight field sets', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, items: [] }));
    await getStoryboardItems('ep_1', undefined, { fields: 'audio' });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items?fields=audio');
  });

  it('supports video-generation field sets', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, items: [] }));
    await getStoryboardItems('ep_1', undefined, { fields: 'video' });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items?fields=video');
  });

  it('supports audio-stage field sets', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, items: [] }));
    await getStoryboardItems('ep_1', undefined, { fields: 'audio_stage' });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items?fields=audio_stage');
  });

  it('supports material-binding field sets', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, items: [] }));
    await getStoryboardItems('ep_1', undefined, { fields: 'materials' });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/storyboard-items?fields=materials');
  });
});

describe('updateStoryboardItem', () => {
  it('sends PUT with data', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));
    await updateStoryboardItem('sb_1', { audio_duration_ms: 3200 });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/storyboard-items/sb_1');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body).audio_duration_ms).toBe(3200);
  });
});

describe('getAudioTracks', () => {
  it('calls correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, tracks: [] }));
    await getAudioTracks('ep_1');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/audio-tracks');
  });
});

describe('getEpisodeScript', () => {
  it('calls correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, script: {} }));
    await getEpisodeScript('ep_1');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/script');
  });
});

describe('getVideoSegments', () => {
  it('calls correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, segments: [] }));
    await getVideoSegments('ep_1');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/video-segments');
  });
});
