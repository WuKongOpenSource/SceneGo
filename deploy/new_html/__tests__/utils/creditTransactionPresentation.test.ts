import { describe, expect, it } from 'vitest';
import { getCreditTransactionReason } from '../../utils/creditTransactionPresentation';

describe('credit transaction reason presentation', () => {
  it('shows the native operation_reason including Chinese text', () => {
    expect(getCreditTransactionReason({
      operation_reason: '测试账号补充 1000 创作点数',
      metadata: { reason: '旧理由' },
    })).toBe('测试账号补充 1000 创作点数');
  });

  it('falls back to metadata used by older schemas', () => {
    expect(getCreditTransactionReason({ metadata: { reason: '活动补发点数' } }))
      .toBe('活动补发点数');
    expect(getCreditTransactionReason({ metadata: '{"operation_reason":"客服修正"}' }))
      .toBe('客服修正');
  });

  it('returns an empty string when no reason was recorded', () => {
    expect(getCreditTransactionReason({ metadata: {} })).toBe('');
    expect(getCreditTransactionReason({ metadata: 'invalid-json' })).toBe('');
  });
});
