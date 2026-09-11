import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, Coins, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import {
  createWechatRechargeOrderByAmount,
  getWechatPayOptions,
  getWechatRechargeOrder,
  quoteWechatRechargeAmount,
  WechatPayOptions,
  WechatRechargeOrder,
  WechatRechargeQuote,
} from '../services/creditService';

const formatFen = (value: number) => `¥${(Number(value || 0) / 100).toFixed(2)}`;
const referencePriceFen = (payAmountFen: number) => Math.max(0, Math.round(Number(payAmountFen || 0) * 2));
const giftedPointAmount = (
  pointAmount: number,
  amountFen: number,
  baseRatio?: { cny_yuan: number; creation_points: number },
) => {
  const cnyYuan = Math.max(1, Number(baseRatio?.cny_yuan || 1));
  const creationPoints = Math.max(1, Number(baseRatio?.creation_points || 10));
  const basePoints = Math.floor((Number(amountFen || 0) * creationPoints) / (100 * cnyYuan));
  return Math.max(0, Math.floor(Number(pointAmount || 0)) - basePoints);
};

export const WechatCreationPointRecharge: React.FC<{
  onPaymentSuccess: () => void | Promise<void>;
}> = ({ onPaymentSuccess }) => {
  const [options, setOptions] = useState<WechatPayOptions | null>(null);
  const [amountText, setAmountText] = useState('10.00');
  const [quote, setQuote] = useState<WechatRechargeQuote | null>(null);
  const [order, setOrder] = useState<WechatRechargeOrder | null>(null);
  const [qrImage, setQrImage] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const paidRef = useRef<string | null>(null);
  const checkingRef = useRef(false);

  const loadOptions = useCallback(async () => {
    setError('');
    try {
      const data = await getWechatPayOptions();
      setOptions(data);
      if (data.suggestions?.[0]) {
        setAmountText((data.suggestions[0].amount_fen / 100).toFixed(2));
        setQuote(data.suggestions[0]);
      }
    } catch (e: any) {
      setOptions(null);
      setError(e?.message || '微信支付配置加载失败');
    }
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  useEffect(() => {
    const amountYuan = Number(amountText);
    const amountFen = Math.round(amountYuan * 100);
    if (!Number.isFinite(amountYuan) || amountFen < 10 || Math.abs(amountYuan * 100 - amountFen) > 0.00001) {
      setQuote(null);
      return;
    }
    const preset = options?.suggestions?.find(item => item.amount_fen === amountFen);
    if (preset) {
      setQuote(preset);
      return;
    }
    const timer = window.setTimeout(() => {
      void quoteWechatRechargeAmount(amountFen)
        .then(nextQuote => {
          setQuote(nextQuote);
          setError('');
        })
        .catch((e: any) => {
          setQuote(null);
          setError(e?.message || '充值金额计算失败');
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [amountText, options?.suggestions]);

  useEffect(() => {
    let cancelled = false;
    if (!order?.code_url) {
      setQrImage('');
      return;
    }
    QRCode.toDataURL(order.code_url, {
      width: 280,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827', light: '#ffffff' },
    }).then(value => {
      if (!cancelled) setQrImage(value);
    }).catch(() => {
      if (!cancelled) setError('支付二维码生成失败');
    });
    return () => { cancelled = true; };
  }, [order?.code_url]);

  const refreshOrder = useCallback(async (target?: WechatRechargeOrder | null) => {
    const current = target || order;
    if (!current?.out_trade_no || checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      const next = await getWechatRechargeOrder(current.out_trade_no);
      setOrder(next);
      if (next.status === 'PAID' && paidRef.current !== next.out_trade_no) {
        paidRef.current = next.out_trade_no;
        window.dispatchEvent(new CustomEvent('credits:updated'));
        await onPaymentSuccess();
      }
    } catch (e: any) {
      setError(e?.message || '支付状态查询失败');
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, [onPaymentSuccess, order]);

  useEffect(() => {
    if (order?.status !== 'PENDING') return;
    const timer = window.setInterval(() => { void refreshOrder(order); }, 3_000);
    return () => window.clearInterval(timer);
  }, [order, refreshOrder]);

  const startPayment = async () => {
    const amountYuan = Number(amountText);
    const amountFen = Math.round(amountYuan * 100);
    if (!Number.isFinite(amountYuan) || amountFen < 10 || !quote) {
      setError('请输入不低于 0.10 元的有效充值金额');
      return;
    }
    setLoading(true);
    setError('');
    setOrder(null);
    setQrImage('');
    try {
      setOrder(await createWechatRechargeOrderByAmount(amountFen));
    } catch (e: any) {
      setError(e?.message || '微信支付下单失败');
    } finally {
      setLoading(false);
    }
  };

  const ended = Boolean(order && ['CLOSED', 'EXPIRED', 'FAILED'].includes(order.status));

  return (
    <section className="rounded-md border border-g75 bg-gradient-to-br from-g50/60 via-n0 to-n0 p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-success">
            <Coins size={17} /> 创作点数充值
          </div>
          <h2 className="mt-1 text-lg font-semibold text-n800">微信扫码，支付成功后自动到账</h2>
          <p className="mt-1 text-xs text-n200">充值进入永久有效的账户点数；当前不提供套餐订阅。</p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-n200">
          <ShieldCheck size={14} className="text-success" /> 微信支付 APIv3
        </div>
      </div>

      {options?.enabled ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {options.suggestions.map(item => (
              <button
                key={item.point_amount}
                type="button"
                onClick={() => { setAmountText((item.amount_fen / 100).toFixed(2)); setQuote(item); setError(''); }}
                className={`rounded-md border p-3 text-left transition ${Math.round(Number(amountText) * 100) === item.amount_fen ? 'border-primary bg-b50' : 'border-n40 bg-n0 hover:border-primary/50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-n800">{item.point_amount.toLocaleString()} 点</span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-[11px] text-n100 line-through" aria-label="参考原价">{formatFen(referencePriceFen(item.amount_fen))}</span>
                    <span className="font-semibold text-success">{formatFen(item.amount_fen)}</span>
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-n200">
                  {item.discount_label} · 赠送 {giftedPointAmount(item.point_amount, item.amount_fen, options.base_ratio).toLocaleString()} 点
                </div>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-md border border-n40 bg-n0 p-4 sm:flex-row sm:items-end">
            <label className="flex-1 text-xs text-n300">
              自定义充值金额（元）
              <input
                type="number"
                min={0.1}
                max={options.max_amount_fen / 100}
                step={0.01}
                value={amountText}
                onChange={e => { setAmountText(e.target.value); setError(''); }}
                className="mt-1.5 w-full rounded border border-n40 bg-n0 px-3 py-2 text-base font-semibold text-n800 outline-none focus:border-primary"
                aria-label="自定义充值金额"
              />
            </label>
            <div className="min-w-52 text-xs text-n200">
              <div>基础比例：1 元 = 10 创作点数</div>
              <div className="mt-1">优惠：{quote?.discount_label || '-'}</div>
              <div className="mt-1">赠送：{quote ? `${giftedPointAmount(quote.point_amount, quote.amount_fen, options.base_ratio).toLocaleString()} 创作点数` : '-'}</div>
              <div className="mt-1 text-sm font-semibold text-n800">到账：{quote ? `${quote.point_amount.toLocaleString()} 创作点数` : '-'}</div>
              <div className="mt-1">参考原价：{quote ? <span className="line-through text-n100">{formatFen(referencePriceFen(quote.amount_fen))}</span> : '-'}</div>
              <div className="mt-1">实付：{quote ? <span className="font-semibold text-success">{formatFen(quote.amount_fen)}</span> : '-'}</div>
              <div className="mt-1 text-[11px] text-n100">自定义金额精确到分，到账点数按整点向下取整。</div>
            </div>
            <button
              type="button"
              onClick={() => void startPayment()}
              disabled={loading || !quote}
              className="h-10 rounded bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {loading ? '创建订单中…' : '微信扫码充值'}
            </button>
          </div>
        </>
      ) : (
        <div className="mt-4 rounded border border-y75 bg-y50 px-4 py-3 text-sm text-warning">
          {error || '微信充值暂未启用，配置完成后可在此直接购买创作点数。'}
          <button type="button" onClick={() => void loadOptions()} className="ml-3 underline">重新加载</button>
        </div>
      )}

      {error && options?.enabled && <div className="mt-3 text-sm text-danger">{error}</div>}

      {order && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-n900/45 p-4 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setOrder(null); }}>
          <div role="dialog" aria-modal="true" aria-label="微信充值" className="w-full max-w-md rounded-lg border border-n40 bg-n0 p-5 shadow-bottom">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-n800">微信支付</h3>
                <p className="mt-1 text-xs text-n200">
                  {order.point_amount.toLocaleString()} 创作点数 · 参考原价{' '}
                  <span className="line-through">{formatFen(referencePriceFen(order.amount_fen))}</span>{' '}
                  · 实付 <span className="font-semibold text-success">{formatFen(order.amount_fen)}</span>
                </p>
              </div>
              <button type="button" onClick={() => setOrder(null)} className="rounded p-1 text-n200 hover:bg-n20"><X size={17} /></button>
            </div>
            <div className="mt-4 flex min-h-80 flex-col items-center justify-center rounded-md bg-n20 p-4 text-center">
              {order.status === 'PAID' ? (
                <>
                  <CheckCircle2 size={58} className="text-success" />
                  <div className="mt-3 text-lg font-semibold text-n800">支付成功</div>
                  <div className="mt-1 text-sm text-n200">{order.point_amount.toLocaleString()} 账户点数已到账</div>
                </>
              ) : qrImage && !ended ? (
                <>
                  <img src={qrImage} alt="微信支付二维码" className="h-64 w-64 rounded bg-white p-2" />
                  <div className="mt-2 text-sm text-n300">请使用微信扫一扫完成支付</div>
                </>
              ) : ended ? (
                <div className="text-sm text-warning">{order.failure_reason || '订单已结束，请重新发起'}</div>
              ) : (
                <Loader2 size={36} className="animate-spin text-primary" />
              )}
            </div>
            {order.status === 'PENDING' && (
              <button type="button" onClick={() => void refreshOrder()} disabled={checking} className="mt-4 flex w-full items-center justify-center gap-2 rounded border border-n40 bg-n0 py-2 text-sm text-n700 hover:bg-n20 disabled:opacity-50">
                <RefreshCw size={15} className={checking ? 'animate-spin' : ''} /> 我已支付，刷新状态
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default WechatCreationPointRecharge;
