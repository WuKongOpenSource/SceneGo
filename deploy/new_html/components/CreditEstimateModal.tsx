














import React, { useEffect, useState } from 'react';
import { Coins, AlertTriangle, Loader2 } from 'lucide-react';
import { estimateCredits, CreditEstimateResult } from '../services/creditService';

interface CreditEstimateModalProps {
  open: boolean;
  featureKey: string;
  params?: Record<string, any>;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: (estimate: CreditEstimateResult) => void;
}

export const CreditEstimateModal: React.FC<CreditEstimateModalProps> = ({
  open, featureKey, params, title = '创作点数预估',
  description, confirmLabel = '确认并继续', cancelLabel = '取消',
  onCancel, onConfirm,
}) => {
  const [estimate, setEstimate] = useState<CreditEstimateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    estimateCredits(featureKey, params || {})
      .then(r => { if (!cancelled) setEstimate(r); })
      .catch(e => { if (!cancelled) setError(e?.message || String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, featureKey, JSON.stringify(params || {})]);

  if (!open) return null;

  return (
    <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-n900/50">
      <div role="dialog" aria-modal="true" aria-label={title} className="app-modal-surface w-full max-w-md mx-4 bg-n0 border border-n40 rounded-lg shadow-bottom">
        <div className="px-5 py-3 border-b border-n40 flex items-center gap-2">
          <Coins size={18} className="text-warning" />
          <h3 className="text-sm font-medium text-n800">{title}</h3>
        </div>

        <div className="px-5 py-4 space-y-3 text-sm">
          {description && <p className="text-n300">{description}</p>}

          {loading && (
            <div className="flex items-center justify-center py-6 text-n100">
              <Loader2 size={18} className="animate-spin mr-2" /> 估算中…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-r50 border border-r75 rounded">
              <AlertTriangle size={16} className="text-danger mt-0.5" />
              <span className="text-xs text-danger">{error}</span>
            </div>
          )}

          {estimate && !loading && (
            <div className="space-y-2.5">
              {!estimate.enabled && (
                <div className="p-3 bg-g50 border border-g75 rounded text-xs text-success">
                  该功能未配置创作点数规则，可免费使用
                </div>
              )}

              {estimate.enabled && (
                <>
                  <Row label="预计消耗" value={`${estimate.estimated_cost} 创作点数`} highlight />
                  <Row label="规则版本" value={estimate.rule_version || '-'} mono />
                  {estimate.base_cost !== undefined && (
                    <Row label="基础消耗" value={`${estimate.base_cost} (${estimate.billing_unit || 'task'})`} />
                  )}
                  {estimate.min_cost !== undefined && (
                    <Row label="区间" value={`${estimate.min_cost} - ${estimate.max_cost ?? '∞'}`} />
                  )}
                  <Row
                    label="账户余额"
                    value={estimate.balance != null ? `${estimate.balance} 创作点数` : '-'}
                    valueClass={estimate.enough ? 'text-success' : 'text-danger'}
                  />
                  {!estimate.enough && (
                    <div className="flex items-start gap-2 p-2 bg-r50 border border-r75 rounded text-xs text-danger">
                      <AlertTriangle size={14} className="text-danger mt-0.5" />
                      余额不足，无法继续
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-n40 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded bg-n0 hover:bg-n20"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => estimate && onConfirm(estimate)}
            disabled={!estimate || loading || (estimate?.enabled && !estimate?.enough)}
            className="px-3 py-1.5 text-xs rounded bg-success hover:bg-success text-white disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; highlight?: boolean; mono?: boolean; valueClass?: string }> = ({
  label, value, highlight, mono, valueClass,
}) => (
  <div className="flex items-center justify-between text-xs">
    <span className="text-n100">{label}</span>
    <span className={`${highlight ? 'text-warning text-base font-semibold' : 'text-n700'} ${mono ? 'font-mono' : ''} ${valueClass || ''}`}>
      {value}
    </span>
  </div>
);

export default CreditEstimateModal;
