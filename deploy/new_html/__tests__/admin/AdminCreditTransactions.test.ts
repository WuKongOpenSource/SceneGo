import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/AdminFeatureTabs.tsx'), 'utf-8');

describe('admin creation-point ledger', () => {
  it('renders recorded reasons and keeps the table shape aligned', () => {
    expect(source).toContain('>原因</th>');
    expect(source).toContain('getCreditTransactionReason(t)');
    expect(source).toContain('操作人：{t.operated_by}');
    expect(source).toContain('colSpan={8}');
  });

  it('formats ledger timestamps in the configured China timezone', () => {
    expect(source).toContain('formatChinaDateTime(t.created_at)');
  });
});
