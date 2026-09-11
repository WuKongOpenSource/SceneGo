import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformFooter, ReleaseNotesContent } from '../../components/PlatformFooter';
import release from '../../../static/platform-release.json';

describe('PlatformFooter', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) { this.open = true; }),
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) { this.open = false; }),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows the build version in the footer and opens a named changelog dialog', () => {
    render(<PlatformFooter />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText(`v${release.version}`)).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(within(footer).getByRole('button', { name: /更新记录/ }));
    const dialog = screen.getByRole('dialog', { name: '更新记录' });
    expect(within(dialog).getByText(release.records[0].title)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭更新记录' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('only closes on backdrop clicks, not on a changelog entry', () => {
    render(<PlatformFooter />);
    fireEvent.click(screen.getByRole('button', { name: /更新记录/ }));
    fireEvent.click(screen.getByText(release.records[0].title));
    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a compact sidebar version and reuses the same release notes', () => {
    const { container } = render(<PlatformFooter placement="sidebar" />);
    const footer = screen.getByLabelText('平台版本与更新记录');
    expect(footer).toHaveClass('platform-sidebar-release');
    expect(footer).not.toHaveClass('platform-footer');
    expect(within(footer).getByText(`v${release.version}`)).toBeVisible();
    expect(within(footer).queryByText('Ovideo')).not.toBeInTheDocument();
    fireEvent.click(within(footer).getByRole('button', { name: /更新记录/ }));
    expect(screen.getByRole('dialog', { name: '更新记录' })).toBeVisible();
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('keeps release notes accessible from a collapsed sidebar with the full version in its tooltip', () => {
    render(<PlatformFooter placement="sidebar" collapsed />);
    const button = screen.getByRole('button', { name: /版本与更新记录/ });
    expect(button).toHaveAttribute('title', `v${release.version} · 更新记录`);
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: '更新记录' });
    expect(within(dialog).getByText(`v${release.version}`)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭更新记录' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders every documented change in reverse chronological order', () => {
    const { container } = render(<ReleaseNotesContent />);
    expect([...container.querySelectorAll('time')].map(time => time.dateTime)).toEqual(release.records.map(record => record.date));
    for (const record of release.records) {
      for (const change of record.changes) expect(screen.getByText(change.text)).toBeVisible();
    }
    expect(screen.getByText(/未为历史更新补编版本号/)).toBeVisible();
  });
});
