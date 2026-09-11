import type { StoryboardGenerationModel } from './storyboardConsistency';

export interface StoryboardGenerationModelOption {
  value: StoryboardGenerationModel;
  label: string;
  shortLabel: string;
  hint: string;
  requiresCluster: boolean;
}
// Creator-facing labels expose the actual model/version while stable operation
// IDs remain internal so existing projects and queued tasks stay compatible.
// Online API models stay first. Processing-cluster models are grouped below and
// explicitly identify themselves as local-node models without bracket prefixes.
export const STORYBOARD_GENERATION_MODEL_OPTIONS: readonly StoryboardGenerationModelOption[] = [
  {
    value: 'doubao',
    label: 'Doubao-Seedream-5.0-lite · 参考图生图模型',
    shortLabel: 'Doubao-Seedream-5.0-lite · 参考优先',
    hint: '参考图一致性优先，走后台配置的豆包生图接口',
    requiresCluster: false,
  },
  {
    value: 'doubao_pro',
    label: 'Doubao-Seedream-5.0-Pro · 分镜生图模型',
    shortLabel: 'Doubao-Seedream-5.0-Pro',
    hint: '支持文生图与图生图；人像分镜请启用纯文生图原图模式',
    requiresCluster: false,
  },
  {
    value: 'nanobanana',
    label: 'Gemini 3.1 Flash Image Preview · 快速生图模型',
    shortLabel: 'Gemini 3.1 Flash · 快速',
    hint: '速度优先，适合快速预览和批量出图',
    requiresCluster: false,
  },
  {
    value: 'gpt_image_vip',
    label: 'GPT Image 2 VIP · 高清生图模型',
    shortLabel: 'GPT Image 2 VIP · 高清',
    hint: '高清输出优先，支持比例和分辨率设置',
    requiresCluster: false,
  },
  {
    value: 'gpt_image_official',
    label: 'GPT Image 2 · 全能生图模型',
    shortLabel: 'GPT Image 2 · 全能',
    hint: '综合能力优先，支持比例、分辨率和质量设置',
    requiresCluster: false,
  },
  {
    value: 'qwen',
    label: 'Qwen Image Edit 2509 · 本地节点多参考图模型',
    shortLabel: 'Qwen Image Edit 2509 · 本地节点多参考',
    hint: '多参考图一致性优先，适合人物与场景组合',
    requiresCluster: true,
  },
  {
    value: 'qwen_lora',
    label: 'Qwen Image Edit 2509 + Lightning LoRA · 本地节点风格强化模型',
    shortLabel: 'Qwen 2509 + LoRA · 本地节点风格',
    hint: '风格表现优先，适合统一视觉风格',
    requiresCluster: true,
  },
  {
    value: 'kontext',
    label: 'Kontext V2 · 本地节点高质量生图模型',
    shortLabel: 'Kontext V2 · 本地节点高质量',
    hint: '质量优先，适合正式分镜画面',
    requiresCluster: true,
  },
  {
    value: 'qwenN',
    label: 'Qwen Image Edit 2509 · 本地节点连贯编辑模型',
    shortLabel: 'Qwen Image Edit 2509 · 本地节点连贯',
    hint: '上下文连贯优先，适合基于单图延续画面',
    requiresCluster: true,
  },
  {
    value: 'qwenN_lora',
    label: 'Qwen Image Edit 2509 + Lightning LoRA · 本地节点风格增强模型',
    shortLabel: 'Qwen 2509 + LoRA · 本地节点风格增强',
    hint: '兼顾画面质量与风格一致性',
    requiresCluster: true,
  },
] as const;

export function getStoryboardGenerationModelOption(
  value: StoryboardGenerationModel,
): StoryboardGenerationModelOption {
  return STORYBOARD_GENERATION_MODEL_OPTIONS.find(option => option.value === value)
    || STORYBOARD_GENERATION_MODEL_OPTIONS[0];
}
