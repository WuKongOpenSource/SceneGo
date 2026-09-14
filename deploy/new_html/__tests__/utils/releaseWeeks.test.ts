import { describe, expect, it } from 'vitest';
import { getReleaseCalendarDate, getReleaseWeek, groupReleaseNotesByWeek } from '../../utils/releaseWeeks';

describe('release calendar weeks', () => {
  it.each([
    ['2026-09-14', '2026-09-14', '2026-09-20'],
    ['2026-09-13', '2026-09-07', '2026-09-13'],
    ['2026-10-01', '2026-09-28', '2026-10-04'],
    ['2027-01-01', '2026-12-28', '2027-01-03'],
    ['2024-02-29', '2024-02-26', '2024-03-03'],
  ])('groups %s from Monday %s to Sunday %s', (date, start, end) => {
    expect(getReleaseWeek(date)).toEqual({ start, end });
  });

  it('uses the Shanghai date even before UTC Monday', () => {
    expect(getReleaseCalendarDate(new Date('2026-09-13T15:59:59Z'))).toBe('2026-09-13');
    expect(getReleaseCalendarDate(new Date('2026-09-13T16:00:00Z'))).toBe('2026-09-14');
  });

  it('sorts every week and record without mutating or dropping history', () => {
    const records = Object.freeze([
      { date: '2026-09-08', title: 'old Tuesday' }, { date: '2026-09-14', title: 'Monday' },
      { date: '2026-09-07', title: 'old Monday' }, { date: '2026-09-13', title: 'Sunday' },
    ]);
    const before = JSON.stringify(records);
    const weeks = groupReleaseNotesByWeek(records, '2026-09-14');
    expect(weeks.map(week => [week.start, week.isCurrent])).toEqual([['2026-09-14', true], ['2026-09-07', false]]);
    expect(weeks[1].records.map(record => record.date)).toEqual(['2026-09-13', '2026-09-08', '2026-09-07']);
    expect(JSON.stringify(records)).toBe(before);
  });

  it('creates an empty current week even when no release has been published', () => {
    expect(groupReleaseNotesByWeek([], '2026-09-14')).toEqual([
      { start: '2026-09-14', end: '2026-09-20', isCurrent: true, records: [] },
    ]);
  });

  it.each(['not-a-date', '2026-02-30', '2026-9-14'])('rejects invalid date %s rather than misgrouping it', date => {
    expect(() => getReleaseWeek(date)).toThrow(RangeError);
  });
});
