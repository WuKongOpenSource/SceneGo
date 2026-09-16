import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/MaterialPage.tsx'), 'utf-8');

describe('MaterialPage AI generation modal', () => {
  it('uses the same unified generation controls as the design workspace', () => {
    expect(source).toContain('生成图 / 参考图 (最多 {maxRefs})');
    expect(source).toContain('AI 润色');
    expect(source).toContain('MATERIAL_IMAGE_STYLE_PRESETS.map');
    expect(source).toContain('buildDesignImageModelPickerOptions()');
    expect(source).toContain("generationModel.resolutions.map");
    expect(source).toContain('图生图');
    expect(source).toContain('xl:w-[556px] xl:justify-end xl:justify-self-end');
    expect(source).toContain('xl:w-[556px] xl:grid-cols-[76px_minmax(0,1fr)] xl:justify-self-end');
    expect(source).toContain('h-9 w-[76px] items-center justify-center');
    expect(source).not.toContain('xl:pl-[84px]');
    expect(source).toContain('InlineCreditEstimate');
    expect(source).toContain('options={generationModelPickerOptions}');
    expect(source).not.toContain('{option.label} · {option.runtime}');
    expect(source).toContain('const refineModelOptions = modelOptions');
    expect(source).toContain('designPromptRefinementFallbackCost(getScriptModelBillingKey(option))');
    expect(source).toContain('DESIGN_CREDIT_FEATURES.promptRefinement');
    expect(source).toContain("taskId: newDesignCreditUsageId('material-prompt-refinement')");
  });

  it('keeps white-background turnaround sheets visibly fixed to 16:9', () => {
    expect(source).toContain("if (enabled) setAspectRatio('16:9')");
    expect(source).toContain('disabled={standardTurnaround && supportsStandardTurnaround(config.type)}');
    expect(source).toContain('固定使用 16:9');
  });

  it('keeps the design modal sizing and removes the legacy engine sidebar', () => {
    expect(source).toContain('w-full max-w-5xl flex-col');
    expect(source).toContain('max-h-[calc(100vh-1.5rem)]');
    expect(source).not.toContain('>引擎选择</span>');
    expect(source).not.toContain('grid grid-cols-1 md:grid-cols-3 gap-4');
  });

  it('keeps generation payloads on the existing material workflow', () => {
    expect(source).toContain('handleMaterialAIGeneration');
    expect(source).toContain("generateGeminiImageVariant({");
    expect(source).toContain("generateImageWithPreferredFallback({");
    expect(source).toContain("references: imageToImageEnabled ? references : []");
    expect(source).toContain('assertEnoughCredits(DESIGN_CREDIT_FEATURES.imageGeneration');
    expect(source).toContain("taskId: newDesignCreditUsageId('material-image')");
    expect(source).toContain('billingModel: generationModel.billingModel');
    expect(source).toContain("if (!results.length) throw new Error('未返回图片，本次不扣创作点数')");
  });

  it('applies exactly one selected image style when the request is submitted', () => {
    expect(source).toContain('const styledPrompt = applyImageStylePreset(prompt, activeStyle)');
    expect(source).toContain('prompt: referencePurpose ? styledPrompt : withStandardTurnaround(styledPrompt, config.type, standardTurnaround)');
    expect(source).toContain('stripImageStylePresets(nextStoredPrompt)');
  });
});
