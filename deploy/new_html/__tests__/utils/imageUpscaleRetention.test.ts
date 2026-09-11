import { describe, expect, it } from 'vitest';
import { formatImageUpscaleDeletionTime } from '../../utils/imageUpscaleRetention';

describe('formatImageUpscaleDeletionTime', () => {
  it('prefers the expiry timestamp supplied by the processing node', () => {
    expect(formatImageUpscaleDeletionTime(
      '2026-10-03T03:29:30+08:00',
      '2026-09-03T03:29:30+08:00',
    )).toBe('预计于 2026年10月03日 03时29分删除');
  });

  it('falls back to 30 days after task completion', () => {
    expect(formatImageUpscaleDeletionTime(
      null,
      '2026-09-03T03:29:30+08:00',
    )).toBe('预计于 2026年10月03日 03时29分删除');
  });

  it('returns no label when no valid task time is available', () => {
    expect(formatImageUpscaleDeletionTime(null, 'invalid-date', null)).toBe('');
  });
});
