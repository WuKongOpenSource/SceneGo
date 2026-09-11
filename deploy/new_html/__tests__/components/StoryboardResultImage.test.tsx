import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoryboardResultImage } from '../../components/StoryboardResultImage';
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('storyboard image preview recovery', () => {
  it('falls back to the untouched original when its thumbnail fails', () => {
    const { container } = render(<StoryboardResultImage url="/storage/angle.webp" />);
    expect(container.querySelector('img')?.src).toContain('/api/thumbnail?');
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toHaveAttribute('src', '/storage/angle.webp');
    fireEvent.load(container.querySelector('img')!);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('retries once after a transient outage, then offers a non-generating manual retry', () => {
    vi.useFakeTimers();
    const outer = vi.fn();
    const { container } = render(<div onClick={outer}><StoryboardResultImage url="/storage/angle.webp" /></div>);
    const fail = () => { fireEvent.error(container.querySelector('img')!); fireEvent.error(container.querySelector('img')!); };
    fail();
    expect(screen.getByRole('button', { name: '重新加载图片' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    fail();
    act(() => vi.advanceTimersByTime(5000));
    fireEvent.click(screen.getByRole('button', { name: '重新加载图片' }));
    expect(outer).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
