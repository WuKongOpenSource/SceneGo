import { describe, expect, it } from 'vitest';
import {
  buildStoryboardImageSyncPatch,
  countOutdatedStoryboardImages,
} from '../../utils/videoStoryboardImageSync';
import type { WorkspaceSession } from '../../services/videoWorkspaceService';

function sessionFixture(): WorkspaceSession {
  return {
    task_groups: [{ uuid: 'group-1', ids: ['sb_1'], model: 'HappyHorse', shotType: 'single' }],
    uploaded_images: [{
      id: 'sb_1',
      storyboardItemId: 'sb_1',
      url: '/old.png?token=old',
      storageUrl: '/old.png?token=old',
      filename: 'old.png',
      uploadTime: 1,
      tags: [],
      linkedGroupUuids: ['group-1'],
    }],
    image_prompts: {},
    tasks_status: {
      'group-1': { state: 'done', videos: ['/finished.mp4'], result: '/finished.mp4' },
    },
    seedance_params: {
      'group-1': {
        sub_model: 'standard',
        prompt: '原提示词',
        media_inputs: [
          { kind: 'image', url: '/old.png', role: 'reference_image' },
          { kind: 'audio', url: '/voice.mp3', role: 'reference_audio' },
        ],
      },
    },
    dashscope_params: {
      'group-1': {
        model: 'HappyHorse',
        prompt: '原提示词',
        media_inputs: [
          { kind: 'image', url: '/old.png', file_id: 'old-file', role: 'reference_image' },
        ],
      },
    },
  };
}

describe('video storyboard image sync', () => {
  it('updates uploaded, Seedance, and DashScope image references without changing generated results', () => {
    const session = sessionFixture();
    const patch = buildStoryboardImageSyncPatch(session, { sb_1: '/latest.png' });

    expect(patch.uploaded_images[0]).toMatchObject({
      url: '/latest.png',
      storageUrl: '/latest.png',
      isPlaceholder: false,
    });
    expect(patch.seedance_params?.['group-1'].media_inputs).toEqual([
      expect.objectContaining({ kind: 'image', url: '/latest.png', role: 'reference_image' }),
      expect.objectContaining({ kind: 'audio', url: '/voice.mp3', role: 'reference_audio' }),
    ]);
    expect(patch.dashscope_params?.['group-1'].media_inputs?.[0]).toMatchObject({
      kind: 'image',
      url: '/latest.png',
      role: 'reference_image',
    });
    expect(patch.dashscope_params?.['group-1'].media_inputs?.[0].file_id).toBeUndefined();
    expect(session.tasks_status['group-1'].videos).toEqual(['/finished.mp4']);
  });

  it('reports no remaining change only after every persisted model reference matches', () => {
    const session = sessionFixture();
    expect(countOutdatedStoryboardImages(session, { sb_1: '/latest.png' })).toBe(1);

    const patch = buildStoryboardImageSyncPatch(session, { sb_1: '/latest.png' });
    const synced = { ...session, ...patch };
    expect(countOutdatedStoryboardImages(synced, { sb_1: '/latest.png' })).toBe(0);
  });

  it('updates both first and last frames for a two-storyboard task', () => {
    const session = sessionFixture();
    session.task_groups[0].ids = ['sb_1', 'sb_2'];
    session.uploaded_images.push({
      ...session.uploaded_images[0],
      id: 'sb_2',
      storyboardItemId: 'sb_2',
      url: '/old-last.png',
    });
    session.seedance_params!['group-1'].media_inputs = [
      { kind: 'image', url: '/old.png', role: 'first_frame' },
      { kind: 'image', url: '/old-last.png', role: 'last_frame' },
    ];

    const patch = buildStoryboardImageSyncPatch(session, {
      sb_1: '/latest-first.png',
      sb_2: '/latest-last.png',
    });

    expect(patch.seedance_params?.['group-1'].media_inputs).toEqual([
      expect.objectContaining({ url: '/latest-first.png', role: 'first_frame' }),
      expect.objectContaining({ url: '/latest-last.png', role: 'last_frame' }),
    ]);
    expect(countOutdatedStoryboardImages({ ...session, ...patch }, {
      sb_1: '/latest-first.png',
      sb_2: '/latest-last.png',
    })).toBe(0);
  });
});
