import { describe, expect, it } from 'vitest';

import {
  getStoryboardGenerationModelOption,
  STORYBOARD_GENERATION_MODEL_OPTIONS,
} from '../../utils/storyboardGenerationModels';

describe('storyboard generation model catalog', () => {
  it('keeps all stable operation identifiers while exposing model versions and capabilities', () => {
    expect(STORYBOARD_GENERATION_MODEL_OPTIONS.map(option => option.value)).toEqual([
      'doubao',
      'doubao_pro',
      'nanobanana',
      'gpt_image_vip',
      'gpt_image_official',
      'qwen',
      'qwen_lora',
      'kontext',
      'qwenN',
      'qwenN_lora',
    ]);
    expect(STORYBOARD_GENERATION_MODEL_OPTIONS.map(option => option.label)).toEqual([
      'Doubao-Seedream-5.0-lite · 参考图生图模型',
      'Doubao-Seedream-5.0-Pro · 分镜生图模型',
      'Gemini 3.1 Flash Image Preview · 快速生图模型',
      'GPT Image 2 VIP · 高清生图模型',
      'GPT Image 2 · 全能生图模型',
      'Qwen Image Edit 2509 · 本地节点多参考图模型',
      'Qwen Image Edit 2509 + Lightning LoRA · 本地节点风格强化模型',
      'Kontext V2 · 本地节点高质量生图模型',
      'Qwen Image Edit 2509 · 本地节点连贯编辑模型',
      'Qwen Image Edit 2509 + Lightning LoRA · 本地节点风格增强模型',
    ]);
  });

  it('derives processing-cluster models from capability metadata', () => {
    expect(
      STORYBOARD_GENERATION_MODEL_OPTIONS
        .filter(option => option.requiresCluster)
        .map(option => option.value),
    ).toEqual(['qwen', 'qwen_lora', 'kontext', 'qwenN', 'qwenN_lora']);
    expect(getStoryboardGenerationModelOption('doubao').requiresCluster).toBe(false);
    expect(getStoryboardGenerationModelOption('doubao').hint).toContain('后台配置');
    expect(getStoryboardGenerationModelOption('qwenN').hint).toContain('上下文连贯');
    expect(getStoryboardGenerationModelOption('gpt_image_official').hint).toContain('质量设置');
  });

  it('lists online API models before local processing-cluster models', () => {
    const capabilities = STORYBOARD_GENERATION_MODEL_OPTIONS.map(option => option.requiresCluster);
    expect(capabilities).toEqual([false, false, false, false, false, true, true, true, true, true]);
    expect(getStoryboardGenerationModelOption('kontext').label).toContain('本地节点');
  });
});
