import { describe, expect, it } from 'vitest';
import { importStoryboardIntoWorkspace, type WorkspaceSession } from '../../services/videoWorkspaceService';

const incoming: WorkspaceSession = {
  task_groups: [{ uuid: 'new1', ids: ['sb_1'], model: 'Seedance15' }, { uuid: 'new2', ids: ['sb_2'], model: 'Seedance15' }],
  uploaded_images: ['sb_1', 'sb_2'].map(id => ({ id, storyboardItemId: id, url: `/${id}.png`, filename: id, uploadTime: 0 })),
  image_prompts: { sb_1: 'script', sb_2: 'new' }, tasks_status: {},
  seedance_params: { new1: { sub_model: 'agent_plan', prompt: 'script', media_inputs: [] }, new2: { sub_model: 'agent_plan', prompt: 'new', media_inputs: [] } },
};

describe('non-destructive storyboard import', () => {
  it('keeps manual cards, their order, prompts, tails and results, without duplicates on repeat', () => {
    const current: WorkspaceSession = {
      task_groups: [{ uuid: 'old', ids: ['sb_1'], model: 'Seedance15' }, { uuid: 'blank', ids: ['manual-image'], model: 'HappyHorse' }],
      uploaded_images: [{ id: 'sb_1', storyboardItemId: 'sb_1', url: '/old.png', filename: '', uploadTime: 0 },
        { id: 'manual-image', url: '/manual.png', filename: '', uploadTime: 0 }],
      image_prompts: { sb_1: 'edited', 'manual-image': 'my manual prompt' },
      tasks_status: { old: { state: 'pending', taskId: 'running' }, blank: { state: 'done', videos: ['/result.mp4'] } },
      seedance_params: { old: { sub_model: 'agent_plan', prompt: 'edited', media_inputs: [
        { kind: 'image', url: '/old.png', role: 'first_frame' }, { kind: 'image', url: '/tail.png', role: 'last_frame' },
      ] } },
    };
    const result = importStoryboardIntoWorkspace(current, incoming);
    expect(result.task_groups.map(group => group.uuid)).toEqual(['old', 'blank', 'new2']);
    expect(result.tasks_status).toEqual(current.tasks_status);
    expect(result.image_prompts.sb_1).toBe('edited');
    expect(result.uploaded_images[1]).toEqual(current.uploaded_images[1]);
    expect(result.seedance_params?.old.media_inputs.map(item => item.url)).toEqual(['/sb_1.png', '/tail.png']);
    expect(importStoryboardIntoWorkspace(result, incoming)).toEqual(result);
    expect(current.seedance_params?.old.media_inputs[0].url).toBe('/old.png');
  });

  it('does not split an existing merged group into duplicate cards', () => {
    const current = { ...incoming, task_groups: [{ uuid: 'merged', ids: ['sb_1', 'sb_2'], model: 'Seedance15' as const }] };
    expect(importStoryboardIntoWorkspace(current, incoming).task_groups).toEqual(current.task_groups);
  });
});
