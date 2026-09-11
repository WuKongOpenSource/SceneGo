import { describe, expect, it, vi } from 'vitest';
vi.mock('@runtime/videoTaskService', () => ({ generateUUID: () => crypto.randomUUID() }));
import { buildEmptyTaskGroup } from '../../utils/videoTaskInsert';

describe('new video cards', () => {
  it('defaults new blank cards to Seedance 1.5 Pro and preserves explicit models', () => {
    const first = buildEmptyTaskGroup();
    expect(first.group.model).toBe('Seedance15');
    expect(first.image.isPlaceholder).toBe(true);
    expect(first.group.ids).toEqual([first.image.id]);
    expect(buildEmptyTaskGroup('HappyHorse').group.model).toBe('HappyHorse');
    expect(buildEmptyTaskGroup().group.uuid).not.toBe(first.group.uuid);
  });
});
