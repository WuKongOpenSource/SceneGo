import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AdminFeatureTabs } from '../../components/AdminFeatureTabs';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../services/httpClient', () => ({ apiJson: mocks.api }));

it('shows the uppercase API failure as a failed ledger row with its timeout reason', async () => {
  mocks.api.mockResolvedValue({ orders: [{ payment_order_id: 'expired', out_trade_no: 'CJ-test', user_id: 'user',
    point_amount: 102, base_amount_fen: 1020, amount_fen: 1000, discount_bps: 9800,
    created_at: '2026-01-01T00:00:00Z', status: 'FAILED', failure_reason: '超过12小时未确认到账，订单自动标记为失败' }] });
  render(<AdminFeatureTabs embedTab="recharge_orders" />);
  const row = (await screen.findByText('CJ-test')).closest('tr')!;
  expect(row).toHaveTextContent('失败');
  expect(row).toHaveTextContent('超过12小时未确认到账');
  expect(row).not.toHaveTextContent('FAILED');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'failed' } });
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith(
    expect.stringContaining('status=failed'), { method: 'GET' }, 'Admin API',
  ));
});
