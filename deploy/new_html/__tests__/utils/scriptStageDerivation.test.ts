import { describe, it, expect } from 'vitest';
import { deriveScriptStagesFromPersisted } from '../../utils/scriptStageDerivation';
import type { ScriptSegment, StoryboardItem } from '../../types';

const seg = (overrides: Partial<ScriptSegment> = {}): ScriptSegment => ({
  id: 's1',
  order: 0,
  sourceText: '原文',
  estimatedDurationSec: 3,
  videoScript: '',
  status: 'done',
  errorMessage: '',
  ...overrides,
});

const item = (overrides: Partial<StoryboardItem> = {}): StoryboardItem =>
  ({ id: 'i1', imagePrompt: '', ...overrides } as StoryboardItem);

describe('deriveScriptStagesFromPersisted', () => {
  it('完全无数据返回 undefined（全新剧本不显示已完成）', () => {
    expect(deriveScriptStagesFromPersisted([], null, [])).toBeUndefined();
  });

  it('三步都完成的剧本重进后阶段全部判为 done（A.2-2 核心）', () => {
    const segments = [seg({ videoScript: '镜头1' }), seg({ id: 's2', order: 1, videoScript: '镜头2' })];
    const items = [item({ imagePrompt: '提示词' })];
    const stages = deriveScriptStagesFromPersisted(segments, '完整改编稿', items);
    expect(stages?.split?.status).toBe('done');
    expect(stages?.videoScript?.status).toBe('done');
    expect(stages?.storyboardPrompt?.status).toBe('done');
    expect(stages?.split?.completed).toBe(2);
  });

  it('只拆分了分段、还没生成视频脚本：仅 split 为 done', () => {
    const segments = [seg(), seg({ id: 's2', order: 1 })];
    const stages = deriveScriptStagesFromPersisted(segments, null, []);
    expect(stages?.split?.status).toBe('done');
    expect(stages?.videoScript).toBeUndefined();
    expect(stages?.storyboardPrompt).toBeUndefined();
  });

  it('视频脚本只生成了一部分分段：videoScript 不判为 done', () => {
    const segments = [seg({ videoScript: '镜头1' }), seg({ id: 's2', order: 1, videoScript: '' })];
    const stages = deriveScriptStagesFromPersisted(segments, '改编稿', []);
    expect(stages?.split?.status).toBe('done');
    expect(stages?.videoScript).toBeUndefined();
  });
});
