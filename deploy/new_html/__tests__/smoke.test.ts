import { describe, it, expect } from 'vitest';

describe('test infrastructure', () => {
  it('vitest runs correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('jsdom is available', () => {
    expect(document).toBeDefined();
    expect(document.createElement('div')).toBeTruthy();
  });
});
