import { describe, expect, it } from 'vitest';
import {
  CARD_MEDIA_HEIGHT_CLASS,
  RESULT_MEDIA_HEIGHT_CLASS,
  RESULT_MEDIA_GRID_CLASS,
  getCardHeightClass,
  getPreviewImageHeightClass,
  getResultVisualHeightClass,
  getVideoResultPlaceholderCount,
} from '../../utils/videoCardLayout';

describe('video card media layout', () => {
  it('aligns every populated card family at three quarters of the viewport with a small-screen floor', () => {
    for (const model of ['Wan2', 'MINI', 'HappyHorse', 'Seedance2', 'Seedance2Fast', 'Seedance2Mini', 'Seedance15', 'JimengSeedance2'] as const) {
      expect(getCardHeightClass(model)).toContain('h-[75vh]');
      expect(getCardHeightClass(model)).toContain('min-h-[640px]');
      expect(getCardHeightClass(model)).toBe(getCardHeightClass('Seedance2'));
    }
    expect(getCardHeightClass('Seedance2', true)).toContain('h-[400px]');
  });

  it('keeps source height and reserves two uncompressed result rows for every model', () => {
    expect(getPreviewImageHeightClass('MINI', false)).toBe(CARD_MEDIA_HEIGHT_CLASS);
    expect(getPreviewImageHeightClass('Seedance2', true)).toBe(CARD_MEDIA_HEIGHT_CLASS);
    expect(getResultVisualHeightClass('MINI')).toBe(RESULT_MEDIA_HEIGHT_CLASS);
    expect(getResultVisualHeightClass('Seedance2')).toBe(RESULT_MEDIA_HEIGHT_CLASS);
    expect(RESULT_MEDIA_HEIGHT_CLASS).toBe('h-[232px] shrink-0');
    expect(RESULT_MEDIA_GRID_CLASS).toContain('auto-rows-[112px]');
    expect(RESULT_MEDIA_GRID_CLASS).toContain('content-start');
    expect(RESULT_MEDIA_GRID_CLASS).toContain('overflow-y-auto');
  });

  it('fills the active result row to four stable slots', () => {
    expect(getVideoResultPlaceholderCount(0)).toBe(4);
    expect(getVideoResultPlaceholderCount(1)).toBe(3);
    expect(getVideoResultPlaceholderCount(3, true)).toBe(0);
    expect(getVideoResultPlaceholderCount(4)).toBe(0);
    expect(getVideoResultPlaceholderCount(5)).toBe(3);
  });
});
