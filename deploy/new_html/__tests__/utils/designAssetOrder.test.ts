import { describe, expect, it } from 'vitest';
import {
  applyDesignAssetOrder,
  DESIGN_ASSET_ORDER_KEY,
  moveDesignAsset,
  reconcileDesignAssetOrder,
  sortDesignAssets,
} from '../../utils/designAssetOrder';

function asset(assetId: string, order?: number) {
  return {
    assetId,
    styleParams: order == null ? {} : { [DESIGN_ASSET_ORDER_KEY]: order },
  };
}

describe('design asset order', () => {
  it('sorts persisted cards first and keeps a stable fallback order', () => {
    expect(sortDesignAssets([
      asset('legacy-a'),
      asset('ranked-b', 1),
      asset('ranked-a', 0),
      asset('legacy-b'),
    ]).map(item => item.assetId)).toEqual([
      'ranked-a',
      'ranked-b',
      'legacy-a',
      'legacy-b',
    ]);
  });

  it('keeps the current visual order after reload and appends new cards', () => {
    expect(reconcileDesignAssetOrder(
      ['asset-b', 'asset-a'],
      [asset('asset-c'), asset('asset-a'), asset('asset-b')],
    )).toEqual(['asset-b', 'asset-a', 'asset-c']);
  });

  it('moves one card without changing the remaining relative order', () => {
    expect(moveDesignAsset(
      ['asset-a', 'asset-b', 'asset-c'],
      'asset-c',
      'asset-a',
    )).toEqual(['asset-c', 'asset-a', 'asset-b']);
  });

  it('applies an explicit visual order independently from API order', () => {
    expect(applyDesignAssetOrder(
      [asset('asset-c'), asset('asset-a'), asset('asset-b')],
      ['asset-b', 'asset-c', 'asset-a'],
    ).map(item => item.assetId)).toEqual(['asset-b', 'asset-c', 'asset-a']);
  });
});
