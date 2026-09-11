import { describe, expect, it } from 'vitest';
import { FileStatus, type ProjectFile, type ScriptConversation } from '../../types';
import {
  collectConversationStoryboardSnapshots,
  createStoryboardSnapshot,
  mergeStoryboardSnapshots,
  resolvePersistableStoryboardVersion,
} from '../../utils/storyboardSnapshots';

const file: ProjectFile = {
  id: 'script-1',
  name: '分集剧本',
  originalContent: '原始内容',
  scriptContent: '分镜内容',
  storyboard: {
    items: [{
      id: 'shot-1',
      shotNumber: '镜头01',
      originalText: '',
      scriptSegment: '',
    }],
  },
  extractedCharacters: ['角色A'],
  extractedScenes: ['场景A'],
  status: FileStatus.Completed,
  lastUpdated: 100,
  versions: [],
};

describe('storyboardSnapshots', () => {
  it('creates an immutable snapshot of the current storyboard', () => {
    const snapshot = createStoryboardSnapshot(file, {
      id: 'snapshot-1',
      timestamp: 1000,
      name: '自动存档',
      source: 'auto',
      scriptVersionId: 'version-1',
    });

    file.storyboard!.items[0].shotNumber = '已修改';

    expect(snapshot.data.storyboard?.items[0].shotNumber).toBe('镜头01');
    expect(snapshot.source).toBe('auto');
    expect(snapshot.scriptVersionId).toBe('version-1');
  });

  it('collects persisted snapshots from every script version without duplicates', () => {
    const first = createStoryboardSnapshot(file, {
      id: 'snapshot-1', timestamp: 2000, name: '第一次', source: 'auto', scriptVersionId: 'version-1',
    });
    const second = createStoryboardSnapshot(file, {
      id: 'snapshot-2', timestamp: 3000, name: '第二次', source: 'manual', scriptVersionId: 'version-2',
    });
    const conversation = {
      scriptId: 'script-1',
      messages: [],
      versions: [
        { id: 'version-1', metadata: { storyboardSnapshots: [first] } },
        { id: 'version-2', metadata: { storyboardSnapshots: [second, first] } },
      ],
    } as unknown as ScriptConversation;

    expect(collectConversationStoryboardSnapshots(conversation).map(item => item.id)).toEqual([
      'snapshot-1',
      'snapshot-2',
    ]);
    expect(mergeStoryboardSnapshots([second], [first]).map(item => item.id)).toEqual([
      'snapshot-1',
      'snapshot-2',
    ]);
  });

  it('falls back from a local legacy version to the latest server-backed version', () => {
    const conversation = {
      scriptId: 'script-1',
      currentVersionId: 'legacy_script-1',
      messages: [],
      versions: [
        { id: 'ver_legacy_script-1', versionNo: 1 },
        { id: 'ver-2', versionNo: 2 },
        { id: 'legacy_script-1', versionNo: 3 },
      ],
    } as ScriptConversation;

    expect(resolvePersistableStoryboardVersion(conversation)?.id).toBe('ver-2');
    expect(resolvePersistableStoryboardVersion(
      conversation,
      conversation.versions[2],
    )?.id).toBe('ver-2');
  });

  it('keeps a preferred server-backed version as the snapshot owner', () => {
    const conversation = {
      scriptId: 'script-1',
      currentVersionId: 'ver-2',
      messages: [],
      versions: [
        { id: 'ver-1', versionNo: 1 },
        { id: 'ver-2', versionNo: 2 },
      ],
    } as ScriptConversation;

    expect(resolvePersistableStoryboardVersion(
      conversation,
      conversation.versions[0],
    )?.id).toBe('ver-1');
  });
});
