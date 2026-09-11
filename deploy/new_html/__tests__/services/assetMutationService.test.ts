import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectSessionTransport } from '../../test/sessionTransport';
import {
  createAsset,
  updateAsset,
  deleteAsset,
  shareAsset,
  listSyncExistingAssetDesignCandidates,
  syncExistingAssetDesigns,
} from '../../services/assetMutationService';

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

describe('asset mutation service', () => {
  it('creates assets through the shared asset endpoint', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, asset: { asset_id: 'a1' } }));

    await createAsset({ project_id: 'p1', asset_type: 'character', name: 'hero' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/assets');
    expect(opts.method).toBe('POST');
    expectSessionTransport(opts);
    expect(JSON.parse(opts.body).name).toBe('hero');
  });

  it('updates assets by asset id', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await updateAsset('asset_abc', { description: 'updated' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/assets/asset_abc');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body).description).toBe('updated');
  });

  it('deletes assets by asset id', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await deleteAsset('asset_abc');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/assets/asset_abc');
    expect(opts.method).toBe('DELETE');
  });

  it('shares assets to target episode and script', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await shareAsset('asset_abc', 'ep_2', 'script_3');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/assets/asset_abc/share');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      target_episode_id: 'ep_2',
      target_script_id: 'script_3',
    });
  });

  it('syncs existing designs by project and episode', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, synced: 1 }));

    await syncExistingAssetDesigns('proj_1', {
      episode_id: 'ep_2',
      script_id: 'script_2',
      asset_types: ['character', 'scene', 'prop'],
      source_asset_ids: ['asset_1'],
      overwrite: true,
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/projects/proj_1/assets/sync-existing-designs');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      episode_id: 'ep_2',
      script_id: 'script_2',
      asset_types: ['character', 'scene', 'prop'],
      source_asset_ids: ['asset_1'],
      overwrite: true,
    });
  });

  it('lists sync candidates from other episodes', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, candidates: [] }));

    await listSyncExistingAssetDesignCandidates('proj_1', {
      episode_id: 'ep_2',
      script_id: 'script_2',
      asset_types: ['character', 'scene'],
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/projects/proj_1/assets/sync-existing-designs/candidates?episode_id=ep_2&script_id=script_2&asset_types=character%2Cscene');
    expect(opts.method).toBe('GET');
  });
});
