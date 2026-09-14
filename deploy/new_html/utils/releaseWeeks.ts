const DAY_MS = 24 * 60 * 60 * 1000;
const calendarFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function getReleaseCalendarDate(now = new Date()): string {
  const parts = calendarFormatter.formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function getReleaseWeek(date: string): { start: string; end: string } {
  const day = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) {
    throw new RangeError('Release dates must be valid YYYY-MM-DD calendar dates');
  }
  // Use UTC for date-only arithmetic so browser time zones and DST cannot split a week.
  const monday = day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS;
  return {
    start: new Date(monday).toISOString().slice(0, 10),
    end: new Date(monday + 6 * DAY_MS).toISOString().slice(0, 10),
  };
}

export interface ReleaseWeek<T> {
  start: string;
  end: string;
  isCurrent: boolean;
  records: T[];
}

export function groupReleaseNotesByWeek<T extends { date: string }>(
  records: readonly T[], today = getReleaseCalendarDate(),
): ReleaseWeek<T>[] {
  const current = getReleaseWeek(today);
  const weeks = new Map<string, ReleaseWeek<T>>([
    [current.start, { ...current, isCurrent: true, records: [] }],
  ]);
  for (const record of [...records].sort((left, right) => right.date.localeCompare(left.date))) {
    const range = getReleaseWeek(record.date);
    if (!weeks.has(range.start)) weeks.set(range.start, { ...range, isCurrent: false, records: [] });
    weeks.get(range.start)!.records.push(record);
  }
  return [...weeks.values()].sort((left, right) => right.start.localeCompare(left.start));
}
