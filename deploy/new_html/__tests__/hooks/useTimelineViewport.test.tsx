import React, { memo, useMemo, useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameCoalesced, useLatestCallback, useTimelineViewport } from '../../hooks/useTimelineViewport';

afterEach(() => vi.unstubAllGlobals());

describe('timeline render isolation', () => {
  it('keeps a stable layer while pointer actions use the latest playhead', () => {
    const renders = vi.fn();
    const clicked = vi.fn();
    const Layer = memo(({ onClick }: { onClick: () => void }) => {
      renders();
      return <button onClick={onClick}>片段</button>;
    });
    function Harness({ time }: { time: number }) {
      const handler = useLatestCallback(() => clicked(time));
      return useMemo(() => <Layer onClick={handler} />, [handler]);
    }
    const view = render(<Harness time={0} />);
    for (let time = 1; time <= 100; time++) view.rerender(<Harness time={time} />);
    expect(renders).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('片段'));
    expect(clicked).toHaveBeenCalledWith(100);
  });

  it('coalesces pointer events and flushes the last position before saving', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const move = vi.fn();
    const handler = frameCoalesced(move);
    for (let i = 0; i < 100; i++) handler.schedule(i);
    expect(frames.size).toBe(1);
    expect(move).not.toHaveBeenCalled();
    handler.flush();
    expect(move).toHaveBeenCalledExactlyOnceWith(99);
    expect(frames.size).toBe(0);
  });

  it('updates the window after scrolling and releases observers on unmount', () => {
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
    function Harness() {
      const ref = useRef<HTMLDivElement>(null);
      const range = useTimelineViewport(ref, 20, true);
      return <div ref={ref} data-testid="scroll">{range.start}:{range.end}</div>;
    }
    const view = render(<Harness />);
    const scroll = screen.getByTestId('scroll');
    act(() => { scroll.scrollLeft = 10000; fireEvent.scroll(scroll); });
    expect(scroll.textContent).toBe('480:560');
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
