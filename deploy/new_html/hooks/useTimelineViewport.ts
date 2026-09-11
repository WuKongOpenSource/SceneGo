import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function timelineWindow(scrollLeft: number, width: number, scale: number) {
  const bucket = 400;
  const startPx = Math.max(0, Math.floor(scrollLeft / bucket) * bucket - bucket);
  const endPx = Math.ceil((scrollLeft + Math.max(width, 800)) / bucket) * bucket + bucket;
  return { start: startPx / Math.max(1, scale), end: endPx / Math.max(1, scale) };
}

export function overlapsTimelineWindow(
  item: { startTime: number; duration: number }, window: { start: number; end: number },
) {
  return item.startTime <= window.end && item.startTime + item.duration >= window.start;
}

export function useTimelineViewport(ref: RefObject<HTMLDivElement | null>, scale: number, ready: boolean) {
  const [viewport, setViewport] = useState(() => timelineWindow(0, 1200, scale));
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = timelineWindow(element.scrollLeft, element.clientWidth, scale);
      setViewport(previous => previous.start === next.start && previous.end === next.end ? previous : next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    element.addEventListener('scroll', schedule, { passive: true });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    observer?.observe(element);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('scroll', schedule);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [ref, scale, ready]);
  return viewport;
}

// Stable event identity lets static timeline layers skip playback-clock renders,
// while pointer actions still read the latest playhead, selection and undo state.
export function useLatestCallback<T extends (...args: any[]) => any>(callback: T): T {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; });
  return useCallback(((...args: Parameters<T>) => latest.current(...args)) as T, []);
}

// Coalesce high-frequency pointer input without dropping the release position.
export function frameCoalesced<T extends (...args: any[]) => void>(callback: T) {
  let frame = 0;
  let pending: Parameters<T> | null = null;
  const flush = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (pending) {
      const args = pending;
      pending = null;
      callback(...args);
    }
  };
  const schedule = (...args: Parameters<T>) => {
    pending = args;
    if (!frame) frame = requestAnimationFrame(flush);
  };
  return { schedule, flush };
}
