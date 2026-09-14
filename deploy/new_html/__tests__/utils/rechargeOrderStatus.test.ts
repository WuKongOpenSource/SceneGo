import { describe, expect, it } from 'vitest';
import { rechargeOrderStatus } from '../../utils/rechargeOrderStatus';

describe('recharge ledger status', () => {
  it.each(['FAILED', 'failed'])('renders %s as a failed order', status => {
    expect(rechargeOrderStatus(status)).toEqual({ label: '失败', type: 'danger' });
  });
  it('recognizes API casing for paid and pending orders', () => {
    expect(rechargeOrderStatus('PAID')).toEqual({ label: '已支付', type: 'success' });
    expect(rechargeOrderStatus('PENDING')).toEqual({ label: '待支付', type: 'warning' });
  });
});
