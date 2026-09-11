import type { StoryboardItem } from '../types';

export type ScriptAssetType = 'character' | 'scene' | 'prop';

export interface ScriptAssetDescriptionRow {
  name: string;
  description: string;
}

const VISUAL_FIELD_PREFIX = /^(?:画面描述|分镜生成提示词|视觉化描述|角色设定|人物设定|场景设定|道具设定)\s*[：:]\s*/;
const NON_VISUAL_FIELD = /^(?:分段\s*\d+|镜头(?:号)?\s*\d|时间|时长|景别|拍摄角度|摄像机角度|运镜方式|镜头运动|光影色调|画质|转场|人声|台词|音效|人物名称|场景名称|道具名称|视频提示词)\s*[：:]/;
const MAX_DESCRIPTION_LENGTH = 900;

function normalizeName(value: unknown): string {
  return String(value || '').replace(/\s+/g, '').trim();
}

function namesMatch(left: string, right: string): boolean {
  const a = normalizeName(left);
  const b = normalizeName(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function cleanVisualText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !NON_VISUAL_FIELD.test(line))
    .map(line => line.replace(VISUAL_FIELD_PREFIX, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function visualFieldsFromBlock(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  const results: string[] = [];
  let current: string[] | null = null;

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (VISUAL_FIELD_PREFIX.test(line)) {
      if (current?.length) results.push(cleanVisualText(current.join(' ')));
      current = [line];
      continue;
    }
    if (NON_VISUAL_FIELD.test(line) || /^[^：:]{1,12}[：:]/.test(line)) {
      if (current?.length) results.push(cleanVisualText(current.join(' ')));
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  if (current?.length) results.push(cleanVisualText(current.join(' ')));
  return results.filter(Boolean);
}

function itemAssetNames(item: StoryboardItem, assetType: ScriptAssetType): string[] {
  if (assetType === 'character') return item.characters || [];
  if (assetType === 'scene') return item.scene ? [item.scene] : [];
  return item.props || [];
}

function itemVisualSources(item: StoryboardItem): string[] {
  return [
    item.imagePrompt,
    item.scriptSegment,
    ...visualFieldsFromBlock(item.videoScriptBlock),
    ...visualFieldsFromBlock(item.originalText),
  ]
    .map(cleanVisualText)
    .filter(Boolean);
}

function namedScriptFragments(scriptText: string, name: string): string[] {
  return String(scriptText || '')
    .replace(/([。！？；])/g, '$1\n')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.includes(name) && !NON_VISUAL_FIELD.test(line))
    .map(cleanVisualText)
    .filter(Boolean);
}

function compactUnique(fragments: string[]): string {
  const kept: string[] = [];
  const keys: string[] = [];
  let length = 0;

  for (const fragment of fragments) {
    const text = fragment.replace(/^[，,；;。\s]+|[，,；;\s]+$/g, '').trim();
    const key = text.replace(/[\s，,；;。！？!?]/g, '');
    if (!key || keys.some(existing => existing === key || existing.includes(key))) continue;
    if (length + text.length + (kept.length ? 1 : 0) > MAX_DESCRIPTION_LENGTH) continue;
    kept.push(text);
    keys.push(key);
    length += text.length + (kept.length > 1 ? 1 : 0);
  }
  return kept.join('；');
}

/**
 * Builds deterministic design prompts from the adopted script and its generated shot data.
 * The exporter must carry concrete user/script descriptions forward without invoking another
 * model, and a later export must remain stable for the same storyboard.
 */
export function buildScriptAssetDescriptionRows(
  assetType: ScriptAssetType,
  names: string[],
  items: StoryboardItem[],
  scriptText = '',
): ScriptAssetDescriptionRow[] {
  return names
    .map(name => name.trim())
    .filter(Boolean)
    .map(name => {
      const fragments: string[] = [];
      for (const item of items) {
        const assignedNames = itemAssetNames(item, assetType).filter(Boolean);
        const sources = itemVisualSources(item);
        const joinedSources = sources.join('\n');
        const assigned = assignedNames.some(candidate => namesMatch(candidate, name));
        if (!assigned && !joinedSources.includes(name)) continue;

        for (const source of sources) {
          if (source.includes(name) || assignedNames.length <= 1) fragments.push(source);
        }
      }
      fragments.push(...namedScriptFragments(scriptText, name));
      return { name, description: compactUnique(fragments) };
    });
}
