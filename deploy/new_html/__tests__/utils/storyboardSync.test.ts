import { beforeEach, describe, expect, it, vi } from 'vitest';

const { patchWorkspaceSessionMock, saveWorkspaceSessionMock } = vi.hoisted(() => ({
  patchWorkspaceSessionMock: vi.fn(),
  saveWorkspaceSessionMock: vi.fn(),
}));

vi.mock('../../services/videoWorkspaceService', () => ({
  computeReactiveDurationFromMeta: vi.fn(() => 5),
  patchWorkspaceSession: patchWorkspaceSessionMock,
  saveWorkspaceSession: saveWorkspaceSessionMock,
}));

import { applySyncStrategy } from '../../utils/storyboardSync';

const emptySession = {
  task_groups: [],
  uploaded_images: [],
  image_prompts: {},
  tasks_status: {},
  seedance_params: {},
  storyboard_meta: {},
};

describe('storyboardSync', () => {
  beforeEach(() => {
    patchWorkspaceSessionMock.mockReset();
    saveWorkspaceSessionMock.mockReset();
  });

  it('adds dialogue audio as Seedance reference_audio when mixed audio is absent', async () => {
    await applySyncStrategy('add_new', [{
      item_id: 'sb_1',
      sort_order: 0,
      generated_image_url: '/storage/image/shot.png',
      video_prompt: 'shot prompt',
      action_text: '角色推门进入房间。',
      dialogue: '角色：我回来了。',
      dialogue_audio_url: '/storage/audio/dialogue.mp3',
    }], emptySession, 'ep_1');

    expect(patchWorkspaceSessionMock).toHaveBeenCalledTimes(1);
    const mutator = patchWorkspaceSessionMock.mock.calls[0][1];
    const patch = mutator(emptySession);
    const params = Object.values(patch.seedance_params)[0] as any;

    expect(params.media_inputs).toEqual([
      { kind: 'image', url: '/storage/image/shot.png', role: 'reference_image' },
      { kind: 'audio', url: '/storage/audio/dialogue.mp3', role: 'reference_audio' },
    ]);
    expect(params.prompt).toBe([
      '动作说明：角色推门进入房间。',
      '对白：角色：我回来了。',
      '视频提示词：shot prompt',
    ].join('\n'));
  });

  it('prefers mixed audio over individual storyboard audio tracks', async () => {
    await applySyncStrategy('add_new', [{
      item_id: 'sb_2',
      sort_order: 1,
      generated_image_url: '/storage/image/shot2.png',
      mixed_audio_url: '/storage/audio/mixed.mp3',
      dialogue_audio_url: '/storage/audio/dialogue.mp3',
    }], emptySession, 'ep_1');

    const mutator = patchWorkspaceSessionMock.mock.calls[0][1];
    const patch = mutator(emptySession);
    const params = Object.values(patch.seedance_params)[0] as any;

    expect(params.media_inputs.find((m: any) => m.kind === 'audio')).toEqual({
      kind: 'audio',
      url: '/storage/audio/mixed.mp3',
      role: 'reference_audio',
    });
  });

  it('keeps storyboard text in placeholder cards that have no image', async () => {
    await applySyncStrategy('add_new', [{
      id: 'sb_placeholder',
      sort_order: 2,
      generated_image_url: '',
      action_text: '角色转身。',
      dialogue: '角色：出发。',
      video_prompt: '镜头向前推进。',
    }], emptySession, 'ep_1');

    const mutator = patchWorkspaceSessionMock.mock.calls[0][1];
    const patch = mutator(emptySession);
    const params = Object.values(patch.seedance_params)[0] as any;

    expect(params.prompt).toContain('动作说明：角色转身。');
    expect(params.prompt).toContain('对白：角色：出发。');
    expect(params.prompt).not.toBe('@');
    expect(patch.uploaded_images[0].storyboardItemId).toBe('sb_placeholder');
  });
});
