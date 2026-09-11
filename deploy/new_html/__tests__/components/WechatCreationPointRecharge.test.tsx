import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WechatCreationPointRecharge } from '../../components/WechatCreationPointRecharge';

const mocks = vi.hoisted(() => ({
  getOptions: vi.fn(),
  quoteAmount: vi.fn(),
  createOrder: vi.fn(),
  getOrder: vi.fn(),
  toDataURL: vi.fn(),
}));

vi.mock('../../services/creditService', () => ({
  getWechatPayOptions: mocks.getOptions,
  quoteWechatRechargeAmount: mocks.quoteAmount,
  createWechatRechargeOrderByAmount: mocks.createOrder,
  getWechatRechargeOrder: mocks.getOrder,
}));

vi.mock('qrcode', () => ({
  default: { toDataURL: mocks.toDataURL },
}));

const quote = {
  point_amount: 102,
  base_amount_fen: 1020,
  discount_bps: 9800,
  discount_label: '9.8 折',
  amount_fen: 1000,
  saved_amount_fen: 20,
  currency: 'CNY' as const,
};

describe('WechatCreationPointRecharge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOptions.mockResolvedValue({
      success: true,
      enabled: true,
      base_ratio: { cny_yuan: 1, creation_points: 10 },
      max_point_amount: 1_000_000,
      max_amount_fen: 8_000_000,
      discount_tiers: [],
      suggestions: [quote],
    });
    mocks.toDataURL.mockResolvedValue('data:image/png;base64,qr');
  });

  it('quotes and creates a WeChat order from an exact custom yuan amount', async () => {
    mocks.quoteAmount.mockResolvedValue({
      ...quote,
      point_amount: 125,
      base_amount_fen: 1250,
      amount_fen: 1234,
      saved_amount_fen: 16,
    });
    mocks.createOrder.mockResolvedValue({
      payment_order_id: 'pay_1',
      out_trade_no: 'CJ1',
      point_amount: 125,
      base_amount_fen: 1250,
      discount_bps: 9800,
      amount_fen: 1234,
      currency: 'CNY',
      status: 'PENDING',
      code_url: 'weixin://wxpay/example',
      transaction_id: null,
      failure_reason: null,
      expires_at: '2026-08-28T12:30:00+08:00',
      paid_at: null,
      created_at: '2026-08-28T12:00:00+08:00',
    });

    render(<WechatCreationPointRecharge onPaymentSuccess={vi.fn()} />);
    expect(await screen.findByText('9.8 折 · 赠送 2 点')).toBeInTheDocument();
    expect(screen.queryByText(/节省/)).not.toBeInTheDocument();
    const amount = await screen.findByLabelText('自定义充值金额');
    fireEvent.change(amount, { target: { value: '12.34' } });

    await waitFor(() => expect(mocks.quoteAmount).toHaveBeenCalledWith(1234));
    expect(await screen.findByText('到账：125 创作点数')).toBeInTheDocument();
    expect(screen.getByText('赠送：2 创作点数')).toBeInTheDocument();
    expect(screen.getByText('¥24.68')).toHaveClass('line-through');
    expect(screen.getByText('¥12.34')).toHaveClass('font-semibold', 'text-success');
    expect(screen.getByText('自定义金额精确到分，到账点数按整点向下取整。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '微信扫码充值' }));
    await waitFor(() => expect(mocks.createOrder).toHaveBeenCalledWith(1234));
    expect(await screen.findByRole('dialog', { name: '微信充值' })).toBeInTheDocument();
    expect(screen.getAllByText('¥24.68').some(element => element.classList.contains('line-through'))).toBe(true);
    await waitFor(() => expect(mocks.toDataURL).toHaveBeenCalledWith(
      'weixin://wxpay/example',
      expect.any(Object),
    ));
  });
});
