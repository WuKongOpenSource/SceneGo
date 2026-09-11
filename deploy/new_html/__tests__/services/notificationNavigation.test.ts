import { describe, expect, it } from 'vitest';
import type { RegisteredTask } from '../../types';
import { buildNotificationTargetUrl } from '../../services/notificationNavigation';

function task(overrides: Partial<RegisteredTask> = {}): RegisteredTask {
  return {
    taskId: 'gemini_img_1',
    kind: 'gemini-image',
    title: 'AI 生图任务',
    status: 'completed',
    createdAt: Date.now(),
    targetPage: 'generation',
    targetProjectId: 'proj_1',
    episodeId: 'ep_1',
    targetEntityType: 'storyboard_item',
    targetEntityId: 'shot_06',
    targetItemId: 'shot_06',
    ...overrides,
  };
}

describe('buildNotificationTargetUrl', () => {
  it('deep-links storyboard image notifications to the originating shot', () => {
    expect(buildNotificationTargetUrl(task())).toBe(
      '/projects/proj_1/ep/ep_1/workflow/storyboard?shotId=shot_06',
    );
  });

  it('uses the storyboard entity id when the explicit item id is absent', () => {
    expect(buildNotificationTargetUrl(task({ targetItemId: undefined }))).toContain(
      'shotId=shot_06',
    );
  });

  it('keeps non-storyboard destinations free of shot query parameters', () => {
    expect(buildNotificationTargetUrl(task({ targetPage: 'video' }))).toBe(
      '/projects/proj_1/ep/ep_1/workflow/video',
    );
  });

  it('falls back to the episode list when legacy data lacks an episode id', () => {
    expect(buildNotificationTargetUrl(task({ episodeId: undefined }))).toBe(
      '/projects/proj_1/episodes',
    );
  });

  it('opens standalone tools even when a task has no project context', () => {
    expect(buildNotificationTargetUrl(task({
      targetPage: 'image-upscale',
      targetProjectId: undefined,
      episodeId: undefined,
    }))).toBe('/tools/image-upscale');
  });

  it('keeps utility notifications on their global routes when project metadata exists', () => {
    expect(buildNotificationTargetUrl(task({ targetPage: 'history' }))).toBe('/tools/history');
    expect(buildNotificationTargetUrl(task({ targetPage: 'media-library' }))).toBe('/tools/media-library');
  });
});
