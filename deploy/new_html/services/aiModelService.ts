






import { AiModel } from '../types';
import { callAI, callAIForJSON } from './aiService';
import * as PROMPTS from '../prompts';
import type { ScriptSegment, ExtractedStoryboardPrompt } from '../types';
import { parseScriptSegments, parseStoryboardPromptExtractions } from '../utils/scriptPipelineParsers';
import { normalizeScriptIterationResult } from '../utils/scriptIteration';
import type { TextTaskContext } from './textTaskContext';
import {
  applyProjectOrientationToPrompt,
  type ProjectOrientation,
} from '../utils/projectCreationPreferences';




export const aiRewriteNovelToScript = async (
  model: AiModel,
  novelText: string,
  userRequirements: string = '',
  onStream?: (chunk: string) => void
): Promise<string> => {
  return await callAI(
    model,
    PROMPTS.REWRITE_NOVEL_TO_SCRIPT,
    {
      novelText,
      userRequirements: userRequirements ? `**用户要求：**\n${userRequirements}` : ''
    },
    onStream
  );
};




export const aiGenerateStoryboards = async (
  model: AiModel,
  scriptContent: string
): Promise<any> => {
  return await callAIForJSON(
    model,
    PROMPTS.GENERATE_STORYBOARDS,
    { scriptContent }
  );
};




export const aiExtractScriptMetadata = async (
  model: AiModel,
  scriptContent: string
): Promise<{ characters: string[]; scenes: string[]; props: string[] }> => {
  return await callAIForJSON(
    model,
    PROMPTS.EXTRACT_SCRIPT_METADATA,
    { scriptContent }
  );
};




export const aiRefineScriptSegment = async (
  model: AiModel,
  selection: string,
  instruction: string,
  context: string
): Promise<string> => {
  return await callAI(
    model,
    PROMPTS.REFINE_SCRIPT_SEGMENT,
    { selection, instruction, context }
  );
};




export const aiIterateFullScript = async (
  model: AiModel,
  currentScript: string,
  instruction: string,
  conversationContext: string,
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
): Promise<string> => {
  const result = await callAI(
    model,
    PROMPTS.ITERATE_FULL_SCRIPT,
    { currentScript, instruction, conversationContext },
    onStream,
    {
      operation: 'script_rewrite',
      displayName: '剧本修改',
      ...taskContext,
    },
  );
  return normalizeScriptIterationResult(result);
};




export const aiRestructureShot = async (
  model: AiModel,
  selection: string,
  instruction: string,
  type: 'split' | 'merge'
): Promise<any> => {
  const typeText = type === 'split' ? '拆分' : '合并';
  return await callAIForJSON(
    model,
    PROMPTS.RESTRUCTURE_SHOT,
    { selection, instruction, type: typeText }
  );
};




export const aiRegenerateSingleShot = async (
  model: AiModel,
  selection: string,
  instruction?: string
): Promise<any> => {
  return await callAIForJSON(
    model,
    PROMPTS.REGENERATE_SINGLE_SHOT,
    { selection, instruction: instruction ? `用户指令：${instruction}` : '' }
  );
};





export const aiExtractShotsFromScript = async (
  model: AiModel,
  scriptText: string
): Promise<{ items: Array<{ originalText: string; scriptSegment: string }> }> => {

  if (model === AiModel.DeepseekChat || model === AiModel.Deepseek) {
    const { extractShotsFromScript } = await import('./deepseekService');
    return await extractShotsFromScript(scriptText);
  } else {
    const { extractShotsFromScript } = await import('./geminiProxyTextService');
    return await extractShotsFromScript(scriptText);
  }
};




export const aiSplitScriptIntoSegments = async (
  model: AiModel,
  originalContent: string,
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
  countPlan?: { target: number; minimum: number; maximum: number },
): Promise<ScriptSegment[]> => {
  const raw = await callAI(
    model,
    PROMPTS.SPLIT_SCRIPT_INTO_SEGMENTS,
    {
      originalContent,
      targetSegmentCount: countPlan ? String(countPlan.target) : '',
      minimumSegmentCount: countPlan ? String(countPlan.minimum) : '',
      maximumSegmentCount: countPlan ? String(countPlan.maximum) : '',
    },
    onStream,
    {
      operation: 'storyboard_script_generate',
      displayName: '剧本拆分',
      ...taskContext,
    },
  );
  return parseScriptSegments(raw);
};


export const aiReplanInvalidScriptSegments = async (
  model: AiModel,
  originalContent: string,
  invalidSegments: string,
  validationError: string,
  taskContext?: TextTaskContext,
): Promise<ScriptSegment[]> => {
  const raw = await callAI(
    model,
    PROMPTS.REPLAN_INVALID_SCRIPT_SEGMENTS,
    { originalContent, invalidSegments, validationError },
    undefined,
    {
      operation: 'storyboard_script_generate',
      displayName: '剧本拆分自动重规划',
      ...taskContext,
      suppressNotification: true,
    },
  );
  return parseScriptSegments(raw);
};


export const aiGenerateVideoScriptFromSegment = async (
  model: AiModel,
  segment: ScriptSegment,
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
  orientation: ProjectOrientation = 'portrait',
): Promise<string> => {
  return await callAI(
    model,
    applyProjectOrientationToPrompt(PROMPTS.GENERATE_VIDEO_SCRIPT_FROM_SEGMENT, orientation),
    {
      segmentText: [
        segment.sourceText,
        segment.estimatedDurationSec === null ? '' : `时长：${segment.estimatedDurationSec}秒`,
      ].filter(Boolean).join('\n'),
    },
    onStream,
    {
      operation: 'storyboard_script_generate',
      displayName: '视频脚本生成',
      ...taskContext,
    },
  );
};


export const aiGenerateVideoScriptFromSegments = async (
  model: AiModel,
  segments: ScriptSegment[],
  taskContext?: TextTaskContext,
  orientation: ProjectOrientation = 'portrait',
): Promise<string> => {
  const segmentsText = segments.map((segment, index) => [
    `分段${index + 1}`,
    segment.sourceText,
    segment.estimatedDurationSec === null ? '时长：缺失' : `时长：${segment.estimatedDurationSec}秒`,
  ].join('\n')).join('\n---\n');
  return await callAI(
    model,
    applyProjectOrientationToPrompt(PROMPTS.GENERATE_VIDEO_SCRIPT_FROM_SEGMENTS, orientation),
    { segmentsText },
    undefined,
    {
      operation: 'storyboard_script_generate',
      displayName: '剧本转视频脚本',
      ...taskContext,
    },
  );
};


export const aiIterateVideoScript = async (
  model: AiModel,
  originalScript: string,
  currentVideoScript: string,
  instruction: string,
  conversationContext: string,
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
  orientation: ProjectOrientation = 'portrait',
): Promise<string> => {
  return await callAI(
    model,
    applyProjectOrientationToPrompt(PROMPTS.ITERATE_VIDEO_SCRIPT, orientation),
    {
      originalScript,
      currentVideoScript,
      instruction,
      conversationContext,
    },
    onStream,
    {
      operation: 'script_rewrite',
      displayName: '剧本修改',
      ...taskContext,
    },
  );
};


export const aiReplanInvalidVideoScript = async (
  model: AiModel,
  originalScript: string,
  invalidVideoScript: string,
  validationError: string,
  scopeRequirements: string,
  instruction: string,
  conversationContext: string,
  taskContext?: TextTaskContext,
  orientation: ProjectOrientation = 'portrait',
): Promise<string> => {
  return await callAI(
    model,
    applyProjectOrientationToPrompt(PROMPTS.REPLAN_INVALID_VIDEO_SCRIPT, orientation),
    {
      originalScript,
      invalidVideoScript,
      validationError,
      scopeRequirements,
      instruction: instruction || '保持原始剧情和当前脚本要求不变',
      conversationContext: conversationContext || '无',
    },
    undefined,
    {
      operation: 'script_rewrite',
      displayName: '视频脚本自动重规划',
      ...taskContext,
      suppressNotification: true,
    },
  );
};


export const aiExtractStoryboardPromptsFromVideoShots = async (
  model: AiModel,
  videoShotBlocks: string,
  expectedShotNumbers: string[],
  taskContext?: TextTaskContext,
  orientation: ProjectOrientation = 'portrait',
): Promise<ExtractedStoryboardPrompt[]> => {
  const orderedShotNumbers = expectedShotNumbers.map(value => value.trim()).filter(Boolean);
  if (orderedShotNumbers.length === 0) return [];
  const raw = await callAI(
    model,
    applyProjectOrientationToPrompt(PROMPTS.EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT, orientation),
    {
      videoShotBlock: videoShotBlocks,
      canonicalShotNo: orderedShotNumbers[0],
    },
    undefined,
    {
      operation: 'storyboard_script_generate',
      displayName: '镜头设计批量生成',
      ...taskContext,
      suppressNotification: true,
    },
  );
  return parseStoryboardPromptExtractions(raw);
};


export const aiExtractStoryboardPromptFromVideoShot = async (
  model: AiModel,
  videoShotBlock: string,
  canonicalShotNo: string = '镜头1-1',
  taskContext?: TextTaskContext,
  orientation: ProjectOrientation = 'portrait',
): Promise<ExtractedStoryboardPrompt[]> => {
  const raw = await callAI(
    model,
    applyProjectOrientationToPrompt(PROMPTS.EXTRACT_STORYBOARD_PROMPT_FROM_VIDEO_SHOT, orientation),
    {
      videoShotBlock,
      canonicalShotNo,
    },
    undefined,
    {
      operation: 'storyboard_script_generate',
      displayName: '镜头设计生成',
      ...taskContext,
    },
  );
  return parseStoryboardPromptExtractions(raw);
};


export const aiReplanInvalidStoryboardExtraction = async (
  model: AiModel,
  videoShotBlock: string,
  canonicalShotNo: string,
  invalidExtraction: string,
  validationError: string,
  taskContext?: TextTaskContext,
  orientation: ProjectOrientation = 'portrait',
): Promise<ExtractedStoryboardPrompt[]> => {
  const raw = await callAI(
    model,
    applyProjectOrientationToPrompt(PROMPTS.REPLAN_INVALID_STORYBOARD_EXTRACTION, orientation),
    {
      videoShotBlock,
      canonicalShotNo,
      invalidExtraction,
      validationError,
    },
    undefined,
    {
      operation: 'storyboard_script_generate',
      displayName: '镜头设计自动重新提取',
      ...taskContext,
      suppressNotification: true,
    },
  );
  return parseStoryboardPromptExtractions(raw);
};




export const aiGenerateShotDetails = async (
  model: AiModel,
  originalText: string,
  scriptSegment: string,
  userRequirements?: string
): Promise<{
  imagePrompt: string;
  videoPrompt: string;
  dialogue: string;
  characters: string[];
  scene: string;
  props: string[];
}> => {
  const requirementsText = userRequirements
    ? `**用户整体要求：**\n${userRequirements}\n`
    : '';

  return await callAIForJSON(
    model,
    PROMPTS.GENERATE_SHOT_DETAILS,
    { originalText, scriptSegment, userRequirements: requirementsText }
  );
};






export const aiGenerateStoryboardScript = async (
  model: AiModel,
  novelText: string,
  userRequirements: string = '',
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
  orientation: ProjectOrientation = 'portrait',
): Promise<string> => {
  return await callAI(
    model,
    applyProjectOrientationToPrompt(PROMPTS.GENERATE_STORYBOARD_SCRIPT, orientation),
    {
      novelText,
      userRequirements: userRequirements ? `\n**用户要求：**\n${userRequirements}` : ''
    },
    onStream,
    {
      operation: 'storyboard_script_generate',
      displayName: '分镜脚本生成',
      ...taskContext,
    },
  );
};





export const aiContinueStoryboardScript = async (
  model: AiModel,
  nextShotId: string,
  remainingText: string,
  previousShotsContext: string = '',
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
): Promise<string> => {
  return await callAI(
    model,
    PROMPTS.CONTINUE_STORYBOARD_SCRIPT,
    {
      nextShotId,
      remainingText,
      previousShotsContext: previousShotsContext.trim() || '（无 — 这是首次续写）'
    },
    onStream,
    {
      operation: 'storyboard_script_continue',
      displayName: '分镜脚本续写',
      ...taskContext,
    },
  );
};












export const aiGenerateStoryboardScriptBySegments = async (
  model: AiModel,
  segments: string[],
  userRequirements: string = '',
  onSegmentComplete?: (segmentIndex: number, result: string) => void,
  onStream?: (chunk: string, segmentIndex: number) => void
): Promise<string[]> => {
  const results: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    console.log(`🎬 处理第 ${i + 1}/${segments.length} 段...`);

    let segmentResult = '';


    const result = await callAI(
      model,
      PROMPTS.GENERATE_STORYBOARD_SCRIPT,
      {
        novelText: segment,
        userRequirements: userRequirements ? `\n**用户要求：**\n${userRequirements}` : ''
      },
      (chunk) => {
        segmentResult += chunk;
        if (onStream) {
          onStream(chunk, i);
        }
      }
    );

    results.push(result);
    console.log(`✅ 第 ${i + 1} 段完成`);

    if (onSegmentComplete) {
      onSegmentComplete(i, result);
    }
  }

  return results;
};
