import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../pages/MaterialsPage.tsx'), 'utf-8');
const episodeContext = readFileSync(resolve(__dirname, '../../contexts/EpisodeContext.tsx'), 'utf-8');

describe('MaterialsPage binding propagation', () => {
  it('asks before replacing the locked material on later matching shots', () => {
    expect(source).toContain('const [bindDialog, setBindDialog] = useState');
    expect(source).toContain('setBindDialog({ shotId, tagName, materialId, cascadeTargets })');
    expect(source).toContain('title="同步锁定后续镜头"');
    expect(source).toContain('confirmText="同步后续镜头"');
    expect(source).toContain('cancelText="仅当前镜头"');
  });

  it('can either update the current shot only or overwrite all later matching shots', () => {
    expect(source).toContain('const handleBindConfirm = useCallback');
    expect(source).toContain('const handleBindCurrentOnly = useCallback');
    expect(source).toContain("await persistNormalizedMaterialBinding(currentItem, tagName, materialId, 'project')");
    expect(source).toContain('await persistLegacyMaterialBinding(target, tagName, materialId)');
    expect(source).toContain('已仅更新当前镜头素材');
  });

  it('disables a binding that already applies to the current and all later matching shots', () => {
    expect(source).toContain('isMaterialSyncedToCurrentAndFollowing');
    expect(source).toContain('const isMaterialFullySynced = useCallback');
    expect(source).toContain('isMaterialFullySynced={isMaterialFullySynced}');
  });

  it('persists material-stage additions without overwriting design reference images', () => {
    expect(source).not.toContain('updateAsset as apiUpdateAsset');
    expect(source).not.toContain('reference_images: newUrls');
    expect(source).toContain("await linkEntityFile(material.fileId, 'asset', targetAssetId, 'material_image')");
    expect(source).toContain('const additions = materials.filter');
  });

  it('keeps the active shot mounted while refreshing generated assets', () => {
    expect(episodeContext).toContain('forceReloadSlicesQuiet: (...slices: DataSlice[]) => Promise<void>');
    expect(episodeContext).toContain('await fetchSlices({ quiet: true }, ...slices)');
    expect(source).toContain("await forceReloadSlicesQuiet('assets')");

    const updateLibrary = source.slice(
      source.indexOf('const handleUpdateLibrary'),
      source.indexOf('const [toastMsg'),
    );
    expect(updateLibrary).not.toContain("await forceReloadSlices('assets')");
  });

  it('does not restore deleted shot roles from a segment-wide video prompt', () => {
    expect(source).toContain('!boundAssets.includes(BINDINGS_INITIALIZED_TAG)');
    expect(source).toContain('!boundAssets.includes(DEFAULT_BINDINGS_INITIALIZED_TAG)');
    expect(source).toContain('tags = ensureDefaultBindingSnapshot(tags)');
    const autoPatch = source.slice(
      source.indexOf('const [autoPatchRevision'),
      source.indexOf('const handleUpdateLibrary'),
    );
    expect(autoPatch).not.toContain('(item as any).videoPrompt');
    expect(autoPatch).toContain("tags.some(tag => tag.startsWith('scene:'))");
  });

  it('persists free shot-level role and scene edits separately from imported defaults', () => {
    expect(source).toContain('const handleAddShotBinding = useCallback');
    expect(source).toContain('const handleRemoveShotBinding = useCallback');
    expect(source).toContain('addCurrentShotBinding(item.boundAssets || [], type, name)');
    expect(source).toContain('removeCurrentShotBinding(item.boundAssets || [], type, name, assetNameToId[name])');
    expect(source).toContain("asset_type: type");
    expect(source).toContain('onAddShotBinding={handleAddShotBinding}');
    expect(source).toContain('onRemoveShotBinding={handleRemoveShotBinding}');
  });

  it('restores the latest upstream default and clears shot-level normalized overrides', () => {
    expect(source).toContain('const handleRestoreDefaultBindings = useCallback');
    expect(source).toContain('restoreDefaultBindingSnapshot(item.boundAssets || [])');
    expect(source).toContain('await clearShotBindingOverrides(shotId, tagKeys)');
    expect(source).toContain('onRestoreDefaultBindings={handleRestoreDefaultBindings}');
    expect(source).toContain('素材图片本身不会删除');
  });
});
