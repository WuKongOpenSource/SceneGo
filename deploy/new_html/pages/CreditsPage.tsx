








import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins, RefreshCw, ArrowDownCircle, Info, Snowflake } from 'lucide-react';
import {
  getCreditBalance, listCreditTransactions,
  CreditBalance, CreditTransaction,
} from '../services/creditService';
import WechatCreationPointRecharge from '../components/WechatCreationPointRecharge';

const CHANGE_TYPE_LABEL: Record<string, { label: string; color: string; sign: 1 | -1 | 0 }> = {
  freeze:        { label: '冻结（暂占）', color: 'text-warning', sign: 0 },
  release:       { label: '退还',       color: 'text-success', sign:  1 },
  consume:       { label: '消耗',       color: 'text-danger',   sign: -1 },
  admin_credit:  { label: '管理员充值', color: 'text-success', sign:  1 },
  admin_debit:   { label: '管理员扣减', color: 'text-danger',   sign: -1 },
  recharge:      { label: '充值',       color: 'text-success', sign:  1 },
  gift:          { label: '赠送',       color: 'text-success', sign:  1 },
  signup_grant:  { label: '注册赠送',   color: 'text-success', sign:  1 },
  expire:        { label: '过期',       color: 'text-n300',  sign: -1 },
};

const FEATURE_LABEL: Record<string, string> = {
  image_generation: '图片生成',
  video_generation: '视频生成',
  design_image_generation: 'AI 生图',
  design_prompt_refinement: '提示词优化',
  storyboard_image_generation: '分镜生图',
  storyboard_design_generation: '分镜设计',
  script_model_call: '剧本 AI',
};

export function formatCreditChangeTypeLabel(changeType: string | null | undefined): string {
  const key = String(changeType || '').trim();
  return CHANGE_TYPE_LABEL[key]?.label || (key ? '其他变动' : '-');
}

export function formatCreditFeatureLabel(featureKey: string | null | undefined): string {
  const key = String(featureKey || '').trim();
  return FEATURE_LABEL[key] || (key ? '其他功能' : '-');
}

const IMAGE_TIER_LABEL: Record<string, string> = {
  image_tier_1: 'Gemini 2.5 Flash Image',
  image_tier_2: 'Gemini 3.1 Flash Image Preview',
  image_tier_3: 'Doubao-Seedream-5.0-lite',
};





export function collapseSettledFreezeRows(
  transactions: CreditTransaction[],
  filterChangeType = '',
): CreditTransaction[] {
  if (filterChangeType) return transactions;
  const settledTaskIds = new Set(
    transactions
      .filter(item => item.task_id && (item.change_type === 'consume' || item.change_type === 'release'))
      .map(item => item.task_id as string),
  );
  return transactions.filter(item => !(
    item.change_type === 'freeze'
    && item.task_id
    && settledTaskIds.has(item.task_id)
  ));
}

export function formatCreditBillingDetail(transaction: CreditTransaction): string {
  const params = transaction.metadata?.billing_params || {};
  const count = Number(params.image_count || 0);
  const model = String(params.model || '');
  const parts: string[] = [];
  if (count > 0) parts.push(`${count} 张`);
  if (model) parts.push(IMAGE_TIER_LABEL[model] || model);
  if (params.resolution) parts.push(String(params.resolution));
  if (params.aspect_ratio) parts.push(String(params.aspect_ratio));
  return parts.join(' · ') || '-';
}

export function formatCreditBalanceMovement(transaction: CreditTransaction): {
  before: string;
  after: string;
  settledFromFreeze: boolean;
} {
  const settledFromFreeze = transaction.change_type === 'consume'
    && Number(transaction.balance_before) === Number(transaction.balance_after);
  return {
    before: settledFromFreeze ? '冻结时已扣' : String(transaction.balance_before),
    after: String(transaction.balance_after),
    settledFromFreeze,
  };
}

export const CreditsPage: React.FC = () => {
  const navigate = useNavigate();
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [filterChangeType, setFilterChangeType] = useState<string>('');
  const [filterFeature, setFilterFeature] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleTransactions = collapseSettledFreezeRows(transactions, filterChangeType);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, t] = await Promise.all([
        getCreditBalance(),
        listCreditTransactions({
          change_type: filterChangeType || undefined,
          feature_key: filterFeature || undefined,
          limit: 200,
        }),
      ]);
      setBalance(b);
      setTransactions(t.transactions || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [filterChangeType, filterFeature]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="min-h-screen bg-n0 text-n800">
      <div className="mx-auto w-full max-w-[1680px] space-y-6 p-4 sm:p-6 lg:px-8">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-sm text-n300 hover:text-n800">← 返回</button>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Coins size={20} className="text-warning" />
            我的创作点数
          </h1>
          <button onClick={reload} className="ml-auto p-2 rounded bg-n0 hover:bg-n20">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && (
          <div className="p-3 text-sm text-danger bg-r50 border border-r75 rounded">
            {error}
          </div>
        )}


        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <BalanceCard
            title="可用创作点数"
            value={balance?.available_credits ?? 0}
            color="from-g50 to-n0"
            icon={<Coins size={20} className="text-success" />}
          />
          <BalanceCard
            title="账户点数"
            value={balance?.account_credits ?? 0}
            color="from-b50 to-n0"
            icon={<Coins size={20} className="text-primary" />}
          />
          <BalanceCard
            title="赠送点数"
            value={balance?.gift_credits ?? 0}
            subtitle={balance?.gift_expires_at ? `${new Date(balance.gift_expires_at).toLocaleString('zh-CN')} 过期` : '暂无当日赠送'}
            color="from-y50 to-n0"
            icon={<Coins size={20} className="text-warning" />}
          />
          <BalanceCard
            title="冻结中"
            value={balance?.frozen_credits ?? 0}
            color="from-y50 to-n0"
            icon={<Snowflake size={20} className="text-warning" />}
          />
          <BalanceCard
            title="累计消耗"
            value={balance?.total_used_credits ?? 0}
            color="from-n30 to-n0"
            icon={<ArrowDownCircle size={20} className="text-n300" />}
          />
        </div>

        <WechatCreationPointRecharge onPaymentSuccess={reload} />


        <section className="rounded-md border border-n40 bg-n0 shadow-card">
          <div className="flex items-start gap-2 border-b border-n40 bg-b50/50 px-4 py-3 text-xs text-n300">
            <Info size={14} className="mt-0.5 shrink-0 text-primary" />
            <span>
              任务提交时会先暂时冻结预估创作点数；成功后从冻结额结算为消耗，不会再扣一次，失败则自动退还。
              “冻结时已扣”表示成功结算时可用余额不再发生第二次变化。
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-n40 text-sm">
            <span className="font-medium whitespace-nowrap">创作点数流水</span>
            <select
              value={filterChangeType}
              onChange={e => setFilterChangeType(e.target.value)}
              className="sm:ml-3 text-xs bg-n0 border border-n40 rounded px-2 py-1"
            >
              <option value="">全部类型</option>
              {Object.keys(CHANGE_TYPE_LABEL).map(k => (
                <option key={k} value={k}>{CHANGE_TYPE_LABEL[k].label}</option>
              ))}
            </select>
            <input
              value={filterFeature}
              onChange={e => setFilterFeature(e.target.value)}
              placeholder="按功能筛选"
              className="order-last w-full text-xs bg-n0 border border-n40 rounded px-2 py-1 sm:order-none sm:w-56"
            />
            <span className="ml-auto text-xs text-n100">
              共 {visibleTransactions.length} 笔
              {!filterChangeType && visibleTransactions.length !== transactions.length
                ? `（已合并 ${transactions.length - visibleTransactions.length} 条中间冻结流水）`
                : ''}
            </span>
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[1120px] text-xs">
              <thead className="text-n100 bg-n20">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2 text-left">时间</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">类型</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left">功能</th>
                  <th className="text-left py-2 px-3">计费详情</th>
                  <th className="w-24 whitespace-nowrap px-3 py-2 text-right">金额</th>
                  <th className="w-28 whitespace-nowrap px-3 py-2 text-right">可用余额前</th>
                  <th className="w-24 whitespace-nowrap px-3 py-2 text-right">可用余额后</th>
                  <th className="text-left py-2 px-3">任务</th>
                </tr>
              </thead>
              <tbody>
                {visibleTransactions.map(t => {
                  const meta = CHANGE_TYPE_LABEL[t.change_type] || { label: formatCreditChangeTypeLabel(t.change_type), color: 'text-n700', sign: 0 as const };
                  const sign = meta.sign;
                  const balanceMovement = formatCreditBalanceMovement(t);
                  return (
                    <tr key={t.transaction_id} className="border-t border-n40">
                      <td className="py-2 px-3 text-n300">
                        {new Date(t.created_at).toLocaleString('zh-CN')}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 ${meta.color}`}>{meta.label}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-n700" title={t.feature_key || undefined}>
                        {formatCreditFeatureLabel(t.feature_key)}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-n300">
                        {formatCreditBillingDetail(t)}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums ${meta.color}`}>
                        {t.change_type === 'freeze'
                          ? `暂占 ${t.amount}`
                          : `${sign === 1 ? '+' : sign === -1 ? '-' : ''}${t.amount}`}
                      </td>
                      <td
                        className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${balanceMovement.settledFromFreeze ? 'font-sans text-n100' : 'font-mono text-n300'}`}
                        title={balanceMovement.settledFromFreeze ? '可用点数已在任务冻结时暂占，成功结算不会重复扣减' : undefined}
                      >
                        {balanceMovement.before}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-n700">{balanceMovement.after}</td>
                      <td className="py-2 px-3 text-n100 font-mono truncate max-w-[200px]">
                        {t.task_id || '-'}
                      </td>
                    </tr>
                  );
                })}
                {!visibleTransactions.length && (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-n100">
                      暂无流水
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};


const BalanceCard: React.FC<{
  title: string;
  value: number;
  subtitle?: string;
  color: string;
  icon: React.ReactNode;
}> = ({ title, value, subtitle, color, icon }) => (
  <div className={`relative rounded-md border border-n40 p-4 shadow-card bg-gradient-to-br ${color}`}>
    <div className="flex items-center justify-between">
      <div className="text-xs text-n300">{title}</div>
      {icon}
    </div>
    <div className="mt-2 text-3xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    {subtitle && <div className="mt-2 text-[11px] leading-4 text-n200">{subtitle}</div>}
  </div>
);

export default CreditsPage;
