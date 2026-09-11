import type { AssetItem } from '../types';

export type AssetScopeMode = 'episode' | 'project';

function assetEpisodeId(asset: AssetItem | Record<string, any>): string | null {
  const value = (asset as any).episodeId ?? (asset as any).episode_id ?? null;
  return value ? String(value) : null;
}

export function isSharedAsset(asset: AssetItem | Record<string, any>): boolean {
  return assetEpisodeId(asset) === null;
}

export function filterAssetsForEpisodeScope<T extends AssetItem | Record<string, any>>(
  assets: T[],
  episodeId: string | null | undefined,
  scopeMode: AssetScopeMode,
): T[] {
  if (scopeMode === 'project' || !episodeId) return assets;
  return assets.filter(asset => {
    const id = assetEpisodeId(asset);
    return id === null || id === episodeId;
  });
}

export function filterAssetsForDesignScope<T extends AssetItem | Record<string, any>>(
  assets: T[],
  episodeId: string | null | undefined,
  _scriptId: string | null | undefined,
): T[] {
  return assets.filter(asset => {
    const assetEpisode = assetEpisodeId(asset);
    if (episodeId && assetEpisode !== episodeId) return false;
    return true;
  });
}
