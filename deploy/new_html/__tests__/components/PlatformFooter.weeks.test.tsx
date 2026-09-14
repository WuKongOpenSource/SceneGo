import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReleaseNotesContent } from '../../components/PlatformFooter';

vi.mock('../../../static/platform-release.json', () => ({ default: {
  version: '2026.9.14.1', period: { from: '2026-09-08', to: '2026-09-14' },
  records: [
    { date: '2026-09-13', title: '周日更新', changes: [{ kind: 'fix', text: '周日修复内容' }] },
    { date: '2026-09-14', title: '周一更新', changes: [{ kind: 'new', text: '周一新增内容' }] },
    { date: '2026-09-06', title: '更早更新', changes: [{ kind: 'improvement', text: '更早优化内容' }] },
  ],
} }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-14T08:00:00+08:00'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('natural-week release notes', () => {
  it('opens the current Monday-to-Sunday week and collapses every older week', () => {
    const { container } = render(<ReleaseNotesContent />);
    const weeks = Array.from(container.querySelectorAll('details'));
    expect(weeks).toHaveLength(3);
    expect(weeks[0]).toHaveAttribute('open');
    expect(weeks[0]).toHaveTextContent('本周');
    expect(weeks[0]).toHaveTextContent('2026-09-14 — 2026-09-20');
    expect(weeks[1]).not.toHaveAttribute('open');
    expect(weeks[1]).toHaveTextContent('2026-09-07 — 2026-09-13');
    expect(weeks[2]).not.toHaveAttribute('open');
    expect(screen.getByText('周一新增内容')).toBeVisible();
    expect(screen.getByText('周日修复内容')).not.toBeVisible();
    expect(screen.queryByText(/最近一周/)).not.toBeInTheDocument();
    expect([...container.querySelectorAll('time')].map(time => time.dateTime)).toEqual(['2026-09-14', '2026-09-13', '2026-09-06']);
  });

  it('lets the user expand and collapse history without losing any entries', () => {
    render(<ReleaseNotesContent />);
    const older = screen.getByText('周日更新').closest('details')!;
    fireEvent.click(older.querySelector('summary')!);
    expect(older).toHaveAttribute('open');
    expect(screen.getByText('周日修复内容')).toBeVisible();
    fireEvent.click(older.querySelector('summary')!);
    expect(older).not.toHaveAttribute('open');
    expect(screen.getByText('周日修复内容')).toBeInTheDocument();
  });

  it('keeps a new empty week open instead of presenting last week as current', () => {
    vi.setSystemTime(new Date('2026-09-21T00:00:00+08:00'));
    const { container } = render(<ReleaseNotesContent />);
    const current = container.querySelector('details[open]');
    expect(current).toHaveTextContent('2026-09-21 — 2026-09-27');
    expect(current).toHaveTextContent('本周暂无更新记录');
    expect(screen.getByText('周一新增内容')).not.toBeVisible();
  });

  it('rolls over at Shanghai Monday midnight while the page remains open', () => {
    vi.setSystemTime(new Date('2026-09-20T23:59:59+08:00'));
    const { container } = render(<ReleaseNotesContent />);
    expect(screen.getByText('周一新增内容')).toBeVisible();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.querySelector('details[open]')).toHaveTextContent('2026-09-21 — 2026-09-27');
    expect(screen.getByText('周一新增内容')).not.toBeVisible();
  });
});
