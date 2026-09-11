import { v4 as uuidv4 } from 'uuid';
import type {
  AiModel,
  ExtractedStoryboardPrompt,
  ScriptSegment,
  StoryboardItem,
  VideoScriptBlock,
} from '../types';
import {
  combineVideoScriptOutputs,
  ensureVideoScriptPromptLengths,
  formatHierarchicalShotNumber,
  formatVideoScriptShotNumber,
  parseVideoScriptGroups,
} from '../utils/scriptPipelineParsers';
import { normalizePositiveIntegerSeconds } from '../utils/storyboardSegments';
import type { ProjectOrientation } from '../utils/projectCreationPreferences';
import type { TextTaskContext } from './textTaskContext';

const loadAiModelService = () => import('./aiModelService');
const VIDEO_SCRIPT_GENERATION_CONCURRENCY = 3;
const STORYBOARD_LOCAL_REPAIR_CONCURRENCY = 4;

export interface PipelineUsage {
  inputTexts: string[];
  outputTexts: string[];
}

export interface EpisodeVideoScriptResult extends PipelineUsage {
  segments: ScriptSegment[];
  content: string;
}

export interface StoryboardDesignResult extends PipelineUsage {
  items: StoryboardItem[];
  sourceShotCount: number;
}

export interface PipelineProgress {
  stage: 'split' | 'videoScript' | 'storyboardDesign';
  completed: number;
  total: number;
  content?: string;
}

export class VideoScriptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoScriptValidationError';
  }
}

class SplitScriptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitScriptValidationError';
  }
}

async function runWithConcurrencyInOrder<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function failVideoScriptValidation(message: string): never {
  throw new VideoScriptValidationError(message);
}

function failSplitScriptValidation(message: string): never {
  throw new SplitScriptValidationError(message);
}

const BRIEF_SOURCE_MAX_CHARACTERS = 80;
const SPLIT_TARGET_CHARACTERS = 72;
const SPLIT_COUNT_MAX_VARIANCE = 3;

export interface ScriptSplitCountPlan {
  target: number;
  minimum: number;
  maximum: number;
}

function countContentCharacters(value: string): number {
  return String(value || '').replace(/\s+/g, '').length;
}

export function calculateScriptSplitCountPlan(originalContent: string): ScriptSplitCountPlan {
  const contentCharacters = countContentCharacters(originalContent);
  const target = Math.max(1, Math.ceil(contentCharacters / SPLIT_TARGET_CHARACTERS));
  const variance = Math.min(
    SPLIT_COUNT_MAX_VARIANCE,
    Math.max(1, Math.round(target * 0.15)),
  );
  return {
    target,
    minimum: Math.max(1, target - variance),
    maximum: target + variance,
  };
}

function estimateBriefSegmentDurationSec(sourceText: string): number {
  const length = countContentCharacters(sourceText);
  if (length <= 12) return 8;
  if (length <= 30) return 10;
  return 15;
}

function buildBriefCreativeSeedSegment(originalContent: string, existing?: ScriptSegment): ScriptSegment | null {
  const source = String(originalContent || '').trim();
  if (!source || countContentCharacters(source) > BRIEF_SOURCE_MAX_CHARACTERS) return null;
  return {
    id: existing?.id || `seg_brief_${Date.now().toString(36)}`,
    order: 0,
    sourceText: source,
    estimatedDurationSec: estimateBriefSegmentDurationSec(source),
    status: 'done',
    errorMessage: '',
  };
}

function isBriefCreativeSeed(originalContent: string, segments: ScriptSegment[]): boolean {
  return segments.length === 1 && countContentCharacters(originalContent) <= BRIEF_SOURCE_MAX_CHARACTERS;
}

function segmentForVideoScriptGeneration(
  segment: ScriptSegment,
  originalContent: string,
  allSegments: ScriptSegment[],
): ScriptSegment {
  if (!isBriefCreativeSeed(originalContent, allSegments)) return segment;

  // not an 8-second locked production segment. Keep the normalized duration in
  // stage-one state, but do not pass it into stage two where it would prevent
  // the model from expanding the seed into multiple 15s-or-less storyboard groups.
  return { ...segment, estimatedDurationSec: null };
}

function normalizeBriefSingleSegmentPlan(
  segments: ScriptSegment[],
  originalContent: string,
): ScriptSegment[] {
  const seed = buildBriefCreativeSeedSegment(originalContent, segments[0]);
  return seed ? [seed] : segments;
}

function normalizeSplitSegments(
  segments: ScriptSegment[],
  originalContent: string,
): ScriptSegment[] {
  const brief = normalizeBriefSingleSegmentPlan(segments, originalContent);
  if (brief.length === 1 && isBriefCreativeSeed(originalContent, brief)) return brief;

  const normalized = [...segments]
    .filter(segment => String(segment?.sourceText || '').trim())
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((segment, index) => ({
      ...segment,
      id: segment.id || `seg_${Date.now().toString(36)}_${index}`,
      order: index,
      sourceText: String(segment.sourceText || '').trim(),
      estimatedDurationSec: segment.estimatedDurationSec ?? null,
      status: 'done' as const,
      errorMessage: '',
    }));
  if (normalized.length > 0) return normalized;

  const source = String(originalContent || '').trim();
  if (!source) return [];
  return [{
    id: `seg_fallback_${Date.now().toString(36)}`,
    order: 0,
    sourceText: source,
    estimatedDurationSec: null,
    status: 'done',
    errorMessage: '',
  }];
}

export function prepareVideoScriptSegments(
  originalContent: string,
  segments: ScriptSegment[],
): ScriptSegment[] {
  return normalizeSplitSegments(segments, originalContent).sort((a, b) => a.order - b.order);
}

function assertValidSplitSegments(
  segments: ScriptSegment[],
  _options: { enforceDurationDensity?: boolean } = {},
): void {
  if (segments.length === 0) failSplitScriptValidation('第一步未解析出有效剧本分段');
}

export function assertValidVideoScript(
  content: string,
  _enforceDurationDensity = false,
  _enforcePromptLength = true,
): void {
  const groups = parseVideoScriptGroups(content);
  if (groups.length === 0) failVideoScriptValidation('第二步未解析出有效分段和分镜');
}

async function validateOrReplanVideoScript(
  model: AiModel,
  initialDraft: string,
  options: {
    originalScript: string;
    instruction: string;
    conversationContext: string;
    scopeRequirements: string;
    enforceDurationDensity: boolean;
    validateContent?: (content: string) => void;
    taskContext?: TextTaskContext;
  },
): Promise<string> {
  const content = ensureVideoScriptPromptLengths(combineVideoScriptOutputs([initialDraft]));
  assertValidVideoScript(content, false, false);
  options.validateContent?.(content);
  return content;
}

function buildVideoScriptSegmentsFromGroups(
  originalContent: string,
  orderedSegments: ScriptSegment[],
  content: string,
): ScriptSegment[] {
  const groups = parseVideoScriptGroups(content);
  if (groups.length === 0) return [];

  if (!isBriefCreativeSeed(originalContent, orderedSegments)) {
    if (groups.length !== orderedSegments.length) {
      failVideoScriptValidation(
        `第二步分段数量异常：第一步为${orderedSegments.length}段，第二步为${groups.length}段`,
      );
    }

    return orderedSegments.map((existing, index) => {
      const group = groups[index];
      const groupContent = [`分段${group.groupNo}`, group.rawGroup].filter(Boolean).join('\n').trim();
      return {
        ...existing,
        videoScript: groupContent,
        status: 'done' as const,
        errorMessage: '',
      };
    });
  }

  return groups.map((group, index) => {
    const durationSec = group.blocks.reduce((total, block) => {
      const duration = normalizePositiveIntegerSeconds(block.durationSec);
      return total + (duration || 0);
    }, 0);
    const groupContent = [`分段${group.groupNo}`, group.rawGroup].filter(Boolean).join('\n').trim();
    const sourceText = group.blocks.map(block => block.rawBlock).filter(Boolean).join('\n\n')
      || groupContent;

    return {
      id: `seg_local_video_${Date.now().toString(36)}_${group.groupNo}_${index}`,
      order: index,
      sourceText,
      estimatedDurationSec: durationSec > 0 ? durationSec : null,
      videoScript: groupContent,
      status: 'done' as const,
      errorMessage: '',
    };
  });
}

function findNearestSemanticBoundary(
  source: string,
  targetContentCount: number,
  minimumRawIndex: number,
): number {
  const candidates: Array<{ rawIndex: number; contentCount: number; priority: number }> = [];
  let contentCount = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (!/\s/.test(character)) contentCount += 1;
    const priority = /[\n。！？!?；;]/.test(character)
      ? 0
      : /[，,、：:]/.test(character) ? 1 : 2;
    if (priority < 2 || contentCount === targetContentCount) {
      candidates.push({ rawIndex: index + 1, contentCount, priority });
    }
  }
  const available = candidates.filter(candidate => (
    candidate.rawIndex > minimumRawIndex && candidate.rawIndex < source.length
  ));
  const strongCandidates = available.filter(candidate => (
    candidate.priority === 0 && Math.abs(candidate.contentCount - targetContentCount) <= 24
  ));
  const softCandidates = available.filter(candidate => (
    candidate.priority === 1 && Math.abs(candidate.contentCount - targetContentCount) <= 18
  ));
  const preferred = strongCandidates.length > 0
    ? strongCandidates
    : softCandidates.length > 0 ? softCandidates : available;
  preferred.sort((left, right) => (
    Math.abs(left.contentCount - targetContentCount) - Math.abs(right.contentCount - targetContentCount)
    || left.priority - right.priority
    || left.rawIndex - right.rawIndex
  ));
  return preferred[0]?.rawIndex || source.length;
}

function splitScriptLocallyPreservingContent(
  originalContent: string,
  countPlan = calculateScriptSplitCountPlan(originalContent),
): ScriptSegment[] {
  const source = String(originalContent || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return [];

  const totalCharacters = countContentCharacters(source);
  const targetCount = Math.min(countPlan.target, Math.max(1, totalCharacters));
  const boundaries: number[] = [];
  let previousBoundary = 0;
  for (let groupIndex = 1; groupIndex < targetCount; groupIndex += 1) {
    const targetContentCount = Math.round((totalCharacters * groupIndex) / targetCount);
    const boundary = findNearestSemanticBoundary(source, targetContentCount, previousBoundary);
    if (boundary <= previousBoundary || boundary >= source.length) break;
    boundaries.push(boundary);
    previousBoundary = boundary;
  }
  const groups = [...boundaries, source.length]
    .map((end, index) => source.slice(index === 0 ? 0 : boundaries[index - 1], end).trim())
    .filter(Boolean);

  return groups.map((sourceText, index) => ({
    id: `seg_local_fallback_${Date.now().toString(36)}_${index}`,
    order: index,
    sourceText,
    estimatedDurationSec: Math.max(4, Math.min(15, Math.round(countContentCharacters(sourceText) / 6))),
    status: 'done' as const,
    errorMessage: '',
  }));
}





function collapseVideoScriptOutputToSingleGroup(content: string): string {
  const groups = parseVideoScriptGroups(content);
  if (groups.length <= 1) return content.trim();

  const blocks = groups.flatMap(group => group.blocks);
  const body = blocks.map((block, index) => block.rawBlock.replace(
    /^[ \t]*(?:镜头|分镜)[ \t]*\d+(?:[ \t]*[-－—][ \t]*\d+)?[ \t]*[:：]?[ \t]*$/m,
    formatVideoScriptShotNumber(1, index + 1),
  ));
  const visualStyle = [...new Set(groups.map(group => group.visualStyle).filter(Boolean))].join('；');
  const stabilityConstraint = [
    ...new Set(groups.map(group => group.stabilityConstraint).filter(Boolean)),
  ].join('；');

  return [
    '分段1',
    ...body,
    visualStyle ? `【视觉风格】${visualStyle}` : '',
    stabilityConstraint ? `【正向稳定约束】${stabilityConstraint}` : '',
  ].filter(Boolean).join('\n\n').trim();
}

async function splitWithValidation(
  model: AiModel,
  originalContent: string,
  taskContext?: TextTaskContext,
): Promise<ScriptSegment[]> {
  const briefSeed = buildBriefCreativeSeedSegment(originalContent);
  if (briefSeed) return [briefSeed];

  const countPlan = calculateScriptSplitCountPlan(originalContent);
  const { aiSplitScriptIntoSegments } = await loadAiModelService();
  let modelSegments: ScriptSegment[];
  try {
    modelSegments = await aiSplitScriptIntoSegments(model, originalContent, undefined, {
      ...taskContext,
      suppressNotification: true,
    }, countPlan);
  } catch (error) {
    console.warn('[scriptThreeStageService] model split failed; using local structure-preserving fallback', error);
    modelSegments = splitScriptLocallyPreservingContent(originalContent, countPlan);
  }
  const normalizedModelSegments = normalizeSplitSegments(modelSegments, originalContent);
  const modelPreservesSource = normalizedModelSegments
    .map(segment => segment.sourceText)
    .join('')
    .replace(/\s+/g, '') === String(originalContent || '').replace(/\s+/g, '');
  const modelCountIsReasonable = normalizedModelSegments.length >= countPlan.minimum
    && normalizedModelSegments.length <= countPlan.maximum;
  if (!modelPreservesSource || !modelCountIsReasonable) {
    console.warn(
      `[scriptThreeStageService] model split rejected: ${normalizedModelSegments.length} segments, `
      + `expected ${countPlan.minimum}-${countPlan.maximum}; using bounded local fallback`,
    );
    modelSegments = splitScriptLocallyPreservingContent(originalContent, countPlan);
  }
  const segments = normalizeSplitSegments(modelSegments, originalContent);
  assertValidSplitSegments(segments);
  return segments;
}

export async function splitScriptIntoValidatedSegments(
  model: AiModel,
  originalContent: string,
  options: {
    taskContext?: TextTaskContext;
    onProgress?: (progress: PipelineProgress) => void;
    orientation?: ProjectOrientation;
  } = {},
): Promise<ScriptSegment[]> {
  options.onProgress?.({ stage: 'split', completed: 0, total: 1 });
  const segments = await splitWithValidation(model, originalContent, options.taskContext);
  options.onProgress?.({ stage: 'split', completed: 1, total: 1 });
  return segments;
}

async function validateOrRepairGeneratedSegment(
  model: AiModel,
  segment: ScriptSegment,
  initialDraft: string,
  taskContext?: TextTaskContext,
): Promise<string> {
  return await validateOrReplanVideoScript(model, initialDraft, {
    originalScript: segment.sourceText,
    instruction: '保持本段原文剧情不变，重新规划镜头与时长',
    conversationContext: '这是首次生成中的单个原文分段',
    scopeRequirements: [
      '围绕当前输入文本生成可拍摄的完整分镜脚本；如果当前输入是一句创意种子，允许扩展为多个连续剧情分段。',
      '正式剧本分段必须保持第一步的一进一出，不得在第二步新增或删除分段。',
      '每个最终分段的分镜累计时长必须小于或等于15秒；只有创意种子扩写时才允许拆成多个连续分段。',
      '第一步时长作为当前正式分段的生产边界；创意种子不受第一步估算时长限制。',
      '不单独要求这一段满足全剧14-15秒占比或全剧平均时长指标。',
    ].join('\n'),
    enforceDurationDensity: false,
    taskContext,
  });
}

export async function generateVideoScriptForSegments(
  model: AiModel,
  originalContent: string,
  segments: ScriptSegment[],
  options: {
    taskContext?: TextTaskContext;
    onProgress?: (progress: PipelineProgress) => void;
    orientation?: ProjectOrientation;
  } = {},
): Promise<EpisodeVideoScriptResult> {
  const inputTexts: string[] = [];
  const outputTexts: string[] = [];
  inputTexts.push(originalContent);

  const orderedSegments = prepareVideoScriptSegments(originalContent, segments);
  inputTexts.push(...orderedSegments.map(segment => segment.sourceText));
  const allowSegmentExpansion = isBriefCreativeSeed(originalContent, orderedSegments);

  let completed = 0;
  options.onProgress?.({
    stage: 'videoScript',
    completed,
    total: orderedSegments.length,
  });

  const { aiGenerateVideoScriptFromSegment } = await loadAiModelService();
  const outputs = await runWithConcurrencyInOrder(
    orderedSegments,
    VIDEO_SCRIPT_GENERATION_CONCURRENCY,
    async (segment) => {
      const generationSegment = segmentForVideoScriptGeneration(
        segment,
        originalContent,
        orderedSegments,
      );
      const initialDraft = await aiGenerateVideoScriptFromSegment(
        model,
        generationSegment,
        undefined,
        {
          ...options.taskContext,
          suppressNotification: true,
        },
        options.orientation,
      );
      const output = await validateOrRepairGeneratedSegment(
        model,
        segment,
        initialDraft,
        options.taskContext,
      );
      completed += 1;
      options.onProgress?.({
        stage: 'videoScript',
        completed,
        total: orderedSegments.length,
      });
      return allowSegmentExpansion
        ? output
        : collapseVideoScriptOutputToSingleGroup(output);
    },
  );
  outputTexts.push(...outputs);

  const content = combineVideoScriptOutputs(outputs);
  const groups = parseVideoScriptGroups(content);
  const finalSegmentCount = allowSegmentExpansion ? groups.length : orderedSegments.length;
  options.onProgress?.({
    stage: 'videoScript',
    completed: finalSegmentCount,
    total: finalSegmentCount,
    content,
  });
  if (groups.length === 0) throw new Error('视频脚本生成未返回可解析的分段/分镜，请手动调整后重试');
  const completedSegments = buildVideoScriptSegmentsFromGroups(originalContent, orderedSegments, content);
  return { segments: completedSegments, content, inputTexts, outputTexts };
}

export async function generateEpisodeVideoScript(
  model: AiModel,
  originalContent: string,
  options: {
    taskContext?: TextTaskContext;
    onProgress?: (progress: PipelineProgress) => void;
    orientation?: ProjectOrientation;
  } = {},
): Promise<EpisodeVideoScriptResult> {
  const segments = await splitScriptIntoValidatedSegments(model, originalContent, options);
  const result = await generateVideoScriptForSegments(model, originalContent, segments, options);
  return {
    ...result,
    outputTexts: [
      segments.map(segment => (
        `${segment.sourceText}\n时长：${segment.estimatedDurationSec}秒`
      )).join('\n---\n'),
      ...result.outputTexts,
    ],
  };
}

export async function iterateEpisodeVideoScript(
  model: AiModel,
  originalScript: string,
  currentVideoScript: string,
  instruction: string,
  conversationContext: string,
  options: {
    taskContext?: TextTaskContext;
    onStream?: (chunk: string) => void;
    orientation?: ProjectOrientation;
  } = {},
): Promise<EpisodeVideoScriptResult> {
  const { aiIterateVideoScript } = await loadAiModelService();
  const raw = await aiIterateVideoScript(
    model,
    originalScript,
    currentVideoScript,
    instruction,
    conversationContext,
    undefined,
    options.taskContext,
    options.orientation,
  );
  const content = await validateOrReplanVideoScript(model, raw, {
    originalScript,
    instruction,
    conversationContext,
    scopeRequirements: [
      '重新规划完整剧本，可按故事情节与情绪闭环调整相邻分段。',
      '最终结果必须保持14-15秒分段占30%以上、所有分段平均时长不低于10秒。',
      '必须完整保留本轮用户修改意见。',
    ].join('\n'),
    enforceDurationDensity: true,
    taskContext: options.taskContext,
  });
  options.onStream?.(content);
  return {
    segments: [],
    content,
    inputTexts: [originalScript, currentVideoScript, instruction, conversationContext],
    outputTexts: [content],
  };
}

function allocateExtractedStoryboardDurations(
  extractions: ExtractedStoryboardPrompt[],
  sourceDurationSec: number | null,
): number[] {
  if (extractions.length === 0) return [];
  const target = normalizePositiveIntegerSeconds(sourceDurationSec);
  const durations = extractions.map(extraction => normalizePositiveIntegerSeconds(extraction.durationSec));
  if (!target) return durations.map(duration => duration || 1);
  if (extractions.length === 1) return [target];

  const allocated = durations.map(duration => duration || 0);
  const missingIndexes = allocated
    .map((duration, index) => (duration > 0 ? -1 : index))
    .filter(index => index >= 0);
  if (missingIndexes.length > 0) {
    const knownTotal = allocated.reduce((total, duration) => total + Math.max(0, duration), 0);
    let remaining = Math.max(target - knownTotal, missingIndexes.length);
    missingIndexes.forEach((index, order) => {
      const slotsLeft = missingIndexes.length - order;
      const nextDuration = Math.max(1, Math.floor(remaining / slotsLeft));
      allocated[index] = nextDuration;
      remaining -= nextDuration;
    });
  }

  let total = allocated.reduce((sum, duration) => sum + duration, 0);
  let delta = target - total;
  if (delta > 0) {
    allocated[allocated.length - 1] += delta;
  } else if (delta < 0) {
    for (let index = allocated.length - 1; index >= 0 && delta < 0; index -= 1) {
      const reducible = Math.max(0, allocated[index] - 1);
      const reduction = Math.min(reducible, -delta);
      allocated[index] -= reduction;
      delta += reduction;
    }
  }

  total = allocated.reduce((sum, duration) => sum + duration, 0);
  if (total <= 0) return extractions.map(() => 1);
  return allocated.map(duration => Math.max(1, Math.round(duration)));
}

function buildStoryboardItem(
  extraction: ExtractedStoryboardPrompt,
  block: VideoScriptBlock,
  groupNo: number,
  localShotNo: number,
  sharedVideoPrompt: string,
  resolvedDurationSec?: number | null,
): StoryboardItem {
  const shotNumber = formatHierarchicalShotNumber(groupNo, localShotNo);
  const durationSec = normalizePositiveIntegerSeconds(resolvedDurationSec)
    || normalizePositiveIntegerSeconds(extraction.durationSec)
    || normalizePositiveIntegerSeconds(block.durationSec);
  const originalText = [
    shotNumber,
    durationSec ? `时间：${durationSec}秒` : '',
    extraction.shotSize ? `景别：${extraction.shotSize}` : '',
    extraction.sceneDescription ? `画面描述：${extraction.sceneDescription}` : '',
    extraction.imagePrompt ? `分镜生成提示词：${extraction.imagePrompt}` : '',
    extraction.cameraAngle ? `拍摄角度：${extraction.cameraAngle}` : '',
    extraction.cameraMove ? `运镜方式：${extraction.cameraMove}` : '',
    extraction.dialogue ? `人声：${extraction.dialogue}` : '人声：无',
    extraction.characters.length ? `人物名称：${extraction.characters.join('、')}` : '人物名称：无',
    extraction.scene ? `场景名称：${extraction.scene}` : '场景名称：无',
    extraction.props.length ? `道具名称：${extraction.props.join('、')}` : '道具名称：无',
    `视频提示词：${sharedVideoPrompt}`,
  ].filter(Boolean).join('\n');
  return {
    id: uuidv4(),
    shotNumber,
    originalText,
    scriptSegment: extraction.sceneDescription,
    characters: extraction.characters,
    scene: extraction.scene,
    props: extraction.props,
    imagePrompt: extraction.imagePrompt,
    videoPrompt: sharedVideoPrompt,
    dialogue: extraction.dialogue,
    cameraMovement: [
      extraction.shotSize,
      extraction.cameraMove,
      extraction.cameraAngle,
    ].filter(Boolean).join('，'),
    plannedDurationMs: durationSec ? durationSec * 1000 : null,
    duration: durationSec ? `${durationSec}秒` : undefined,
    scriptSegmentId: `storyboard-segment-${groupNo}`,
    sourceVideoShotNo: block.shotNo || shotNumber,
    videoScriptBlock: block.rawBlock,
    shotSize: extraction.shotSize,
    cameraAngle: extraction.cameraAngle,
    timestamp: Date.now(),
  };
}

async function validateOrReplanStoryboardExtractions(
  _model: AiModel,
  _videoShotBlock: string,
  _canonicalShotNo: string,
  initialExtractions: ExtractedStoryboardPrompt[],
  _taskContext?: TextTaskContext,
): Promise<ExtractedStoryboardPrompt[]> {
  return initialExtractions;
}

export async function generateStoryboardDesignForVersion(
  model: AiModel,
  videoScript: string,
  options: {
    taskContext?: TextTaskContext;
    onProgress?: (progress: PipelineProgress) => void;
    orientation?: ProjectOrientation;
  } = {},
): Promise<StoryboardDesignResult> {
  const groups = parseVideoScriptGroups(videoScript);
  assertValidVideoScript(videoScript, false, false);
  const sourceShotCount = groups.reduce((total, group) => total + group.blocks.length, 0);
  const inputTexts: string[] = [];
  const outputTexts: string[] = [];
  let completed = 0;
  const sourceShots = groups.flatMap(group => (
    group.blocks.map((block, localIndex) => ({
      block,
      group,
      localShotNo: localIndex + 1,
      canonicalShotNo: block.shotNo || formatVideoScriptShotNumber(group.groupNo, localIndex + 1),
    }))
  ));
  const { aiExtractStoryboardPromptFromVideoShot } = await loadAiModelService();


  const extractionResults = await runWithConcurrencyInOrder(
    sourceShots,
    STORYBOARD_LOCAL_REPAIR_CONCURRENCY,
    async (shot) => {
      const extractionTaskContext = {
        ...options.taskContext,
        suppressNotification: true,
      };
      const initialExtractions = await aiExtractStoryboardPromptFromVideoShot(
        model,
        shot.block.rawBlock,
        shot.canonicalShotNo,
        extractionTaskContext,
        options.orientation,
      );
      const extractions = await validateOrReplanStoryboardExtractions(
        model,
        shot.block.rawBlock,
        shot.canonicalShotNo,
        initialExtractions,
        extractionTaskContext,
      );
      completed += 1;
      options.onProgress?.({
        stage: 'storyboardDesign',
        completed,
        total: sourceShotCount,
      });
      return {
        shot,
        extractions,
        inputTexts: extractions === initialExtractions
          ? [shot.block.rawBlock]
          : [shot.block.rawBlock, shot.block.rawBlock],
        outputTexts: extractions === initialExtractions
          ? [JSON.stringify(initialExtractions)]
          : [JSON.stringify(initialExtractions), JSON.stringify(extractions)],
      };
    },
  );
  extractionResults.forEach((result) => {
    inputTexts.push(...result.inputTexts);
    outputTexts.push(...result.outputTexts);
  });

  const localShotCountByGroup = new Map<number, number>();
  const items = extractionResults.flatMap((result) => {
    const { shot, extractions } = result;
    const firstShot = formatVideoScriptShotNumber(shot.group.groupNo, 1);
    const lastShot = formatVideoScriptShotNumber(
      shot.group.groupNo,
      Math.max(1, shot.group.blocks.length),
    );
    const range = firstShot === lastShot ? firstShot : `${firstShot}至${lastShot}`;
    const finalSharedVideoPrompt = [
      range,
      shot.group.visualStyle ? `【视觉风格】${shot.group.visualStyle}` : '',
      shot.group.stabilityConstraint ? `【正向稳定约束】${shot.group.stabilityConstraint}` : '',
    ].filter(Boolean).join('，') + '。';
    const durations = allocateExtractedStoryboardDurations(extractions, shot.block.durationSec);
    return extractions.map((extraction, extractionIndex) => {
      const localShotNo = (localShotCountByGroup.get(shot.group.groupNo) || 0) + 1;
      localShotCountByGroup.set(shot.group.groupNo, localShotNo);
      return buildStoryboardItem(
        extraction,
        shot.block,
        shot.group.groupNo,
        localShotNo,
        finalSharedVideoPrompt,
        durations[extractionIndex],
      );
    });
  });

  if (items.length === 0) throw new Error('镜头设计生成未返回可用内容，请手动调整分镜脚本后重试');
  return { items, sourceShotCount, inputTexts, outputTexts };
}
