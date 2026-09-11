import { describe, expect, it } from 'vitest';
import { buildStoryboardModelPickerOptions } from '../../components/modelPickerCatalogs';
import { STORYBOARD_GENERATION_MODEL_OPTIONS } from '../../utils/storyboardGenerationModels';

describe('storyboard model capability preflight', () => {
  it('disables an unavailable online model with its server reason', () => {
    const options = buildStoryboardModelPickerOptions(
      STORYBOARD_GENERATION_MODEL_OPTIONS,
      true,
      { gpt_image_vip: { available: false, reason: '上游供应商余额不足' } },
    );
    const vip = options.find(option => option.value === 'gpt_image_vip');
    expect(vip?.available).toBe(false);
    expect(vip?.unavailableReason).toBe('上游供应商余额不足');
  });
});
