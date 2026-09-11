import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/AdminFeatureTabs.tsx'), 'utf-8');

describe('admin credit adjustment interaction', () => {
  it('only closes the dialog through explicit controls', () => {
    const dialogStart = source.indexOf('{adjustOpen && (');
    const dialogEnd = source.indexOf('// 5. 创作点数台账', dialogStart);
    const dialog = source.slice(dialogStart, dialogEnd);

    expect(dialog).toContain('onClick={closeAdjustment}');
    expect(dialog).not.toContain('if (e.target === e.currentTarget)');
    expect(dialog).not.toContain('onMouseLeave=');
  });

  it('starts with an empty string and normalizes the controlled amount input', () => {
    expect(source).toContain("const [amountText, setAmountText] = useState('')");
    expect(source).toContain('value={amountText}');
    expect(source).toContain('normalizeAdminCreditAdjustmentAmountInput(event.target.value)');
    expect(source).toContain('parseAdminCreditAdjustmentAmount(amountText)');
  });
});
