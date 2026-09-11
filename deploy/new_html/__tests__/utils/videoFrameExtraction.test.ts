import { describe, expect, it } from 'vitest';

import { getVideoFrameLabel, resolveVideoFrameTime } from '../../utils/videoFrameExtraction';

describe('video frame extraction', () => {
  it('resolves first, current, and last frame positions safely', () => {
    expect(resolveVideoFrameTime('first', 4, 10)).toBe(0);
    expect(resolveVideoFrameTime('current', 4, 10)).toBe(4);
    expect(resolveVideoFrameTime('current', 12, 10)).toBe(10);
    expect(resolveVideoFrameTime('last', 4, 10)).toBeCloseTo(9.95);
  });

  it('handles missing metadata without producing invalid times', () => {
    expect(resolveVideoFrameTime('current', Number.NaN, Number.NaN)).toBe(0);
    expect(resolveVideoFrameTime('last', 0, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('provides user-facing labels for all extraction modes', () => {
    expect(getVideoFrameLabel('first')).toBe('首帧');
    expect(getVideoFrameLabel('current')).toBe('当前帧');
    expect(getVideoFrameLabel('last')).toBe('尾帧');
  });
});
