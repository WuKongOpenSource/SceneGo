import { describe, expect, it } from 'vitest';

import type { CreditTransaction } from '../../services/creditService';
import {
  collapseSettledFreezeRows,
  formatCreditBalanceMovement,
  formatCreditBillingDetail,
  formatCreditChangeTypeLabel,
  formatCreditFeatureLabel,
} from '../../pages/CreditsPage';

function transaction(overrides: Partial<CreditTransaction>): CreditTransaction {
  return {
    transaction_id: 'txn-1',
    account_id: 'acct-1',
    user_id: 'user-1',
    team_id: null,
    project_id: 'project-1',
    task_id: 'design-image-batch:task-1',
    feature_key: 'design_image_generation',
    change_type: 'freeze',
    amount: 660,
    balance_before: 793,
    balance_after: 133,
    rule_version: '2026-07-31-002',
    metadata: {
      billing_params: {
        image_count: 11,
        model: 'image_tier_3',
        resolution: '1K',
        aspect_ratio: '16:9',
      },
    },
    created_at: '2026-08-28T03:53:42',
    ...overrides,
  };
}

describe('CreditsPage transaction presentation', () => {
  it('shows a settled reservation as one business charge by default', () => {
    const freeze = transaction({ transaction_id: 'freeze-1' });
    const consume = transaction({
      transaction_id: 'consume-1',
      change_type: 'consume',
      balance_before: 133,
      balance_after: 133,
    });

    expect(collapseSettledFreezeRows([consume, freeze])).toEqual([consume]);
    expect(formatCreditBalanceMovement(consume)).toEqual({
      before: '冻结时已扣',
      after: '133',
      settledFromFreeze: true,
    });
  });

  it('keeps actual before/after values for balance-changing rows', () => {
    expect(formatCreditBalanceMovement(transaction({ change_type: 'recharge' }))).toEqual({
      before: '793',
      after: '133',
      settledFromFreeze: false,
    });
  });

  it('keeps raw freeze rows when the user explicitly filters for them', () => {
    const freeze = transaction({ transaction_id: 'freeze-1' });
    const consume = transaction({ transaction_id: 'consume-1', change_type: 'consume' });

    expect(collapseSettledFreezeRows([consume, freeze], 'freeze')).toHaveLength(2);
  });

  it('keeps active reservations visible', () => {
    const freeze = transaction({ transaction_id: 'freeze-active', task_id: 'active-task' });

    expect(collapseSettledFreezeRows([freeze])).toEqual([freeze]);
  });

  it('explains the batch count, model version, resolution and aspect ratio', () => {
    expect(formatCreditBillingDetail(transaction({})))
      .toBe('11 张 · Doubao-Seedream-5.0-lite · 1K · 16:9');
  });

  it('shows user-facing Chinese labels instead of internal feature keys', () => {
    expect(formatCreditChangeTypeLabel('signup_grant')).toBe('注册赠送');
    expect(formatCreditFeatureLabel('image_generation')).toBe('图片生成');
    expect(formatCreditFeatureLabel('video_generation')).toBe('视频生成');
    expect(formatCreditFeatureLabel('design_prompt_refinement')).toBe('提示词优化');
    expect(formatCreditFeatureLabel('future_internal_key')).toBe('其他功能');
  });
});
