import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCRIPT_WORKSPACE_MODE,
  getScriptWorkspaceModeStorageKey,
  readScriptWorkspaceMode,
  writeScriptWorkspaceMode,
} from '../../utils/scriptWorkspaceMode';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

describe('script workspace mode preference', () => {
  it('defaults every user to writing mode when no valid preference exists', () => {
    const storage = createStorage();

    expect(readScriptWorkspaceMode(storage, 'new-user')).toBe(DEFAULT_SCRIPT_WORKSPACE_MODE);
    storage.setItem(getScriptWorkspaceModeStorageKey('new-user'), 'legacy');
    expect(readScriptWorkspaceMode(storage, 'new-user')).toBe('writing');
  });

  it('persists mode independently for each signed-in user', () => {
    const storage = createStorage();

    writeScriptWorkspaceMode(storage, 'Alice', 'quick');
    writeScriptWorkspaceMode(storage, 'Bob', 'writing');
    writeScriptWorkspaceMode(storage, 'Carol', 'reverse');

    expect(readScriptWorkspaceMode(storage, 'alice')).toBe('quick');
    expect(readScriptWorkspaceMode(storage, 'bob')).toBe('writing');
    expect(readScriptWorkspaceMode(storage, 'carol')).toBe('reverse');
    expect(getScriptWorkspaceModeStorageKey('Alice')).not.toBe(
      getScriptWorkspaceModeStorageKey('Bob'),
    );
  });
});
