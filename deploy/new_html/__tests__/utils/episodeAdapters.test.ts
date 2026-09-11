import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assetsToMaterialLibrary,
  applyStoryboardRecordPatch,
  BINDINGS_INITIALIZED_TAG,
  DEFAULT_BINDINGS_INITIALIZED_TAG,
  bindingMembershipDiffersFromDefault,
  dbItemToStoryboardItem,
  ensureDefaultBindingSnapshot,
  newShotToDbFields,
  normalizeStoryboardRecord,
  parseBoundAssetTags,
  restoreDefaultBindingSnapshot,
  storyboardItemToDbUpdate,
} from '../../utils/episodeAdapters';

describe('EpisodeContext adapter wiring', () => {
  it('does not retain the removed safeObj runtime helper', () => {
    const source = readFileSync(resolve(__dirname, '../../contexts/EpisodeContext.tsx'), 'utf-8');
    expect(source).not.toContain('safeObj(');
    expect(source).toContain('generationParams: parseRecord(');
    expect(source).toContain('metadata: parseRecord(');
    expect(source).toContain('voiceParams: parseRecord(');
  });
});

describe('storyboard segment metadata adapters', () => {
  it('preserves backend segment identifiers for downstream workflow pages', () => {
    const record = normalizeStoryboardRecord({
      item_id: 'shot_2',
      episode_id: 'episode_1',
      sort_order: 2,
      script_segment_id: 'segment_2',
      source_video_shot_no: '镜头01',
    });

    expect(record.scriptSegmentId).toBe('segment_2');
    expect(record.sourceVideoShotNo).toBe('镜头01');
    expect(dbItemToStoryboardItem(record)).toEqual(expect.objectContaining({
      scriptSegmentId: 'segment_2',
      sourceVideoShotNo: '镜头01',
    }));
  });

  it('rounds legacy millisecond durations to whole seconds for every downstream page', () => {
    const record = normalizeStoryboardRecord({
      item_id: 'shot_fractional',
      episode_id: 'episode_1',
      sort_order: 1,
      planned_duration_ms: 4500,
    });

    expect(dbItemToStoryboardItem(record)).toEqual(expect.objectContaining({
      plannedDurationMs: 5000,
      duration: '5秒',
    }));
  });
});

describe('assetsToMaterialLibrary', () => {
  it('includes generated material_image files alongside reference images', () => {
    const library = assetsToMaterialLibrary([
      {
        assetId: 'asset_1',
        name: '小悟',
        referenceImages: ['/storage/legacy/original.webp', '/storage/generated/angle.webp'],
        thumbnailUrl: null,
        entityFiles: [
          {
            fileId: 'file_ref',
            fileUrl: '/storage/legacy/original.webp',
            fileType: 'image',
            fileRole: 'reference_image',
            createdAt: '2026-07-04T01:00:00',
          },
          {
            fileId: 'file_angle',
            fileUrl: '/storage/generated/angle.webp',
            fileType: 'image',
            fileRole: 'material_image',
            createdAt: '2026-07-04T02:00:00',
          },
        ],
      } as any,
    ]);

    expect(library['小悟']).toEqual([
      expect.objectContaining({
        id: 'asset_1_0',
        url: '/storage/legacy/original.webp',
        source: 'entity_file:reference_image',
        fileId: 'file_ref',
      }),
      expect.objectContaining({
        id: 'asset_1_1',
        url: '/storage/generated/angle.webp',
        source: 'entity_file:material_image',
        fileId: 'file_angle',
      }),
    ]);
  });

  it('keeps legacy references before generated entity files for stable selection ids', () => {
    const library = assetsToMaterialLibrary([
      {
        assetId: 'asset_2',
        name: '角色A',
        referenceImages: ['/storage/legacy/original.webp'],
        thumbnailUrl: null,
        entityFiles: [
          {
            fileId: 'file_angle',
            fileUrl: '/storage/generated/angle.webp',
            fileType: 'image',
            fileRole: 'material_image',
            createdAt: '2026-07-04T02:00:00',
          },
        ],
      } as any,
    ]);

    expect(library['角色A']).toEqual([
      expect.objectContaining({
        id: 'asset_2_0',
        url: '/storage/legacy/original.webp',
      }),
      expect.objectContaining({
        id: 'asset_2_1',
        url: '/storage/generated/angle.webp',
        source: 'entity_file:material_image',
      }),
    ]);
  });

  it('appends newer design images after existing material-stage variants', () => {
    const library = assetsToMaterialLibrary([
      {
        assetId: 'asset_3',
        name: '角色B',
        referenceImages: [
          '/storage/design/original.webp',
          '/storage/material/upscale.webp',
          '/storage/design/new.webp',
        ],
        thumbnailUrl: null,
        entityFiles: [
          {
            fileId: 'file_original',
            fileUrl: '/storage/design/original.webp',
            fileType: 'image',
            fileRole: 'reference_image',
            createdAt: '2026-07-04T01:00:00',
          },
          {
            fileId: 'file_upscale',
            fileUrl: '/storage/material/upscale.webp',
            fileType: 'image',
            fileRole: 'material_image',
            createdAt: '2026-07-04T02:00:00',
          },
          {
            fileId: 'file_new_design',
            fileUrl: '/storage/design/new.webp',
            fileType: 'image',
            fileRole: 'reference_image',
            createdAt: '2026-07-04T03:00:00',
          },
        ],
      } as any,
    ]);

    expect(library['角色B'].map(material => ({
      url: material.url,
      source: material.source,
    }))).toEqual([
      {
        url: '/storage/design/original.webp',
        source: 'entity_file:reference_image',
      },
      {
        url: '/storage/material/upscale.webp',
        source: 'entity_file:material_image',
      },
      {
        url: '/storage/design/new.webp',
        source: 'entity_file:reference_image',
      },
    ]);
  });
});

describe('prop storyboard bindings', () => {
  it('maps prop bound tags and selections into storyboard items', () => {
    const item = dbItemToStoryboardItem({
      itemId: 'sb_1',
      sceneHeading: '小悟拿起扇子',
      actionText: '桌边动作',
      dialogue: '',
      imagePrompt: '',
      videoPrompt: '',
      cameraMovement: '',
      generatedImageUrl: null,
      boundAssets: ['char:小悟', 'scene:办公室', 'prop:扇子', 'sel:扇子:asset_prop_0'],
      status: 'draft',
    } as any, [
      {
        assetId: 'asset_prop',
        assetType: 'prop',
        name: '扇子',
        referenceImages: ['/storage/fan.png'],
        thumbnailUrl: null,
        entityFiles: [],
      } as any,
    ]);

    expect(item.props).toEqual(['扇子']);
    expect(item.materialSelections?.['扇子']).toBe('asset_prop_0');
  });

  it('auto-selects prop materials even when the shot has no scene', () => {
    const item = dbItemToStoryboardItem({
      itemId: 'sb_1',
      sceneHeading: '小悟拿起扇子',
      actionText: '小悟拿起扇子',
      dialogue: '',
      imagePrompt: '',
      videoPrompt: '',
      cameraMovement: '',
      generatedImageUrl: null,
      boundAssets: ['prop:扇子'],
      status: 'draft',
    } as any, [
      {
        assetId: 'asset_prop',
        assetType: 'prop',
        name: '扇子',
        referenceImages: ['/storage/fan.png'],
        thumbnailUrl: null,
        entityFiles: [],
      } as any,
    ]);

    expect(item.scene).toBe('');
    expect(item.props).toEqual(['扇子']);
    expect(item.materialSelections?.['扇子']).toBe('asset_prop_0');
  });

  it('writes props back as prop bound asset tags', () => {
    const fields = newShotToDbFields({
      originalText: '小悟拿着扇子进入办公室',
      scriptSegment: '小悟入场',
      characters: ['小悟'],
      scene: '办公室',
      props: ['扇子'],
    } as any, 0);

    expect(fields.bound_assets).toEqual([
      BINDINGS_INITIALIZED_TAG,
      'char:小悟',
      'scene:办公室',
      'prop:扇子',
      DEFAULT_BINDINGS_INITIALIZED_TAG,
      'default-char:小悟',
      'default-scene:办公室',
      'default-prop:扇子',
    ]);
  });

  it('keeps an explicitly empty shot binding empty instead of inferring from a shared video prompt', () => {
    const item = dbItemToStoryboardItem({
      itemId: 'sb_explicit_empty',
      sceneHeading: '',
      actionText: '门口只有阿亮',
      dialogue: '',
      imagePrompt: '',
      videoPrompt: '分段共享说明：阿亮、快递员、女店主位于茶馆室内',
      cameraMovement: '',
      generatedImageUrl: null,
      boundAssets: [BINDINGS_INITIALIZED_TAG],
      status: 'draft',
    } as any, [
      { assetId: 'asset_a', assetType: 'character', name: '阿亮' },
      { assetId: 'asset_b', assetType: 'character', name: '快递员' },
      { assetId: 'asset_c', assetType: 'character', name: '女店主' },
      { assetId: 'asset_scene', assetType: 'scene', name: '茶馆室内' },
    ] as any);

    expect(item.characters).toEqual([]);
    expect(item.scene).toBe('');
    expect(item.bindingsInitialized).toBe(true);
  });
});

describe('material binding default snapshots', () => {
  it('captures an imported binding once without treating default tokens as asset ids', () => {
    const snapshotted = ensureDefaultBindingSnapshot([
      BINDINGS_INITIALIZED_TAG,
      'char:阿亮',
      'scene:茶馆门口',
    ]);
    const parsed = parseBoundAssetTags(snapshotted);

    expect(parsed.defaultBindingsInitialized).toBe(true);
    expect(parsed.defaultCharNames).toEqual(['阿亮']);
    expect(parsed.defaultSceneName).toBe('茶馆门口');
    expect(parsed.assetIds).toEqual([]);
  });

  it('restores imported membership while keeping valid image selections', () => {
    const edited = [
      BINDINGS_INITIALIZED_TAG,
      DEFAULT_BINDINGS_INITIALIZED_TAG,
      'default-char:阿亮',
      'default-scene:茶馆门口',
      'char:女店主',
      'scene:茶馆室内',
      'sel:阿亮:asset_a_0',
      'sel:女店主:asset_b_0',
    ];

    expect(bindingMembershipDiffersFromDefault(edited)).toBe(true);
    expect(restoreDefaultBindingSnapshot(edited)).toEqual([
      BINDINGS_INITIALIZED_TAG,
      DEFAULT_BINDINGS_INITIALIZED_TAG,
      'char:阿亮',
      'scene:茶馆门口',
      'default-char:阿亮',
      'default-scene:茶馆门口',
      'sel:阿亮:asset_a_0',
    ]);
  });
});

describe('storyboard configured references', () => {
  const references = [{
    id: 'ref-1',
    url: '/storage/character.webp',
    type: 'character',
    name: '小悟',
    assetId: 'asset-1',
    fileId: 'file-1',
  }] as any;

  it('maps persisted configured references into the storyboard item', () => {
    const item = dbItemToStoryboardItem({
      itemId: 'sb_1',
      sceneHeading: '',
      actionText: '',
      dialogue: '',
      imagePrompt: '',
      videoPrompt: '',
      cameraMovement: '',
      generatedImageUrl: null,
      boundAssets: [],
      configuredReferences: references,
      status: 'draft',
    } as any);

    expect(item.configuredReferences).toEqual(references);
    expect(item.referenceConfigInitialized).toBe(true);
  });

  it('normalizes JSON encoded references and audio fields without dropping objects', () => {
    const item = normalizeStoryboardRecord({
      item_id: 'sb_1',
      episode_id: 'ep_1',
      sort_order: 2,
      bound_assets: JSON.stringify(['char:hero']),
      configured_references: JSON.stringify(references),
      dialogue_audio_url: '/audio/dialogue.mp3',
      planned_duration_ms: 4200,
    });

    expect(item.boundAssets).toEqual(['char:hero']);
    expect(item.configuredReferences).toEqual(references);
    expect(item.dialogueAudioUrl).toBe('/audio/dialogue.mp3');
    expect(item.plannedDurationMs).toBe(4200);
  });

  it('round-trips ordered storyboard audio segments', () => {
    const audioSegments = [
      {
        segmentId: 'speech-1',
        kind: 'speech',
        sequenceIndex: 0,
        speaker: '小悟',
        text: '先说话',
        durationMs: 3200,
      },
      {
        segmentId: 'silence-1',
        kind: 'silence',
        sequenceIndex: 1,
        label: '转身',
        durationMs: 1200,
      },
    ];
    const item = normalizeStoryboardRecord({
      item_id: 'sb_1',
      episode_id: 'ep_1',
      audio_segments: JSON.stringify(audioSegments),
    });

    expect(item.audioSegments).toEqual(audioSegments);
    expect(storyboardItemToDbUpdate({ audioSegments } as any))
      .toEqual({ audio_segments: audioSegments });
  });

  it('applies snake-case patches while preserving references and audio metadata', () => {
    const item = normalizeStoryboardRecord({
      item_id: 'sb_1',
      episode_id: 'ep_1',
      configured_references: references,
      dialogue_audio_url: '/audio/dialogue.mp3',
      bound_assets: ['char:hero'],
    });
    const patched = applyStoryboardRecordPatch(item, {
      image_prompt: 'updated prompt',
      bound_assets: ['char:hero', 'scene:classroom'],
    });

    expect(patched.imagePrompt).toBe('updated prompt');
    expect(patched.boundAssets).toEqual(['char:hero', 'scene:classroom']);
    expect(patched.configuredReferences).toEqual(references);
    expect(patched.dialogueAudioUrl).toBe('/audio/dialogue.mp3');
  });

  it('writes configured references for updates and new shots', () => {
    expect(storyboardItemToDbUpdate({ configuredReferences: references } as any))
      .toEqual({ configured_references: references });
    expect(newShotToDbFields({
      originalText: '',
      scriptSegment: '',
      configuredReferences: references,
    } as any, 0).configured_references).toEqual(references);
  });

  it('persists an explicitly initialized empty reference list', () => {
    const normalized = normalizeStoryboardRecord({
      item_id: 'sb_empty',
      episode_id: 'ep_1',
      configured_references: [],
      reference_config_initialized: true,
    });
    expect(normalized.configuredReferences).toEqual([]);
    expect(normalized.referenceConfigInitialized).toBe(true);
    expect(dbItemToStoryboardItem(normalized).referenceConfigInitialized).toBe(true);
    expect(storyboardItemToDbUpdate({
      configuredReferences: [],
      referenceConfigInitialized: true,
    })).toEqual({
      configured_references: [],
      reference_config_initialized: true,
    });
  });
});
