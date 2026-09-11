import { describe, expect, it } from 'vitest';
import type { AssetItem, Material, MaterialLibrary, StoryboardItem, StoryboardItemDB } from '../../types';
import {
  getFollowingMaterialTargets,
  getMaterialBindingProgress,
  isMaterialSyncedToCurrentAndFollowing,
  resolveBoundMaterial,
} from '../../utils/materialBindingState';
import { assetsToMaterialLibrary, dbItemToStoryboardItem } from '../../utils/episodeAdapters';
import { buildIdentityAnchoredPrompt, resolveShotReferences } from '../../utils/storyboardConsistency';

const asset: AssetItem = {
  assetId: 'asset_character',
  projectId: 'project_1',
  episodeId: 'episode_1',
  assetType: 'character',
  name: '小悟',
  description: '',
  thumbnailUrl: 'https://example.com/front.png',
  referenceImages: [
    'https://example.com/front.png',
    'https://example.com/side.png',
  ],
  styleParams: {},
  tags: [],
  createdBy: 'tester',
  createdAt: '2026-07-24T00:00:00Z',
};

function storyboardItem(
  itemId: string,
  sortOrder: number,
  boundAssets: string[],
): StoryboardItemDB {
  return {
    itemId,
    episodeId: 'episode_1',
    sortOrder,
    sceneHeading: '',
    actionText: '',
    dialogue: '',
    cameraMovement: '',
    imagePrompt: '',
    videoPrompt: '',
    generatedImageUrl: null,
    boundAssets,
    configuredReferences: [],
    status: '',
    dialogueAudioUrl: null,
    narrationAudioUrl: null,
    sfxAudioUrl: null,
    audioDurationMs: null,
    plannedDurationMs: null,
  };
}

describe('material binding state', () => {
  it('treats the first design image as the default binding on every matching shot', () => {
    const items = [
      storyboardItem('shot_1', 1, ['char:小悟']),
      storyboardItem('shot_2', 2, ['char:小悟']),
      storyboardItem('shot_3', 3, ['scene:办公室']),
    ];

    expect(getFollowingMaterialTargets(items, 'shot_1', '小悟')).toEqual([items[1]]);
    expect(isMaterialSyncedToCurrentAndFollowing(
      items,
      [asset],
      'shot_1',
      '小悟',
      'asset_character_0',
    )).toBe(true);
  });

  it('requires an explicitly selected alternate image on every following matching shot', () => {
    const items = [
      storyboardItem('shot_1', 1, ['char:小悟', 'sel:小悟:asset_character_1']),
      storyboardItem('shot_2', 2, ['char:小悟']),
    ];

    expect(isMaterialSyncedToCurrentAndFollowing(
      items,
      [asset],
      'shot_1',
      '小悟',
      'asset_character_1',
    )).toBe(false);

    items[1] = storyboardItem('shot_2', 2, [
      'char:小悟',
      'sel:小悟:asset_character_1',
    ]);
    expect(isMaterialSyncedToCurrentAndFollowing(
      items,
      [asset],
      'shot_1',
      '小悟',
      'asset_character_1',
    )).toBe(true);
  });

  it('does not report an explicitly unbound matching shot as synchronized', () => {
    const items = [
      storyboardItem('shot_1', 1, ['char:小悟']),
      storyboardItem('shot_2', 2, ['char:小悟', 'nosel:小悟']),
    ];

    expect(isMaterialSyncedToCurrentAndFollowing(
      items,
      [asset],
      'shot_1',
      '小悟',
      'asset_character_0',
    )).toBe(false);
  });
});

describe('material binding progress', () => {
  const image = (id: string): Material => ({ id, url: `/images/${id}.png`, type: 'image', source: 'asset', timestamp: 0 });
  const library: MaterialLibrary = { 角色: [image('char')], 场景: [image('scene')], 道具: [image('prop')] };
  const shot: StoryboardItem = { id: 'shot', originalText: '', scriptSegment: '', characters: ['角色'], scene: '场景', props: ['道具'] };

  it('does not consider available design images to be selected references', () => {
    expect(getMaterialBindingProgress(shot, library)).toEqual({ status: 'pending', total: 3, boundTags: [], missingTags: ['角色', '场景', '道具'], optionalPropTags: [] });
  });

  it('reports partial binding when only the character and scene have been selected', () => {
    expect(getMaterialBindingProgress({ ...shot, materialSelections: { 角色: 'char', 场景: 'scene' } }, library)).toEqual({
      status: 'partial', total: 3, boundTags: ['角色', '场景'], missingTags: ['道具'], optionalPropTags: [],
    });
  });

  it('reports complete reference binding without requiring a generated storyboard image', () => {
    expect(getMaterialBindingProgress({ ...shot, materialSelections: { 角色: 'char', 场景: 'scene', 道具: 'prop' } }, library)).toEqual({
      status: 'complete', total: 3, boundTags: ['角色', '场景', '道具'], missingTags: [], optionalPropTags: [],
    });
    expect(getMaterialBindingProgress({ ...shot, generatedImages: [{ id: 'output', url: '/output.png', timestamp: 0 }] }, library).status).toBe('pending');
  });

  it('does not accept stale IDs, IDs from another tag, or a missing image URL', () => {
    const progress = getMaterialBindingProgress({ ...shot, materialSelections: { 角色: 'deleted', 场景: 'char', 道具: 'prop' } }, {
      ...library, 道具: [{ ...image('prop'), url: ' ' }],
    });
    expect(progress.status).toBe('pending');
    expect(progress.boundTags).toEqual([]);
    expect(resolveBoundMaterial(library.角色, 'char')).toBe(library.角色[0]);
    expect(resolveBoundMaterial(library.角色)).toBeUndefined();
  });

  it('ignores duplicate and empty membership tags and unrelated selections without changing the item', () => {
    const item = { ...shot, characters: ['角色', '角色', ''], props: ['道具', '  '], materialSelections: { 多余标签: 'unused' } };
    const snapshot = JSON.stringify(item);
    expect(getMaterialBindingProgress(item, library).total).toBe(3);
    expect(JSON.stringify(item)).toBe(snapshot);
    expect(getMaterialBindingProgress({ id: 'empty', originalText: '', scriptSegment: '' }, library)).toEqual({
      status: 'empty', total: 0, boundTags: [], missingTags: [], optionalPropTags: [],
    });
  });

  it('respects persisted default references and explicit unbinding after an adapter reload', () => {
    const refs = assetsToMaterialLibrary([asset]) as MaterialLibrary;
    const item = storyboardItem('shot_1', 1, ['char:小悟']);
    expect(getMaterialBindingProgress(dbItemToStoryboardItem(item, [asset]), refs).status).toBe('complete');
    expect(getMaterialBindingProgress(dbItemToStoryboardItem({ ...item, boundAssets: ['char:小悟', 'nosel:小悟'] }, [asset]), refs).status).toBe('pending');
  });

  it.each<{ label: string; materials?: Material[] }>([
    { label: 'missing library entry' },
    { label: 'empty image list', materials: [] },
    { label: 'blank image URL', materials: [{ ...image('prop'), url: ' ' }] },
  ])('excludes props without usable images ($label), including stale selections', ({ materials }) => {
    const item = { ...shot, materialSelections: { 角色: 'char', 场景: 'scene', 道具: 'deleted-prop' } };
    const snapshot = JSON.stringify(item);
    expect(getMaterialBindingProgress(item, { ...library, 道具: materials || [] })).toMatchObject({
      status: 'complete', total: 2, boundTags: ['角色', '场景'], missingTags: [], optionalPropTags: ['道具'],
    });
    expect(JSON.stringify(item)).toBe(snapshot);
  });

  it('requires no image binding for a text-only prop shot but keeps characters and scenes required', () => {
    expect(getMaterialBindingProgress({ id: 'props', originalText: '', scriptSegment: '', props: ['茶杯', '茶杯'] }, {})).toMatchObject({
      status: 'empty', total: 0, boundTags: [], missingTags: [], optionalPropTags: ['茶杯'],
    });
    expect(getMaterialBindingProgress(shot, {})).toMatchObject({
      status: 'pending', total: 2, missingTags: ['角色', '场景'], optionalPropTags: ['道具'],
    });
  });

  it.each(['generated', 'upload', 'asset'])('counts props with an image from %s without auto-selecting it', source => {
    expect(getMaterialBindingProgress({ ...shot, materialSelections: { 角色: 'char', 场景: 'scene' } }, {
      ...library, 道具: [{ ...image('prop'), source }],
    })).toMatchObject({ status: 'partial', total: 3, missingTags: ['道具'], optionalPropTags: [] });
  });

  it('does not exempt a required character or scene when its name also appears as a prop', () => {
    expect(getMaterialBindingProgress({ ...shot, props: ['角色', '场景'] }, {})).toMatchObject({
      status: 'pending', total: 2, missingTags: ['角色', '场景'], optionalPropTags: [],
    });
  });

  it('keeps persisted text-only props in downstream prompts without adding a fake image reference', () => {
    const record = storyboardItem('prop-only', 1, ['prop:茶杯']);
    const item = dbItemToStoryboardItem(record, []);
    expect(getMaterialBindingProgress(item, {}).status).toBe('empty');
    expect(item.props).toEqual(['茶杯']);
    const refs = resolveShotReferences(item, {});
    expect(refs).toEqual([]);
    expect(buildIdentityAnchoredPrompt(item, '抬手喝茶', {}, refs)).toContain('关键道具：茶杯');
    expect(record.boundAssets).toEqual(['prop:茶杯']);
  });
});
