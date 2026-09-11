import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEpisode } from '../contexts/EpisodeContext';
import { MaterialPage } from '../components/MaterialPage';
import {
  applyStoryboardRecordPatch,
  scriptToProjectFile,
  assetsToMaterialLibrary,
  dbItemToStoryboardItem,
  normalizeStoryboardRecord,
  BINDINGS_INITIALIZED_TAG,
  DEFAULT_BINDINGS_INITIALIZED_TAG,
  bindingMembershipDiffersFromDefault,
  ensureDefaultBindingSnapshot,
  parseBoundAssetTags,
  restoreDefaultBindingSnapshot,
} from '../utils/episodeAdapters';
import { createAsset as apiCreateAsset } from '../services/assetMutationService';
import { linkEntityFile } from '../services/entityFileService';
import {
  deleteContentBinding,
  listContentBindings,
  putContentBinding,
} from '../services/contentWorkflowService';
import { getStoryboardItems, updateStoryboardItem as apiUpdateStoryboardItem } from '../services/episodeDataService';
import { waitForIdle } from '../utils/idleScheduler';
import { buildStoryboardSegmentLookup } from '../utils/storyboardSegments';
import {
  getFollowingMaterialTargets,
  isMaterialSyncedToCurrentAndFollowing,
} from '../utils/materialBindingState';
import { Image as ImageIcon, Loader } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { crmConfirm, crmMessage } from '../admin/crmUI';
import type { MaterialLibrary, Material, FileVersion, StoryboardItemDB } from '../types';

const MATERIALS_STORYBOARD_INITIAL_LOAD_LIMIT = 20;
const MATERIALS_STORYBOARD_BACKGROUND_PAGE_SIZE = 80;

function normalizeMaterialsStoryboardItem(record: Record<string, any>): StoryboardItemDB {
  return normalizeStoryboardRecord(record);
}
const MATERIALS_AUTO_PATCH_MAX_ATTEMPTS = 3;
const MATERIALS_AUTO_PATCH_RETRY_DELAY_MS = 1200;

function sortMaterialsStoryboardItems(items: StoryboardItemDB[]): StoryboardItemDB[] {
  return [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function mergeMaterialsStoryboardItems(existing: StoryboardItemDB[], incoming: StoryboardItemDB[]): StoryboardItemDB[] {
  const byId = new Map(existing.map(item => [item.itemId, item]));
  for (const item of incoming) {
    if (!byId.has(item.itemId)) byId.set(item.itemId, item);
  }
  return sortMaterialsStoryboardItems(Array.from(byId.values()));
}

type EditableShotBindingType = 'character' | 'scene';

function bindingTokenPrefix(type: EditableShotBindingType): 'char:' | 'scene:' {
  return type === 'character' ? 'char:' : 'scene:';
}

function contentBindingTag(type: EditableShotBindingType, name: string): string {
  return `${type === 'character' ? 'char' : 'scene'}:${name}`;
}

function removeSelectionTokens(tokens: string[], names: string[]): string[] {
  const targets = new Set(names);
  return tokens.filter(token => {
    if (token.startsWith('nosel:')) return !targets.has(token.slice('nosel:'.length));
    if (!token.startsWith('sel:')) return true;
    const rest = token.slice('sel:'.length);
    const separator = rest.indexOf(':');
    return separator <= 0 || !targets.has(rest.slice(0, separator));
  });
}

function addCurrentShotBinding(
  boundAssets: string[],
  type: EditableShotBindingType,
  name: string,
): string[] {
  const snapshotted = ensureDefaultBindingSnapshot(boundAssets);
  const parsed = parseBoundAssetTags(snapshotted);
  const replacedNames = type === 'scene' && parsed.sceneName ? [parsed.sceneName] : [];
  const withoutReplacedSelections = removeSelectionTokens(snapshotted, replacedNames);
  const prefix = bindingTokenPrefix(type);
  const withoutCurrentType = type === 'scene'
    ? withoutReplacedSelections.filter(token => !token.startsWith(prefix))
    : withoutReplacedSelections;
  return Array.from(new Set([
    ...withoutCurrentType.filter(token => token !== `nosel:${name}`),
    BINDINGS_INITIALIZED_TAG,
    `${prefix}${name}`,
  ]));
}

function removeCurrentShotBinding(
  boundAssets: string[],
  type: EditableShotBindingType,
  name: string,
  assetId?: string,
): string[] {
  const prefix = bindingTokenPrefix(type);
  return Array.from(new Set(removeSelectionTokens(
    ensureDefaultBindingSnapshot(boundAssets).filter(token => (
      token !== `${prefix}${name}` && token !== assetId
    )),
    [name],
  )));
}

export const MaterialsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    episodeId, projectId, selectedScriptId,
    script, assets,
    assetScopeMode, setAssetScopeMode,
    isLoading, error,
    forceReloadSlices, forceReloadSlicesQuiet,
  } = useEpisode();
  const [storyboardItems, setStoryboardItems] = useState<StoryboardItemDB[]>([]);
  const [storyboardLoading, setStoryboardLoading] = useState(false);
  const [storyboardError, setStoryboardError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportInFlight = useRef(false);



  useEffect(() => {
    forceReloadSlices('assets', 'script');
  }, [forceReloadSlices]);

  useEffect(() => {
    let active = true;
    if (!episodeId) {
      setStoryboardItems([]);
      return () => { active = false; };
    }
    const currentEpisodeId = episodeId;
    const scriptId = selectedScriptId || undefined;

    const loadRemainingMaterialsStoryboardPages = async (offset: number, total: number) => {
      let nextOffset = offset;
      while (active && nextOffset < total) {
        await waitForIdle();
        if (!active) return;
        try {
          const res = await getStoryboardItems(currentEpisodeId, scriptId, {
            fields: 'materials',
            limit: MATERIALS_STORYBOARD_BACKGROUND_PAGE_SIZE,
            offset: nextOffset,
          });
          if (!active) return;
          const pageItems = res.success
            ? (res.items || []).map(normalizeMaterialsStoryboardItem)
            : [];
          if (!pageItems.length) return;
          setStoryboardItems(prev => mergeMaterialsStoryboardItems(prev, pageItems));
          nextOffset += pageItems.length;
          if (pageItems.length < MATERIALS_STORYBOARD_BACKGROUND_PAGE_SIZE) return;
        } catch (err) {
          console.warn('storyboard material background fields load failed:', err);
          return;
        }
      }
    };

    setStoryboardLoading(true);
    setStoryboardError(null);
    getStoryboardItems(currentEpisodeId, scriptId, {
      fields: 'materials',
      limit: MATERIALS_STORYBOARD_INITIAL_LOAD_LIMIT,
      includeTotal: true,
    })
      .then(res => {
        if (!active) return;
        const items = res.success ? (res.items || []).map(normalizeMaterialsStoryboardItem) : [];
        const sortedItems = sortMaterialsStoryboardItems(items);
        setStoryboardItems(sortedItems);
        const total = typeof res.total === 'number' ? res.total : sortedItems.length;
        if (total > sortedItems.length) {
          void loadRemainingMaterialsStoryboardPages(sortedItems.length, total);
        }
      })
      .catch(err => {
        console.warn('storyboard material fields load failed:', err);
        if (active) {
          setStoryboardItems([]);
          setStoryboardError(err?.message || '素材绑定分镜数据加载失败');
        }
      })
      .finally(() => {
        if (active) setStoryboardLoading(false);
      });
    return () => { active = false; };
  }, [episodeId, selectedScriptId]);

  const updateMaterialsStoryboardItem = useCallback(async (itemId: string, data: Record<string, any>) => {
    await apiUpdateStoryboardItem(itemId, data);
    setStoryboardItems(prev => prev.map(item =>
      item.itemId === itemId ? applyStoryboardRecordPatch(item, data) : item
    ));
  }, []);

  const pseudoFile = useMemo(
    () => scriptToProjectFile(script, storyboardItems, assets, episodeId),
    [script, storyboardItems, assets, episodeId],
  );
  const shotLabels = useMemo(
    () => buildStoryboardSegmentLookup(pseudoFile.storyboard?.items || []),
    [pseudoFile],
  );

  const materialLibraryFromDb = useMemo(
    () => assetsToMaterialLibrary(assets) as MaterialLibrary,
    [assets],
  );

  const effectiveLibrary = materialLibraryFromDb;

  const assetNameToId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of assets) {
      map[a.name] = a.assetId;
    }
    return map;
  }, [assets]);





  const patchedItemIdsRef = useRef<Set<string>>(new Set());
  const patchAttemptsRef = useRef<Map<string, number>>(new Map());
  const patchRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoPatchRevision, setAutoPatchRevision] = useState(0);
  useEffect(() => {
    patchedItemIdsRef.current.clear();
    patchAttemptsRef.current.clear();
    if (patchRetryTimerRef.current) clearTimeout(patchRetryTimerRef.current);
    patchRetryTimerRef.current = null;
  }, [episodeId, selectedScriptId]);

  useEffect(() => () => {
    if (patchRetryTimerRef.current) clearTimeout(patchRetryTimerRef.current);
  }, []);

  useEffect(() => {
    if (!storyboardItems.length) return;
    const charAssets = assets.filter(a => a.assetType === 'character' && a.name);
    const sceneAssets = assets.filter(a => a.assetType === 'scene' && a.name);
    const propAssets = assets.filter(a => a.assetType === 'prop' && a.name);
    const hasAvailableAssets = charAssets.length > 0 || sceneAssets.length > 0 || propAssets.length > 0;

    const uncheckedItems = storyboardItems.filter(item => {
      const boundAssets = Array.isArray(item.boundAssets) ? item.boundAssets : [];
      const needsBindingInference = !boundAssets.includes(BINDINGS_INITIALIZED_TAG);
      return item.itemId
        && (
          needsBindingInference
          || !boundAssets.includes(DEFAULT_BINDINGS_INITIALIZED_TAG)
        )
        && (!needsBindingInference || hasAvailableAssets)
        && !patchedItemIdsRef.current.has(item.itemId)
        && (patchAttemptsRef.current.get(item.itemId) || 0) < MATERIALS_AUTO_PATCH_MAX_ATTEMPTS;
    });
    if (!uncheckedItems.length) return;

    const doPatch = async () => {
      let patched = 0;
      let retryNeeded = false;
      for (const item of uncheckedItems) {
        const searchText = [
          item.sceneHeading, item.actionText, item.dialogue,
          (item as any).imagePrompt,
        ].filter(Boolean).join(' ');
        const existing = Array.isArray(item.boundAssets) ? [...item.boundAssets] : [];
        let tags = [...existing];
        const hasTag = (tag: string) => tags.includes(tag);
        if (!tags.includes(BINDINGS_INITIALIZED_TAG)) {
          tags.push(BINDINGS_INITIALIZED_TAG);
          const matchedChars = searchText
            ? charAssets.filter(a => searchText.includes(a.name))
            : charAssets;
          tags.push(...matchedChars.map(a => `char:${a.name}`).filter(tag => !hasTag(tag)));

          const hasSceneTag = tags.some(tag => tag.startsWith('scene:'));
          const matchedScene = !hasSceneTag && searchText
            ? sceneAssets.find(a => searchText.includes(a.name))
            : (!hasSceneTag && !searchText && sceneAssets.length === 1 ? sceneAssets[0] : undefined);
          if (matchedScene && !hasTag(`scene:${matchedScene.name}`)) tags.push(`scene:${matchedScene.name}`);

          const matchedProps = searchText
            ? propAssets.filter(a => searchText.includes(a.name))
            : [];
          tags.push(...matchedProps.map(a => `prop:${a.name}`).filter(tag => !hasTag(tag)));
        }
        tags = ensureDefaultBindingSnapshot(tags);

        if (JSON.stringify(tags) === JSON.stringify(existing)) {
          patchedItemIdsRef.current.add(item.itemId);
          continue;
        }

        const attempts = (patchAttemptsRef.current.get(item.itemId) || 0) + 1;
        patchAttemptsRef.current.set(item.itemId, attempts);
        try {
          await updateMaterialsStoryboardItem(item.itemId, { bound_assets: tags, boundAssets: tags });
          patchedItemIdsRef.current.add(item.itemId);
          patched++;
        } catch (e) {
          retryNeeded ||= attempts < MATERIALS_AUTO_PATCH_MAX_ATTEMPTS;
          console.error(`Auto-patch bound_assets failed (attempt ${attempts}):`, e);
        }
      }
      if (patched > 0) {
        console.log(`Auto-patched ${patched} storyboard items with char/scene/prop tags`);
      }
      if (retryNeeded && !patchRetryTimerRef.current) {
        patchRetryTimerRef.current = setTimeout(() => {
          patchRetryTimerRef.current = null;
          setAutoPatchRevision(value => value + 1);
        }, MATERIALS_AUTO_PATCH_RETRY_DELAY_MS);
      }
    };
    void doPatch();
  }, [autoPatchRevision, storyboardItems, assets, updateMaterialsStoryboardItem]);

  const handleUpdateLibrary = useCallback(async (newLibrary: MaterialLibrary) => {
    for (const [tagName, materials] of Object.entries(newLibrary)) {
      const currentMaterials = materialLibraryFromDb[tagName] || [];
      const currentFileIds = new Set(currentMaterials.map(material => material.fileId).filter(Boolean));
      const currentUrls = new Set(currentMaterials.map(material => material.url).filter(Boolean));
      const additions = materials.filter(material => (
        (material.fileId && !currentFileIds.has(material.fileId))
        || (!material.fileId && material.url && !currentUrls.has(material.url))
      ));
      if (!additions.length) continue;

      let targetAssetId = assetNameToId[tagName];
      if (!targetAssetId) {
        const assetType = storyboardItems.some(si => {
          const converted = dbItemToStoryboardItem(si, assets);
          return converted.characters.includes(tagName);
        }) ? 'character' : storyboardItems.some(si => {
          const converted = dbItemToStoryboardItem(si, assets);
          return (converted.props || []).includes(tagName);
        }) ? 'prop' : 'scene';

        try {
          const created = await apiCreateAsset({
            project_id: projectId,
            episode_id: episodeId,
            script_id: selectedScriptId || undefined,
            asset_type: assetType,
            name: tagName,
          });
          targetAssetId = created?.asset?.asset_id || created?.asset?.assetId;
        } catch (e) {
          console.error('创建素材失败:', e);
          continue;
        }
      }

      if (!targetAssetId) continue;
      for (const material of additions) {
        if (!material.fileId) {
          console.warn('Material image was not persisted because it has no entity file id:', material.url);
          continue;
        }
        try {
          await linkEntityFile(material.fileId, 'asset', targetAssetId, 'material_image');
        } catch (e) {
          console.error('Failed to link material-stage image:', e);
        }
      }
    }

    // A generated/uploaded material only needs an asset refresh.  Keep the
    // MaterialPage mounted so its selectedShotId (for example shot 06) is not
    // reset to the first storyboard item after every successful generation.
    await forceReloadSlicesQuiet('assets');
  }, [
    assetNameToId,
    assets,
    storyboardItems,
    projectId,
    episodeId,
    selectedScriptId,
    forceReloadSlicesQuiet,
    materialLibraryFromDb,
  ]);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number>(0);

  const [bindDialog, setBindDialog] = useState<{
    shotId: string;
    tagName: string;
    materialId: string;
    cascadeTargets: typeof storyboardItems;
  } | null>(null);

  const [unbindDialog, setUnbindDialog] = useState<{
    shotId: string;
    tagName: string;
    cascadeTargets: typeof storyboardItems;
  } | null>(null);

  const buildBoundAssets = useCallback((item: StoryboardItemDB, tagName: string, materialId: string) => {
    const asset = assets.find(a => a.name === tagName);
    const prefix = asset?.assetType === 'scene' ? 'scene' : asset?.assetType === 'prop' ? 'prop' : 'char';
    const tagEntry = `${prefix}:${tagName}`;
    const currentBound = Array.isArray(item.boundAssets) ? [...item.boundAssets] : [];
    if (!currentBound.includes(tagEntry)) {
      currentBound.push(tagEntry);
    }
    const rawId = assetNameToId[tagName];
    const cleaned = currentBound.filter(id =>
      !id.startsWith(`sel:${tagName}:`) && id !== rawId && id !== `nosel:${tagName}`
    );
    cleaned.push(`sel:${tagName}:${materialId}`);
    return cleaned;
  }, [assets, assetNameToId]);

  const materialTagKey = useCallback((tagName: string) => {
    const asset = assets.find(candidate => candidate.name === tagName);
    const prefix = asset?.assetType === 'scene' ? 'scene' : asset?.assetType === 'prop' ? 'prop' : 'char';
    return `${prefix}:${tagName}`;
  }, [assets]);

  const availableBindingNames = useMemo(() => ({
    character: Array.from(new Set(
      assets.filter(asset => asset.assetType === 'character' && asset.name).map(asset => asset.name),
    )).sort((left, right) => left.localeCompare(right, 'zh-CN')),
    scene: Array.from(new Set(
      assets.filter(asset => asset.assetType === 'scene' && asset.name).map(asset => asset.name),
    )).sort((left, right) => left.localeCompare(right, 'zh-CN')),
  }), [assets]);

  const selectedMaterial = useCallback((tagName: string, materialId: string) => (
    (effectiveLibrary[tagName] || []).find(material => material.id === materialId)
  ), [effectiveLibrary]);

  const persistNormalizedMaterialBinding = useCallback(async (
    item: StoryboardItemDB,
    tagName: string,
    materialId: string,
    scope: 'project' | 'shot',
  ) => {
    const material = selectedMaterial(tagName, materialId);
    const assetId = material?.assetId || assetNameToId[tagName];
    if (!projectId || !assetId) throw new Error('没有找到该素材对应的项目资产');
    await putContentBinding(projectId, {
      episode_id: episodeId || undefined,
      storyboard_item_id: scope === 'shot' ? item.itemId : undefined,
      tag_key: materialTagKey(tagName),
      scope,
      asset_id: assetId,
      file_id: material?.fileId,
      locked: true,
    });
  }, [assetNameToId, episodeId, materialTagKey, projectId, selectedMaterial]);

  const persistLegacyMaterialBinding = useCallback(async (
    item: StoryboardItemDB,
    tagName: string,
    materialId: string,
  ) => {
    const cleaned = buildBoundAssets(item, tagName, materialId);
    await updateMaterialsStoryboardItem(item.itemId, { bound_assets: cleaned, boundAssets: cleaned });
  }, [buildBoundAssets, updateMaterialsStoryboardItem]);

  const persistMaterialBinding = useCallback(async (
    item: StoryboardItemDB,
    tagName: string,
    materialId: string,
  ) => {
    await persistNormalizedMaterialBinding(item, tagName, materialId, 'shot');
    await persistLegacyMaterialBinding(item, tagName, materialId);
  }, [persistLegacyMaterialBinding, persistNormalizedMaterialBinding]);

  const persistDisabledMaterialBinding = useCallback(async (
    item: StoryboardItemDB,
    tagName: string,
    type?: EditableShotBindingType,
  ) => {
    if (!projectId) return;
    await putContentBinding(projectId, {
      episode_id: episodeId || undefined,
      storyboard_item_id: item.itemId,
      tag_key: type ? contentBindingTag(type, tagName) : materialTagKey(tagName),
      scope: 'shot',
      is_disabled: true,
      locked: true,
    });
  }, [episodeId, materialTagKey, projectId]);

  const clearShotBindingOverrides = useCallback(async (
    storyboardItemId: string,
    tagKeys: string[],
  ) => {
    if (!projectId || !tagKeys.length) return;
    const response = await listContentBindings(projectId, { storyboardItemId });
    const targetKeys = new Set(tagKeys);
    const overrides = (response.items || []).filter(binding => (
      binding.scope === 'shot'
      && binding.storyboard_item_id === storyboardItemId
      && targetKeys.has(binding.tag_key)
    ));
    await Promise.all(overrides.map(binding => deleteContentBinding(projectId, binding.binding_id)));
  }, [projectId]);

  const showMaterialToast = useCallback((message: string) => {
    setToastMsg(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3000);
  }, []);

  const handleAddShotBinding = useCallback(async (
    shotId: string,
    type: EditableShotBindingType,
    rawName: string,
  ) => {
    const name = rawName.trim();
    if (!name) throw new Error(`请输入${type === 'character' ? '角色' : '场景'}名称`);
    const item = storyboardItems.find(candidate => candidate.itemId === shotId);
    if (!item) throw new Error('没有找到当前镜头');

    const current = dbItemToStoryboardItem(item, assets);
    if (type === 'character' && current.characters.includes(name)) {
      showMaterialToast(`角色“${name}”已在当前镜头中`);
      return;
    }
    if (type === 'scene' && current.scene === name) {
      showMaterialToast(`场景“${name}”已是当前镜头场景`);
      return;
    }

    const existingAsset = assets.find(asset => asset.assetType === type && asset.name.trim() === name);
    let createdAsset = false;
    if (!existingAsset) {
      if (!projectId) throw new Error('缺少项目信息，无法创建素材');
      const created = await apiCreateAsset({
        project_id: projectId,
        episode_id: episodeId || undefined,
        script_id: selectedScriptId || undefined,
        asset_type: type,
        name,
      });
      if (!created?.success || !(created?.asset?.asset_id || created?.asset?.assetId)) {
        throw new Error(`创建${type === 'character' ? '角色' : '场景'}失败`);
      }
      createdAsset = true;
    }

    const previousScene = type === 'scene' ? current.scene : '';
    if (previousScene && previousScene !== name) {
      await persistDisabledMaterialBinding(item, previousScene, 'scene');
    }
    await clearShotBindingOverrides(shotId, [contentBindingTag(type, name)]);
    const updated = addCurrentShotBinding(item.boundAssets || [], type, name);
    await updateMaterialsStoryboardItem(shotId, { bound_assets: updated, boundAssets: updated });
    if (createdAsset) await forceReloadSlicesQuiet('assets');
    showMaterialToast(type === 'character'
      ? `已为当前镜头新增角色“${name}”`
      : `已将当前镜头场景改为“${name}”`);
  }, [
    assets,
    clearShotBindingOverrides,
    episodeId,
    forceReloadSlicesQuiet,
    persistDisabledMaterialBinding,
    projectId,
    selectedScriptId,
    showMaterialToast,
    storyboardItems,
    updateMaterialsStoryboardItem,
  ]);

  const handleRemoveShotBinding = useCallback(async (
    shotId: string,
    type: EditableShotBindingType,
    name: string,
  ) => {
    const item = storyboardItems.find(candidate => candidate.itemId === shotId);
    if (!item) return;
    const typeLabel = type === 'character' ? '角色' : '场景';
    const confirmed = await crmConfirm({
      title: `从当前镜头移除${typeLabel}`,
      message: `确定从当前镜头移除${typeLabel}“${name}”吗？素材库中的设计图不会被删除，可通过“恢复默认”或重新添加找回。`,
      type: 'danger',
      confirmText: '确认移除',
    });
    if (!confirmed) return;

    try {
      await persistDisabledMaterialBinding(item, name, type);
      const updated = removeCurrentShotBinding(item.boundAssets || [], type, name, assetNameToId[name]);
      await updateMaterialsStoryboardItem(shotId, { bound_assets: updated, boundAssets: updated });
      showMaterialToast(`已从当前镜头移除${typeLabel}“${name}”`);
    } catch (error) {
      console.error('移除镜头素材绑定失败:', error);
      crmMessage.error(`移除失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [
    assetNameToId,
    persistDisabledMaterialBinding,
    showMaterialToast,
    storyboardItems,
    updateMaterialsStoryboardItem,
  ]);

  const handleRestoreDefaultBindings = useCallback(async (shotId: string) => {
    const item = storyboardItems.find(candidate => candidate.itemId === shotId);
    if (!item || !bindingMembershipDiffersFromDefault(item.boundAssets || [])) return;
    const confirmed = await crmConfirm({
      title: '恢复默认绑定',
      message: '确定恢复为最近一次从前一步导入的角色、场景和道具绑定吗？当前镜头中的人工增删将被替换，素材图片本身不会删除。',
      type: 'warning',
      confirmText: '恢复默认',
    });
    if (!confirmed) return;

    try {
      const parsed = parseBoundAssetTags(item.boundAssets || []);
      const tagKeys = Array.from(new Set([
        ...parsed.charNames.map(name => `char:${name}`),
        ...(parsed.sceneName ? [`scene:${parsed.sceneName}`] : []),
        ...parsed.propNames.map(name => `prop:${name}`),
        ...parsed.defaultCharNames.map(name => `char:${name}`),
        ...(parsed.defaultSceneName ? [`scene:${parsed.defaultSceneName}`] : []),
        ...parsed.defaultPropNames.map(name => `prop:${name}`),
      ]));
      await clearShotBindingOverrides(shotId, tagKeys);
      const restored = restoreDefaultBindingSnapshot(item.boundAssets || []);
      await updateMaterialsStoryboardItem(shotId, { bound_assets: restored, boundAssets: restored });
      showMaterialToast('已恢复最近一次导入的默认绑定');
    } catch (error) {
      console.error('恢复默认绑定失败:', error);
      crmMessage.error(`恢复失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [clearShotBindingOverrides, showMaterialToast, storyboardItems, updateMaterialsStoryboardItem]);

  const handleBindMaterial = useCallback(async (shotId: string, tagName: string, materialId: string) => {
    const currentIndex = storyboardItems.findIndex(si => si.itemId === shotId);
    const item = storyboardItems[currentIndex];
    if (!item || currentIndex < 0) return;

    const cascadeTargets = getFollowingMaterialTargets(storyboardItems, shotId, tagName);
    if (isMaterialSyncedToCurrentAndFollowing(
      storyboardItems,
      assets,
      shotId,
      tagName,
      materialId,
    )) {
      return;
    }

    if (cascadeTargets.length > 0) {
      setBindDialog({ shotId, tagName, materialId, cascadeTargets });
      return;
    }

    try {
      await persistMaterialBinding(item, tagName, materialId);
      showMaterialToast('已锁定当前镜头素材');
    } catch (e) {
      console.error('绑定素材失败:', e);
    }
  }, [storyboardItems, assets, persistMaterialBinding, showMaterialToast]);

  const isMaterialFullySynced = useCallback((
    shotId: string,
    tagName: string,
    materialId: string,
  ) => isMaterialSyncedToCurrentAndFollowing(
    storyboardItems,
    assets,
    shotId,
    tagName,
    materialId,
  ), [storyboardItems, assets]);

  const handleBindConfirm = useCallback(async () => {
    if (!bindDialog) return;
    const { shotId, tagName, materialId, cascadeTargets } = bindDialog;
    setBindDialog(null);

    const currentItem = storyboardItems.find(si => si.itemId === shotId);
    if (!currentItem) return;

    let cascadeCount = 0;
    try {


      // old readers until all generation paths consume normalized bindings.
      await persistNormalizedMaterialBinding(currentItem, tagName, materialId, 'project');
      await persistLegacyMaterialBinding(currentItem, tagName, materialId);
      for (const target of cascadeTargets) {
        try {
          await persistLegacyMaterialBinding(target, tagName, materialId);
          cascadeCount += 1;
        } catch (e) {
          console.error('级联绑定后续镜头失败:', e);
        }
      }
      showMaterialToast(`已锁定当前镜头，并同步更新后续 ${cascadeCount} 个同名镜头`);
    } catch (e) {
      console.error('绑定素材失败:', e);
    }
  }, [bindDialog, storyboardItems, persistLegacyMaterialBinding, persistNormalizedMaterialBinding, showMaterialToast]);

  const handleBindCurrentOnly = useCallback(async () => {
    if (!bindDialog) return;
    const { shotId, tagName, materialId } = bindDialog;
    setBindDialog(null);

    const currentItem = storyboardItems.find(si => si.itemId === shotId);
    if (!currentItem) return;
    try {
      await persistMaterialBinding(currentItem, tagName, materialId);
      showMaterialToast('已仅更新当前镜头素材');
    } catch (e) {
      console.error('绑定素材失败:', e);
    }
  }, [bindDialog, storyboardItems, persistMaterialBinding, showMaterialToast]);

  const handleUnbindMaterial = useCallback(async (shotId: string, tagName: string) => {
    const currentIndex = storyboardItems.findIndex(si => si.itemId === shotId);
    const item = storyboardItems[currentIndex];
    if (!item || currentIndex < 0) return;

    let cascadeTargets: typeof storyboardItems = [];
    for (let i = currentIndex + 1; i < storyboardItems.length; i++) {
      const si = storyboardItems[i];
      const bound = Array.isArray(si.boundAssets) ? si.boundAssets : [];
      if (bound.some((b: string) => b.startsWith(`sel:${tagName}:`))) {
        cascadeTargets.push(si);
      }
    }

    if (cascadeTargets.length > 0) {
      setUnbindDialog({ shotId, tagName, cascadeTargets });
      return;
    }

    const assetId = assetNameToId[tagName];
    const currentBound = Array.isArray(item.boundAssets) ? item.boundAssets : [];
    const filtered = currentBound.filter((id: string) =>
      id !== assetId &&
      !id.startsWith(`sel:${tagName}:`) &&
      id !== `nosel:${tagName}`
    );
    filtered.push(`nosel:${tagName}`);
    try {
      await persistDisabledMaterialBinding(item, tagName);
      await updateMaterialsStoryboardItem(shotId, { bound_assets: filtered, boundAssets: filtered });
    } catch (e) {
      console.error('解绑素材失败:', e);
    }
  }, [storyboardItems, assetNameToId, persistDisabledMaterialBinding, updateMaterialsStoryboardItem]);

  const handleUnbindConfirm = useCallback(async () => {
    if (!unbindDialog) return;
    const { shotId, tagName, cascadeTargets } = unbindDialog;
    setUnbindDialog(null);

    const unbindItem = async (itemId: string, boundAssets: string[]) => {
      const item = storyboardItems.find(candidate => candidate.itemId === itemId);
      if (item) await persistDisabledMaterialBinding(item, tagName);
      const assetId = assetNameToId[tagName];
      const filtered = boundAssets.filter((id: string) =>
        id !== assetId &&
        !id.startsWith(`sel:${tagName}:`) &&
        id !== `nosel:${tagName}`
      );
      filtered.push(`nosel:${tagName}`);
      await updateMaterialsStoryboardItem(itemId, { bound_assets: filtered, boundAssets: filtered });
    };

    try {
      const currentItem = storyboardItems.find(si => si.itemId === shotId);
      if (currentItem) {
        await unbindItem(currentItem.itemId, Array.isArray(currentItem.boundAssets) ? currentItem.boundAssets : []);
      }
      for (const si of cascadeTargets) {
        try {
          await unbindItem(si.itemId, Array.isArray(si.boundAssets) ? si.boundAssets : []);
        } catch (e) {
          console.error('级联解绑镜头失败:', e);
        }
      }
    } catch (e) {
      console.error('解绑素材失败:', e);
    }
  }, [unbindDialog, storyboardItems, assetNameToId, persistDisabledMaterialBinding, updateMaterialsStoryboardItem]);

  const handleUnbindCancel = useCallback(async () => {
    if (!unbindDialog) return;
    const { shotId, tagName } = unbindDialog;
    setUnbindDialog(null);

    const currentItem = storyboardItems.find(si => si.itemId === shotId);
    if (!currentItem) return;

    const assetId = assetNameToId[tagName];
    const currentBound = Array.isArray(currentItem.boundAssets) ? currentItem.boundAssets : [];
    const filtered = currentBound.filter((id: string) =>
      id !== assetId &&
      !id.startsWith(`sel:${tagName}:`) &&
      id !== `nosel:${tagName}`
    );
    filtered.push(`nosel:${tagName}`);

    try {
      await persistDisabledMaterialBinding(currentItem, tagName);
      await updateMaterialsStoryboardItem(shotId, { bound_assets: filtered, boundAssets: filtered });
    } catch (e) {
      console.error('解绑素材失败:', e);
    }
  }, [unbindDialog, storyboardItems, assetNameToId, persistDisabledMaterialBinding, updateMaterialsStoryboardItem]);

  const handleNextStep = useCallback(async () => {
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    setExporting(true);
    try {
      // All stages share the same persisted shots. Validate the destination
      // projection instead of rewriting audio or copying stale material rows.
      const result = await getStoryboardItems(episodeId, selectedScriptId || undefined, {
        fields: 'audio_stage', limit: 1, includeTotal: true,
      });
      if (!result.success || !result.items?.length) throw new Error('没有可导出的镜头，请先完成脚本');
      await forceReloadSlicesQuiet('storyboardItems', 'audioTracks');
      crmMessage.success(`已导出 ${result.total ?? storyboardItems.length} 个镜头，声音和画面按脚本顺序排列`);
      navigate(`/projects/${projectId}/ep/${episodeId}/workflow/audio`);
    } catch (error: any) {
      crmMessage.error(`导出失败：${error?.message || '请稍后重试'}`);
    } finally {
      exportInFlight.current = false;
      setExporting(false);
    }
  }, [navigate, projectId, episodeId, selectedScriptId, forceReloadSlicesQuiet, storyboardItems.length]);

  const noopSaveVersion = useCallback((_name: string) => {}, []);
  const noopRestoreVersion = useCallback((_v: FileVersion) => {}, []);
  const noopDeleteVersion = useCallback((_id: string) => {}, []);
  const noopImportProject = useCallback(() => {}, []);

  if (isLoading || storyboardLoading) {
    return (
      <div className="flex items-center justify-center h-full text-n300">
        <div className="animate-pulse flex items-center gap-2">
          <Loader className="w-5 h-5 animate-spin" />
          <span>加载素材数据...</span>
        </div>
      </div>
    );
  }

  if (error || storyboardError) {
    return (
      <div className="flex items-center justify-center h-full text-danger p-6">
        <p>{error || storyboardError}</p>
      </div>
    );
  }

  if (!pseudoFile.storyboard || pseudoFile.storyboard.items.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-n300">
        <div className="text-center space-y-3">
          <ImageIcon className="w-12 h-12 mx-auto text-primary" />
          <p className="text-xl font-medium text-n700">素材绑定</p>
          <p className="text-sm text-n100">暂无分镜数据，请先在设计页面创建分镜</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <MaterialPage
        projectId={projectId}
        files={[pseudoFile]}
        selectedFileId={episodeId}
        materialLibrary={effectiveLibrary}
        onUpdateLibrary={handleUpdateLibrary}
        onBindMaterial={handleBindMaterial}
        isMaterialFullySynced={isMaterialFullySynced}
        onUnbindMaterial={handleUnbindMaterial}
        onNextStep={handleNextStep}
        nextStepBusy={exporting}
        onSaveVersion={noopSaveVersion}
        onRestoreVersion={noopRestoreVersion}
        onDeleteVersion={noopDeleteVersion}
        onImportProject={noopImportProject}
        hideVersionArchive
        assetNameToId={assetNameToId}
        assetScopeMode={assetScopeMode}
        onAssetScopeModeChange={setAssetScopeMode}
        availableBindingNames={availableBindingNames}
        onAddShotBinding={handleAddShotBinding}
        onRemoveShotBinding={handleRemoveShotBinding}
        onRestoreDefaultBindings={handleRestoreDefaultBindings}
      />
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-success text-white text-sm rounded-lg shadow-bottom">
          {toastMsg}
        </div>
      )}
      {bindDialog && (
        <ConfirmDialog
          open={!!bindDialog}
          onConfirm={handleBindConfirm}
          onCancel={handleBindCurrentOnly}
          title="同步锁定后续镜头"
          message={`是否将「${bindDialog.tagName}」的新素材同步锁定到后续同名镜头？`}
          detail={
            <div className="space-y-2">
              <p className="text-xs text-warning font-medium">
                确认后将覆盖后续 {bindDialog.cascadeTargets.length} 个同名镜头当前绑定的素材
              </p>
              <div className="flex flex-wrap gap-1.5">
                {bindDialog.cascadeTargets.slice(0, 8).map((si) => (
                  <span key={si.itemId} className="text-[10px] bg-n30 text-warning px-2 py-0.5 rounded-md">
                    {shotLabels.get(si.itemId)?.localShotLabel || `镜头 ${si.sortOrder + 1}`}
                  </span>
                ))}
                {bindDialog.cascadeTargets.length > 8 && (
                  <span className="text-[10px] text-warning">
                    +{bindDialog.cascadeTargets.length - 8} 个
                  </span>
                )}
              </div>
            </div>
          }
          confirmText="同步后续镜头"
          cancelText="仅当前镜头"
          variant="warning"
        />
      )}
      {unbindDialog && (
        <ConfirmDialog
          open={!!unbindDialog}
          onConfirm={handleUnbindConfirm}
          onCancel={handleUnbindCancel}
          title="解除素材绑定"
          message={`确定要解除当前镜头「${unbindDialog.tagName}」的素材绑定吗？`}
          detail={
            <div className="space-y-2">
              <p className="text-xs text-warning font-medium">
                后续还有 {unbindDialog.cascadeTargets.length} 个镜头绑定了同一素材
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unbindDialog.cascadeTargets.slice(0, 8).map((si, i) => (
                  <span key={si.itemId} className="text-[10px] bg-n30 text-warning px-2 py-0.5 rounded-md">
                    {shotLabels.get(si.itemId)?.localShotLabel || `镜头 ${si.sortOrder + 1}`}
                  </span>
                ))}
                {unbindDialog.cascadeTargets.length > 8 && (
                  <span className="text-[10px] text-warning">
                    +{unbindDialog.cascadeTargets.length - 8} 个
                  </span>
                )}
              </div>
            </div>
          }
          confirmText="全部解绑"
          cancelText="仅当前镜头"
          variant="warning"
        />
      )}
    </>
  );
};
