import { describe, expect, it } from 'vitest';
import { formatChinaDateTime, parseBackendDateTime } from '../../utils/dateTime';

describe('China date-time formatting', () => {
  it('treats a legacy timezone-less backend timestamp as UTC', () => {
    expect(parseBackendDateTime('2026-09-02T03:14:15').getTime())
      .toBe(Date.UTC(2026, 8, 2, 3, 14, 15));
    expect(formatChinaDateTime('2026-09-02T03:14:15')).toContain('11:14:15');
  });

  it('preserves explicit offsets while always displaying in Asia/Shanghai', () => {
    expect(formatChinaDateTime('2026-09-02T11:14:15+08:00')).toContain('11:14:15');
    expect(formatChinaDateTime(Date.UTC(2026, 8, 2, 3, 14, 15))).toContain('11:14:15');
  });

  it('returns the requested placeholder for missing or invalid values', () => {
    expect(formatChinaDateTime(null)).toBe('-');
    expect(formatChinaDateTime('not-a-date', '—')).toBe('—');
  });
});
