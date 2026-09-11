import { describe, expect, it } from 'vitest';
import {
  canUseDesignImageReferences,
  countDesignImageQuotaReferences,
  DESIGN_IMAGE_BATCH_LIMIT,
  DESIGN_IMAGE_MODEL_OPTIONS,
  findDesignImageModel,
  isDesignImageReferenceQuotaExempt,
  maxDesignImageOutputCount,
  normalizeDesignImageResolution,
  trimDesignImageReferenceSelectionToQuota,
} from '../../utils/designImageModels';

describe('design image model capabilities', () => {
  it('exposes the three runtime models with their capability suffixes', () => {
    expect(DESIGN_IMAGE_MODEL_OPTIONS.map(option => option.label)).toEqual([
      'Doubao-Seedream-5.0-lite · 参考图生图模型',
      'Gemini 3.1 Flash Image Preview · 高质量生图模型',
      'Gemini 2.5 Flash Image · 快速生图模型',
    ]);
    expect(DESIGN_IMAGE_MODEL_OPTIONS.map(option => option.runtime)).toEqual([
      'Doubao-Seedream-5.0-lite',
      'Gemini 3.1 Flash Image Preview',
      'Gemini 2.5 Flash Image',
    ]);
    expect(DESIGN_IMAGE_MODEL_OPTIONS.map(option => option.hint)).toEqual([
      '参考优先',
      '质量优先',
      '速度优先',
    ]);
    expect(DESIGN_IMAGE_MODEL_OPTIONS.map(option => option.billingModel)).toEqual([
      'image_tier_3',
      'image_tier_2',
      'image_tier_1',
    ]);
    expect(DESIGN_IMAGE_MODEL_OPTIONS[0].id).toBe('doubao-seedream-5-0-lite-260128');
  });

  it('only offers resolutions supported by each model', () => {
    const fastGemini = findDesignImageModel('nanobanana', 'gemini-2.5-flash-image');
    const qualityGemini = findDesignImageModel('nanobanana', 'gemini-3-pro-image-preview');
    const doubao = findDesignImageModel('doubao', '');

    expect(fastGemini.resolutions).toEqual(['1K']);
    expect(qualityGemini.resolutions).toEqual(['1K', '2K', '4K']);
    expect(doubao.resolutions).toEqual(['1K', '2K', '4K']);
    expect(doubao.supportsImageToImageBatch).toBe(true);
    expect(fastGemini.supportsImageToImageBatch).toBe(false);
  });

  it('only enables references after image-to-image is selected on a capable model', () => {
    const doubao = findDesignImageModel('doubao', '');
    const gemini = findDesignImageModel('nanobanana', 'gemini-2.5-flash-image');

    expect(canUseDesignImageReferences(doubao, false)).toBe(false);
    expect(canUseDesignImageReferences(doubao, true)).toBe(true);
    expect(canUseDesignImageReferences(gemini, true)).toBe(false);
  });

  it('keeps reference and generated image counts within the provider batch limit', () => {
    expect(DESIGN_IMAGE_BATCH_LIMIT).toBe(15);
    expect(maxDesignImageOutputCount(0)).toBe(15);
    expect(maxDesignImageOutputCount(6)).toBe(9);
    expect(maxDesignImageOutputCount(14)).toBe(1);
  });

  it('does not charge related-scene references against the selectable reference quota', () => {
    const references = [
      { id: 'current', sourceKind: 'current' as const },
      { id: 'upload', sourceKind: 'external-upload' as const },
      { id: 'related-a', sourceKind: 'related-scene' as const },
      { id: 'related-b', sourceKind: 'related-scene' as const },
    ];

    expect(isDesignImageReferenceQuotaExempt('related-scene')).toBe(true);
    expect(countDesignImageQuotaReferences(
      ['current', 'upload', 'related-a', 'related-b'],
      references,
    )).toBe(2);
    expect(maxDesignImageOutputCount(2)).toBe(13);
  });

  it('preserves related-scene references while trimming quota-consuming selections', () => {
    const references = [
      { id: 'current-a', sourceKind: 'current' as const },
      { id: 'related-a', sourceKind: 'related-scene' as const },
      { id: 'upload-a', sourceKind: 'external-upload' as const },
      { id: 'related-b', sourceKind: 'related-scene' as const },
    ];

    expect(Array.from(trimDesignImageReferenceSelectionToQuota(
      references.map(reference => reference.id),
      references,
      1,
    ))).toEqual(['current-a', 'related-a', 'related-b']);
  });

  it('falls back to the model default when a persisted resolution is unsupported', () => {
    const fastGemini = findDesignImageModel('nanobanana', 'gemini-2.5-flash-image');
    expect(normalizeDesignImageResolution(fastGemini, '4K')).toBe('1K');
  });
});
