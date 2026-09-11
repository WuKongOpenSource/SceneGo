import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiModel } from '../../types';

vi.mock('../../services/httpClient', () => ({
  apiJson: vi.fn(),
}));

import { apiJson } from '../../services/httpClient';
import {
  DEFAULT_SCRIPT_MODEL_OPTIONS,
  fetchScriptModelOptions,
  formatScriptModelDisplay,
  formatScriptModelHistoryLabel,
  formatScriptModelSelectLabel,
  getScriptModelBillingKey,
  getScriptModelOption,
  normalizeScriptModelOptions,
  resolveScriptAiModel,
} from '../../services/scriptModelCatalogService';

describe('scriptModelCatalogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses backend-resolved model names with capability suffixes', async () => {
    vi.mocked(apiJson).mockResolvedValue({
      success: true,
      models: [
        {
          value: 'minimax-m3',
          label: 'MiniMax-M3 · 连续写作模型',
          hint: '适合持续',
          billing_model: 'script_tier_1',
          failover_active: false,
        },
        {
          value: 'deepseek-chat',
          label: 'deepseek-v4-flash · 快速写作模型',
          hint: '速度优先',
          billing_model: 'script_tier_2',
          failover_active: false,
        },
        {
          value: 'deepseek',
          label: 'deepseek-v4-pro · 推理写作模型',
          hint: '推理优先',
          billing_model: 'script_tier_3',
          failover_active: false,
        },
        {
          value: 'gemini',
          label: 'gemini-2.5-flash · 全能写作模型',
          hint: '综合全能',
          billing_model: 'script_tier_4',
          failover_active: true,
        },
      ],
    });

    const options = await fetchScriptModelOptions();

    expect(options.map(option => option.value)).toEqual([
      AiModel.MinimaxM3,
      AiModel.DeepseekChat,
      AiModel.Deepseek,
      AiModel.Gemini,
    ]);
    expect(getScriptModelOption(AiModel.DeepseekChat, options)).toMatchObject({
      label: 'deepseek-v4-flash · 快速写作模型',
      hint: '速度优先',
      operation: 'deepseek-chat',
      runtime: 'deepseek-v4-flash',
      billingModel: 'script_tier_2',
    });
    expect(getScriptModelOption(AiModel.Deepseek, options)).toMatchObject({
      label: 'deepseek-v4-pro · 推理写作模型',
      hint: '推理优先',
      operation: 'deepseek-reasoner',
      runtime: 'deepseek-v4-pro',
      billingModel: 'script_tier_3',
    });
    expect(getScriptModelOption(AiModel.Gemini, options)).toMatchObject({
      label: 'gemini-2.5-flash · 全能写作模型',
      hint: '综合全能',
      provider: 'gemini-text',
      runtime: 'gemini-2.5-flash',
      billingModel: 'script_tier_4',
      failoverActive: true,
    });
    expect(getScriptModelOption(AiModel.MinimaxM3, options)).toMatchObject({
      label: 'MiniMax-M3 · 连续写作模型',
      hint: '适合持续',
      operation: 'minimax-m3',
      runtime: 'MiniMax-M3',
      billingModel: 'script_tier_1',
    });
    expect(formatScriptModelDisplay(getScriptModelOption(AiModel.MinimaxM3, options)))
      .toBe('MiniMax-M3 · 连续写作模型');
    expect(formatScriptModelSelectLabel(getScriptModelOption(AiModel.MinimaxM3, options)))
      .toBe('MiniMax-M3 · 连续写作模型');
    expect(getScriptModelBillingKey(getScriptModelOption(AiModel.Gemini, options)))
      .toBe('script_tier_4');
    expect(resolveScriptAiModel('MiniMax-M3', options)).toBe(AiModel.MinimaxM3);
  });

  it('falls back per option when the response is incomplete', () => {
    const options = normalizeScriptModelOptions([{
      value: 'deepseek-chat',
      runtime_model_name: 'custom-chat',
    }]);

    expect(getScriptModelOption(AiModel.DeepseekChat, options).runtime).toBe('custom-chat');
    expect(getScriptModelOption(AiModel.Deepseek, options).runtime).toBe('deepseek-v4-pro');
    expect(getScriptModelOption(AiModel.Gemini, options).runtime).toBe('gemini-2.5-flash');
    expect(getScriptModelOption(AiModel.MinimaxM3, options).runtime).toBe('MiniMax-M3');
    expect(DEFAULT_SCRIPT_MODEL_OPTIONS).toHaveLength(4);
  });

  it('restores legacy aliases and new V4 runtime names to the correct selector', () => {
    expect(resolveScriptAiModel('minimax-m3')).toBe(AiModel.MinimaxM3);
    expect(resolveScriptAiModel('MiniMax-M3')).toBe(AiModel.MinimaxM3);
    expect(resolveScriptAiModel('一阶 · 连续写作模型')).toBe(AiModel.MinimaxM3);
    expect(resolveScriptAiModel('script_tier_2')).toBe(AiModel.DeepseekChat);
    expect(resolveScriptAiModel('deepseek-reasoner')).toBe(AiModel.Deepseek);
    expect(resolveScriptAiModel('deepseek-v4-pro')).toBe(AiModel.Deepseek);
    expect(resolveScriptAiModel('deepseek-chat')).toBe(AiModel.DeepseekChat);
    expect(resolveScriptAiModel('deepseek-v4-flash')).toBe(AiModel.DeepseekChat);
    expect(formatScriptModelHistoryLabel('deepseek-v4-flash', 'DK金丹')).toBe('deepseek-v4-flash · 快速写作模型');
    expect(formatScriptModelHistoryLabel('legacy', '历史版本')).toBe('历史版本');
    expect(formatScriptModelHistoryLabel('experimental-runtime', 'GPT 高阶')).toBe('写作模型');
  });
});
