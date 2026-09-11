import { describe, expect, it } from 'vitest';
import { recommendDoubaoImageSize } from '../../utils/doubaoImageSize';

describe('recommendDoubaoImageSize', () => {
  it('converts 16:9 K presets to explicit pixel sizes', () => {
    expect(recommendDoubaoImageSize('16:9', '1K')).toBe('2560x1440');
    expect(recommendDoubaoImageSize('16:9', '2K')).toBe('2560x1440');
    expect(recommendDoubaoImageSize('16:9', '4K')).toBe('4096x2304');
  });

  it('supports portrait and square ratios', () => {
    expect(recommendDoubaoImageSize('9:16', '2K')).toBe('1440x2560');
    expect(recommendDoubaoImageSize('3:4', '1K')).toBe('1664x2224');
    expect(recommendDoubaoImageSize('1:1', '1K')).toBe('1920x1920');
    expect(recommendDoubaoImageSize('1:1', '4K')).toBe('4096x4096');
  });

  it('keeps the K preset when a future ratio is unknown', () => {
    expect(recommendDoubaoImageSize('auto', '2K')).toBe('2K');
  });
});
