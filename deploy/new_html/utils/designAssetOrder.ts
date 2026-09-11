import type { AssetItem } from '../types';

export const DESIGN_ASSET_ORDER_KEY = 'design_order';

type OrderedAsset = Pick<AssetItem, 'assetId' | 'styleParams'>;

function persistedOrder(asset: OrderedAsset): number | null {
  const raw = asset.styleParams?.[DESIGN_ASSET_ORDER_KEY];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function sortDesignAssets<T extends OrderedAsset>(assets: readonly T[]): T[] {
  return assets
    .map((asset, sourceIndex) => ({ asset, sourceIndex, order: persistedOrder(asset) }))
    .sort((left, right) => {
      if (left.order != null && right.order != null && left.order !== right.order) {
        return left.order - right.order;
      }
      if (left.order != null && right.order == null) return -1;
      if (left.order == null && right.order != null) return 1;
      return left.sourceIndex - right.sourceIndex;
    })
    .map(item => item.asset);
}

export function reconcileDesignAssetOrder(
  previousIds: readonly string[],
  assets: readonly OrderedAsset[],
): string[] {
  const sortedIds = sortDesignAssets(assets).map(asset => asset.assetId);
  const available = new Set(sortedIds);
  const next = previousIds.filter(id => available.has(id));
  const known = new Set(next);
  for (const id of sortedIds) {
    if (!known.has(id)) {
      next.push(id);
      known.add(id);
    }
  }
  return next;
}

export function applyDesignAssetOrder<T extends OrderedAsset>(
  assets: readonly T[],
  orderedIds: readonly string[],
): T[] {
  if (orderedIds.length === 0) return sortDesignAssets(assets);
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  return assets
    .map((asset, sourceIndex) => ({
      asset,
      sourceIndex,
      rank: rank.get(asset.assetId),
    }))
    .sort((left, right) => {
      if (left.rank != null && right.rank != null) return left.rank - right.rank;
      if (left.rank != null) return -1;
      if (right.rank != null) return 1;
      return left.sourceIndex - right.sourceIndex;
    })
    .map(item => item.asset);
}

export function moveDesignAsset(
  orderedIds: readonly string[],
  sourceId: string,
  targetId: string,
): string[] {
  if (!sourceId || !targetId || sourceId === targetId) return [...orderedIds];
  const sourceIndex = orderedIds.indexOf(sourceId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return [...orderedIds];
  const next = [...orderedIds];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}
