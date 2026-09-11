import { describe, expect, it } from 'vitest';
import type { StoryboardItem } from '../../types';
import {
  buildStoryboardSegmentGroups,
  cleanStoryboardShotCardText,
  cleanStoryboardDisplayText,
  estimateDialogueDurationSeconds,
  getStoryboardItemDurationSeconds,
  getStoryboardSegmentPromptSections,
  mergeStoryboardDisplayItems,
  normalizePositiveIntegerSeconds,
  normalizeStoryboardItemsForWorkflow,
  serializeStoryboardItemsWithSegments,
  synchronizeStoryboardSegmentVideoPrompts,
} from '../../utils/storyboardSegments';
import { convertToStoryboardItem, parseStreamingBlocks } from '../../utils/storyboardParser';

const shot = (id: string, duration: string, scriptSegmentId?: string): StoryboardItem => ({
  id,
  duration,
  scriptSegmentId,
  originalText: `${id}\n时间：${duration}`,
  scriptSegment: id,
  imagePrompt: '',
  videoPrompt: '',
  dialogue: '',
  characters: [],
});

describe('storyboard segment normalization', () => {
  it('restores complete shot fields from version content while keeping persisted ids', () => {
    const persisted = [
      {
        ...shot('persisted-shot-1', '4秒', 'storyboard-segment-1'),
        originalText: '镜头01\n镜头运动：固定',
      },
    ];
    const content = [
      '分段01',
      '镜头01',
      '时间：4秒',
      '取景：中景',
      '摄像机角度：平视',
      '镜头运动：固定',
      '机位：办公桌正前方',
      '站位与构图：主角位于画面中央',
      '动作与神态：主角专注查看屏幕',
      '氛围与特效：日光柔和',
      '人声：无',
      '音效：键盘声',
      '转场：硬切',
      '场景名称：办公室',
      '人物名称：主角',
      '道具名称：电脑',
      '---CUT---',
    ].join('\n');

    const merged = mergeStoryboardDisplayItems(content, persisted);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('persisted-shot-1');
    expect(merged[0].scriptSegmentId).toBe('storyboard-segment-1');
    expect(merged[0].originalText).toContain('取景：中景');
    expect(merged[0].originalText).toContain('机位：办公桌正前方');
    expect(merged[0].originalText).toContain('人物名称：主角');
    expect(merged[0].originalText).toContain('道具名称：电脑');
  });

  it('keeps the immutable reply authoritative when persisted shot counts differ', () => {
    const persisted = [
      shot('persisted-shot-1', '4秒', 'storyboard-segment-1'),
      shot('persisted-shot-2', '4秒', 'storyboard-segment-1'),
    ];

    const merged = mergeStoryboardDisplayItems('镜头01\n时间：4秒\n画面描述：完整历史正文', persisted);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('persisted-shot-1');
    expect(merged[0].originalText).toContain('画面描述：完整历史正文');
  });

  it('splits legacy history without CUT markers and preserves all original fields', () => {
    const persisted = [
      shot('persisted-shot-1', '4秒'),
      shot('persisted-shot-2', '4秒'),
      shot('duplicate-shot-1', '4秒'),
      shot('duplicate-shot-2', '4秒'),
    ];
    const content = [
      '镜头1',
      '时长（秒）：4',
      '画面描述：主角坐在办公室查看电脑。',
      '光影色调：清晨暖光。',
      '镜头运动：固定',
      '',
      '镜头2',
      '时长（秒）：5',
      '画面描述：主角起身走向窗边。',
      '光影色调：柔和逆光。',
      '镜头运动：缓慢推进',
    ].join('\n');

    const merged = mergeStoryboardDisplayItems(content, persisted);

    expect(merged).toHaveLength(2);
    expect(merged.map(item => item.id)).toEqual(['persisted-shot-1', 'persisted-shot-2']);
    expect(merged[0].originalText).toContain('主角坐在办公室查看电脑');
    expect(merged[0].originalText).toContain('光影色调：清晨暖光');
    expect(merged[1].originalText).toContain('主角起身走向窗边');
    expect(getStoryboardItemDurationSeconds(merged[1])).toBe(5);
  });

  it('keeps segment prompts out of the final shot body and exposes explicit prompt sections', () => {
    const content = [
      '分段1',
      '镜头1-1',
      '时长（秒）：15',
      '画面描述：主角推门。',
      '【视觉风格】古风写实，暖黄暗调，室内光影层次丰富，略带神秘氛围。',
      '【正向稳定约束】角色、场景、机位和光影全部保持稳定。',
    ].join('\n');
    const merged = mergeStoryboardDisplayItems(content, []);

    expect(merged[0].originalText).not.toContain('【视觉风格】');
    expect(merged[0].originalText).not.toContain('【正向稳定约束】');

    const group = buildStoryboardSegmentGroups([{
      ...merged[0],
      videoPrompt: '镜头1-1，【视觉风格】古风写实，暖黄暗调。【正向稳定约束】角色、场景、机位和光影全部保持稳定。',
    }])[0];
    expect(getStoryboardSegmentPromptSections(group)).toEqual({
      visualStyle: '古风写实，暖黄暗调。',
      stabilityConstraint: '角色、场景、机位和光影全部保持稳定。',
    });
    expect(cleanStoryboardShotCardText(
      `${merged[0].originalText}\n视频提示词：${group.entries[0].item.videoPrompt}`,
    )).not.toMatch(/^镜头1-1/m);
  });

  it('restores stage-two 分镜 version content into display cards', () => {
    const content = [
      '分段1',
      '分镜1-1',
      '时长（秒）：8',
      '画面描述：孙悟空挥棒破开云海。',
      '光影色调：云海金光与暗蓝天幕对冲。',
      '分镜1-2',
      '时长（秒）：6',
      '画面描述：南天门牌匾震颤，天兵后退。',
      '光影色调：金色冲击波照亮白玉门柱。',
    ].join('\n');

    const merged = mergeStoryboardDisplayItems(content, []);

    expect(merged).toHaveLength(2);
    expect(merged[0].sourceVideoShotNo).toBe('分镜1-1');
    expect(merged[1].sourceVideoShotNo).toBe('分镜1-2');
    expect(merged[0].originalText).toContain('孙悟空挥棒破开云海');
  });

  it('removes the shot heading already rendered by the shot card', () => {
    expect(cleanStoryboardShotCardText([
      '镜头2-1',
      '时长（秒）：8',
      '画面描述：角色推门进入。',
    ].join('\n'))).toBe([
      '时长（秒）：8',
      '画面描述：角色推门进入。',
    ].join('\n'));
    expect(cleanStoryboardShotCardText([
      '分镜2-1',
      '时长（秒）：8',
      '画面描述：角色推门进入。',
    ].join('\n'))).toBe([
      '时长（秒）：8',
      '画面描述：角色推门进入。',
    ].join('\n'));
  });

  it('removes Markdown controls and parses decorated legacy shot headings', () => {
    const content = [
      '### **镜头1**',
      '- **时长（秒）**：4',
      '- **画面描述**：主角坐在办公室查看电脑。',
      '',
      '### **镜头2**',
      '- **时长（秒）**：5',
      '- **镜头运动**：缓慢推进',
    ].join('\n');

    const merged = mergeStoryboardDisplayItems(content, []);

    expect(merged).toHaveLength(2);
    expect(merged[0].originalText).toContain('镜头1');
    expect(merged[0].originalText).toContain('画面描述：主角坐在办公室查看电脑。');
    expect(merged[1].originalText).toContain('镜头运动：缓慢推进');
    expect(merged.map(item => item.originalText).join('\n')).not.toMatch(/###|\*\*/);
    expect(cleanStoryboardDisplayText(content)).not.toMatch(/###|\*\*/);
  });

  it('infers sequential groups close to the 15-second limit for legacy rows', () => {
    const groups = buildStoryboardSegmentGroups([
      shot('a', '6秒'),
      shot('b', '7秒'),
      shot('c', '5秒'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].entries.map(entry => entry.localShotNo)).toEqual([1, 2]);
    expect(groups[0].estimatedDurationSec).toBe(13);
    expect(groups[1].entries[0].localShotNo).toBe(1);
  });

  it('preserves explicit segment ids and resets the user-facing shot number', () => {
    const normalized = normalizeStoryboardItemsForWorkflow([
      shot('a', '4秒', 'segment-a'),
      shot('b', '4秒', 'segment-a'),
      shot('c', '4秒', 'segment-b'),
    ]);

    expect(normalized.map(item => item.shotNumber)).toEqual(['镜头1-1', '镜头1-2', '镜头2-1']);
    expect(normalized.map(item => item.sourceVideoShotNo)).toEqual(['镜头1-1', '镜头1-2', '镜头2-1']);
    expect(normalized[2].originalText.startsWith('镜头2-1')).toBe(true);
  });

  it('normalizes generated, persisted, and estimated workflow durations to integer seconds', () => {
    const normalized = normalizeStoryboardItemsForWorkflow([
      { ...shot('persisted', '4.5秒'), plannedDurationMs: 4500 },
      shot('explicit', '2.4秒'),
      {
        id: 'estimated',
        originalText: '办公室内',
        scriptSegment: '办公室内',
        dialogue: '你为什么要这样做我已经告诉过你很多次了',
        characters: [],
      },
    ]);

    expect(normalized.map(item => item.plannedDurationMs)).toEqual([5000, 2000, 5000]);
    expect(normalized.map(item => item.duration)).toEqual(['5秒', '2秒', '5秒']);
    expect(normalizePositiveIntegerSeconds(0.2)).toBe(1);
    expect(normalizePositiveIntegerSeconds(3.6)).toBe(4);
    expect(normalizePositiveIntegerSeconds(0)).toBeNull();
  });

  it('serializes visible segment headings and restarts shot numbers per segment', () => {
    const content = serializeStoryboardItemsWithSegments([
      shot('a', '8秒', 'segment-a'),
      shot('b', '7秒', 'segment-a'),
      shot('c', '6秒', 'segment-b'),
    ]);

    expect(content).toContain('分段1\n镜头1-1');
    expect(content).toContain('镜头1-2\nb\n时间：7秒');
    expect(content).toContain('分段2\n镜头2-1\nc\n时间：6秒');
  });

  it('renumbers globally numbered model output inside every explicit segment', () => {
    const modelOutput = [
      '分段01',
      '镜头16',
      '时间：8秒',
      '---CUT---',
      '镜头17',
      '时间：7秒',
      '---CUT---',
      '分段02',
      '镜头18',
      '时间：6秒',
      '---CUT---',
    ].join('\n');
    const parsed = parseStreamingBlocks(modelOutput).completedBlocks.map(convertToStoryboardItem);
    const content = serializeStoryboardItemsWithSegments(parsed);

    expect(content).toContain('分段1\n镜头1-1\n时间：8秒');
    expect(content).toContain('镜头1-2\n时间：7秒');
    expect(content).toContain('分段2\n镜头2-1\n时间：6秒');
    expect(content).not.toMatch(/镜头(?:16|17|18)/);
  });

  it('synchronizes every shot in a segment to one exact video prompt', () => {
    const items = [
      {
        ...shot('a', '6秒', 'segment-a'),
        videoPrompt: '镜头01-02，【视觉风格】电影感动画，【正向稳定约束】角色稳定。',
      },
      {
        ...shot('b', '7秒', 'segment-a'),
        videoPrompt: '固定镜头，人物抬头。',
      },
      {
        ...shot('c', '5秒', 'segment-b'),
        videoPrompt: '镜头01-01，【视觉风格】夜景动画，【正向稳定约束】场景稳定。',
      },
    ];

    const synchronized = synchronizeStoryboardSegmentVideoPrompts(items);

    expect(synchronized[0].videoPrompt).toBe(synchronized[1].videoPrompt);
    expect(synchronized[0].videoPrompt).toBe(
      '镜头1-1至镜头1-2，【视觉风格】电影感动画，【正向稳定约束】角色稳定。',
    );
    expect(synchronized[0].originalText).toContain(`视频提示词：${synchronized[0].videoPrompt}`);
    expect(synchronized[1].originalText).toContain(`视频提示词：${synchronized[1].videoPrompt}`);
    expect(synchronized[2].videoPrompt).toBe(
      '镜头2-1，【视觉风格】夜景动画，【正向稳定约束】场景稳定。',
    );
  });

  it('uses the new light and color field when constructing a missing shared video prompt', () => {
    const synchronized = synchronizeStoryboardSegmentVideoPrompts([
      {
        ...shot('a', '6秒', 'segment-a'),
        originalText: '镜头01\n光影色调：傍晚冷暖交织。',
      },
      {
        ...shot('b', '6秒', 'segment-a'),
        originalText: '镜头02\n光影色调：傍晚冷暖交织。',
      },
    ]);

    expect(synchronized[0].videoPrompt).toContain('【视觉风格】傍晚冷暖交织。');
    expect(synchronized[0].videoPrompt).toBe(synchronized[1].videoPrompt);
  });
});

describe('dialogue duration estimation', () => {
  it('estimates 1 second per 4 CJK chars or 8 latin chars', () => {
    expect(estimateDialogueDurationSeconds('')).toBe(0);
    expect(estimateDialogueDurationSeconds('你为什么要这样做')).toBe(2);
    expect(estimateDialogueDurationSeconds('hellowor')).toBe(1);

    expect(estimateDialogueDurationSeconds('这是真的abcdefgh')).toBe(2);
  });

  it('uses dialogue estimate when no explicit duration is present', () => {
    const item: StoryboardItem = {
      id: 'x',
      originalText: '办公室内',
      scriptSegment: '办公室内',
      dialogue: '你为什么要这样做我已经告诉过你很多次了',
      characters: [],
    };
    expect(getStoryboardItemDurationSeconds(item)).toBe(4.75);
  });

  it('keeps the 3-second floor for short or missing dialogue', () => {
    const shortDialogue: StoryboardItem = {
      id: 'y',
      originalText: '走廊',
      scriptSegment: '走廊',
      dialogue: '好',
      characters: [],
    };
    const noDialogue: StoryboardItem = {
      id: 'z',
      originalText: '空镜头：城市夜景',
      scriptSegment: '空镜头：城市夜景',
      characters: [],
    };
    expect(getStoryboardItemDurationSeconds(shortDialogue)).toBe(3);
    expect(getStoryboardItemDurationSeconds(noDialogue)).toBe(3);
  });

  it('falls back to quoted dialogue inside the script text', () => {
    const item: StoryboardItem = {
      id: 'q',
      originalText: '小明说："你为什么要这样做"',
      scriptSegment: '小明说："你为什么要这样做"',
      characters: [],
    };
    expect(getStoryboardItemDurationSeconds(item)).toBe(3);
    const longQuote: StoryboardItem = {
      id: 'q2',
      originalText: '小明说："你为什么要这样做我已经告诉过你很多次了"',
      scriptSegment: '',
      characters: [],
    };
    expect(getStoryboardItemDurationSeconds(longQuote)).toBe(4.75);
  });

  it('explicit duration fields always win over dialogue estimate', () => {
    const item: StoryboardItem = {
      id: 'e',
      duration: '10秒',
      originalText: '时间：10秒',
      scriptSegment: '时间：10秒',
      dialogue: '你为什么要这样做我已经告诉过你很多次了',
      characters: [],
    };
    expect(getStoryboardItemDurationSeconds(item)).toBe(10);
    const planned: StoryboardItem = { ...item, id: 'e2', plannedDurationMs: 7000 };
    expect(getStoryboardItemDurationSeconds(planned)).toBe(7);
  });
});
