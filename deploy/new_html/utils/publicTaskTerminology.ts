import type { TaskKind } from '../types';
import { getModelDisplayName } from '../services/videoModelService';

const PUBLIC_SCRIPT_LABELS = {
  tier1: 'MiniMax-M3 · 连续写作模型',
  tier2: 'deepseek-v4-flash · 快速写作模型',
  tier3: 'deepseek-v4-pro · 推理写作模型',
  tier4: 'gemini-2.5-flash · 全能写作模型',
} as const;

const PUBLIC_IMAGE_LABELS = {
  tier1: 'Gemini 2.5 Flash Image · 快速生图模型',
  tier2: 'Gemini 3.1 Flash Image Preview · 高质量生图模型',
  tier3: 'Doubao-Seedream-5.0-lite · 参考图生图模型',
  tier4Hd: 'GPT Image 2 VIP · 高清生图模型',
  tier4All: 'GPT Image 2 · 全能生图模型',
} as const;

/**
 * Task history used to persist provider/runtime names in display_name/title.
 * Keep operation text, expose the real model/version, and translate old tier
 * aliases without rewriting historical rows. Protected tokens prevent a
 * replacement label that contains the model name from being replaced twice.
 */
export function formatPublicTaskText(value: unknown, kind?: TaskKind): string {
  let text = String(value || '').trim();
  if (!text) return '';
  const protectedLabels: string[] = [];
  const protect = (label: string): string => {
    const token = `\uE000${protectedLabels.length}\uE001`;
    protectedLabels.push(label);
    return token;
  };
  const replace = (pattern: RegExp, label: string): void => {
    text = text.replace(pattern, () => protect(label));
  };

  const imageContext = String(kind || '').includes('image')
    || /图像|图片|生图|image|seedream|doubao|豆包/i.test(text);

  if (imageContext) {
    replace(/三阶\s*·\s*参考图生图模型/g, PUBLIC_IMAGE_LABELS.tier3);
    replace(/二阶\s*·\s*高质量生图模型/g, PUBLIC_IMAGE_LABELS.tier2);
    replace(/一阶\s*·\s*快速生图模型/g, PUBLIC_IMAGE_LABELS.tier1);
    replace(/四阶\s*·\s*高清生图模型/g, PUBLIC_IMAGE_LABELS.tier4Hd);
    replace(/四阶\s*·\s*全能生图模型/g, PUBLIC_IMAGE_LABELS.tier4All);
    replace(/(?:doubao[\s_-]*)?seedream[\w.\s_-]*/gi, PUBLIC_IMAGE_LABELS.tier3);
    replace(/豆包(?:图像|图片)?(?:生成)?/g, PUBLIC_IMAGE_LABELS.tier3);
    replace(/doubao(?:\s*(?:image|图像|图片))?(?:\s*生成)?/gi, PUBLIC_IMAGE_LABELS.tier3);
    replace(/gemini[\s_-]*2\.5[\s_-]*flash[\s_-]*image/gi, PUBLIC_IMAGE_LABELS.tier1);
    replace(/gemini[\s_-]*3(?:\.\d+)?[\s_-]*(?:pro|flash)?[\s_-]*image(?:[\s_-]*preview)?/gi, PUBLIC_IMAGE_LABELS.tier2);
    replace(/gemini(?:[\s_-]*(?:image|图像|图片))?(?:\s*生成)?/gi, 'Gemini 生图任务');
    replace(/gpt[\s_-]*image[\s_-]*(?:2[\s_-]*vip|vip)/gi, PUBLIC_IMAGE_LABELS.tier4Hd);
    replace(/gpt[\s_-]*image[\s_-]*(?:official|2)/gi, PUBLIC_IMAGE_LABELS.tier4All);
    replace(/gpt[\s_-]*image/gi, PUBLIC_IMAGE_LABELS.tier4All);
    replace(/qwen(?:n)?[\s_-]*lora/gi, 'Qwen Image Edit 2509 + Lightning LoRA · 风格强化模型');
    replace(/qwen(?:n)?(?:[\s_-]*image)?/gi, 'Qwen Image Edit 2509 · 多参考图模型');
    replace(/kontext(?:[\s_-]*v?2)?/gi, 'Kontext v2 · 高质量生图模型');
    replace(/nanobanana/gi, 'Gemini 3.1 Flash Image Preview · 快速生图模型');
  } else {
    replace(/一阶\s*·\s*连续写作模型/g, PUBLIC_SCRIPT_LABELS.tier1);
    replace(/二阶\s*·\s*快速写作模型/g, PUBLIC_SCRIPT_LABELS.tier2);
    replace(/三阶\s*·\s*推理写作模型/g, PUBLIC_SCRIPT_LABELS.tier3);
    replace(/四阶\s*·\s*全能写作模型/g, PUBLIC_SCRIPT_LABELS.tier4);
    replace(/deepseek[\s_-]*(?:reasoner|r1|v4[\s_-]*pro)\s*文本生成/gi, PUBLIC_SCRIPT_LABELS.tier3);
    replace(/deepseek[\s_-]*(?:chat|v4[\s_-]*flash)?\s*文本生成/gi, PUBLIC_SCRIPT_LABELS.tier2);
    replace(/minimax[\s_-]*m3\s*文本生成/gi, PUBLIC_SCRIPT_LABELS.tier1);
    replace(/gemini(?:[\s_-]*2\.5[\s_-]*flash)?\s*文本生成/gi, PUBLIC_SCRIPT_LABELS.tier4);
    replace(/deepseek[\s_-]*(?:reasoner|r1|v4[\s_-]*pro)/gi, PUBLIC_SCRIPT_LABELS.tier3);
    replace(/deepseek[\s_-]*(?:chat|v4[\s_-]*flash)/gi, PUBLIC_SCRIPT_LABELS.tier2);
    replace(/deepseek/gi, PUBLIC_SCRIPT_LABELS.tier2);
    replace(/minimax[\s_-]*m3/gi, PUBLIC_SCRIPT_LABELS.tier1);
    replace(/gemini(?:[\s_-]*2\.5[\s_-]*flash)?/gi, PUBLIC_SCRIPT_LABELS.tier4);
  }

  replace(/minimax[\s_-]*h3[\s_-]*(?:fl2va)?(?:[\s_-]*fast|\s*\+\s*sageattention)/gi, getModelDisplayName('MiniMaxH3Fast'));
  replace(/minimax[\s_-]*h3[\s_-]*(?:fl2va)?(?:[\s_-]*(?:mini|1b)|\s*\+\s*qwen3[\s_-]*vl[\s_-]*4b[\s_-]*clipproj)/gi, getModelDisplayName('MiniMaxH3Mini'));
  replace(/minimax[\s_-]*h3(?:[\s_-]*fl2va)?/gi, getModelDisplayName('MiniMaxH3'));
  replace(/(?:doubao[\s_-]*)?seedance[\s_-]*2(?:[.\s_-]*0)?[\s_-]*fast(?:[\s_-]*\d+)?/gi, getModelDisplayName('Seedance2Fast'));
  replace(/(?:doubao[\s_-]*)?seedance[\s_-]*2(?:[.\s_-]*0)?[\s_-]*mini(?:[\s_-]*\d+)?/gi, getModelDisplayName('Seedance2Mini'));
  replace(/(?:doubao[\s_-]*)?seedance(?:[\s_-]*2(?:[.\s_-]*0)?(?:[\s_-]*\d+)?)?/gi, getModelDisplayName('Seedance2'));
  replace(/wan[\s_-]*2(?:\.\d+)?(?:[\s_-]*i2v)?/gi, getModelDisplayName('大能'));
  replace(/happy[\s_-]*horse(?:[\s_.-]*1\.0[\s_-]*r2v)?/gi, getModelDisplayName('HappyHorse'));
  replace(/kling(?:[\/\s_-]*kling[\s_-]*v?3(?:[\s_-]*(?:omni|video[\s_-]*generation))?)?/gi, getModelDisplayName('Kling'));
  replace(/vidu(?:[\/\w.\s_-]*)?/gi, getModelDisplayName('Vidu'));
  replace(/sora[\s_-]*(?:video)?2(?:[\w.\s_-]*)?/gi, getModelDisplayName('Sora2'));
  replace(/veo(?:[\s_-]*3(?:\.1)?(?:[\w.\s_-]*)?)?/gi, getModelDisplayName('Veo'));

  const cleaned = text
    .replace(/\s*API\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/(?:\s*·\s*){2,}/g, ' · ')
    .trim();
  return cleaned.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => (
    protectedLabels[Number(index)] || ''
  ));
}
