import { describe, expect, it } from 'vitest';
import { mergeWorkspaceSessions } from '../../services/videoWorkspaceService';

describe('mergeWorkspaceSessions', () => {
  it('combines legacy script workspaces into one additive episode chain', () => {
    const merged = mergeWorkspaceSessions([
      {
        task_groups: [{ id: 'group_a', label: 'A' }] as any,
        uploaded_images: [{ uuid: 'image_a', name: 'A' }] as any,
        image_prompts: { image_a: 'prompt A' },
        tasks_status: { task_a: 'completed' } as any,
        dashscope_params: { group_a: { model: 'HappyHorse', prompt: 'legacy A' } as any },
      },
      {
        task_groups: [{ id: 'group_b', label: 'B' }] as any,
        uploaded_images: [{ uuid: 'image_b', name: 'B' }] as any,
        image_prompts: { image_b: 'prompt B' },
        tasks_status: { task_b: 'running' } as any,
        dashscope_params: { group_b: { model: 'Vidu', prompt: 'legacy B' } as any },
      },
    ]);

    expect(merged.task_groups.map((item: any) => item.id)).toEqual(['group_a', 'group_b']);
    expect(merged.uploaded_images.map((item: any) => item.uuid)).toEqual(['image_a', 'image_b']);
    expect(merged.image_prompts).toEqual({ image_a: 'prompt A', image_b: 'prompt B' });
    expect(Object.keys(merged.dashscope_params || {})).toEqual(['group_a', 'group_b']);
  });

  it('deduplicates existing records while keeping the current episode version', () => {
    const merged = mergeWorkspaceSessions([
      {
        task_groups: [{ id: 'group_a', label: 'legacy' }] as any,
        uploaded_images: [],
        image_prompts: {},
        tasks_status: {},
      },
      {
        task_groups: [{ id: 'group_a', label: 'current' }] as any,
        uploaded_images: [],
        image_prompts: {},
        tasks_status: {},
      },
    ]);

    expect(merged.task_groups).toHaveLength(1);
    expect((merged.task_groups[0] as any).label).toBe('current');
  });
});
