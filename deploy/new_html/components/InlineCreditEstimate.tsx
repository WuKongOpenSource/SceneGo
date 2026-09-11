import React, { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import { estimateCredits } from '../services/creditService';

interface InlineCreditEstimateProps {
  featureKey: string;
  params: Record<string, unknown>;
  fallbackCost: number;
  className?: string;
  compact?: boolean;
}

export const InlineCreditEstimate: React.FC<InlineCreditEstimateProps> = ({
  featureKey,
  params,
  fallbackCost,
  className = '',
  compact = false,
}) => {
  const [cost, setCost] = useState(fallbackCost);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      estimateCredits(featureKey, JSON.parse(paramsKey))
        .then(result => {
          if (active && result.enabled) setCost(result.estimated_cost);
        })
        .catch(() => {
          if (active) setCost(fallbackCost);
        });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [fallbackCost, featureKey, paramsKey]);

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-warning ${className}`}>
      <Coins size={compact ? 11 : 14} />
      {compact ? `预计 ${cost} 创作点数` : `预计消耗 ${cost} 创作点数`}
      {!compact && <span className="text-n100">· 成功后扣除</span>}
    </span>
  );
};
