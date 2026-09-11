import { describe, expect, it } from 'vitest';

import { estimateTextTokens } from '../../services/creditService';


describe('creditService token estimation', () => {
  it('counts Chinese characters and approximates non-CJK text separately', () => {
    expect(estimateTextTokens('你好')).toBe(2);
    expect(estimateTextTokens('abcdefgh')).toBe(2);
    expect(estimateTextTokens('你好abcdefgh')).toBe(4);
  });

  it('does not return a negative or zero estimate for non-empty text', () => {
    expect(estimateTextTokens(' ')).toBe(1);
    expect(estimateTextTokens('')).toBe(0);
  });
});
