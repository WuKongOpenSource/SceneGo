import { describe, expect, it } from 'vitest';

import type { MaterialLibrary, StoryboardItem } from '../../types';
import {
  applyComputerOperationOrientationConstraint,
  applyConfiguredReferenceDrafts,
  buildIdentityAnchoredPrompt,
  mergeDefaultShotReferences,
  resolveSelectedShotReferences,
  resolveShotReferencePlan,
  resolveShotReferences,
} from '../../utils/storyboardConsistency';
import { COMPUTER_OPERATION_ORIENTATION_RULE } from '../../utils/scriptPromptStandards';

const library: MaterialLibrary = {
  女1: [
    {
      id: 'char_0', url: '/storage/char/old.png', type: 'image', source: 'asset', timestamp: 1,
      name: '女1', description: '旧角色素材', styleParams: {}, isIdentityReference: true,
    },
    {
      id: 'char_1', url: '/storage/char/default.png', type: 'image', source: 'asset', timestamp: 2,
      assetId: 'asset-char', fileId: 'file-char',
      name: '女1', description: '冷静的女总裁',
      styleParams: { identity_anchor: { hair: '黑色齐肩直发', outfit: '黑色西装' } },
    },
  ],
  客厅: [{ id: 'scene_0', url: '/storage/scene.png', type: 'image', source: 'asset', timestamp: 1, name: '客厅' }],
};

const shot: StoryboardItem = {
  id: 'shot_1',
  originalText: '',
  scriptSegment: '女1坐在沙发上翻阅文件',
  imagePrompt: '中景，女1坐在沙发上',
  characters: ['女1'],
  scene: '客厅',
  props: [],
  materialSelections: { 女1: 'char_1', 客厅: 'scene_0' },
};

describe('storyboard computer operation orientation', () => {
  it('keeps the camera behind a computer screen even when the script names screen content', () => {
    const originalPrompt = '中景，平视，女经理坐在电脑前办公，屏幕上显示销售报表。';
    const constrained = applyComputerOperationOrientationConstraint(originalPrompt);

    expect(constrained.startsWith(originalPrompt)).toBe(true);
    expect(constrained).toContain(COMPUTER_OPERATION_ORIENTATION_RULE);
    expect(constrained).toContain('观众看到的必须是屏幕背面或侧后方');
  });

  it('does not add a computer-operation composition rule to an unused device', () => {
    const prompt = '办公室桌面放着一台合上的笔记本电脑。';
    expect(applyComputerOperationOrientationConstraint(prompt)).toBe(prompt);
  });

  it('respects an explicit request to present the screen front to the audience', () => {
    const prompt = '女经理使用电脑，随后把电脑屏幕正面展示给观众。';
    expect(applyComputerOperationOrientationConstraint(prompt)).toBe(prompt);
  });

  it('adds the computer-operation composition rule at most once', () => {
    const prompt = '她坐在显示器前打字。';
    const constrained = applyComputerOperationOrientationConstraint(prompt);
    expect(applyComputerOperationOrientationConstraint(constrained)).toBe(constrained);
  });
});

describe('storyboard independent references', () => {
  it('uses selected project materials only as the initial default list', () => {
    const refs = resolveShotReferences(shot, library);

    expect(refs).toEqual([
      expect.objectContaining({
        url: '/storage/char/default.png',
        assetId: 'asset-char',
        fileId: 'file-char',
        name: '女1',
        source: 'manual',
      }),
      expect.objectContaining({
        url: '/storage/scene.png',
        name: '客厅',
        source: 'manual',
      }),
    ]);
    expect(refs.every(reference => reference.isLocked == null)).toBe(true);
  });

  it('keeps an explicitly emptied saved list empty instead of restoring materials', () => {
    expect(resolveShotReferences(shot, library, [])).toEqual([]);
    expect(resolveSelectedShotReferences(
      { ...shot, configuredReferences: [], referenceConfigInitialized: true },
      library,
      'another-shot',
      [{ id: 'stale', url: '/storage/stale.png', type: 'pose', source: 'manual' }],
    )).toEqual([]);
  });

  it('keeps arbitrary saved references without adding project materials again', () => {
    const refs = resolveShotReferences(shot, library, [
      {
        id: 'external',
        url: '/storage/external-upload.png',
        type: 'pose',
        source: 'identity_anchor',
        isLocked: true,
      },
    ]);

    expect(refs).toEqual([{
      id: 'external',
      url: '/storage/external-upload.png',
      type: 'pose',
      source: 'manual',
    }]);
  });

  it('restores missing defaults without deleting later-added references', () => {
    const added = [{
      id: 'later-added',
      url: '/storage/later-added.png',
      type: 'pose' as const,
      source: 'manual' as const,
    }];
    const defaults = resolveShotReferences(shot, library);

    expect(mergeDefaultShotReferences(added, defaults)).toEqual({
      references: [
        ...added,
        ...defaults,
      ],
      exceedsLimit: false,
    });
  });

  it('does not duplicate defaults already present in the current list', () => {
    const defaults = resolveShotReferences(shot, library);
    const added = {
      id: 'later-added',
      url: '/storage/later-added.png',
      type: 'pose' as const,
      source: 'manual' as const,
    };

    expect(mergeDefaultShotReferences([defaults[0], added], defaults)).toEqual({
      references: [defaults[0], added, defaults[1]],
      exceedsLimit: false,
    });
  });

  it('keeps the current list unchanged when restoring defaults would exceed six images', () => {
    const current = Array.from({ length: 5 }, (_, index) => ({
      id: `later-${index}`,
      url: `/storage/later-${index}.png`,
      type: 'pose' as const,
      source: 'manual' as const,
    }));
    const defaults = resolveShotReferences(shot, library);

    expect(mergeDefaultShotReferences(current, defaults)).toEqual({
      references: current,
      exceedsLimit: true,
    });
  });

  it('preserves current references while the active shot receives unrelated updates', () => {
    const stalePersistedShot = {
      ...shot,
      configuredReferences: [
        { id: 'persisted', url: '/storage/old-reference.png', type: 'pose' as const, source: 'manual' as const },
      ],
    };
    const currentReferences = [
      { id: 'external', url: '/storage/external-upload.png', type: 'pose' as const, source: 'manual' as const },
    ];

    const refs = resolveSelectedShotReferences(
      stalePersistedShot,
      library,
      stalePersistedShot.id,
      currentReferences,
    );

    expect(refs).toEqual(currentReferences);
  });

  it('loads exactly the persisted references when switching shots', () => {
    const nextShot = {
      ...shot,
      id: 'shot_2',
      configuredReferences: [
        { id: 'next-manual', url: '/storage/next-shot.png', type: 'pose' as const, source: 'manual' as const },
      ],
    };

    expect(resolveSelectedShotReferences(
      nextShot,
      library,
      shot.id,
      [{ id: 'previous-manual', url: '/storage/previous-shot.png', type: 'pose', source: 'manual' }],
    )).toEqual([
      expect.objectContaining({ id: 'next-manual', url: '/storage/next-shot.png' }),
    ]);
  });

  it('keeps per-shot reference drafts while the server save is pending', () => {
    const file = {
      id: 'file_1',
      name: 'test',
      originalContent: '',
      scriptContent: '',
      storyboard: {
        items: [
          { ...shot, id: 'shot_1', configuredReferences: [] },
          { ...shot, id: 'shot_2', configuredReferences: [] },
        ],
      },
      extractedCharacters: [],
      extractedScenes: [],
      status: 'completed',
      lastUpdated: 1,
      versions: [],
    } as any;

    const updated = applyConfiguredReferenceDrafts(file, {
      shot_1: [{
        id: 'external',
        url: '/storage/external-upload.png',
        type: 'pose',
        source: 'manual',
      }],
    });

    expect(updated.storyboard?.items[0].configuredReferences).toEqual([
      expect.objectContaining({ id: 'external', url: '/storage/external-upload.png' }),
    ]);
    expect(updated.storyboard?.items[0].referenceConfigInitialized).toBe(true);
    expect(updated.storyboard?.items[1].configuredReferences).toEqual([]);
  });

  it('keeps an explicit empty reference draft instead of stale server references', () => {
    const file = {
      id: 'file_1',
      name: 'test',
      originalContent: '',
      scriptContent: '',
      storyboard: {
        items: [{
          ...shot,
          configuredReferences: [
            { id: 'stale', url: '/storage/stale.png', type: 'pose', source: 'manual' },
          ],
        }],
      },
      extractedCharacters: [],
      extractedScenes: [],
      status: 'completed',
      lastUpdated: 1,
      versions: [],
    } as any;

    const updated = applyConfiguredReferenceDrafts(file, { shot_1: [] });
    expect(updated.storyboard?.items[0].configuredReferences).toEqual([]);
    expect(updated.storyboard?.items[0].referenceConfigInitialized).toBe(true);
  });

  it('uses identity details only when that character reference is actually submitted', () => {
    const defaults = resolveShotReferences(shot, library);
    const withReference = buildIdentityAnchoredPrompt(
      shot,
      shot.imagePrompt || '',
      library,
      defaults,
    );
    const withoutReference = buildIdentityAnchoredPrompt(
      shot,
      shot.imagePrompt || '',
      library,
      [],
    );

    expect(withReference).toContain('冷静的女总裁');
    expect(withReference).toContain('黑色齐肩直发');
    expect(withReference).toContain('参考图1 = 角色身份锚点（最高优先级）【女1】');
    expect(withoutReference).not.toContain('冷静的女总裁');
    expect(withoutReference).not.toContain('黑色齐肩直发');
    expect(withoutReference).not.toContain('角色身份锚点（最高优先级硬约束）');
  });

  it('reports capacity overflow without treating any image as a binding', () => {
    const crowdedLibrary: MaterialLibrary = {};
    const characters = Array.from({ length: 7 }, (_, index) => `角色${index + 1}`);
    const materialSelections: Record<string, string> = {};
    for (const [index, name] of characters.entries()) {
      const id = `character_${index + 1}`;
      materialSelections[name] = id;
      crowdedLibrary[name] = [{
        id,
        url: `/storage/characters/${index + 1}.png`,
        type: 'image',
        source: 'asset',
        timestamp: index,
        name,
      }];
    }

    const plan = resolveShotReferencePlan({
      ...shot,
      characters,
      scene: '',
      materialSelections,
    }, crowdedLibrary, undefined, 6);

    expect(plan.references).toHaveLength(6);
    expect(plan.excluded).toEqual([
      expect.objectContaining({
        isCritical: false,
        reference: expect.objectContaining({ name: '角色7', url: '/storage/characters/7.png' }),
      }),
    ]);
    expect(plan.criticalExcluded).toEqual([]);
  });

  it('keeps the submitted order when enforcing provider capacity', () => {
    const manual = Array.from({ length: 6 }, (_, index) => ({
      id: `manual_${index}`,
      url: `/storage/manual/${index}.png`,
      type: 'pose' as const,
      name: `构图${index + 1}`,
      source: 'manual' as const,
    }));
    const plan = resolveShotReferencePlan(shot, library, manual, 2);

    expect(plan.references.map(item => item.id)).toEqual(['manual_0', 'manual_1']);
    expect(plan.excluded).toHaveLength(4);
    expect(plan.criticalExcluded).toEqual([]);
  });
});
