import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LazyVideo, withVideoFirstFrame } from '../../components/LazyVideo';

type ObserverCallback = IntersectionObserverCallback;

let lastObserverCallback: ObserverCallback | null = null;
const observe = vi.fn();
const disconnect = vi.fn();

class MockIntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number> = [];

  constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
    lastObserverCallback = callback;
    this.rootMargin = options?.rootMargin || '0px';
  }

  observe = observe;
  unobserve = vi.fn();
  disconnect = disconnect;
  takeRecords = () => [];
}

afterEach(() => {
  vi.unstubAllGlobals();
  lastObserverCallback = null;
  observe.mockClear();
  disconnect.mockClear();
});

describe('LazyVideo', () => {
  it('does not bind src or preload until the video enters the viewport', async () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    const { container } = render(<LazyVideo src="/uploads/clip.mp4" className="preview" />);
    const video = container.querySelector('video') as HTMLVideoElement;

    expect(video.getAttribute('src')).toBeNull();
    expect(video.getAttribute('preload')).toBe('none');
    expect(video.muted).toBe(true);
    expect(observe).toHaveBeenCalledWith(video);

    await act(async () => {
      lastObserverCallback?.(
        [{ isIntersecting: true, target: video } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(video.getAttribute('src')).toBe('/uploads/clip.mp4#t=0.1');
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(disconnect).toHaveBeenCalled();
  });

  it('keeps the video bound when src changes after it has entered view', async () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    const { container, rerender } = render(<LazyVideo src="/uploads/clip.mp4" />);
    const video = container.querySelector('video') as HTMLVideoElement;

    await act(async () => {
      lastObserverCallback?.(
        [{ isIntersecting: true, target: video } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(video.getAttribute('src')).toBe('/uploads/clip.mp4#t=0.1');

    rerender(<LazyVideo src="/uploads/clip-v2.mp4" />);
    expect(video.getAttribute('src')).toBe('/uploads/clip-v2.mp4#t=0.1');
  });

  it('does not append a first-frame fragment when the url already has one', () => {
    expect(withVideoFirstFrame('/uploads/clip.mp4#t=3')).toBe('/uploads/clip.mp4#t=3');
  });
});
