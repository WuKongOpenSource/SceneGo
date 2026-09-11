export type ScriptWorkspaceMode = 'writing' | 'quick' | 'reverse';

export const DEFAULT_SCRIPT_WORKSPACE_MODE: ScriptWorkspaceMode = 'writing';
export const SCRIPT_WORKSPACE_MODE_STORAGE_PREFIX = 'ostory:script-workspace-mode:v1';

type ScriptWorkspaceModeStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function getScriptWorkspaceModeStorageKey(username?: string | null): string {
  const userScope = username?.trim().toLocaleLowerCase() || 'anonymous';
  return `${SCRIPT_WORKSPACE_MODE_STORAGE_PREFIX}:${encodeURIComponent(userScope)}`;
}

export function readScriptWorkspaceMode(
  storage: ScriptWorkspaceModeStorage,
  username?: string | null,
): ScriptWorkspaceMode {
  const value = storage.getItem(getScriptWorkspaceModeStorageKey(username));
  return value === 'quick' || value === 'writing' || value === 'reverse'
    ? value
    : DEFAULT_SCRIPT_WORKSPACE_MODE;
}

export function writeScriptWorkspaceMode(
  storage: ScriptWorkspaceModeStorage,
  username: string | null | undefined,
  mode: ScriptWorkspaceMode,
): void {
  storage.setItem(getScriptWorkspaceModeStorageKey(username), mode);
}
