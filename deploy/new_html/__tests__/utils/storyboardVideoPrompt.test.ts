import { describe, expect, it } from 'vitest';
import {
  buildStoryboardVideoPrompt,
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
});
