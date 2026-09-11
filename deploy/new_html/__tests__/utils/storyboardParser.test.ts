import { describe, expect, it } from 'vitest';
import {
  convertToStoryboardItem,
  estimateDialogueDurationSeconds,
  parseStreamingBlocks,
} from '../../utils/storyboardParser';

describe('storyboard dialogue duration', () => {
  it('estimates Chinese and English dialogue with their configured speaking rates', () => {
    expect(estimateDialogueDurationSeconds('女生：“一二三四五六七八。”')).toBe(2);
    expect(estimateDialogueDurationSeconds('Narrator: "abcdefgh12345678"')).toBe(2);
    expect(estimateDialogueDurationSeconds('角色：“一二三四abcdefgh”')).toBe(2);
  });

  it('raises a shot duration when it cannot contain the complete dialogue', () => {
    const item = convertToStoryboardItem({
      shotId: '镜头01',
      时间: '1秒',
      人声: '女生：“一二三四五六七八。”',
    });

    expect(item.duration).toBe('2秒');
    expect(item.originalText).toContain('时间：2秒');
  });

  it('keeps a longer authored duration intact', () => {
    const item = convertToStoryboardItem({
      shotId: '镜头01',
      时间: '4秒',
      人声: '女生：“一二三四五六七八。”',
    });

    expect(item.duration).toBe('4秒');
  });

  it('carries standalone segment headings across shot blocks', () => {
    const parsed = parseStreamingBlocks([
      '分段01',
      '镜头01',
      '时间：4秒',
      '---CUT---',
      '镜头02',
      '时间：5秒',
      '---CUT---',
      '分段02',
      '镜头03',
      '时间：4秒',
      '---CUT---',
    ].join('\n'));

    expect(parsed.completedBlocks.map(block => block.segmentNo)).toEqual([1, 1, 2]);
  });

  it('parses stage-two 分镜 headers without dropping the block', () => {
    const parsed = parseStreamingBlocks([
      '分段01',
      '分镜1-1',
      '时长（秒）：8',
      '画面描述：孙悟空挥棒破开云海。',
      '分镜生成提示词：近景，仰拍，孙悟空挥动金箍棒，云海金光撕裂。',
      '---CUT---',
    ].join('\n'));
    const item = convertToStoryboardItem(parsed.completedBlocks[0]);

    expect(parsed.completedBlocks).toHaveLength(1);
    expect(parsed.completedBlocks[0].shotId).toBe('分镜1-1');
    expect(item.shotNumber).toBe('分镜1-1');
    expect(item.sourceVideoShotNo).toBe('分镜1-1');
    expect(item.scriptSegment).toContain('孙悟空挥棒');
  });

  it('does not merge segment prompt cards into the last shot field', () => {
    const parsed = parseStreamingBlocks([
      '分段1',
      '镜头1-1',
      '时间：8秒',
      '道具名称：手机',
      '【视觉风格】现代都市写实，冲突爆发的冷峻张力，硬光强化愤怒情绪，胶片感影调。',
      '【正向稳定约束】无背景音乐，保持无字幕、不要生成Logo、不要生成水印。',
      '---CUT---',
    ].join('\n'));

    expect(parsed.completedBlocks[0].道具名称).toBe('手机');
    expect(parsed.completedBlocks[0].道具名称).not.toContain('视觉风格');
    expect(parsed.completedBlocks[0].道具名称).not.toContain('正向稳定约束');
  });

  it('prioritizes an explicit shared video prompt over the legacy motion fallback', () => {
    const sharedPrompt = '镜头01-03，【视觉风格】清新动画，【正向稳定约束】角色与场景稳定。';
    const item = convertToStoryboardItem({
      shotId: '镜头01',
      镜头运动: '固定',
      动作与神态: '主角抬头',
      视频提示词: sharedPrompt,
    });

    expect(item.videoPrompt).toBe(sharedPrompt);
    expect(item.originalText).toContain(`视频提示词：${sharedPrompt}`);
  });

  it('maps the new three-step prompt fields into the platform storyboard schema', () => {
    const parsed = parseStreamingBlocks([
      '分段01',
      '镜头01',
      '时长（秒）：4',
      '景别：中近景',
      '画面描述：女主角坐在桌前抬头，随后望向窗外。',
      '分镜生成提示词：中近景，平视，女主角坐在桌前抬头，傍晚暖光。',
      '拍摄角度：平视',
      '运镜方式：缓慢推进',
      '光影色调：傍晚冷暖交织。',
      '画质：4K，电影质感。',
      '转场：硬切',
      '人声：女主角：“我知道了。”',
      '音效：环境底噪。',
      '人物名称：女主角',
      '场景名称：办公室',
      '道具名称：电脑',
      '视频提示词：镜头01-02，【视觉风格】电影感动画，【正向稳定约束】角色稳定。',
      '---CUT---',
    ].join('\n'));
    const item = convertToStoryboardItem(parsed.completedBlocks[0]);

    expect(item.duration).toBe('4秒');
    expect(item.scriptSegment).toBe('女主角坐在桌前抬头，随后望向窗外。');
    expect(item.imagePrompt).toBe('中近景，平视，女主角坐在桌前抬头，傍晚暖光。');
    expect(item.videoPrompt).toContain('【视觉风格】电影感动画');
    expect(item.dialogue).toContain('我知道了');
    expect(item.originalText).toContain('景别：中近景');
    expect(item.originalText).toContain('拍摄角度：平视');
    expect(item.originalText).toContain('运镜方式：缓慢推进');
    expect(item.shotSize).toBe('中近景');
    expect(item.cameraAngle).toBe('平视');
    expect(item.cameraMovement).toBe('中近景，缓慢推进，平视');
    expect(item.plannedDurationMs).toBe(4000);
    expect(item.videoScriptBlock).toBe(item.originalText);
    expect(item.originalText).not.toContain('站位与构图');
    expect(item.originalText).not.toContain('动作与神态');
  });

  it('continues to parse persisted legacy fields without emitting an empty shot', () => {
    const item = convertToStoryboardItem({
      shotId: '镜头01',
      取景: '中景',
      摄像机角度: '平视',
      镜头运动: '固定',
      站位与构图: '主角位于画面中央',
      动作与神态: '主角抬头观察屏幕',
      氛围与特效: '室内冷色光',
    });

    expect(item.imagePrompt).toContain('主角位于画面中央');
    expect(item.videoPrompt).toContain('主角抬头观察屏幕');
    expect(item.originalText).toContain('站位与构图：主角位于画面中央');
  });
});
