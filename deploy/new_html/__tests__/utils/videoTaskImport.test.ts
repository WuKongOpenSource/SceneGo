import { describe, expect, it } from 'vitest';
import { buildVideoTaskImport } from '../../utils/videoTaskImport';

describe('buildVideoTaskImport', () => {
  it('converts project video tasks into workspace images, groups, and prompts', () => {
    let t = 1000;
    const result = buildVideoTaskImport([
      {
        image_url: '/uploads/shot.png',
        storyboard_id: 'sb_1',
        scene: 'living-room',
        video_prompt: 'camera pans right',
        action_text: '主角走向窗边。',
        dialogue: '主角：看那边。',
      },
    ], {
      normalizeUrl: url => `secure:${url}`,
      now: () => t++,
      random: () => 0.123456789,
    });

    expect(result.skipped).toEqual([]);
    expect(result.images).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^img_1000_0_/),
        url: 'secure:/uploads/shot.png',
        storageUrl: 'secure:/uploads/shot.png',
        filename: 'living-room_sb_1.png',
        uploadTime: 1000,
      }),
    ]);
    expect(result.groups).toEqual([
      expect.objectContaining({
        uuid: expect.stringMatching(/^task_1001_/),
        ids: [result.images[0].id],
        model: 'HappyHorse',
        createdAt: 1001,
      }),
    ]);
    expect(result.prompts[result.images[0].id]).toBe([
      '动作说明：主角走向窗边。',
      '对白：主角：看那边。',
      '视频提示词：camera pans right',
    ].join('\n'));
  });

  it('skips tasks without a usable image url', () => {
    const result = buildVideoTaskImport([
      { storyboard_id: 'sb_missing', image_url: '', video_prompt: 'unused' },
    ], {
      normalizeUrl: () => '',
      now: () => 1,
      random: () => 0.5,
    });

    expect(result.images).toHaveLength(0);
    expect(result.groups).toHaveLength(0);
    expect(result.prompts).toEqual({});
    expect(result.skipped).toEqual([
      { storyboardId: 'sb_missing', reason: 'missing_image_url' },
    ]);
  });

  it('links the latest resolved binding to the imported generation card', () => {
    let t = 2000;
    const result = buildVideoTaskImport([{
      image_url: '/uploads/keyframe.png',
      storyboard_id: 'sb_1',
      resolved_bindings: [
        {
          binding_id: 'binding_1',
          binding_version: 4,
          tag_key: 'char:小悟',
          scope: 'shot',
          file_id: 'file_reference',
          file_url: '/uploads/reference.png',
          is_disabled: false,
        },
        {
          binding_id: 'binding_disabled',
          tag_key: 'scene:旧场景',
          scope: 'shot',
          file_url: '/uploads/disabled.png',
          is_disabled: true,
        },
      ],
    }], {
      normalizeUrl: url => `secure:${url}`,
      now: () => t++,
      random: () => 0.25,
    });

    expect(result.groups).toHaveLength(1);
    expect(result.images).toHaveLength(2);
    expect(result.images[1]).toEqual(expect.objectContaining({
      fileId: 'file_reference',
      url: 'secure:/uploads/reference.png',
      linkedGroupUuids: [result.groups[0].uuid],
      tags: ['char:小悟', 'shot'],
    }));
  });
});
