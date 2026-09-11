import { describe, expect, it } from 'vitest';
import {
  applyProjectOrientationToText,
  normalizeProjectCreationPreferences,
  projectCreationSettings,
  projectDefaultAspectRatio,
} from '../../utils/projectCreationPreferences';

describe('project creation preferences', () => {
  it('keeps duration and orientation as independent project fields', () => {
    const settings = projectCreationSettings({
      genre: '校园',
      durationSeconds: 90,
      orientation: 'landscape',
      aspectRatio: '16:9',
    });

    expect(normalizeProjectCreationPreferences(settings)).toEqual({
      genre: '校园',
      durationSeconds: 90,
      orientation: 'landscape',
      aspectRatio: '16:9',
    });
  });

  it('does not change legacy project defaults when creation settings are missing', () => {
    expect(projectDefaultAspectRatio({}, '16:9')).toBe('16:9');
    expect(projectDefaultAspectRatio({ creation_preferences: { orientation: 'portrait' } }, '16:9')).toBe('9:16');
  });

  it('rewrites portrait-only prompt constraints for a landscape project', () => {
    expect(applyProjectOrientationToText(
      '严禁生成横屏构图，所有分镜适配9:16竖屏，竖屏主体居中，纵向空间充分利用。',
      'landscape',
    )).toBe('严禁生成竖屏构图，所有分镜适配16:9横屏，横屏主体居中，横向空间充分利用。');
  });
});
