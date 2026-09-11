import { describe, expect, it } from 'vitest';

import type { StoryboardItem } from '../../types';
import { buildScriptAssetDescriptionRows } from '../../utils/scriptAssetDescriptions';

function shot(overrides: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: 'shot-1',
    originalText: '',
    scriptSegment: '',
    ...overrides,
  };
}

describe('script asset descriptions', () => {
  it('carries explicit character appearance details into the exported design prompt', () => {
    const rows = buildScriptAssetDescriptionRows('character', ['阿壳'], [
      shot({
        characters: ['机器人阿壳'],
        imagePrompt: '机器人阿壳站在吧台旁，银灰色圆润外壳，头部两侧带圆形接收器，胸口屏幕显示淡蓝光。',
      }),
    ]);

    expect(rows).toEqual([{
      name: '阿壳',
      description: '机器人阿壳站在吧台旁，银灰色圆润外壳，头部两侧带圆形接收器，胸口屏幕显示淡蓝光。',
    }]);
  });

  it('uses named script sentences as a fallback without exporting structural fields', () => {
    const rows = buildScriptAssetDescriptionRows(
      'character',
      ['阿壳'],
      [],
      '人物名称：阿壳\n阿壳是银灰色圆润机器人，胸口屏幕显示淡蓝光。\n场景名称：茶馆',
    );

    expect(rows[0].description).toBe('阿壳是银灰色圆润机器人，胸口屏幕显示淡蓝光。');
    expect(rows[0].description).not.toContain('人物名称');
  });

  it('does not copy an unnamed multi-character shot into every character prompt', () => {
    const rows = buildScriptAssetDescriptionRows('character', ['阿壳', '女店主'], [
      shot({
        characters: ['阿壳', '女店主'],
        imagePrompt: '两人站在吧台两侧交谈。',
      }),
    ]);

    expect(rows.map(row => row.description)).toEqual(['', '']);
  });
});
