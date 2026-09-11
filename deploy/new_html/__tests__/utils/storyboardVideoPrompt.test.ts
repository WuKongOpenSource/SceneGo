import { describe, expect, it } from 'vitest';
import {
  buildStoryboardVideoPrompt,
  mergeStoryboardVideoPrompts,
  upgradeLegacyStoryboardVideoPrompt,
} from '../../utils/storyboardVideoPrompt';

describe('storyboardVideoPrompt', () => {
  const shot = {
    action_text: '林夜抬头看向门口。',
    dialogue: '林夜：谁在那里？',
    video_prompt: '镜头缓慢推进，冷色办公室。',
  };

  it('carries action, dialogue, and the original video prompt', () => {
    expect(buildStoryboardVideoPrompt(shot)).toBe([
      '动作说明：林夜抬头看向门口。',
      '对白：林夜：谁在那里？',
      '视频提示词：镜头缓慢推进，冷色办公室。',
    ].join('\n'));
  });

  it('upgrades untouched legacy prompts for merged storyboard cards', () => {
    const second = {
      actionText: '贺玲玲放下文件。',
      dialogue: '贺玲玲：是我。',
      videoPrompt: '镜头固定，暖色侧光。',
    };
    expect(upgradeLegacyStoryboardVideoPrompt(
      '镜头缓慢推进，冷色办公室。\n镜头固定，暖色侧光。',
      [shot, second],
    )).toContain('动作说明：林夜抬头看向门口。');
    expect(upgradeLegacyStoryboardVideoPrompt(
      '镜头缓慢推进，冷色办公室。\n镜头固定，暖色侧光。',
      [shot, second],
    )).toContain('对白：贺玲玲：是我。');
  });

  it('preserves prompts edited by the user', () => {
    expect(upgradeLegacyStoryboardVideoPrompt('用户手工修改的提示词', [shot]))
      .toBe('用户手工修改的提示词');
  });

  it('repairs first-only legacy pairs but never replaces edited pair prompts', () => {
    const sources = [shot, { ...shot, action_text: '第二镜头动作', dialogue: '第二镜头对白' }];
    const fixed = upgradeLegacyStoryboardVideoPrompt(buildStoryboardVideoPrompt(shot), sources, true);
    expect(fixed).toContain('第二镜头动作');
    expect(fixed).toContain('第二镜头对白');
    expect(fixed.match(/视频提示词：/g)).toHaveLength(1);
    expect(upgradeLegacyStoryboardVideoPrompt('手工改写首尾帧动作', sources, true)).toBe('手工改写首尾帧动作');
  });

  it('keeps every shot action and dialogue in order, sharing only identical video blocks', () => {
    const shared = '【视觉风格】暖色。\n【正向稳定约束】人物服装一致。';
    const prompts = ['推门', '抬头', '放下菜单', '指向菜单', '转身'].map((action, i) =>
      `【镜头2-${i + 1}】\n动作说明：${action}\n对白：台词${i + 1}\n视频提示词：${shared}`);
    const result = mergeStoryboardVideoPrompts(prompts);
    expect(result.match(/视频提示词：/g)).toHaveLength(1);
    expect(result.match(/动作说明：/g)).toHaveLength(5);
    expect(result.match(/对白：/g)).toHaveLength(5);
    expect(result.indexOf('放下菜单')).toBeLessThan(result.indexOf('指向菜单'));
    expect(mergeStoryboardVideoPrompts([result])).toBe(result);
    expect(result).toContain('【正向稳定约束】人物服装一致。');
    expect(result.endsWith(`视频提示词：${shared}`)).toBe(true);
  });

  it('matches the segmented layout and never moves a segment constraint past the next segment', () => {
    const result = mergeStoryboardVideoPrompts([
      '镜头2-1\n动作说明：推门\n视频提示词：茶馆公共约束',
      '镜头2-2\n动作说明：抬头\n对白：请问\n视频提示词：茶馆公共约束',
      '镜头3-1\n动作说明：走向太空\n对白：再见\n视频提示词：月球公共约束',
    ]);
    expect(result).toBe('镜头2-1\n动作说明：推门\n镜头2-2\n动作说明：抬头\n对白：请问\n视频提示词：茶馆公共约束\n镜头3-1\n动作说明：走向太空\n对白：再见\n视频提示词：月球公共约束');
    expect(mergeStoryboardVideoPrompts([result])).toBe(result);
  });

  it('never removes repeated actions or distinct scene constraints', () => {
    const result = mergeStoryboardVideoPrompts([
      '动作说明：点头\n视频提示词：暖色', '动作说明：点头\n视频提示词：冷色',
    ]);
    expect(result.match(/动作说明：点头/g)).toHaveLength(2);
    expect(result).toContain('视频提示词：暖色');
    expect(result).toContain('视频提示词：冷色');
  });

  it('recovers all actions in untouched historical merged defaults and keeps later manual edits', () => {
    const sources = [shot, { ...shot, action_text: '转身走出门。', dialogue: '再见。' }];
    const restored = upgradeLegacyStoryboardVideoPrompt(sources.map(s => s.video_prompt).join('\n'), sources);
    expect(restored.match(/视频提示词：/g)).toHaveLength(1);
    expect(restored).toContain('转身走出门。');
    const edited = restored + '\n动作说明：手工增加的停顿动作。';
    const remerged = mergeStoryboardVideoPrompts([edited, buildStoryboardVideoPrompt(shot)]);
    expect(remerged).toContain('手工增加的停顿动作。');
    expect(remerged.match(/视频提示词：/g)).toHaveLength(1);
    expect(mergeStoryboardVideoPrompts(['手工提示，没有结构标记。'])).toBe('手工提示，没有结构标记。');
  });
});
