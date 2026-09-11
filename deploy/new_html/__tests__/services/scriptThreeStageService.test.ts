import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiModel } from '../../types';

const aiMocks = vi.hoisted(() => ({
  aiSplitScriptIntoSegments: vi.fn(),
  aiReplanInvalidScriptSegments: vi.fn(),
  aiGenerateVideoScriptFromSegment: vi.fn(),
  aiGenerateVideoScriptFromSegments: vi.fn(),
  aiIterateVideoScript: vi.fn(),
  aiReplanInvalidVideoScript: vi.fn(),
  aiExtractStoryboardPromptsFromVideoShots: vi.fn(),
  aiExtractStoryboardPromptFromVideoShot: vi.fn(),
  aiReplanInvalidStoryboardExtraction: vi.fn(),
}));

vi.mock('../../services/aiModelService', () => aiMocks);

import {
  assertValidVideoScript,
  calculateScriptSplitCountPlan,
  generateEpisodeVideoScript,
  generateStoryboardDesignForVersion,
  generateVideoScriptForSegments,
  iterateEpisodeVideoScript,
  prepareVideoScriptSegments,
  splitScriptIntoValidatedSegments,
} from '../../services/scriptThreeStageService';
import {
  STABILITY_CONSTRAINT_REFERENCE,
  VISUAL_STYLE_REFERENCE,
} from '../../utils/scriptPromptStandards';
import { parseVideoScriptGroups } from '../../utils/scriptPipelineParsers';

const validGroup = [
  '分段1',
  '镜头1-1',
  '时长（秒）：8',
  '画面描述：主角推门进入办公室。',
  '镜头1-2',
  '时长（秒）：7',
  '画面描述：主角停在办公桌前。',
  `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
  `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
].join('\n');

function oneShotGroup(text = '主角推门进入办公室。', duration = 15): string {
  return [
    '分段1',
    '镜头1-1',
    `时长（秒）：${duration}`,
    `画面描述：${text}`,
    `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
    `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
  ].join('\n');
}

describe('three-stage script pipeline prefers usable output over blocking validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only requires stage-two text to contain parseable groups', () => {
    expect(() => assertValidVideoScript(validGroup)).not.toThrow();
    expect(() => assertValidVideoScript(validGroup.replace('时长（秒）：7', '时长（秒）：99'))).not.toThrow();
    expect(() => assertValidVideoScript(validGroup.replace(/【正向稳定约束】.*$/, ''))).not.toThrow();
    expect(() => assertValidVideoScript(validGroup.replace('镜头1-2', '镜头1-1'))).not.toThrow();
    expect(() => assertValidVideoScript('只有普通文字，没有分段和分镜')).toThrow('第二步未解析出有效分段和分镜');
  });

  it('uses one local seed call for a short idea but returns the generated groups as formal segments', async () => {
    aiMocks.aiGenerateVideoScriptFromSegment.mockResolvedValue([
      '分段1',
      '分镜1-1',
      '时长（秒）：8',
      '画面描述：孙悟空立于云海之上，金箍棒横扫天门。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
      '分段2',
      '分镜2-1',
      '时长（秒）：7',
      '画面描述：天兵在南天门前列阵，云层被金光撕开。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n'));

    const progress: Array<{ stage: string; completed: number; total: number }> = [];
    const result = await generateEpisodeVideoScript(AiModel.DeepseekChat, '孙悟空大闹天宫', {
      orientation: 'landscape',
      onProgress: event => progress.push({
        stage: event.stage,
        completed: event.completed,
        total: event.total,
      }),
    });

    expect(aiMocks.aiSplitScriptIntoSegments).not.toHaveBeenCalled();
    expect(aiMocks.aiReplanInvalidScriptSegments).not.toHaveBeenCalled();
    expect(aiMocks.aiReplanInvalidVideoScript).not.toHaveBeenCalled();
    expect(aiMocks.aiGenerateVideoScriptFromSegment).toHaveBeenCalledTimes(1);
    expect(aiMocks.aiGenerateVideoScriptFromSegment).toHaveBeenCalledWith(
      AiModel.DeepseekChat,
      expect.objectContaining({
        sourceText: '孙悟空大闹天宫',
        estimatedDurationSec: null,
      }),
      undefined,
      expect.objectContaining({ suppressNotification: true }),
      'landscape',
    );
    expect(result.segments).toHaveLength(2);
    expect(result.segments.map(segment => segment.estimatedDurationSec)).toEqual([8, 7]);
    expect(result.segments[0].videoScript).toContain('分段1');
    expect(result.segments[1].videoScript).toContain('分段2');
    expect(parseVideoScriptGroups(result.content)).toHaveLength(2);
    expect(result.content).toContain('天兵在南天门前列阵');
    expect(progress).toEqual(expect.arrayContaining([
      { stage: 'split', completed: 1, total: 1 },
      { stage: 'videoScript', completed: 1, total: 1 },
      { stage: 'videoScript', completed: 2, total: 2 },
    ]));
  });

  it('collapses stale over-split short-idea segments before video-script generation', async () => {
    const staleSegments = Array.from({ length: 21 }, (_, index) => ({
      id: `s${index + 1}`,
      order: index,
      sourceText: `错误拆出的第${index + 1}段`,
      estimatedDurationSec: 8,
      status: 'done' as const,
    }));
    aiMocks.aiGenerateVideoScriptFromSegment.mockResolvedValue(oneShotGroup('孙悟空冲向南天门。', 8));

    const prepared = prepareVideoScriptSegments('孙悟空大闹天宫（仿照黑悟空的游戏剧情）', staleSegments);
    const progress: Array<{ completed: number; total: number }> = [];
    const result = await generateVideoScriptForSegments(
      AiModel.DeepseekChat,
      '孙悟空大闹天宫（仿照黑悟空的游戏剧情）',
      staleSegments,
      {
        onProgress: event => {
          if (event.stage === 'videoScript') progress.push({ completed: event.completed, total: event.total });
        },
      },
    );

    expect(prepared).toHaveLength(1);
    expect(aiMocks.aiGenerateVideoScriptFromSegment).toHaveBeenCalledTimes(1);
    expect(progress[0]).toEqual({ completed: 0, total: 1 });
    expect(progress.at(-1)).toEqual({ completed: 1, total: 1 });
    expect(result.segments).toHaveLength(1);
    expect(result.content).toContain('孙悟空冲向南天门');
  });

  it('runs at most three stage-two segments concurrently while preserving source order', async () => {
    const source = '这是超过八十字的正式剧本，用于验证第二阶段并发生成不会改变第一阶段已经确定的分段顺序和数量。每一段都应独立生成视频分镜，最终仍按照原始顺序合并，不能因为请求完成先后不同而打乱剧情前后关系。';
    const segments = Array.from({ length: 6 }, (_, index) => ({
      id: `s${index + 1}`,
      order: index,
      sourceText: `原始剧情第${index + 1}段`,
      estimatedDurationSec: 8,
      status: 'done' as const,
    }));
    let active = 0;
    let maxActive = 0;
    aiMocks.aiGenerateVideoScriptFromSegment.mockImplementation(async (_model, segment) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return oneShotGroup(segment.sourceText, 8);
    });

    const result = await generateVideoScriptForSegments(AiModel.DeepseekChat, source, segments);

    expect(aiMocks.aiGenerateVideoScriptFromSegment).toHaveBeenCalledTimes(6);
    expect(maxActive).toBe(3);
    expect(result.segments.map(segment => segment.id)).toEqual(segments.map(segment => segment.id));
    expect(result.segments.map(segment => segment.sourceText)).toEqual(segments.map(segment => segment.sourceText));
    expect(parseVideoScriptGroups(result.content).map(group => group.groupNo)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.content.indexOf('原始剧情第1段')).toBeLessThan(result.content.indexOf('原始剧情第6段'));
  });

  it('collapses an over-split model response into its existing formal source segment', async () => {
    const source = '这是超过八十字的正式剧本，用于验证第二阶段不能再把第一阶段的既有分段随意拆成更多段落。即使模型错误输出了多个分段，也必须保留原有段数、编号、原文和时长，只将额外内容收口为当前段内的连续分镜。';
    const segments = [{
      id: 'source-1',
      order: 0,
      sourceText: '主角进入办公室，与客户完成一段连续对话。',
      estimatedDurationSec: 12,
      status: 'done' as const,
    }];
    aiMocks.aiGenerateVideoScriptFromSegment.mockResolvedValue([
      oneShotGroup('主角进入办公室。', 5),
      oneShotGroup('客户起身与主角交谈。', 7).replace(/^分段1/m, '分段2'),
    ].join('\n'));

    const result = await generateVideoScriptForSegments(AiModel.DeepseekChat, source, segments);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toEqual(expect.objectContaining({
      id: 'source-1',
      order: 0,
      sourceText: segments[0].sourceText,
      estimatedDurationSec: 12,
    }));
    expect(parseVideoScriptGroups(result.content)).toHaveLength(1);
    expect(result.content).toContain('分镜1-1');
    expect(result.content).toContain('分镜1-2');
    expect(result.content).toContain('客户起身与主角交谈');
    expect(result.content).not.toContain('分段2');
  });

  it('keeps a source-complete model split inside the shared count budget', async () => {
    const modelParts = [
      '第一场主角进入办公室，与客户核对延期合同并说明系统故障。',
      '客户拒绝接受解释，拿出交付记录逐条质疑，双方情绪逐渐升级。',
      '主角提出新的补救计划，客户暂时同意继续谈判并等待验证结果。',
    ];
    const longSource = modelParts.join('');
    aiMocks.aiSplitScriptIntoSegments.mockResolvedValue(modelParts.map((sourceText, index) => ({
      id: `model-${index}`,
      order: index,
      sourceText,
      estimatedDurationSec: index === 0 ? 17 : 12,
      status: 'done',
    })));
    aiMocks.aiGenerateVideoScriptFromSegment.mockResolvedValue(oneShotGroup('主角进入办公室。', 17));

    const result = await generateEpisodeVideoScript(AiModel.DeepseekChat, longSource);

    expect(aiMocks.aiSplitScriptIntoSegments).toHaveBeenCalledTimes(1);
    expect(aiMocks.aiReplanInvalidScriptSegments).not.toHaveBeenCalled();
    expect(aiMocks.aiReplanInvalidVideoScript).not.toHaveBeenCalled();
    expect(result.segments).toHaveLength(3);
    expect(result.segments.map(segment => segment.sourceText)).toEqual(modelParts);
    expect(result.content).toContain('时长（秒）：17');
  });

  it('bounds extreme model split counts for the same source while preserving model-sized variation', async () => {
    const sourceParts = Array.from({ length: 9 }, (_, index) => (
      `第${index + 1}场，角色完成当前动作并推动冲突，随后给出明确反应和新的信息。`
    ));
    const longSource = sourceParts.join('');
    const splitRawText = (count: number) => Array.from({ length: count }, (_, index) => {
      const start = Math.floor((longSource.length * index) / count);
      const end = Math.floor((longSource.length * (index + 1)) / count);
      return {
        id: `model-${count}-${index}`,
        order: index,
        sourceText: longSource.slice(start, end),
        estimatedDurationSec: 12,
        status: 'done',
      };
    });
    const plan = calculateScriptSplitCountPlan(longSource);
    aiMocks.aiSplitScriptIntoSegments
      .mockResolvedValueOnce(splitRawText(2))
      .mockResolvedValueOnce(splitRawText(plan.target))
      .mockResolvedValueOnce(splitRawText(29));

    const results = [
      await splitScriptIntoValidatedSegments(AiModel.DeepseekChat, longSource),
      await splitScriptIntoValidatedSegments(AiModel.DeepseekChat, longSource),
      await splitScriptIntoValidatedSegments(AiModel.DeepseekChat, longSource),
    ];

    expect(plan.target).toBeGreaterThan(2);
    expect(plan.target).toBeLessThan(29);
    expect(results.map(segments => segments.length)).toEqual([
      plan.target,
      plan.target,
      plan.target,
    ]);
    results.forEach(segments => {
      expect(segments.map(segment => segment.sourceText).join('').replace(/\s+/g, ''))
        .toBe(longSource.replace(/\s+/g, ''));
      expect(segments.length).toBeGreaterThanOrEqual(plan.minimum);
      expect(segments.length).toBeLessThanOrEqual(plan.maximum);
    });
  });

  it('falls back to ordered local source segments when the stage-one model request fails', async () => {
    const paragraphs = [
      '第一场：主角进入办公室。'.repeat(12),
      '第二场：客户拿出合同，双方开始争论。'.repeat(12),
      '第三场：主角提出补救方案，冲突逐渐缓和。'.repeat(12),
    ];
    const longSource = paragraphs.join('\n\n');
    aiMocks.aiSplitScriptIntoSegments.mockRejectedValue(new Error('upstream stream failed'));
    aiMocks.aiGenerateVideoScriptFromSegment.mockImplementation(async (_model, segment) => (
      oneShotGroup(segment.sourceText, 15)
    ));

    const progress: Array<{ stage: string; completed: number; total: number }> = [];
    const result = await generateEpisodeVideoScript(AiModel.DeepseekChat, longSource, {
      onProgress: event => progress.push({
        stage: event.stage,
        completed: event.completed,
        total: event.total,
      }),
    });

    expect(aiMocks.aiSplitScriptIntoSegments).toHaveBeenCalledWith(
      AiModel.DeepseekChat,
      longSource,
      undefined,
      expect.objectContaining({ suppressNotification: true }),
      calculateScriptSplitCountPlan(longSource),
    );
    expect(result.segments).toHaveLength(calculateScriptSplitCountPlan(longSource).target);
    expect(result.segments.map(segment => segment.sourceText).join('').replace(/\s+/g, ''))
      .toBe(longSource.replace(/\s+/g, ''));
    expect(progress).toContainEqual({ stage: 'split', completed: 1, total: 1 });
    expect(result.content.indexOf('第一场')).toBeLessThan(result.content.indexOf('第三场'));
  });

  it('returns a revised storyboard script as-is instead of buffering and replanning it', async () => {
    const invalidButParseable = validGroup
      .replace('时长（秒）：7', '时长（秒）：99')
      .replace('主角停在办公桌前', '客户可见的待人工修改草稿');
    aiMocks.aiIterateVideoScript.mockResolvedValue(invalidButParseable);
    const onStream = vi.fn();

    const result = await iterateEpisodeVideoScript(
      AiModel.DeepseekChat,
      '原始剧本',
      validGroup,
      '让冲突更强',
      '此前意见',
      { onStream },
    );

    expect(aiMocks.aiReplanInvalidVideoScript).not.toHaveBeenCalled();
    expect(onStream).toHaveBeenCalledTimes(1);
    expect(onStream).toHaveBeenCalledWith(result.content);
    expect(result.content).toContain('客户可见的待人工修改草稿');
  });

  it('runs stage three per source storyboard and lets one source split into multiple design shots', async () => {
    aiMocks.aiExtractStoryboardPromptFromVideoShot.mockResolvedValue([{
      shotNo: '镜头1-1',
      shotSize: '近景',
      sceneDescription: '主角推开办公室门。',
      characters: ['主角'],
      scene: '办公室门口',
      props: ['门'],
      imagePrompt: '近景，平视，主角推门，门口日光。',
      cameraAngle: '平视',
      cameraMove: '固定',
      dialogue: '',
      durationSec: 5,
    }, {
      shotNo: '镜头1-2',
      shotSize: '中景',
      sceneDescription: '主角走进办公室看向桌边。',
      characters: ['主角'],
      scene: '办公室',
      props: ['办公桌'],
      imagePrompt: '中景，平视，主角进屋，办公室柔和日光。',
      cameraAngle: '平视',
      cameraMove: '固定',
      dialogue: '',
      durationSec: null,
    }]);

    const result = await generateStoryboardDesignForVersion(
      AiModel.DeepseekChat,
      [
        '分段1',
        '分镜1-1',
        '时长（秒）：15',
        '画面描述：主角推门进入办公室。',
        `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
        `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
      ].join('\n'),
      { orientation: 'landscape' },
    );

    expect(aiMocks.aiExtractStoryboardPromptFromVideoShot).toHaveBeenCalledWith(
      AiModel.DeepseekChat,
      expect.stringContaining('分镜1-1'),
      '分镜1-1',
      expect.objectContaining({ suppressNotification: true }),
      'landscape',
    );
    expect(aiMocks.aiReplanInvalidStoryboardExtraction).not.toHaveBeenCalled();
    expect(result.items.map(item => item.shotNumber)).toEqual(['镜头1-1', '镜头1-2']);
    expect(result.items.map(item => item.sourceVideoShotNo)).toEqual(['分镜1-1', '分镜1-1']);
    expect(result.items.map(item => item.plannedDurationMs)).toEqual([5000, 10000]);
  });

  it('keeps incomplete stage-three output visible instead of auto-reextracting it', async () => {
    aiMocks.aiExtractStoryboardPromptFromVideoShot.mockResolvedValue([{
      shotNo: '镜头1-1',
      shotSize: '近景',
      sceneDescription: '不完整但可人工修改的镜头设计。',
      characters: ['主角'],
      scene: '办公室',
      props: [],
      imagePrompt: '',
      cameraAngle: '平视',
      cameraMove: '固定',
      dialogue: '',
      durationSec: 15,
    }]);

    const result = await generateStoryboardDesignForVersion(AiModel.DeepseekChat, oneShotGroup('主角推门进入办公室。', 15));

    expect(aiMocks.aiReplanInvalidStoryboardExtraction).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].scriptSegment).toContain('不完整但可人工修改');
  });

  it('only fails stage three when no design item is returned at all', async () => {
    aiMocks.aiExtractStoryboardPromptFromVideoShot.mockResolvedValue([]);

    await expect(generateStoryboardDesignForVersion(AiModel.DeepseekChat, oneShotGroup('主角推门进入办公室。', 15)))
      .rejects.toThrow('镜头设计生成未返回可用内容，请手动调整分镜脚本后重试');
    expect(aiMocks.aiReplanInvalidStoryboardExtraction).not.toHaveBeenCalled();
  });
});
