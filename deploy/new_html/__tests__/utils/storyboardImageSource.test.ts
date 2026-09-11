import { describe, expect, it } from 'vitest';
import { storyboardImageSource, storyboardImageSourceLabel } from '../../utils/storyboardImageSource';

describe('per-image storyboard source', () => {
  it('identifies a recorded local mirror without guessing the selected model', () => {
    expect(storyboardImageSourceLabel(storyboardImageSource({ source: 'local_transform', transform: 'horizontal_mirror' }))).toBe('水平镜像');
    expect(storyboardImageSourceLabel(storyboardImageSource({ source: 'local_transform' }))).toBe('模型未记录');
  });
  it('reads actual saved model ahead of the old UI model field', () => {
    const saved = { model: 'doubao-seedream-5.0-lite', storyboard_generation_model: 'doubao_pro' };
    expect(storyboardImageSource(saved).generationModel).toBe('doubao-seedream-5.0-lite');
    expect(storyboardImageSourceLabel(storyboardImageSource(saved))).toBe('Doubao-Seedream-5.0-lite');
  });

  it('uses the original model record without changing provenance or media bytes', () => {
    const saved = { source: 'doubao', model: 'doubao_pro', seedance_provenance: {
      model: 'doubao-seedream-5-0-lite-260128', sha256: 'unchanged', signature: 'unchanged',
    } };
    const before = JSON.stringify(saved);
    expect(storyboardImageSourceLabel(storyboardImageSource(saved))).toBe('Doubao-Seedream-5.0-lite');
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('keeps externally uploaded images external even if stale model metadata exists', () => {
    const source = storyboardImageSource({ source: 'upload', model: 'doubao', seedance_provenance: { model: 'doubao_pro' } });
    expect(source).toEqual({ source: 'upload', generationModel: undefined });
    expect(storyboardImageSourceLabel(source)).toBe('外部上传');
  });

  it('restores labels after metadata JSON reload', () => {
    expect(storyboardImageSourceLabel(storyboardImageSource('{"source":"upload"}'))).toBe('外部上传');
    expect(storyboardImageSourceLabel(storyboardImageSource('{"storyboard_generation_model":"qwen_lora"}'))).toBe('Qwen 2509 + LoRA');
  });

  it.each([undefined, null, '', '{bad', [], { model: {} }, { source: 'doubao' }])('does not guess a model or upload source for missing/malformed metadata %j', value => {
    expect(storyboardImageSourceLabel(storyboardImageSource(value))).toBe('模型未记录');
  });

  it.each([
    ['doubao', 'Doubao-Seedream-5.0-lite'], ['doubao_pro', 'Doubao-Seedream-5.0-Pro'],
    ['doubao-seedream-5-0-pro-260628', 'Doubao-Seedream-5.0-Pro'],
    ['nanobanana', 'Gemini 3.1 Flash'], ['gpt_image_official', 'GPT Image 2'],
    ['gpt_image_vip', 'GPT Image 2 VIP'], ['kontext', 'Kontext V2'],
    ['i2i_fj', '角度调整'], ['horizontal_mirror', '水平镜像'],
    ['gpt-image-1', 'gpt-image-1'], ['custom-model-v9', 'custom-model-v9'],
  ])('formats %s without replacing historical/unknown model versions', (generationModel, expected) => {
    expect(storyboardImageSourceLabel({ generationModel })).toBe(expected);
  });
});
