type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

interface IdleOptions {
  timeout?: number;
  fallbackDelayMs?: number;
}

export function runWhenIdle(callback: () => void, options: IdleOptions = {}): () => void {
  const timeout = options.timeout ?? 1200;
  const fallbackDelayMs = options.fallbackDelayMs ?? 0;

  if (typeof window !== 'undefined') {
    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(callback, { timeout });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(callback, fallbackDelayMs);
    return () => window.clearTimeout(handle);
  }

  const handle = globalThis.setTimeout(callback, fallbackDelayMs);
  return () => globalThis.clearTimeout(handle);
}

export function waitForIdle(timeout: number = 1200): Promise<void> {
  return new Promise(resolve => {
    runWhenIdle(resolve, { timeout });
  });
}
