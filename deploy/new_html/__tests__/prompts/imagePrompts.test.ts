import { describe, expect, it } from 'vitest';

import {
  IMAGE_QUALITY_SUFFIX,
  applyImageStylePreset,
  detectImageStylePreset,
  imageRefinementConstraints,
  stripImageStylePresets,
  validateRefinedImageAge,
} from '../../prompts/imagePrompts';
import { withStandardTurnaround } from '../../utils/assetGenerationStandards';

describe('image style presets', () => {
  it('replaces a legacy anime suffix with strong photorealistic constraints', () => {
    const result = applyImageStylePreset(
      `school boy${IMAGE_QUALITY_SUFFIX.anime}`,
      'realistic',
    );

    expect(result).toContain('真实演员');
    expect(result).toContain('real human subject');
    expect(result).toContain('No anime');
    expect(result).toContain('不继承动漫或插画画风');
    expect(result).not.toContain('ray tracing');
    expect(result).not.toContain('anime style, vibrant colors');
    expect(result).not.toContain('cel shading, photorealistic');
  });

  it('is idempotent when the same style is applied repeatedly', () => {
    const once = applyImageStylePreset('school boy', 'realistic');
    expect(applyImageStylePreset(once, 'realistic')).toBe(once);
  });

  it('removes common Chinese and English cartoon-style conflicts in realistic mode', () => {
    const result = applyImageStylePreset(
      '校服男孩，动漫风格, anime style, cel shading',
      'realistic',
    );

    expect(result).not.toContain('动漫风格');
    expect(result).not.toContain('anime style');
    expect(result).not.toMatch(/cel shading, photorealistic/i);
    expect(result).toContain('live-action photographic image');
  });

  it('keeps the original animation wording when animation is selected', () => {
    const original = '少年角色，手绘逐帧动画质感，柔和赛璐片色彩';
    const result = applyImageStylePreset(original, 'anime');

    expect(result).toContain(original);
    expect(result).toContain(IMAGE_QUALITY_SUFFIX.anime.replace(/^,\s*/, ''));
    expect(result).not.toContain('live-action photographic image');
    expect(result).not.toContain('真实演员');
  });

  it('removes legacy forced anime service text without changing the subject', () => {
    const result = stripImageStylePresets(
      'school boy\n\nStyle: High quality Anime/Manga screenshot, detailed background, cinematic lighting.',
    );

    expect(result).toBe('school boy');
  });

  it('recovers the selected style from an old saved prompt before stripping it', () => {
    const oldPrompt = 'school boy, photorealistic, cinematic lighting, depth of field, ray tracing';

    expect(detectImageStylePreset(oldPrompt)).toBe('realistic');
    expect(stripImageStylePresets(oldPrompt)).toBe('school boy');
  });

  it('replaces repeated application-owned styles without deleting clothing patterns', () => {
    const description = '约25岁的唐代文人，月白素袍，袖口有水墨山水暗纹。';
    const legacy = `${description}${IMAGE_QUALITY_SUFFIX.anime}${IMAGE_QUALITY_SUFFIX.anime}`;
    const result = applyImageStylePreset(legacy, 'realistic');

    expect(result).toContain(description);
    expect(result).not.toContain('anime style, vibrant colors');
    expect(result.match(/\[IMAGE_STYLE\]/g)).toHaveLength(1);
    expect(stripImageStylePresets(result)).toBe(description);
  });

  it('carries style, age and white-canvas requirements into refinement', () => {
    const system = imageRefinementConstraints('realistic', 'character', true);
    expect(system).toContain('年龄');
    expect(system).toContain('不得改写或遗漏');
    expect(system).toContain('真实演员');
    expect(system).toContain('包括放大的正面半身肖像');
    expect(system).toContain('不添加烛火');
    expect(imageRefinementConstraints('watercolor', 'scene', true)).toContain('不要添加人物');
    expect(imageRefinementConstraints('realistic', 'character', false)).not.toContain('白底四视图素材');
  });

  it('rejects numeric age omission or changes before accepting refinement', () => {
    const original = '一位约25岁的唐代文人，清瘦儒雅。';
    expect(() => validateRefinedImageAge(original, '45岁的唐代文人')).toThrow('本次不扣创作点数');
    expect(() => validateRefinedImageAge(original, '唐代文人，清瘦儒雅')).toThrow('未保留原定年龄');
    expect(() => validateRefinedImageAge(original, '约25岁的文人，麻布白袍')).not.toThrow();
    expect(() => validateRefinedImageAge('古代文人', '约60岁的文人')).not.toThrow();
  });

  it('keeps every turnaround view on one white canvas and preserves requested old age', () => {
    const result = withStandardTurnaround(applyImageStylePreset('60岁老人，有白胡须', 'realistic'), 'character');
    expect(result).toContain('60岁老人，有白胡须');
    expect(result).toContain('especially Panel 4');
    expect(result).toContain('same seamless pure white (#FFFFFF) canvas');
    expect(result).toContain('No separate portrait rectangle');
    expect(result).not.toContain('25岁');
  });
});
