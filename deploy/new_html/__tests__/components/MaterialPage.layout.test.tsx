import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/MaterialPage.tsx'), 'utf-8');

describe('MaterialPage workspace layout', () => {
  it('keeps the shot context collapsed by default and exposes an explicit toggle', () => {
    expect(source).toContain('const [isContextExpanded, setIsContextExpanded] = usePersistedPageState<boolean>');
    expect(source).toContain("page: 'MaterialPage:shotContext'");
    expect(source).toContain('episodeId: selectedFileId');
    expect(source).toContain('defaultValue: false');
    expect(source).toContain('aria-controls="material-shot-context"');
    expect(source).toContain("{isContextExpanded ? '收起提示词' : '展开提示词'}");
    expect(source).toContain('{isContextExpanded && (');
  });

  it('repairs stale shot selection and keeps sidebar cards keyboard-selectable', () => {
    expect(source).toContain('setSelectedShotId(currentId => {');
    expect(source).toContain('storyboardItems.some(item => item.id === currentId)');
    expect(source).toContain('return storyboardItems[0]?.id ?? null');
    expect(source).toContain('data-storyboard-item-id={item.id}');
    expect(source).toContain('aria-pressed={isSelected}');
    expect(source).toContain("event.key === 'Enter' || event.key === ' '");
  });

  it('matches the script file rail with a compact title row and blue active edge', () => {
    expect(source).toContain('data-testid="material-shot-list-title-row"');
    expect(source).toContain('({storyboardItems.length})');
    expect(source).toContain('data-testid="material-shot-card"');
    expect(source).toContain('border-b border-l-[3px]');
    expect(source).toContain("? 'border-l-primary bg-primary-light'");
    expect(source).toContain('line-clamp-2 min-h-10');
  });

  it('shows up to three cards per row inside every material category on desktop', () => {
    expect(source).toContain('data-testid="material-category-grid"');
    expect(source).toContain('data-testid="material-character-cards"');
    expect(source).toContain('data-testid="material-scene-cards"');
    expect(source).toContain('data-testid="material-prop-cards"');
    expect(source).toContain('grid grid-cols-1 lg:grid-cols-3');
    expect(source).toContain('aria-labelledby="material-characters-heading"');
    expect(source).toContain('aria-labelledby="material-scene-heading"');
    expect(source).toContain('aria-labelledby="material-props-heading"');
  });

  it('keeps one material row scrollbar-free and fully contains portrait thumbnails', () => {
    expect(source).toContain("materials.length > 3 ? 'max-h-[128px] overflow-y-auto custom-scrollbar' : 'overflow-hidden'");
    expect(source).toContain('className={`relative group/item h-24');
    expect(source).toContain('className="w-full h-full object-contain p-1"');
    expect(source).toContain("'已同步到当前及后续同名镜头'");
    expect(source).toContain("isSynced ? 'cursor-not-allowed bg-n30 opacity-60'");
    expect(source).toContain('<span>AI 生图</span>');
    expect(source).toContain("'角度处理中…' : '角度'");
    expect(source).toContain("'高清放大处理中…' : '高清放大'");
    expect(source).toContain("'去水印处理中…' : '去水印'");
    expect(source).toContain('<span>四视图</span>');
  });

  it('uses the same preview and green-border thumbnail picker for four-view generation', () => {
    expect(source).toContain("selectedMaterialId === mat.id");
    expect(source).toContain("'border-success ring-2 ring-success/30'");
    expect(source).toContain('className="w-full h-72');
    expect(source).toContain('aria-label={`选择素材 ${mat.id}`}');
  });

  it('explains the four generated character views beside the prompt editor', () => {
    expect(source).toContain('data-testid="character-turnaround-explanation"');
    expect(source).toContain("config.type === 'character'");
    expect(source).toContain('三张不同角度的全身图');
    expect(source).toContain('正面、侧面、背面');
    expect(source).toContain('一张放大的正面半身图');
  });

  it('stores every material-stage image as an independent material_image entity file', () => {
    expect(source).toContain("targetAssetId ? 'asset' : 'storyboard_item'");
    expect(source).toContain("'material_image'");
    expect(source).toContain('fileId: saved.fileId');
    expect(source).toContain('fileId: r.fileId');
    expect(source).toContain('fileId: result.fileId');
    expect(source).toContain('fileId: results[0].fileId');
  });

  it('shows persistent processing feedback and safely deletes character or scene materials', () => {
    expect(source).toContain('role="status" aria-live="polite"');
    expect(source).toContain("label: workflow === 'upscale_hd' ? '高清放大处理中…' : '去水印处理中…'");
    expect(source).toContain("title: `删除${typeLabel}素材`");
    expect(source).toContain('需要从剧本分镜重新导入');
    expect(source).toContain("confirmText: '确认删除'");
    expect(source).toContain('await deleteEntityFile(targetMaterial.fileId)');
    expect(source).toContain('await updateAsset(targetAssetId');
    expect(source).toContain('aria-label={`删除${name}素材`}');
  });

  it('allows shot-level character and scene editing without deleting shared assets', () => {
    expect(source).toContain('data-testid="add-shot-character"');
    expect(source).toContain('data-testid="add-shot-scene"');
    expect(source).toContain('data-testid="restore-default-bindings"');
    expect(source).toContain("openBindingEditor('character')");
    expect(source).toContain("openBindingEditor('scene')");
    expect(source).toContain('修改只作用于当前镜头');
    expect(source).toContain('原场景素材不会被删除');
    expect(source).toContain('从当前镜头移除${type === \'character\' ? \'角色\' : \'场景\'}，不会删除素材图片');
  });
});
