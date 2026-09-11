



import { describe, it, expect } from 'vitest';
import {
  recommendGptImageSize,
  resolveGptImageSettings,
  GPT_IMAGE_RATIO_OPTIONS,
  GPT_IMAGE_K_OPTIONS,
  GPT_IMAGE_QUALITY_OPTIONS,
  GEMINI_NANO2_RATIO_OPTIONS,
  GEMINI_NANO2_SIZE_OPTIONS,
} from '../../utils/gptImageSizeMap';

describe('recommendGptImageSize', () => {
  it('1:1 + 1K → 1024x1024（标准方形）', () => {
    expect(recommendGptImageSize('1:1', '1K')).toBe('1024x1024');
  });

  it('16:9 + 2K → 2688x1536（横屏高清）', () => {
    expect(recommendGptImageSize('16:9', '2K')).toBe('2688x1536');
  });

  it('9:16 + 4K → 3072x5376（竖屏超清）', () => {
    expect(recommendGptImageSize('9:16', '4K')).toBe('3072x5376');
  });

  it('21:9 + 1K → 1536x640（超宽屏）', () => {
    expect(recommendGptImageSize('21:9', '1K')).toBe('1536x640');
  });

  it('ratio=auto → 始终返回 "auto"', () => {
    expect(recommendGptImageSize('auto', '1K')).toBe('auto');
    expect(recommendGptImageSize('auto', '4K')).toBe('auto');
    expect(recommendGptImageSize('auto', 'auto')).toBe('auto');
  });

  it('K=auto → 始终返回 "auto"', () => {
    expect(recommendGptImageSize('1:1', 'auto')).toBe('auto');
    expect(recommendGptImageSize('16:9', 'auto')).toBe('auto');
  });

  it('每个非 auto ratio 都覆盖 1K/2K/4K 三档', () => {
    const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '5:4', '4:5'] as const;
    const ks = ['1K', '2K', '4K'] as const;
    for (const r of ratios) {
      for (const k of ks) {
        const size = recommendGptImageSize(r, k);
        expect(size).toMatch(/^\d{3,4}x\d{3,4}$/);
        expect(size).not.toBe('auto');
      }
    }
  });

  it('2K 像素积大约是 1K 的 4 倍（1 megapixel → 4 megapixel）', () => {
    const ratios = ['1:1', '16:9', '9:16'] as const;
    for (const r of ratios) {
      const [w1k, h1k] = recommendGptImageSize(r, '1K').split('x').map(Number);
      const [w2k, h2k] = recommendGptImageSize(r, '2K').split('x').map(Number);
      const ratio = (w2k * h2k) / (w1k * h1k);

      expect(ratio).toBeGreaterThan(3.5);
      expect(ratio).toBeLessThan(4.5);
    }
  });
});

describe('resolveGptImageSettings', () => {
  it('没有参考素材时稳定回落到标准 16:9 1K', () => {
    expect(resolveGptImageSettings('auto', 'auto')).toEqual({
      ratio: '16:9',
      k: '1K',
      sourceDimensions: null,
    });
  });

  it('按像素面积最大的参考素材推导比例和分辨率档位', () => {
    expect(resolveGptImageSettings('auto', 'auto', [
      { width: 1024, height: 1024 },
      { width: 1920, height: 1080 },
      { width: 640, height: 480 },
    ])).toEqual({
      ratio: '16:9',
      k: '1K',
      sourceDimensions: { width: 1920, height: 1080 },
    });
  });

  it('使用最接近最大参考图的受支持比例', () => {
    expect(resolveGptImageSettings('auto', '1K', [
      { width: 1200, height: 1600 },
    ])).toMatchObject({
      ratio: '3:4',
      k: '1K',
    });
  });

  it('超过 2K 档长边的参考素材使用 4K', () => {
    expect(resolveGptImageSettings('auto', 'auto', [
      { width: 3200, height: 1800 },
    ])).toMatchObject({
      ratio: '16:9',
      k: '4K',
    });
  });

  it('用户显式选择的比例和档位优先于自动推导', () => {
    expect(resolveGptImageSettings('9:16', '1K', [
      { width: 4096, height: 2160 },
    ])).toMatchObject({
      ratio: '9:16',
      k: '1K',
    });
  });

  it('忽略无效尺寸', () => {
    expect(resolveGptImageSettings('auto', 'auto', [
      { width: 0, height: 1080 },
      { width: Number.NaN, height: 720 },
    ])).toEqual({
      ratio: '16:9',
      k: '1K',
      sourceDimensions: null,
    });
  });
});

describe('option arrays', () => {
  it('GPT_IMAGE_RATIO_OPTIONS 第一项是 auto', () => {
    expect(GPT_IMAGE_RATIO_OPTIONS[0].value).toBe('auto');
    expect(GPT_IMAGE_RATIO_OPTIONS[0].label).toContain('最大参考图');
  });

  it('GPT_IMAGE_K_OPTIONS 第一项是 auto', () => {
    expect(GPT_IMAGE_K_OPTIONS[0].value).toBe('auto');
  });

  it('GPT_IMAGE_QUALITY_OPTIONS 第一项是 auto（默认值约定）', () => {
    expect(GPT_IMAGE_QUALITY_OPTIONS[0].value).toBe('auto');
  });

  it('所有图像模型共用自动选项，但提交前会解析为确定值', () => {
    expect(GEMINI_NANO2_RATIO_OPTIONS[0]).toEqual(GPT_IMAGE_RATIO_OPTIONS[0]);
    expect(GEMINI_NANO2_SIZE_OPTIONS[0]).toEqual(GPT_IMAGE_K_OPTIONS[0]);
    expect(resolveGptImageSettings('auto', 'auto', [{ width: 2048, height: 1152 }]))
      .toMatchObject({ ratio: '16:9', k: '2K' });
  });

  it('共用尺寸选项包含自动与 1K/2K/4K', () => {
    expect(GEMINI_NANO2_SIZE_OPTIONS.map(o => o.value)).toEqual(['auto', '1K', '2K', '4K']);
  });
});
