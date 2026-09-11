import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateDoubaoImages = vi.fn();
const generateGeminiImageVariant = vi.fn();

vi.mock('../../services/doubaoService', () => ({
  generateDoubaoImages: (...args: any[]) => generateDoubaoImages(...args),
}));
vi.mock('../../services/geminiImageGenerationService', () => ({
  generateGeminiImageVariant: (...args: any[]) => generateGeminiImageVariant(...args),
}));

import {
  generateImageWithPreferredFallback,
  IMAGE_FALLBACK_MODEL,
  PREFERRED_IMAGE_MODEL,
} from '../../services/preferredImageGenerationService';

const options = (overrides: Record<string, any> = {}) => ({
  engine: 'doubao' as const,
  model: PREFERRED_IMAGE_MODEL,
  billingModel: 'image_tier_3',
  count: 1,
  doubao: { prompt: 'story', references: [], size: '2K' },
  gemini: { prompt: 'story', references: [], imageSize: '2K' as const },
  ...overrides,
});

describe('preferred image generation fallback', () => {
  beforeEach(() => {
    generateDoubaoImages.mockReset();
    generateGeminiImageVariant.mockReset();
  });

  it('uses Seedream without calling Gemini when the preferred provider succeeds', async () => {
    generateDoubaoImages.mockResolvedValue([{ url: 'doubao.png' }]);
    const result = await generateImageWithPreferredFallback(options());
    expect(result.actualEngine).toBe('doubao');
    expect(result.fallbackReason).toBeUndefined();
    expect(generateGeminiImageVariant).not.toHaveBeenCalled();
  });

  it('falls back exactly once to Gemini 3.1 on a definitive unavailable response', async () => {
    generateDoubaoImages.mockRejectedValue(Object.assign(new Error('unavailable'), { status: 503 }));
    generateGeminiImageVariant.mockResolvedValue([{ url: 'gemini.png' }]);
    const result = await generateImageWithPreferredFallback(options());
    expect(result.actualModel).toBe(IMAGE_FALLBACK_MODEL);
    expect(result.actualBillingModel).toBe('image_tier_2');
    expect(generateGeminiImageVariant).toHaveBeenCalledTimes(1);
    expect(generateGeminiImageVariant.mock.calls[0][0].model).toBe(IMAGE_FALLBACK_MODEL);
  });

  it.each([504, 422, 403])('does not duplicate work for non-fallback status %s', async status => {
    generateDoubaoImages.mockRejectedValue(Object.assign(new Error('blocked'), { status }));
    await expect(generateImageWithPreferredFallback(options())).rejects.toThrow('blocked');
    expect(generateGeminiImageVariant).not.toHaveBeenCalled();
  });

  it('does not drop excess references to fit the fallback model', async () => {
    generateDoubaoImages.mockRejectedValue(Object.assign(new Error('unavailable'), { status: 503 }));
    const references = Array.from({ length: 7 }, (_, index) => `ref-${index}.png`);
    await expect(generateImageWithPreferredFallback(options({
      doubao: { prompt: 'story', references },
      gemini: { prompt: 'story', references },
    }))).rejects.toThrow('unavailable');
    expect(generateGeminiImageVariant).not.toHaveBeenCalled();
  });
});
