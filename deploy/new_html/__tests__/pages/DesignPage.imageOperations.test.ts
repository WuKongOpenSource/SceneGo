import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../pages/DesignPage.tsx'), 'utf-8');

describe('DesignPage image operation modals', () => {
  it('uses discrete angle choices instead of fixed-step sliders', () => {
    expect(source).toContain('const DiscreteChoiceControl');
    expect(source).toContain("label=\"水平旋转\"");
    expect(source).toContain("label=\"推进距离\"");
    expect(source).toContain("label=\"垂直视角\"");
    expect(source).not.toContain('type="range"');
  });

  it('explains online reference-image consistency and candidate persistence', () => {
    expect(source).toContain('在线模型会保留主体身份、画面风格和未指定变化的内容');
    expect(source).toContain('保存为新的候选图片');
    expect(source).not.toContain('随机种子用于探索新的构图');
  });

  it('shares the green-border material picker across all image operations', () => {
    expect(source.match(/<OperationMaterialPicker/g)).toHaveLength(2);
    expect(source).toContain("'border-success ring-2 ring-success/30'");
    expect(source).toContain('aria-pressed={active}');
  });

  it('keeps upscale and watermark processing in the same two-column modal layout', () => {
    expect(source).toContain('max-w-5xl');
    expect(source).toContain("workflow === 'upscale_hd'");
    expect(source).toContain('对左侧选中的素材进行高清重建和细节增强');
    expect(source).toContain('仅处理您拥有或已获授权的图片');
    expect(source).toContain('模型会重绘水印覆盖区域');
  });

  it('does not read downstream material-stage images back into design', () => {
    expect(source).toContain('isDesignAssetImageFileRole');
    expect(source).toContain('isMaterialStageAssetImageFileRole');
    expect(source).toContain('.filter(f => isDesignAssetImageFileRole(f.fileRole)');
    expect(source).toContain('const materialStageUrls = new Set(');
  });

  it('keeps AI generation actions visible in short desktop viewports', () => {
    expect(source).toContain('max-h-[calc(100vh-1.5rem)]');
    expect(source).toContain('sm:max-h-[calc(100vh-2rem)]');
    expect(source).toContain('flex shrink-0 items-center justify-between px-6 pt-6 pb-4');
    expect(source).toContain('min-h-0 flex-1 overflow-y-auto px-6 pb-5');
    expect(source).toContain('flex shrink-0 flex-wrap items-center justify-between');
  });

  it('keeps image-to-image controls on a stable second row', () => {
    expect(source).toContain('mt-3 grid min-h-[44px]');
    expect(source).toContain('xl:w-[556px] xl:justify-end xl:justify-self-end');
    expect(source).toContain('xl:w-[556px] xl:grid-cols-[76px_minmax(0,1fr)] xl:justify-self-end');
    expect(source).toContain('h-9 w-[76px] items-center justify-center');
    expect(source).not.toContain('xl:pl-[84px]');
    expect(source).toContain('invisible pointer-events-none');
    expect(source).toContain('生成张数');
    expect(source).toContain('当前/上传参考图 + 生成图 ≤ 15');
  });

  it('keeps white-background turnaround sheets visibly fixed to 16:9', () => {
    expect(source).toContain("if (enabled) setAspectRatio('16:9')");
    expect(source).toContain('disabled={standardTurnaround && supportsStandardTurnaround(asset.assetType)}');
    expect(source).toContain('固定使用 16:9');
  });

  it('only enables and submits selected references in image-to-image mode', () => {
    expect(source).toContain('disabled={!imageToImageEnabled}');
    expect(source).toContain('if (!imageToImageEnabled) return;');
    expect(source).toContain('references: imageToImageEnabled');
    expect(source).toContain("sequential: imageToImageEnabled ? 'auto' : 'disabled'");
  });

  it('keeps the generation modal open while selecting text or interacting inside it', () => {
    expect(source).toContain('onMouseDown={event => {');
    expect(source).toContain('if (event.target === event.currentTarget) handleClose();');
  });

  it('offers images from other scenes in the current design scope as references', () => {
    expect(source).toContain('assets={designAssets}');
    expect(source).toContain("candidate.assetType === 'scene' && candidate.assetId !== asset.assetId");
    expect(source).toContain("sourceKind: 'related-scene' as const");
    expect(source).toContain("renderReferenceGroup('其他场景参考图（不计参考图额度）', relatedSceneMaterials)");
    expect(source).toContain('来源场景：${material.name');
    expect(source).toContain('selectedQuotaReferenceCount');
    expect(source).toContain('其他场景已选 {selectedRelatedSceneReferenceCount}（不计额度）');
  });

  it('uploads external reference images for supported image-to-image models', () => {
    expect(source).toContain('generationModel.supportsImageToImageBatch && (');
    expect(source).toContain('上传参考图');
    expect(source).toContain('multiple');
    expect(source).toContain("uploadEntityFile(file, 'asset', asset.assetId, 'reference_image'");
    expect(source).toContain("sourceKind: 'external-upload'");
    expect(source).toContain("setSequential('auto')");
  });

  it('requires an explicit second confirmation before deleting an asset', () => {
    expect(source).toContain('const confirmed = await crmConfirm({');
    expect(source).toContain('删除后，该素材及其设计图将从当前分集移除，且无法撤销');
    expect(source).toContain('需要从剧本分镜重新导入');
    expect(source).toContain("confirmText: '确认删除'");
    expect(source).toContain('if (!confirmed) return;');
  });

  it('lets users edit imported role, scene, and prop names and prompts', () => {
    expect(source).toContain('const [editAsset, setEditAsset]');
    expect(source).toContain('<AssetEditModal');
    expect(source).toContain('描述 / AI 提示词');
    expect(source).toContain('name: normalizedName');
    expect(source).toContain('description: nextDescription.trim()');
    expect(source).toContain('名称修改后会同步更新现有镜头中的同名绑定');
  });

  it('defaults refinement to the fast tier and exposes all four public writing tiers', () => {
    expect(source).toContain("LS.get('design_ai_refine_model', AiModel.DeepseekChat)");
    expect(source).toContain('const refineModelOptions = modelOptions');
    expect(source).toContain('buildScriptModelPickerOptions(refineModelOptions');
    expect(source).toContain('designPromptRefinementFallbackCost(getScriptModelBillingKey(option))');
    expect(source).toContain('DESIGN_CREDIT_FEATURES.promptRefinement');
    expect(source).toContain("taskId: newDesignCreditUsageId('design-prompt-refinement')");
  });

  it('uses public image model labels and billing tiers without exposing runtimes', () => {
    expect(source).toContain('buildDesignImageModelPickerOptions()');
    expect(source).toContain('options={generationModelPickerOptions}');
    expect(source).toContain('model: generationModel.billingModel');
    expect(source).not.toContain('{option.label} · {option.runtime}');
  });

  it('applies the selected style at submission and strips saved legacy suffixes', () => {
    expect(source).toContain('const styledPrompt = applyImageStylePreset(basePrompt, activeStyle)');
    expect(source).toContain('prompt: withStandardTurnaround(styledPrompt, asset.assetType, standardTurnaround)');
    expect(source).toContain('detectImageStylePreset(storedPrompt) || savedStyle()');
  });
});
