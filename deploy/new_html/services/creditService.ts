




import { apiJson } from './httpClient';

export interface CreditBalance {
  success: boolean;
  account_id: string;
  available_credits: number;
  account_credits: number;
  gift_credits: number;
  gift_expires_at?: string | null;
  frozen_credits: number;
  total_used_credits: number;
}

export interface CreditEstimateResult {
  success: boolean;
  feature_key: string;
  enabled: boolean;
  estimated_cost: number;
  rule_id?: string;
  rule_version?: string;
  base_cost?: number;
  billing_unit?: string;
  min_cost?: number;
  max_cost?: number | null;
  balance: number | null;
  enough: boolean;
  message?: string;
}

export interface CreditTransaction {
  transaction_id: string;
  account_id: string;
  user_id: string | null;
  team_id: string | null;
  project_id: string | null;
  task_id: string | null;
  feature_key: string | null;
  change_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  rule_version: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export async function getCreditBalance(): Promise<CreditBalance> {
  return apiJson('/api/credits/balance', {
    method: 'GET',
  }, 'getCreditBalance');
}

export async function estimateCredits(
  featureKey: string,
  params: Record<string, any> = {},
): Promise<CreditEstimateResult> {
  return apiJson('/api/credits/estimate', {
    method: 'POST',
    body: JSON.stringify({ feature_key: featureKey, params }),
  }, 'estimateCredits');
}

export interface CreditConsumeResult {
  success: boolean;
  task_id: string;
  feature_key: string;
  charged_credits: number;
  transaction_id?: string | null;
  balance_after?: number | null;
  rule_version?: string | null;
  idempotent: boolean;
  billing_disabled?: boolean;
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const nonCjkLength = Math.max(0, text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, '').trim().length);
  return Math.max(1, cjkCount + Math.ceil(nonCjkLength / 4));
}

export async function assertEnoughCredits(
  featureKey: string,
  params: Record<string, any>,
): Promise<CreditEstimateResult> {
  const quote = await estimateCredits(featureKey, params);
  if (quote.enabled && !quote.enough) {
    throw new Error(`创作点数不足：本次预计需要 ${quote.estimated_cost} 点，当前可用 ${quote.balance ?? 0} 点`);
  }
  return quote;
}

export async function consumeCredits(payload: {
  featureKey: string;
  taskId: string;
  params: Record<string, any>;
  projectId?: string | null;
  metadata?: Record<string, any>;
}): Promise<CreditConsumeResult> {
  const result = await apiJson<CreditConsumeResult>('/api/credits/consume', {
    method: 'POST',
    body: JSON.stringify({
      feature_key: payload.featureKey,
      task_id: payload.taskId,
      params: payload.params,
      project_id: payload.projectId || undefined,
      metadata: payload.metadata || {},
    }),
  }, 'consumeCredits');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('credits:updated', { detail: { balance: result.balance_after } }));
  }
  return result;
}

export interface ListTransactionsParams {
  feature_key?: string;
  change_type?: string;
  from_dt?: string;
  to_dt?: string;
  limit?: number;
  offset?: number;
}

export async function listCreditTransactions(
  params: ListTransactionsParams = {},
): Promise<{ success: boolean; transactions: CreditTransaction[]; limit: number; offset: number }> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  return apiJson(`/api/credits/transactions${qs}`, {
    method: 'GET',
  }, 'listCreditTransactions');
}

export interface WechatRechargeQuote {
  point_amount: number;
  base_amount_fen: number;
  discount_bps: number;
  discount_label: string;
  amount_fen: number;
  saved_amount_fen: number;
  currency: 'CNY';
}

export interface WechatPayOptions {
  success: boolean;
  enabled: boolean;
  base_ratio: { cny_yuan: number; creation_points: number };
  max_point_amount: number;
  max_amount_fen: number;
  discount_tiers: Array<{
    min_point_amount: number;
    min_pay_amount_fen: number;
    discount_bps: number;
    label: string;
  }>;
  suggestions: WechatRechargeQuote[];
}

export interface WechatRechargeOrder {
  payment_order_id: string;
  out_trade_no: string;
  point_amount: number;
  base_amount_fen: number;
  discount_bps: number;
  amount_fen: number;
  currency: 'CNY';
  status: 'PENDING' | 'PAID' | 'CLOSED' | 'EXPIRED' | 'FAILED';
  code_url: string | null;
  transaction_id: string | null;
  failure_reason: string | null;
  expires_at: string;
  paid_at: string | null;
  created_at: string;
}

export async function getWechatPayOptions(): Promise<WechatPayOptions> {
  return apiJson('/api/payments/wechat/options', { method: 'GET' }, 'getWechatPayOptions');
}

export async function quoteWechatRecharge(pointAmount: number): Promise<WechatRechargeQuote> {
  const result = await apiJson<{ success: boolean; quote: WechatRechargeQuote }>(
    '/api/payments/wechat/quote',
    { method: 'POST', body: JSON.stringify({ point_amount: pointAmount }) },
    'quoteWechatRecharge',
  );
  return result.quote;
}

export async function quoteWechatRechargeAmount(amountFen: number): Promise<WechatRechargeQuote> {
  const result = await apiJson<{ success: boolean; quote: WechatRechargeQuote }>(
    '/api/payments/wechat/quote',
    { method: 'POST', body: JSON.stringify({ amount_fen: amountFen }) },
    'quoteWechatRechargeAmount',
  );
  return result.quote;
}

export async function createWechatRechargeOrder(pointAmount: number): Promise<WechatRechargeOrder> {
  const result = await apiJson<{ success: boolean; order: WechatRechargeOrder }>(
    '/api/payments/wechat/orders',
    { method: 'POST', body: JSON.stringify({ point_amount: pointAmount }) },
    'createWechatRechargeOrder',
  );
  return result.order;
}

export async function createWechatRechargeOrderByAmount(amountFen: number): Promise<WechatRechargeOrder> {
  const result = await apiJson<{ success: boolean; order: WechatRechargeOrder }>(
    '/api/payments/wechat/orders',
    { method: 'POST', body: JSON.stringify({ amount_fen: amountFen }) },
    'createWechatRechargeOrderByAmount',
  );
  return result.order;
}

export async function getWechatRechargeOrder(outTradeNo: string): Promise<WechatRechargeOrder> {
  const result = await apiJson<{ success: boolean; order: WechatRechargeOrder }>(
    `/api/payments/wechat/orders/${encodeURIComponent(outTradeNo)}`,
    { method: 'GET' },
    'getWechatRechargeOrder',
  );
  return result.order;
}


// Admin endpoints — credit rules

export interface CreditRule {
  rule_id: string;
  feature_key: string;
  feature_name: string;
  enabled: boolean;
  base_cost: number;
  billing_unit: string;
  factors: any[];
  min_cost: number;
  max_cost: number | null;
  rule_version: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export async function adminListCreditRules(): Promise<{ success: boolean; rules: CreditRule[] }> {
  return apiJson('/api/admin/credit-rules', {
    method: 'GET',
  }, 'adminListCreditRules');
}

export async function adminCreateCreditRule(payload: Partial<CreditRule> & {
  feature_key: string; feature_name: string; base_cost: number;
}): Promise<{ success: boolean; rule: CreditRule }> {
  return apiJson('/api/admin/credit-rules', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 'adminCreateCreditRule');
}

export async function adminUpdateCreditRule(
  ruleId: string,
  payload: Partial<CreditRule>,
): Promise<{ success: boolean; rule: CreditRule }> {
  return apiJson(`/api/admin/credit-rules/${ruleId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  }, 'adminUpdateCreditRule');
}

export async function adminDeleteCreditRule(ruleId: string): Promise<{ success: boolean }> {
  return apiJson(`/api/admin/credit-rules/${ruleId}`, {
    method: 'DELETE',
  }, 'adminDeleteCreditRule');
}
