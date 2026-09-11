import type { AssetItem, Material, MaterialLibrary, StoryboardItem, StoryboardItemDB } from '../types';
import { dbItemToStoryboardItem } from './episodeAdapters';

export function resolveBoundMaterial(materials: readonly Material[], selectedId?: string): Material | undefined {
  if (!selectedId) return undefined;
  return materials.find(material => material.id === selectedId && Boolean(material.url?.trim()));
}

export function getMaterialBindingProgress(item: StoryboardItem, library: MaterialLibrary) {
  const requiredTags = new Set([
    ...(item.characters || []),
    ...(item.scene ? [item.scene] : []),
  ].filter(tag => tag.trim()));
  const propTags = [...new Set((item.props || []).filter(tag => tag.trim()))];
  // Text-only props remain in the prompt, but are not missing image references.
  const optionalPropTags = propTags.filter(tag => (
    !requiredTags.has(tag) && !(library[tag] || []).some(material => Boolean(material.url?.trim()))
  ));
  const tags = [...new Set([...requiredTags, ...propTags.filter(tag => !optionalPropTags.includes(tag))])];
  const boundTags: string[] = [];
  const missingTags: string[] = [];
  for (const tag of tags) {
    const bound = resolveBoundMaterial(library[tag] || [], item.materialSelections?.[tag]);
    (bound ? boundTags : missingTags).push(tag);
  }
  const status = !tags.length ? 'empty'
    : !missingTags.length ? 'complete'
      : boundTags.length ? 'partial' : 'pending';
  return { status, total: tags.length, boundTags, missingTags, optionalPropTags };
}

function hasMaterialTag(item: StoryboardItemDB, tagName: string): boolean {
  const boundAssets = Array.isArray(item.boundAssets) ? item.boundAssets : [];
  return boundAssets.some(entry => (
    entry === `char:${tagName}`
    || entry === `scene:${tagName}`
    || entry === `prop:${tagName}`
  ));
}

export function getFollowingMaterialTargets(
  storyboardItems: StoryboardItemDB[],
  shotId: string,
  tagName: string,
): StoryboardItemDB[] {
  const currentIndex = storyboardItems.findIndex(item => item.itemId === shotId);
  if (currentIndex < 0) return [];

  return storyboardItems
    .slice(currentIndex + 1)
    .filter(item => hasMaterialTag(item, tagName));
}

export function isMaterialSyncedToCurrentAndFollowing(
  storyboardItems: StoryboardItemDB[],
  assets: AssetItem[],
  shotId: string,
  tagName: string,
  materialId: string,
): boolean {
  const currentItem = storyboardItems.find(item => item.itemId === shotId);
  if (!currentItem) return false;

  const targets = [
    currentItem,
    ...getFollowingMaterialTargets(storyboardItems, shotId, tagName),
  ];

  return targets.every(item => (
    dbItemToStoryboardItem(item, assets).materialSelections?.[tagName] === materialId
  ));
}
