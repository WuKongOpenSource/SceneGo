import type { ScriptSegment, StoryboardItem } from '../types';
import { parseStoryboardScript } from './storyboardParser';
import {
  formatHierarchicalShotNumber,
  formatVideoScriptShotNumber,
  parseHierarchicalShotNumber,
  stripVideoScriptGroupPromptSections,
} from './scriptPipelineParsers';

const TARGET_SEGMENT_DURATION_SECONDS = 15;
const DEFAULT_SHOT_DURATION_SECONDS = 3;

const DIALOGUE_CJK_CHARS_PER_SECOND = 4;
const DIALOGUE_LATIN_CHARS_PER_SECOND = 8;


export function estimateDialogueDurationSeconds(text: string): number {
  const value = String(text || '').trim();
  if (!value) return 0;
  const cjkCount = (value.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const latinCount = (value.match(/[A-Za-z0-9]/g) || []).length;
  return cjkCount / DIALOGUE_CJK_CHARS_PER_SECOND + latinCount / DIALOGUE_LATIN_CHARS_PER_SECOND;
}


function getDialogueTextForEstimate(item: StoryboardItem): string {
  if (item.dialogue?.trim()) return item.dialogue;

  const text = item.originalText?.trim() || item.videoScriptBlock?.trim() || item.scriptSegment || '';
  const quoted = text.match(/["「『“][^"」』”]*["」』”]/g);
  return quoted ? quoted.join('\n') : '';
}

export interface StoryboardSegmentEntry {
  item: StoryboardItem;
  globalIndex: number;
  localShotNo: number;
  localShotLabel: string;
}

export interface StoryboardSegmentGroup {
  key: string;
  segmentNo: number;
  segmentLabel: string;
  estimatedDurationSec: number;
  sourceText?: string;
  inferred: boolean;
  entries: StoryboardSegmentEntry[];
}

export interface StoryboardSegmentLookupEntry {
  segmentKey: string;
  segmentNo: number;
  segmentLabel: string;
  localShotNo: number;
  localShotLabel: string;
  estimatedDurationSec: number;
  isFirstInSegment: boolean;
}

/**
 * Removes Markdown decorations commonly found in historical model replies
 * without changing the underlying script stored in the database.
 */
export function cleanStoryboardDisplayLine(line: string): string {
  let value = String(line || '').trim();
  if (!value) return '';

  value = value
    .replace(/^>\s*/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/^(?:[-+*]\s+|\d+[.)、]\s+)/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();

  return value;
}

export function cleanStoryboardDisplayText(content: string): string {
  return String(content || '')
    .split(/\r?\n/)
    .map(cleanStoryboardDisplayLine)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Uses the immutable conversation reply as the display source while retaining
 * persistence identifiers from the stored storyboard items. Older database
 * rows may only contain a shortened scene/action summary, while `content`
 * still contains the complete shot fields shown to the user.
 */
function parseStoryboardDisplayItems(content: string): StoryboardItem[] {
  const value = String(content || '').trim();
  if (!value) return [];

  const blocks: Array<{ text: string; segmentNo?: number }> = [];
  let activeSegmentNo: number | undefined;
  let currentSegmentNo: number | undefined;
  let currentLines: string[] = [];

  const flush = () => {
    const text = stripVideoScriptGroupPromptSections(currentLines.join('\n'));
    if (text) blocks.push({ text, segmentNo: currentSegmentNo });
    currentLines = [];
    currentSegmentNo = undefined;
  };

  value.split(/\r?\n/).forEach((line) => {
    const trimmed = cleanStoryboardDisplayLine(line);
    const segmentMatch = trimmed.match(/^(?:分段|段落)\s*0*(\d+)\s*$/);
    if (segmentMatch) {
      flush();
      activeSegmentNo = Number.parseInt(segmentMatch[1], 10);
      return;
    }
    if (/^---CUT---$/.test(trimmed)) {
      flush();
      return;
    }
    if (/^(?:镜头|分镜)\s*\d+(?:\s*[-－—]\s*\d+)?\s*$/.test(trimmed)) {
      flush();
      const parsedShotNo = parseHierarchicalShotNumber(trimmed);
      currentSegmentNo = activeSegmentNo || parsedShotNo?.segmentNo || undefined;
      currentLines = [trimmed];
      return;
    }
    if (currentLines.length > 0) currentLines.push(trimmed);
  });
  flush();

  if (blocks.length === 0) return parseStoryboardScript(value).shots;

  return blocks.map((block, index) => {
    const parsed = parseStoryboardScript(block.text).shots[0];
    const parsedShotNo = parseHierarchicalShotNumber(block.text);
    const segmentNo = block.segmentNo || parsedShotNo?.segmentNo || 1;
    const localShotNo = parsedShotNo?.localShotNo || index + 1;
    const shotNumber = formatHierarchicalShotNumber(segmentNo, localShotNo);
    const sourceShotNumber = /^\s*分镜/.test(block.text.trim())
      ? formatVideoScriptShotNumber(segmentNo, localShotNo)
      : shotNumber;
    const fallback: StoryboardItem = {
      id: `storyboard-display-${index + 1}`,
      originalText: block.text,
      scriptSegment: block.text,
      imagePrompt: '',
      videoPrompt: '',
      dialogue: '',
      characters: [],
      shotNumber,
      sourceVideoShotNo: sourceShotNumber,
    };
    return {
      ...(parsed || fallback),
      originalText: block.text,
      shotNumber,
      sourceVideoShotNo: sourceShotNumber,
      scriptSegmentId: segmentNo
        ? `storyboard-segment-${segmentNo}`
        : parsed?.scriptSegmentId,
    };
  });
}

export function mergeStoryboardDisplayItems(
  content: string,
  persistedItems: StoryboardItem[] = [],
): StoryboardItem[] {
  const parsedItems = parseStoryboardDisplayItems(content);
  if (parsedItems.length === 0) return persistedItems;

  return parsedItems.map((parsedItem, index) => {
    const persistedItem = persistedItems[index];
    if (!persistedItem) return parsedItem;
    return {
      ...persistedItem,
      ...parsedItem,
      id: persistedItem.id,
      scriptSegmentId: parsedItem.scriptSegmentId || persistedItem.scriptSegmentId,
    };
  });
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizePositiveIntegerSeconds(value: unknown): number | null {
  const parsed = positiveNumber(value);
  return parsed === null ? null : Math.max(1, Math.round(parsed));
}

export function getStoryboardItemDurationSeconds(item: StoryboardItem): number {
  const planned = positiveNumber(item.plannedDurationMs);
  if (planned) return planned / 1000;

  const direct = positiveNumber(item.duration);
  if (direct) return direct;

  const text = [item.originalText, item.videoScriptBlock, item.scriptSegment]
    .filter(Boolean)
    .join('\n');
  const match = text.match(/(?:时间|时长)(?:\s*[（(]秒[)）])?\s*[：:]\s*(\d+(?:\.\d+)?)\s*秒?/);
  const explicit = positiveNumber(match?.[1]);
  if (explicit) return explicit;

  // Dialogue duration is the fallback lower bound when no explicit duration exists.
  const dialogueSeconds = estimateDialogueDurationSeconds(getDialogueTextForEstimate(item));
  return Math.max(dialogueSeconds, DEFAULT_SHOT_DURATION_SECONDS);
}

function makeSyntheticSegmentId(segmentNo: number): string {
  return `storyboard-segment-${segmentNo}`;
}

function replaceShotHeader(value: string, segmentNo: number, localShotNo: number): string {
  const label = formatHierarchicalShotNumber(segmentNo, localShotNo);
  const text = String(value || '').trim();
  if (!text) return label;
  return /^\s*(?:镜头|分镜)\s*\d+(?:\s*[-－—]\s*\d+)?/m.test(text)
    ? text.replace(/^\s*(?:镜头|分镜)\s*\d+(?:\s*[-－—]\s*\d+)?/m, label)
    : `${label}\n${text}`;
}

/**
 * Fills the segment metadata used by the whole storyboard workflow.
 * Existing Stage 1/2 segment ids are preserved. Legacy flat storyboards are
 * grouped sequentially near the 15-second model limit.
 */
export function normalizeStoryboardSegmentMetadata(
  items: StoryboardItem[],
  scriptSegments: ScriptSegment[] = [],
): StoryboardItem[] {
  const segmentOrderById = new Map(
    [...scriptSegments]
      .sort((a, b) => a.order - b.order)
      .map((segment, index) => [segment.id, index + 1]),
  );
  const orderedSegmentIds = [...scriptSegments]
    .sort((a, b) => a.order - b.order)
    .map(segment => segment.id);
  let nextSegmentNo = 1;
  const encounteredSegmentNos = new Map<string, number>();
  let currentKey = '';
  let currentDuration = 0;
  let currentSegmentNo = 0;

  return items.map((item) => {
    if (item.isPlaceholder) return item;

    const duration = getStoryboardItemDurationSeconds(item);
    const explicitKey = String(item.scriptSegmentId || '').trim();
    if (explicitKey) {
      if (!encounteredSegmentNos.has(explicitKey)) {
        const knownNo = segmentOrderById.get(explicitKey);
        while ([...encounteredSegmentNos.values()].includes(nextSegmentNo)) nextSegmentNo += 1;
        const assignedNo = knownNo || nextSegmentNo;
        encounteredSegmentNos.set(explicitKey, assignedNo);
        nextSegmentNo = Math.max(nextSegmentNo, assignedNo + 1);
      }
      if (currentKey !== explicitKey) currentDuration = 0;
      currentKey = explicitKey;
      currentSegmentNo = encounteredSegmentNos.get(explicitKey)!;
    } else if (!currentKey || (currentDuration > 0 && currentDuration + duration > TARGET_SEGMENT_DURATION_SECONDS)) {
      while ([...encounteredSegmentNos.values()].includes(nextSegmentNo)) nextSegmentNo += 1;
      currentSegmentNo = nextSegmentNo++;
      currentKey = orderedSegmentIds[currentSegmentNo - 1] || makeSyntheticSegmentId(currentSegmentNo);
      currentDuration = 0;
      encounteredSegmentNos.set(currentKey, currentSegmentNo);
    }

    currentDuration += duration;
    return {
      ...item,
      scriptSegmentId: currentKey,
    };
  });
}

export function buildStoryboardSegmentGroups(
  items: StoryboardItem[],
  scriptSegments: ScriptSegment[] = [],
): StoryboardSegmentGroup[] {
  const normalized = normalizeStoryboardSegmentMetadata(items, scriptSegments)
    .filter(item => !item.isPlaceholder);
  const sourceById = new Map(scriptSegments.map(segment => [segment.id, segment]));
  const groups: StoryboardSegmentGroup[] = [];
  const byKey = new Map<string, StoryboardSegmentGroup>();

  normalized.forEach((item, globalIndex) => {
    const key = item.scriptSegmentId || makeSyntheticSegmentId(groups.length + 1);
    let group = byKey.get(key);
    if (!group) {
      const source = sourceById.get(key);
      group = {
        key,
        segmentNo: groups.length + 1,
        segmentLabel: `分段${groups.length + 1}`,
        estimatedDurationSec: 0,
        sourceText: source?.sourceText,
        inferred: !source && !items.some(row => row.scriptSegmentId === key),
        entries: [],
      };
      groups.push(group);
      byKey.set(key, group);
    }
    const localShotNo = group.entries.length + 1;
    group.entries.push({
      item,
      globalIndex,
      localShotNo,
      localShotLabel: formatHierarchicalShotNumber(group.segmentNo, localShotNo),
    });
    group.estimatedDurationSec += getStoryboardItemDurationSeconds(item);
  });

  return groups;
}

const DEFAULT_SEGMENT_VISUAL_STYLE = '电影感竖屏构图，统一角色、场景、服装与光影风格';
const DEFAULT_SEGMENT_STABILITY = '角色身份和造型稳定，五官与肢体自然，动作连贯，主体清晰，无字幕、无水印、无Logo';

function extractPromptSection(prompt: string, label: '视觉风格' | '正向稳定约束'): string {
  const nextLabel = label === '视觉风格' ? '正向稳定约束' : '';
  const pattern = nextLabel
    ? new RegExp(`【${label}】([\\s\\S]*?)(?=【${nextLabel}】|$)`)
    : new RegExp(`【${label}】([\\s\\S]*)$`);
  return String(prompt || '')
    .match(pattern)?.[1]
    ?.replace(/^[，,：:\s]+|[，,\s]+$/g, '')
    .replace(/。{2,}$/g, '。')
    .trim() || '';
}

export interface StoryboardSegmentPromptSections {
  visualStyle: string;
  stabilityConstraint: string;
}

export function getStoryboardSegmentPromptSections(
  group: StoryboardSegmentGroup,
): StoryboardSegmentPromptSections {
  const explicit = group.entries
    .map(entry => String(entry.item.videoPrompt || '').trim())
    .find(prompt => prompt.includes('【视觉风格】') || prompt.includes('【正向稳定约束】')) || '';
  return {
    visualStyle: extractPromptSection(explicit, '视觉风格'),
    stabilityConstraint: extractPromptSection(explicit, '正向稳定约束'),
  };
}

export function cleanStoryboardShotCardText(value: string): string {
  const lines = stripVideoScriptGroupPromptSections(value)
    .split(/\r?\n/)
    .filter(line => !/^\s*视频提示词\s*[：:]/.test(line))
    .map(line => line.trimEnd());
  const firstContentLine = lines.findIndex(line => line.trim());
  if (
    firstContentLine >= 0
    && /^(?:镜头|分镜)\s*\d+(?:\s*[-－—–]\s*\d+)?\s*$/.test(cleanStoryboardDisplayLine(lines[firstContentLine]))
  ) {
    lines.splice(firstContentLine, 1);
  }
  return lines.join('\n').trim();
}

function extractVisualStyleFromShot(item: StoryboardItem): string {
  const text = [item.originalText, item.videoScriptBlock]
    .filter(Boolean)
    .join('\n');
  return text.match(/光影色调\s*[：:]\s*([^\n]+)/)?.[1]?.trim()
    || text.match(/氛围与特效\s*[：:]\s*([^\n]+)/)?.[1]?.trim()
    || DEFAULT_SEGMENT_VISUAL_STYLE;
}

function buildSharedSegmentVideoPrompt(group: StoryboardSegmentGroup): string {
  const promptSections = getStoryboardSegmentPromptSections(group);
  const visualStyle = promptSections.visualStyle
    || extractVisualStyleFromShot(group.entries[0]?.item);
  const stability = promptSections.stabilityConstraint
    || DEFAULT_SEGMENT_STABILITY;
  const firstShot = formatHierarchicalShotNumber(group.segmentNo, 1);
  const lastShot = formatHierarchicalShotNumber(group.segmentNo, Math.max(1, group.entries.length));
  const shotRange = firstShot === lastShot ? firstShot : `${firstShot}至${lastShot}`;
  const normalizedVisualStyle = visualStyle.replace(/[，,；;\s]+$/g, '');
  const normalizedStability = stability.replace(/[，,。；;！？\s]+$/g, '');
  const promptSeparator = /[。！？]$/.test(normalizedVisualStyle) ? '' : '，';
  return `${shotRange}，【视觉风格】${normalizedVisualStyle}${promptSeparator}【正向稳定约束】${normalizedStability}。`;
}

function writeSharedVideoPrompt(originalText: string, prompt: string): string {
  const value = String(originalText || '').trim();
  if (!value) return `视频提示词：${prompt}`;
  if (/^视频提示词\s*[：:]/m.test(value)) {
    return value.replace(/^视频提示词\s*[：:][^\n]*/m, `视频提示词：${prompt}`);
  }
  return `${value}\n视频提示词：${prompt}`;
}

/**
 * One segment is rendered as one video from multiple generated stills.
 * Keep every shot in that segment on the exact same video prompt even when
 * the model omits the field or returns inconsistent shot-level text.
 */
export function synchronizeStoryboardSegmentVideoPrompts(
  items: StoryboardItem[],
  scriptSegments: ScriptSegment[] = [],
): StoryboardItem[] {
  const normalized = normalizeStoryboardSegmentMetadata(items, scriptSegments);
  const promptByItemId = new Map<string, string>();

  buildStoryboardSegmentGroups(normalized, scriptSegments).forEach((group) => {
    const prompt = buildSharedSegmentVideoPrompt(group);
    group.entries.forEach(entry => promptByItemId.set(entry.item.id, prompt));
  });

  return normalized.map((item) => {
    if (item.isPlaceholder) return item;
    const prompt = promptByItemId.get(item.id);
    if (!prompt) return item;
    return {
      ...item,
      videoPrompt: prompt,
      originalText: writeSharedVideoPrompt(
        item.originalText || item.videoScriptBlock || item.scriptSegment,
        prompt,
      ),
    };
  });
}

export function buildStoryboardSegmentLookup(
  items: StoryboardItem[],
  scriptSegments: ScriptSegment[] = [],
): Map<string, StoryboardSegmentLookupEntry> {
  const lookup = new Map<string, StoryboardSegmentLookupEntry>();
  buildStoryboardSegmentGroups(items, scriptSegments).forEach((group) => {
    group.entries.forEach((entry, index) => {
      lookup.set(entry.item.id, {
        segmentKey: group.key,
        segmentNo: group.segmentNo,
        segmentLabel: group.segmentLabel,
        localShotNo: entry.localShotNo,
        localShotLabel: entry.localShotLabel,
        estimatedDurationSec: group.estimatedDurationSec,
        isFirstInSegment: index === 0,
      });
    });
  });
  return lookup;
}

/** Keeps persistence ids globally unique while using one canonical hierarchical shot label everywhere. */
export function normalizeStoryboardItemsForWorkflow(
  items: StoryboardItem[],
  scriptSegments: ScriptSegment[] = [],
): StoryboardItem[] {
  const normalized = normalizeStoryboardSegmentMetadata(items, scriptSegments);
  const lookup = buildStoryboardSegmentLookup(normalized, scriptSegments);
  return normalized.map((item) => {
    if (item.isPlaceholder) return item;
    const segment = lookup.get(item.id);
    const durationSeconds = normalizePositiveIntegerSeconds(getStoryboardItemDurationSeconds(item)) || 1;
    const shotNumber = segment
      ? formatHierarchicalShotNumber(segment.segmentNo, segment.localShotNo)
      : String(item.shotNumber || item.sourceVideoShotNo || '');
    return {
      ...item,
      shotNumber,
      originalText: segment
        ? replaceShotHeader(
            item.originalText || item.videoScriptBlock || item.scriptSegment,
            segment.segmentNo,
            segment.localShotNo,
          )
        : item.originalText,
      sourceVideoShotNo: item.sourceVideoShotNo || shotNumber || '',
      plannedDurationMs: durationSeconds * 1000,
      duration: `${durationSeconds}秒`,
    };
  });
}

/** Serializes the canonical segmented script persisted in conversation versions. */
export function serializeStoryboardItemsWithSegments(
  items: StoryboardItem[],
  scriptSegments: ScriptSegment[] = [],
): string {
  const synchronized = synchronizeStoryboardSegmentVideoPrompts(items, scriptSegments);
  return buildStoryboardSegmentGroups(synchronized, scriptSegments)
    .flatMap(group => [
      `分段${group.segmentNo}`,
      ...group.entries.flatMap(entry => [
        replaceShotHeader(
          entry.item.originalText || entry.item.videoScriptBlock || entry.item.scriptSegment,
          group.segmentNo,
          entry.localShotNo,
        ),
        '---CUT---',
      ]),
    ])
    .join('\n')
    .trim();
}
