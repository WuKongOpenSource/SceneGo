import { describe, expect, it } from 'vitest';
import { filterAssetsForDesignScope, filterAssetsForEpisodeScope, isSharedAsset } from '../../utils/assetScope';
import type { AssetItem } from '../../types';

function asset(overrides: Partial<AssetItem>): AssetItem {
  return {
    assetId: overrides.assetId || 'asset_1',
    projectId: 'proj_1',
    episodeId: Object.prototype.hasOwnProperty.call(overrides, 'episodeId') ? (overrides.episodeId ?? null) : 'ep_1',
    scriptId: Object.prototype.hasOwnProperty.call(overrides, 'scriptId') ? overrides.scriptId : 'script_1',
    assetType: overrides.assetType || 'character',
    name: overrides.name || 'asset',
    description: '',
    thumbnailUrl: null,
    referenceImages: [],
    styleParams: {},
    tags: [],
    createdBy: 'user_1',
    createdAt: '2026-07-11T00:00:00Z',
  };
}

describe('asset scope helpers', () => {
  it('keeps shared assets in normal material episode scope', () => {
    const shared = asset({ assetId: 'shared', episodeId: null });
    expect(isSharedAsset(shared)).toBe(true);
    expect(filterAssetsForEpisodeScope([shared], 'ep_1', 'episode')).toEqual([shared]);
  });

  it('keeps all assets in project material scope', () => {
    const shared = asset({ assetId: 'shared', episodeId: null });
    const current = asset({ assetId: 'current', episodeId: 'ep_1' });
    const otherEpisode = asset({ assetId: 'other_episode', episodeId: 'ep_2' });
    expect(filterAssetsForEpisodeScope([shared, current, otherEpisode], 'ep_1', 'project').map(item => item.assetId))
      .toEqual(['shared', 'current', 'other_episode']);
  });

  it('recognizes snake_case shared assets', () => {
    expect(isSharedAsset({ asset_id: 'shared', episode_id: null })).toBe(true);
  });

  it('keeps all accumulated design assets in the current episode chain', () => {
    const current = asset({ assetId: 'current', episodeId: 'ep_1', scriptId: 'script_1' });
    const shared = asset({ assetId: 'shared', episodeId: null, scriptId: null });
    const oldEpisode = asset({ assetId: 'old_episode', episodeId: 'ep_deleted', scriptId: 'script_1' });
    const otherScript = asset({ assetId: 'other_script', episodeId: 'ep_1', scriptId: 'script_old' });
    const legacyNullScript = asset({ assetId: 'legacy_null_script', episodeId: 'ep_1', scriptId: null });

    expect(filterAssetsForDesignScope(
      [current, shared, oldEpisode, otherScript, legacyNullScript],
      'ep_1',
      'script_1',
    ).map(item => item.assetId)).toEqual(['current', 'other_script', 'legacy_null_script']);
  });

  it('uses current episode only when no script is selected', () => {
    const current = asset({ assetId: 'current', episodeId: 'ep_1', scriptId: null });
    const shared = asset({ assetId: 'shared', episodeId: null, scriptId: null });
    const otherEpisode = asset({ assetId: 'other_episode', episodeId: 'ep_2', scriptId: null });

    expect(filterAssetsForDesignScope([current, shared, otherEpisode], 'ep_1', null).map(item => item.assetId))
      .toEqual(['current']);
  });
});
