import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LazyImage } from '../../components/LazyImage';

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

describe('LazyImage', () => {
  it('does not bind src until the image enters the viewport', async () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    render(<LazyImage src="/uploads/shot.png" alt="shot" className="preview" />);

    const img = screen.getByAltText('shot') as HTMLImageElement;
    expect(img.getAttribute('src')).toBeNull();
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(observe).toHaveBeenCalledWith(img);

    await act(async () => {
      lastObserverCallback?.(
        [{ isIntersecting: true, target: img } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(img.getAttribute('src')).toBe('/uploads/shot.png');
    expect(disconnect).toHaveBeenCalled();
  });

  it('keeps the image bound when src changes after it has entered view', async () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    const { rerender } = render(<LazyImage src="/uploads/shot.png" alt="shot" />);
    const img = screen.getByAltText('shot') as HTMLImageElement;

    await act(async () => {
      lastObserverCallback?.(
        [{ isIntersecting: true, target: img } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(img.getAttribute('src')).toBe('/uploads/shot.png');


    rerender(<LazyImage src="/uploads/shot-v2.png" alt="shot" />);
    expect(img.getAttribute('src')).toBe('/uploads/shot-v2.png');
  });
});
