import { describe, expect, it } from 'vitest';
import {
  standardTurnaroundAspectRatio,
  standardTurnaroundLabel,
  supportsStandardTurnaround,
  withStandardTurnaround,
} from '../../utils/assetGenerationStandards';

describe('asset generation standards', () => {
  it('creates the required three-view plus enlarged half-body character layout', () => {
    const prompt = withStandardTurnaround('黑发女性角色，黑色西装', 'character');

    expect(prompt).toContain('exactly four images arranged side by side');
    expect(prompt).toContain('Panel 1: full-body front view');
    expect(prompt).toContain('Panel 2: full-body strict 90-degree side profile');
    expect(prompt).toContain('Panel 3: full-body back view');
    expect(prompt).toContain('Panel 4: an enlarged front-facing waist-up half-body portrait');
    expect(prompt).toContain('Do not duplicate, mirror, repeat');
    expect(prompt).toContain('seamless pure white background');
    expect(standardTurnaroundAspectRatio('character', '1:1')).toBe('16:9');
    expect(standardTurnaroundLabel('character')).toBe('人物白底四视图');
  });

  it('turns a prop prompt into a strict white-background four-view reference', () => {
    const prompt = withStandardTurnaround('一把带有红色宝石的古剑', 'prop');

    expect(prompt).toContain('four-panel prop turnaround');
    expect(prompt).toContain('pure white background');
    expect(prompt).toContain('no character, hands, scene');
    expect(standardTurnaroundAspectRatio('prop', '1:1')).toBe('16:9');
    expect(standardTurnaroundLabel('prop')).toBe('道具白底四视图');
  });

  it('keeps scenes and disabled standards unchanged', () => {
    expect(supportsStandardTurnaround('scene')).toBe(false);
    expect(withStandardTurnaround('未来办公室', 'scene')).toBe('未来办公室');
    expect(withStandardTurnaround('古剑', 'prop', false)).toBe('古剑');
    expect(standardTurnaroundAspectRatio('scene', '9:16')).toBe('9:16');
  });

  it('does not append the same standard twice', () => {
    const once = withStandardTurnaround('角色设定', 'character');
    expect(withStandardTurnaround(once, 'character')).toBe(once);
  });
});
