import { describe, expect, it, vi } from 'vitest';
import {
  DESIGN_CREDIT_DEFAULTS,
  DESIGN_CREDIT_FEATURES,
  designImageCreditParams,
  designImageFallbackCost,
  designOperationCreditParams,
  designPromptRefinementCreditParams,
  designPromptRefinementFallbackCost,
  newDesignCreditUsageId,
} from '../../utils/designCredits';

describe('designCredits', () => {
  it('defines independently configurable design feature keys and defaults', () => {
    expect(DESIGN_CREDIT_FEATURES).toEqual({
      imageGeneration: 'design_image_generation',
      promptRefinement: 'design_prompt_refinement',
      angleAdjustment: 'design_angle_adjustment',
      multiAngleGeneration: 'design_multi_angle_generation',
      upscaleHd: 'design_upscale_hd',
    });
    expect(DESIGN_CREDIT_DEFAULTS).toEqual({
      imageGenerationPerImage: 8,
      onlineImageOperation: 60,
      promptRefinement: 1,
      angleAdjustment: 5,
      multiAngleGeneration: 60,
      upscaleHd: 5,
    });
  });

  it('uses the public model-tier and resolution point matrix for fallback quotes', () => {
    expect(designImageFallbackCost('image_tier_1', '1K', 1)).toBe(8);
    expect(designImageFallbackCost('image_tier_2', '1K', 1)).toBe(12);
    expect(designImageFallbackCost('image_tier_2', '2K', 1)).toBe(18);
    expect(designImageFallbackCost('image_tier_2', '4K', 2)).toBe(52);
    expect(designImageFallbackCost('image_tier_3', '1K', 1)).toBe(5);
    expect(designImageFallbackCost('image_tier_3', '2K', 1)).toBe(10);
    expect(designImageFallbackCost('image_tier_3', '4K', 1)).toBe(15);
  });

  it('keeps prompt refinement within four credits across public writing tiers', () => {
    expect(designPromptRefinementCreditParams('script_tier_3')).toEqual({
      model: 'script_tier_3',
    });
    expect(designPromptRefinementFallbackCost('script_tier_1')).toBe(1);
    expect(designPromptRefinementFallbackCost('script_tier_2')).toBe(2);
    expect(designPromptRefinementFallbackCost('script_tier_3')).toBe(3);
    expect(designPromptRefinementFallbackCost('script_tier_4')).toBe(4);
    expect(designPromptRefinementFallbackCost('unknown')).toBe(1);
  });

  it('normalizes image counts while retaining model parameters', () => {
    expect(designImageCreditParams({
      imageCount: 2.9,
      model: 'gemini-2.5-flash-image',
      resolution: '2K',
      aspectRatio: '16:9',
    })).toEqual({
      image_count: 2,
      model: 'gemini-2.5-flash-image',
      resolution: '2K',
      aspect_ratio: '16:9',
    });
  });

  it('builds operation params and unique usage ids', () => {
    expect(designOperationCreditParams('angle_adjustment')).toEqual({
      operation_count: 1,
      workflow: 'angle_adjustment',
    });
    expect(designOperationCreditParams('human_multi_angle')).toEqual({
      operation_count: 1,
      workflow: 'human_multi_angle',
      output_count: 14,
    });
    vi.stubGlobal('crypto', { randomUUID: () => 'usage-1' });
    expect(newDesignCreditUsageId('design-image')).toBe('design-image:usage-1');
    vi.unstubAllGlobals();
  });
});
