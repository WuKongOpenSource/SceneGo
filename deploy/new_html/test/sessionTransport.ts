import { expect } from 'vitest';

declare const __OVIDEO_PUBLIC_SOURCE__: boolean;

/** The public edition uses cookies only; the full edition retains legacy bearer compatibility. */
export function expectSessionTransport(options: RequestInit): void {
  const publicEdition = typeof __OVIDEO_PUBLIC_SOURCE__ !== 'undefined' && __OVIDEO_PUBLIC_SOURCE__;
  expect(new Headers(options.headers).get('Authorization')).toBe(publicEdition ? null : 'Bearer test-token');
  expect(options.credentials).toBe('same-origin');
}
