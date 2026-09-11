import type { FileVersion, ProjectFile, ScriptConversation, ScriptStoryboardVersion } from '../types';

export const STORYBOARD_SNAPSHOTS_METADATA_KEY = 'storyboardSnapshots';

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isSnapshot(value: unknown): value is FileVersion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Partial<FileVersion>;
  return Boolean(
    snapshot.id
    && snapshot.name
    && Number.isFinite(Number(snapshot.timestamp))
    && snapshot.data
    && typeof snapshot.data === 'object',
  );
}

export function createStoryboardSnapshot(
  file: ProjectFile,
  options: {
    id: string;
    timestamp: number;
    name: string;
    source: 'auto' | 'manual';
    scriptVersionId?: string;
  },
): FileVersion {
  return cloneValue({
    id: options.id,
    timestamp: options.timestamp,
    name: options.name,
    source: options.source,
    scriptVersionId: options.scriptVersionId,
    data: {
      name: file.name,
      originalContent: file.originalContent,
      scriptContent: file.scriptContent,
      storyboard: file.storyboard,
      extractedCharacters: file.extractedCharacters,
      extractedScenes: file.extractedScenes,
      extractedProps: file.extractedProps,
      lastUpdated: file.lastUpdated,
      scriptSegments: file.scriptSegments,
      generationStages: file.generationStages,
    },
  });
}

export function getVersionStoryboardSnapshots(version: ScriptStoryboardVersion): FileVersion[] {
  const raw = version.metadata?.[STORYBOARD_SNAPSHOTS_METADATA_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isSnapshot)
    .map(snapshot => cloneValue({
      ...snapshot,
      source: snapshot.source === 'auto' ? 'auto' : 'manual',
      scriptVersionId: snapshot.scriptVersionId || version.id,
      timestamp: Number(snapshot.timestamp),
    }));
}

export function mergeStoryboardSnapshots(...groups: FileVersion[][]): FileVersion[] {
  const byId = new Map<string, FileVersion>();
  groups.flat().forEach(snapshot => {
    if (isSnapshot(snapshot)) byId.set(snapshot.id, cloneValue(snapshot));
  });
  return [...byId.values()].sort((left, right) => left.timestamp - right.timestamp);
}

export function collectConversationStoryboardSnapshots(conversation: ScriptConversation): FileVersion[] {
  return mergeStoryboardSnapshots(
    ...conversation.versions.map(getVersionStoryboardSnapshots),
  );
}

export function resolvePersistableStoryboardVersion(
  conversation: ScriptConversation | undefined,
  preferredVersion?: ScriptStoryboardVersion,
): ScriptStoryboardVersion | undefined {
  const versions = conversation?.versions || [];
  const currentVersion = versions.find(version => version.id === conversation?.currentVersionId);
  const candidates = [preferredVersion, currentVersion, ...[...versions].reverse()];
  return candidates.find(version => Boolean(
    version?.id
    && !version.id.startsWith('legacy_'),
  ));
}

export function cloneStoryboardSnapshot(snapshot: FileVersion): FileVersion {
  return cloneValue(snapshot);
}
