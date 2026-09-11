import {
  parseVideoScriptGroups,
} from './scriptPipelineParsers';
import type {
  ScriptConversation,
  ScriptConversationMessage,
  ScriptStoryboardVersion,
  VideoScriptGroup,
} from '../types';

export interface ScriptIterationMessage {
  role: 'user' | 'assistant';
  content: string;
}

const normalizeWhitespace = (value: string): string =>
  String(value || '').replace(/\s+/g, ' ').trim();

export function buildScriptIterationContext(
  messages: ScriptIterationMessage[],
  maxCharacters = 2400,
): string {
  if (!messages.length) return '（首次修改，无历史意见）';

  const lines = messages
    .slice(-10)
    .map((message) => {
      const speaker = message.role === 'user' ? '用户' : '系统';
      const content = normalizeWhitespace(message.content);
      return content ? `${speaker}：${content}` : '';
    })
    .filter(Boolean);

  const context = lines.join('\n');
  if (context.length <= maxCharacters) return context;
  return `…${context.slice(context.length - maxCharacters)}`;
}

const VERSION_CONTEXT_ANCHOR_PATTERN = /^(?:人物名称|场景名称|道具名称|视频提示词)\s*[:：]|【(?:视觉风格|正向稳定约束)】/;

function versionCanBeAnIterationBase(version: ScriptStoryboardVersion): boolean {
  return (version.status === 'draft' || version.status === 'ready') && Boolean(version.content.trim());
}

function isVersionDescendantOf(
  version: ScriptStoryboardVersion,
  ancestorVersionId: string,
  versionById: Map<string, ScriptStoryboardVersion>,
): boolean {
  const visited = new Set<string>();
  let cursor: ScriptStoryboardVersion | undefined = version;
  while (cursor && !visited.has(cursor.id)) {
    if (cursor.id === ancestorVersionId) return true;
    visited.add(cursor.id);
    cursor = cursor.baseVersionId ? versionById.get(cursor.baseVersionId) : undefined;
  }
  return false;
}

/**
 * Continue an unconfirmed revision chain instead of jumping back to the last
 * adopted version. Drafts from another branch are ignored after the user
 * explicitly switches the adopted version.
 */
export function selectScriptIterationBaseVersion(
  conversation: ScriptConversation,
): ScriptStoryboardVersion | undefined {
  const eligibleVersions = conversation.versions
    .filter(versionCanBeAnIterationBase)
    .sort((left, right) => left.versionNo - right.versionNo);
  const currentVersion = eligibleVersions.find(version => version.id === conversation.currentVersionId);
  const versionById = new Map(eligibleVersions.map(version => [version.id, version]));
  const chainedDraft = [...eligibleVersions]
    .reverse()
    .find(version => (
      version.status === 'draft'
      && (!currentVersion || isVersionDescendantOf(version, currentVersion.id, versionById))
    ));
  return chainedDraft || currentVersion || eligibleVersions[eligibleVersions.length - 1];
}

function findVersionInstruction(
  version: ScriptStoryboardVersion,
  messageById: Map<string, ScriptConversationMessage>,
): string {
  if (version.versionNo <= 1 || !version.messageId) return '';
  const assistantMessage = messageById.get(version.messageId);
  const instructionMessage = assistantMessage?.replyToMessageId
    ? messageById.get(assistantMessage.replyToMessageId)
    : undefined;
  return instructionMessage?.role === 'user'
    ? normalizeWhitespace(instructionMessage.content)
    : '';
}

function extractVersionAnchors(content: string, maxCharacters = 700): string {
  const anchors = [...new Set(
    String(content || '')
      .split(/\r?\n/)
      .map(line => normalizeWhitespace(line))
      .filter(line => VERSION_CONTEXT_ANCHOR_PATTERN.test(line)),
  )];
  const joined = anchors.join('；');
  if (joined.length <= maxCharacters) return joined;
  return `${joined.slice(0, maxCharacters)}…`;
}

function compactVersionContextBlock(
  version: ScriptStoryboardVersion,
  messageById: Map<string, ScriptConversationMessage>,
  versionById: Map<string, ScriptStoryboardVersion>,
): string {
  const baseVersion = version.baseVersionId ? versionById.get(version.baseVersionId) : undefined;
  const sourceLabel = baseVersion ? `V${baseVersion.versionNo}` : '初始输入';
  const statusLabel = version.status === 'draft' ? '未采纳草稿' : '已采纳/可用';
  const instruction = findVersionInstruction(version, messageById);
  const anchors = extractVersionAnchors(version.content);
  return [
    `V${version.versionNo}（${statusLabel}，来源 ${sourceLabel}）`,
    instruction ? `对应修改要求：${instruction}` : '对应修改要求：初始生成基线',
    anchors ? `必须继承的内容关键词：${anchors}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Build a version-aware prompt context. Legacy rows may all point to the same
 * adopted base, so ordered earlier non-rejected versions are retained as a
 * compatibility chain instead of relying only on baseVersionId ancestry.
 */
export function buildScriptVersionChainContext(
  conversation: ScriptConversation,
  baseVersion: ScriptStoryboardVersion | undefined,
  maxCharacters = 6400,
): string {
  if (!baseVersion) {
    return buildScriptIterationContext(
      conversation.messages.filter((message): message is ScriptConversationMessage & ScriptIterationMessage => (
        message.role === 'user' || message.role === 'assistant'
      )),
      maxCharacters,
    );
  }

  const messageById = new Map(conversation.messages.map(message => [message.id, message]));
  const versionById = new Map(conversation.versions.map(version => [version.id, version]));
  const versions = conversation.versions
    .filter(version => (
      versionCanBeAnIterationBase(version)
      && version.versionNo <= baseVersion.versionNo
    ))
    .sort((left, right) => left.versionNo - right.versionNo);
  const header = [
    '【版本继承链】',
    `本轮当前正文基线：V${baseVersion.versionNo}（version_id=${baseVersion.id}）`,
    '规则：下列各版本的修改要求和内容关键词按顺序累积继承；只有更晚一轮对同一目标的明确要求可以覆盖更早要求，未点名内容不得回退或丢失。',
  ].join('\n');
  const footer = '\n【本轮执行】直接修改上面的当前正文基线，不要重新从最初剧本生成。';
  const available = Math.max(0, maxCharacters - header.length - footer.length - 2);
  const selectedBlocks: string[] = [];
  let used = 0;

  for (const version of [...versions].reverse()) {
    const block = compactVersionContextBlock(version, messageById, versionById);
    const separatorLength = selectedBlocks.length > 0 ? 2 : 0;
    if (used + separatorLength + block.length > available) {
      if (selectedBlocks.length === 0 && available > 0) {
        selectedBlocks.push(`${block.slice(0, Math.max(0, available - 1))}…`);
      }
      break;
    }
    selectedBlocks.push(block);
    used += separatorLength + block.length;
  }

  const orderedBlocks = selectedBlocks.reverse();
  const omittedCount = Math.max(0, versions.length - orderedBlocks.length);
  const omission = omittedCount > 0 ? `\n已省略更早的 ${omittedCount} 个版本正文锚点；其未被覆盖的约束仍然有效。` : '';
  return `${header}\n\n${orderedBlocks.join('\n\n')}${omission}${footer}`;
}

export function normalizeScriptIterationResult(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

const LOCKED_SCOPE_PATTERN = /(?:不变|保持(?:不变|原样)|原样保留|不要(?:改|修改|调整|改变)|不得(?:改|修改|调整|改变))/;
const CHANGED_SCOPE_PATTERN = /(?:修改|调整|改成|变成|拆成|拆分|增加|延长|加长|缩短|合并|删除|重做|重写)/;
const GLOBAL_SCOPE_PATTERN = /(?:整体|全部|所有|全篇|全局|整份|通篇|重新规划)/;
const DURATION_INCREASE_PATTERN = /(?:(?:增加|延长|加长|多加).{0,8}(?:时间|时长)|(?:时间|时长).{0,8}(?:增加|延长|加长))/;

export class ScriptIterationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptIterationContractError';
  }
}

export interface ScriptIterationScope {
  targetSegmentNumbers: number[];
  lockedSegmentNumbers: number[];
  expectedShotCounts: Record<number, number>;
  isGlobal: boolean;
  requiresDurationIncrease: boolean;
}

function collectReferencedSegmentNumbers(value: string): number[] {
  const numbers = new Set<number>();
  const patterns = [
    /(?:镜头|分镜)\s*0*(\d+)\s*[-－—]\s*0*\d+/g,
    /(?:分段|分组)\s*0*(\d+)/g,
    /分镜\s*0*(\d+)(?!\s*[-－—]\s*\d)/g,
  ];
  patterns.forEach((pattern) => {
    for (const match of value.matchAll(pattern)) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) numbers.add(parsed);
    }
  });
  return [...numbers];
}

function collectExpectedShotCounts(instruction: string): Record<number, number> {
  const expected: Record<number, number> = {};
  const patterns = [
    /(?:分段|分组|分镜)\s*0*(\d+)(?!\s*[-－—]\s*\d)[^，,。；;\n]{0,32}?(?:变成|改成|拆成|拆分成|拆分为|调整为|增加到)\s*0*(\d+)\s*个?\s*(?:镜头|分镜)/g,
    /(?:镜头|分镜)\s*0*(\d+)\s*[-－—]\s*0*\d+[^，,。；;\n]{0,32}?(?:变成|改成|拆成|拆分成|拆分为|调整为|增加到)\s*0*(\d+)\s*个?\s*(?:镜头|分镜)/g,
  ];
  patterns.forEach((pattern) => {
    for (const match of instruction.matchAll(pattern)) {
      const segmentNo = Number.parseInt(match[1], 10);
      const shotCount = Number.parseInt(match[2], 10);
      if (segmentNo > 0 && shotCount > 0) expected[segmentNo] = shotCount;
    }
  });
  return expected;
}





export function analyzeScriptIterationScope(instruction: string): ScriptIterationScope {
  const targetSegmentNumbers = new Set<number>();
  const lockedSegmentNumbers = new Set<number>();
  const clauses = String(instruction || '').split(/[，,。；;\n]+/).filter(Boolean);

  clauses.forEach((clause) => {
    const references = collectReferencedSegmentNumbers(clause);
    if (LOCKED_SCOPE_PATTERN.test(clause)) {
      references.forEach(number => lockedSegmentNumbers.add(number));
      return;
    }
    if (CHANGED_SCOPE_PATTERN.test(clause)) {
      references.forEach(number => targetSegmentNumbers.add(number));
    }
  });

  lockedSegmentNumbers.forEach(number => targetSegmentNumbers.delete(number));
  return {
    targetSegmentNumbers: [...targetSegmentNumbers].sort((a, b) => a - b),
    lockedSegmentNumbers: [...lockedSegmentNumbers].sort((a, b) => a - b),
    expectedShotCounts: collectExpectedShotCounts(instruction),
    isGlobal: GLOBAL_SCOPE_PATTERN.test(instruction),
    requiresDurationIncrease: DURATION_INCREASE_PATTERN.test(instruction),
  };
}

function serializeVideoScriptGroup(group: VideoScriptGroup): string {
  return `分段${group.groupNo}\n${group.rawGroup.trim()}`;
}

function totalGroupDuration(group: VideoScriptGroup): number {
  return group.blocks.reduce((total, block) => total + (block.durationSec || 0), 0);
}





export function stabilizeScriptIterationResult(
  currentScript: string,
  candidateScript: string,
  instruction: string,
): string {
  const currentGroups = parseVideoScriptGroups(currentScript);
  const candidateGroups = parseVideoScriptGroups(candidateScript);
  if (currentGroups.length === 0) return candidateScript.trim();
  if (candidateGroups.length === 0) {
    throw new ScriptIterationContractError('修改结果没有可识别的分段或镜头，已阻止保存。');
  }

  const scope = analyzeScriptIterationScope(instruction);
  const targetNumbers = new Set(scope.targetSegmentNumbers);
  const lockedNumbers = new Set(scope.lockedSegmentNumbers);
  const isSurgicalEdit = targetNumbers.size > 0 && !scope.isGlobal;
  if (isSurgicalEdit) {
    currentGroups.forEach((group) => {
      if (!targetNumbers.has(group.groupNo)) lockedNumbers.add(group.groupNo);
    });
  }

  if (lockedNumbers.size === 0 && !isSurgicalEdit) return candidateScript.trim();

  const currentByNumber = new Map(currentGroups.map(group => [group.groupNo, group]));
  const candidateByNumber = new Map(candidateGroups.map(group => [group.groupNo, group]));

  targetNumbers.forEach((segmentNo) => {
    const candidate = candidateByNumber.get(segmentNo);
    if (!candidate) {
      throw new ScriptIterationContractError(`修改结果丢失了分镜${segmentNo}，已阻止保存。`);
    }
    const expectedShotCount = scope.expectedShotCounts[segmentNo];
    if (expectedShotCount && candidate.blocks.length !== expectedShotCount) {
      throw new ScriptIterationContractError(
        `分镜${segmentNo}应生成${expectedShotCount}个镜头，实际生成${candidate.blocks.length}个，已阻止保存。`,
      );
    }
    if (scope.requiresDurationIncrease) {
      const current = currentByNumber.get(segmentNo);
      if (current && totalGroupDuration(candidate) <= totalGroupDuration(current)) {
        throw new ScriptIterationContractError(`分镜${segmentNo}的总时长没有增加，已阻止保存。`);
      }
    }
  });

  const merged = currentGroups.map((current) => {
    if (lockedNumbers.has(current.groupNo)) return current;
    return candidateByNumber.get(current.groupNo) || current;
  });

  if (!isSurgicalEdit) {
    candidateGroups.forEach((candidate) => {
      if (!currentByNumber.has(candidate.groupNo)) merged.push(candidate);
    });
  }

  return merged.map(serializeVideoScriptGroup).join('\n\n');
}

/**
 * Some models preserve every shot header but omit the CUT delimiter on edits.
 * Insert delimiters between standalone shot headers before parsing the reply.
 */
export function ensureStoryboardCutSeparators(value: string): string {
  const normalized = normalizeScriptIterationResult(value);
  if (!normalized) return '';

  const lines = normalized.split(/\r?\n/);
  const output: string[] = [];
  let hasShot = false;

  lines.forEach((line) => {
    const isShotHeader = /^\s*(?:镜头|分镜)\s*\d+(?:\s*[-－—]\s*\d+)?\s*$/.test(line);
    const isSegmentHeader = /^\s*(?:分段|段落)\s*\d+\s*$/.test(line);
    if ((isShotHeader || isSegmentHeader) && hasShot) {
      const previous = [...output].reverse().find(item => item.trim())?.trim();
      const previousIsSegmentHeader = /^(?:分段|段落)\s*\d+$/.test(previous || '');
      if (previous !== '---CUT---' && !(isShotHeader && previousIsSegmentHeader)) output.push('---CUT---');
    }
    if (isShotHeader) hasShot = true;
    output.push(line);
  });

  return output.join('\n').replace(/(?:\s*---CUT---\s*){2,}/g, '\n---CUT---\n').trim();
}
