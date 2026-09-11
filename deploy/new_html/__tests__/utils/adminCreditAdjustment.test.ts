import { describe, expect, it } from 'vitest';
import {
  normalizeAdminCreditAdjustmentAmountInput,
  parseAdminCreditAdjustmentAmount,
} from '../../utils/adminCreditAdjustment';

describe('admin credit adjustment amount', () => {
  it('removes redundant leading zeroes while preserving a negative sign', () => {
    expect(normalizeAdminCreditAdjustmentAmountInput('01000')).toBe('1000');
    expect(normalizeAdminCreditAdjustmentAmountInput('-0010')).toBe('-10');
    expect(normalizeAdminCreditAdjustmentAmountInput('0')).toBe('0');
    expect(normalizeAdminCreditAdjustmentAmountInput('-')).toBe('-');
    expect(normalizeAdminCreditAdjustmentAmountInput('')).toBe('');
  });

  it('only parses non-zero safe integers for submission', () => {
    expect(parseAdminCreditAdjustmentAmount('1000')).toBe(1000);
    expect(parseAdminCreditAdjustmentAmount('-25')).toBe(-25);
    expect(parseAdminCreditAdjustmentAmount('0')).toBeNull();
    expect(parseAdminCreditAdjustmentAmount('-')).toBeNull();
    expect(parseAdminCreditAdjustmentAmount('1.5')).toBeNull();
    expect(parseAdminCreditAdjustmentAmount('9007199254740992')).toBeNull();
  });
});
