import { describe, expect, it } from 'vitest';
import {
  CARD_MEDIA_HEIGHT_CLASS,
  getCardHeightClass,
  getPreviewImageHeightClass,
  getResultVisualHeightClass,
  getVideoResultPlaceholderCount,
} from '../../utils/videoCardLayout';

describe('video card media layout', () => {
  it('uses the same compact fixed height for every card family', () => {
    expect(getCardHeightClass('Wan2')).toContain('h-[560px]');
    expect(getCardHeightClass('MINI')).toContain('h-[560px]');
    expect(getCardHeightClass('HappyHorse')).toContain('h-[560px]');
    expect(getCardHeightClass('Seedance2')).toContain('h-[560px]');
    expect(getCardHeightClass('Seedance15')).toContain('h-[560px]');
    expect(getCardHeightClass('Seedance2', true)).toContain('h-[320px]');
  });

  it('keeps source and result media at the same height for every model and pair mode', () => {
    expect(getPreviewImageHeightClass('MINI', false)).toBe(CARD_MEDIA_HEIGHT_CLASS);
    expect(getPreviewImageHeightClass('Seedance2', true)).toBe(CARD_MEDIA_HEIGHT_CLASS);
    expect(getResultVisualHeightClass('MINI')).toBe(CARD_MEDIA_HEIGHT_CLASS);
    expect(getResultVisualHeightClass('Seedance2')).toBe(CARD_MEDIA_HEIGHT_CLASS);
  });

  it('fills the active result row to four stable slots', () => {
    expect(getVideoResultPlaceholderCount(0)).toBe(4);
    expect(getVideoResultPlaceholderCount(1)).toBe(3);
    expect(getVideoResultPlaceholderCount(3, true)).toBe(0);
    expect(getVideoResultPlaceholderCount(4)).toBe(0);
    expect(getVideoResultPlaceholderCount(5)).toBe(3);
  });
});
