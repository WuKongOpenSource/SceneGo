import { AiModel } from '../types';
import { callAI } from './aiService';
import type { TextTaskContext } from './textTaskContext';

export const STORY_SUMMARY_MAX_CHARACTERS = 100;

const SUMMARY_PROMPT = {
  system: '你是专业的中文故事编辑。只输出概要正文，不要标题、解释、项目符号或 Markdown。',
  user: `阅读下面的完整故事，提炼主要人物、核心冲突、关键行动与结局，写成一段准确连贯的中文故事概要。
概要不得超过 100 个中文字符，不得直接截取原文开头，不得补写原文没有的情节。

完整故事：
{story}`,
};

const LYRICS_PROMPT = {
  system: '你是专业的中文影视歌曲作词人。只输出可演唱的歌词正文，不要解释、标题标记或 Markdown 代码块。',
  user: `请根据下面的故事概要创作一首结构完整、情绪连贯的中文歌词。
歌词应包含主歌与副歌，避免复述提示语，不得虚构与故事主题冲突的情节。

故事概要：
{summary}`,
};

function stripFormatting(value: string): string {
  return String(value || '')
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function unicodeLength(value: string): number {
  return Array.from(value || '').length;
}

export function clampUnicode(value: string, limit: number): string {
  return Array.from(value || '').slice(0, Math.max(0, limit)).join('');
}

export function normalizeStorySummary(value: string): string {
  const normalized = stripFormatting(value)
    .replace(/^\s*(?:故事)?(?:概要|梗概|摘要)\s*[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clampUnicode(normalized, STORY_SUMMARY_MAX_CHARACTERS);
}

export async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function generateStorySummary(
  story: string,
  taskContext?: TextTaskContext,
): Promise<string> {
  if (!story.trim()) throw new Error('剧本内容为空，无法生成故事概要');
  const response = await callAI(
    AiModel.DeepseekChat,
    SUMMARY_PROMPT,
    { story },
    undefined,
    taskContext,
  );
  const summary = normalizeStorySummary(response);
  if (!summary) throw new Error('文本模型未返回有效故事概要，请重试');
  return summary;
}

export async function generateLyricsFromSummary(
  summary: string,
  taskContext?: TextTaskContext,
): Promise<string> {
  const normalizedSummary = normalizeStorySummary(summary);
  if (!normalizedSummary) throw new Error('请先填写或生成故事概要');
  const response = await callAI(
    AiModel.DeepseekChat,
    LYRICS_PROMPT,
    { summary: normalizedSummary },
    undefined,
    taskContext,
  );
  const lyrics = stripFormatting(response);
  if (!lyrics) throw new Error('文本模型未返回有效歌词，请重试');
  return lyrics;
}
