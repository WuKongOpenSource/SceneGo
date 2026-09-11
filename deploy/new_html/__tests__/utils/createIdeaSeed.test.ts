import { describe, expect, it } from 'vitest';
import {
  CREATE_IDEA_STORAGE_KEY,
  clearCreateIdeaSeed,
  readCreateIdeaSeed,
  saveCreateIdeaSeed,
} from '../../utils/createIdeaSeed';

function createStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  };
}

describe('create idea seed', () => {
  it('binds the one-sentence idea to the newly created episode', () => {
    const storage = createStorage();
    saveCreateIdeaSeed(storage, {
      sentence: ' 深夜便利店里来了一个不会离开的顾客。 ',
      genre: '悬疑',
      durationSeconds: 60,
      orientation: 'portrait',
      aspectRatio: '9:16',
      projectId: 'project-1',
      episodeId: 'episode-1',
    });

    expect(readCreateIdeaSeed(storage, 'episode-2')).toBeNull();
    expect(readCreateIdeaSeed(storage, 'episode-1')).toMatchObject({
      sentence: '深夜便利店里来了一个不会离开的顾客。',
      projectId: 'project-1',
      episodeId: 'episode-1',
      durationSeconds: 60,
      orientation: 'portrait',
      aspectRatio: '9:16',
    });
  });

  it('keeps old combined duration seeds readable during the transition', () => {
    const storage = createStorage();
    storage.setItem(CREATE_IDEA_STORAGE_KEY, JSON.stringify({
      sentence: '旧版创意',
      duration: '60s 竖屏',
      episodeId: 'episode-1',
    }));

    expect(readCreateIdeaSeed(storage, 'episode-1')).toMatchObject({
      durationSeconds: 60,
      orientation: 'portrait',
      aspectRatio: '9:16',
    });
  });

  it('clears a seed only after the workflow has handled it', () => {
    const storage = createStorage();
    storage.setItem(CREATE_IDEA_STORAGE_KEY, JSON.stringify({ sentence: '一个新故事' }));

    expect(readCreateIdeaSeed(storage, 'episode-1')?.sentence).toBe('一个新故事');
    clearCreateIdeaSeed(storage);
    expect(readCreateIdeaSeed(storage, 'episode-1')).toBeNull();
  });

  it('ignores malformed or empty payloads', () => {
    const storage = createStorage();
    storage.setItem(CREATE_IDEA_STORAGE_KEY, '{not-json');
    expect(readCreateIdeaSeed(storage, 'episode-1')).toBeNull();
    storage.setItem(CREATE_IDEA_STORAGE_KEY, JSON.stringify({ sentence: '   ' }));
    expect(readCreateIdeaSeed(storage, 'episode-1')).toBeNull();
  });
});
