import { describe, expect, it } from 'vitest';
import { compactImageModelLabel, compactImageSourceLabel } from '../../utils/imageSourceDisplay';
import { buildDesignImageModelPickerOptions, buildStoryboardModelPickerOptions } from '../../components/modelPickerCatalogs';
import { DESIGN_IMAGE_MODEL_OPTIONS } from '../../utils/designImageModels';
import { STORYBOARD_GENERATION_MODEL_OPTIONS } from '../../utils/storyboardGenerationModels';

describe('compact image display names', () => {
  it.each([
    ['Gemini 3.1-flash-image Preview · 文生图', 'Gemini · 文生图'],
    ['Gemini 2.5 Flash Image · 图生图', 'Gemini · 图生图'],
    ['doubao · 图生图', 'Seedream · 图生图'],
    ['Doubao-Seedream-5.0-lite · 文生图', 'Seedream 5.0 Lite · 文生图'],
    ['Seedream 5.0 Pro · 图生图', 'Seedream 5.0 Pro · 图生图'],
    ['外部上传 · 来源待确认', '外部上传 · 来源待确认'],
    ['模型未记录', '模型未记录'],
    ['GPT Image 2 · 文生图', 'GPT Image 2 · 文生图'],
  ])('formats %s without inventing a generation method', (input, expected) => {
    expect(compactImageSourceLabel(input)).toBe(expected);
  });

  it('keeps the verified Gemini versions in pickers and all model identities unchanged', () => {
    const originals = JSON.stringify(DESIGN_IMAGE_MODEL_OPTIONS);
    const options = buildDesignImageModelPickerOptions();
    expect(options.map(item => item.value)).toEqual(DESIGN_IMAGE_MODEL_OPTIONS.map(item => item.id));
    expect(options.map(item => item.runtimeLabel)).toContain('Gemini 3.1');
    expect(options.map(item => item.runtimeLabel)).toContain('Gemini 2.5');
    expect(JSON.stringify(options)).not.toContain('Gemini 3.2');
    expect(JSON.stringify(DESIGN_IMAGE_MODEL_OPTIONS)).toBe(originals);
    expect(compactImageModelLabel('Gemini 3.1 Flash Image Preview · 高质量生图模型')).toBe('Gemini 3.1 · 高质量生图模型');
    const storyboards = buildStoryboardModelPickerOptions(STORYBOARD_GENERATION_MODEL_OPTIONS, false);
    expect(storyboards.find(item => item.value === 'nanobanana')?.label).toBe('Gemini 3.1 · 快速生图模型');
    expect(storyboards.find(item => item.value === 'qwen')?.available).toBe(false);
  });
});
