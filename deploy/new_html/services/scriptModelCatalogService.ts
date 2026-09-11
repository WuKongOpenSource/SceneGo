import { AiModel } from '../types';
import { apiJson } from './httpClient';

export interface ScriptModelOption {
  value: AiModel;
  label: string;
  hint: string;
  operation: string;
  requestedProvider: string;
  provider: string;
  runtime: string;
  billingModel: string;
  failoverActive: boolean;
  modelScope?: string;
}

interface TextModelCatalogResponse {
  success: boolean;
  models?: Array<{
    value?: string;
    label?: string;
    hint?: string;
    operation?: string;
    requested_provider?: string;
    provider?: string;
    runtime_model_name?: string;
    billing_model?: string;
    failover_active?: boolean;
    model_scope?: string;
  }>;
}

const SCRIPT_MODEL_PUBLIC_META: Record<AiModel, {
  label: string;
  hint: string;
  billingModel: string;
}> = {
  [AiModel.MinimaxM3]: {
    label: 'MiniMax-M3 · 连续写作模型',
    hint: '适合持续',
    billingModel: 'script_tier_1',
  },
  [AiModel.DeepseekChat]: {
    label: 'deepseek-v4-flash · 快速写作模型',
    hint: '速度优先',
    billingModel: 'script_tier_2',
  },
  [AiModel.Deepseek]: {
    label: 'deepseek-v4-pro · 推理写作模型',
    hint: '推理优先',
    billingModel: 'script_tier_3',
  },
  [AiModel.Gemini]: {
    label: 'gemini-2.5-flash · 全能写作模型',
    hint: '综合全能',
    billingModel: 'script_tier_4',
  },
};

export const DEFAULT_SCRIPT_MODEL_OPTIONS: readonly ScriptModelOption[] = [
  {
    value: AiModel.MinimaxM3,
    label: SCRIPT_MODEL_PUBLIC_META[AiModel.MinimaxM3].label,
    hint: SCRIPT_MODEL_PUBLIC_META[AiModel.MinimaxM3].hint,
    operation: 'minimax-m3',
    requestedProvider: 'minimax',
    provider: 'minimax',
    runtime: 'MiniMax-M3',
    billingModel: SCRIPT_MODEL_PUBLIC_META[AiModel.MinimaxM3].billingModel,
    failoverActive: false,
  },
  {
    value: AiModel.DeepseekChat,
    label: SCRIPT_MODEL_PUBLIC_META[AiModel.DeepseekChat].label,
    hint: SCRIPT_MODEL_PUBLIC_META[AiModel.DeepseekChat].hint,
    operation: 'deepseek-chat',
    requestedProvider: 'deepseek',
    provider: 'deepseek',
    runtime: 'deepseek-v4-flash',
    billingModel: SCRIPT_MODEL_PUBLIC_META[AiModel.DeepseekChat].billingModel,
    failoverActive: false,
  },
  {
    value: AiModel.Deepseek,
    label: SCRIPT_MODEL_PUBLIC_META[AiModel.Deepseek].label,
    hint: SCRIPT_MODEL_PUBLIC_META[AiModel.Deepseek].hint,
    operation: 'deepseek-reasoner',
    requestedProvider: 'deepseek',
    provider: 'deepseek',
    runtime: 'deepseek-v4-pro',
    billingModel: SCRIPT_MODEL_PUBLIC_META[AiModel.Deepseek].billingModel,
    failoverActive: false,
  },
  {
    value: AiModel.Gemini,
    label: SCRIPT_MODEL_PUBLIC_META[AiModel.Gemini].label,
    hint: SCRIPT_MODEL_PUBLIC_META[AiModel.Gemini].hint,
    operation: 'gemini-text',
    requestedProvider: 'gemini-text',
    provider: 'gemini-text',
    runtime: 'gemini-2.5-flash',
    billingModel: SCRIPT_MODEL_PUBLIC_META[AiModel.Gemini].billingModel,
    failoverActive: false,
  },
];

const isAiModel = (value: string): value is AiModel => (
  value === AiModel.MinimaxM3
  || value === AiModel.Gemini
  || value === AiModel.Deepseek
  || value === AiModel.DeepseekChat
);

export function normalizeScriptModelOptions(
  rows: TextModelCatalogResponse['models'],
): readonly ScriptModelOption[] {
  if (!Array.isArray(rows)) return DEFAULT_SCRIPT_MODEL_OPTIONS;

  const rowByValue = new Map(
    rows
      .filter(row => isAiModel(String(row.value || '')))
      .map(row => [String(row.value) as AiModel, row]),
  );

  return DEFAULT_SCRIPT_MODEL_OPTIONS.map(fallback => {
    const row = rowByValue.get(fallback.value);
    if (!row) return fallback;
    const publicMeta = SCRIPT_MODEL_PUBLIC_META[fallback.value];
    return {
      value: fallback.value,
      label: String(row.label || publicMeta.label).trim() || publicMeta.label,
      hint: String(row.hint || publicMeta.hint).trim() || publicMeta.hint,
      operation: String(row.operation || fallback.operation).trim(),
      requestedProvider: String(row.requested_provider || fallback.requestedProvider).trim(),
      provider: String(row.provider || fallback.provider).trim(),
      runtime: String(row.runtime_model_name || fallback.runtime).trim(),
      billingModel: String(row.billing_model || publicMeta.billingModel).trim() || publicMeta.billingModel,
      failoverActive: Boolean(row.failover_active),
      modelScope: String(row.model_scope || '').trim() || undefined,
    };
  });
}

export async function fetchScriptModelOptions(scope: string = 'workflow'): Promise<readonly ScriptModelOption[]> {
  const normalizedScope = String(scope || 'workflow').trim().toLowerCase() || 'workflow';
  const query = normalizedScope === 'workflow' ? '' : `?scope=${encodeURIComponent(normalizedScope)}`;
  const response = await apiJson<TextModelCatalogResponse>(
    `/api/ai/text-models${query}`,
    undefined,
    '文本模型配置',
  );
  return normalizeScriptModelOptions(response.models);
}

export function getScriptModelOption(
  model: AiModel,
  options: readonly ScriptModelOption[] = DEFAULT_SCRIPT_MODEL_OPTIONS,
): ScriptModelOption {
  return options.find(option => option.value === model)
    || DEFAULT_SCRIPT_MODEL_OPTIONS.find(option => option.value === model)
    || DEFAULT_SCRIPT_MODEL_OPTIONS.find(option => option.value === AiModel.DeepseekChat)
    || DEFAULT_SCRIPT_MODEL_OPTIONS[0];
}

export function resolveScriptAiModel(
  modelName?: string,
  options: readonly ScriptModelOption[] = DEFAULT_SCRIPT_MODEL_OPTIONS,
): AiModel | null {
  const normalized = String(modelName || '').trim().toLowerCase();
  if (!normalized) return null;

  const exact = options.find(option => (
    option.value.toLowerCase() === normalized
    || option.operation.toLowerCase() === normalized
    || option.runtime.toLowerCase() === normalized
    || option.billingModel.toLowerCase() === normalized
    || option.label.toLowerCase() === normalized
  ));
  if (exact) return exact.value;

  if (normalized.includes('一阶') || normalized.includes('连续写作') || normalized.includes('练气')) return AiModel.MinimaxM3;
  if (normalized.includes('二阶') || normalized.includes('快速写作') || normalized.includes('金丹')) return AiModel.DeepseekChat;
  if (normalized.includes('三阶') || normalized.includes('推理写作') || normalized.includes('筑基')) return AiModel.Deepseek;
  if (normalized.includes('四阶') || normalized.includes('全能写作') || normalized.includes('通用写作') || normalized.includes('化神')) return AiModel.Gemini;
  if (normalized.includes('tier_1')) return AiModel.MinimaxM3;
  if (normalized.includes('tier_2')) return AiModel.DeepseekChat;
  if (normalized.includes('tier_3')) return AiModel.Deepseek;
  if (normalized.includes('tier_4')) return AiModel.Gemini;
  if (normalized.includes('minimax') && normalized.includes('m3')) return AiModel.MinimaxM3;
  if (normalized.includes('gemini')) return AiModel.Gemini;
  if (normalized.includes('reasoner') || normalized.includes('v4-pro')) return AiModel.Deepseek;
  if (normalized.includes('deepseek')) return AiModel.DeepseekChat;
  return null;
}

export function formatScriptModelDisplay(option: ScriptModelOption): string {
  return option.label || SCRIPT_MODEL_PUBLIC_META[option.value]?.label || '写作模型';
}

export function formatScriptModelSelectLabel(option: ScriptModelOption): string {
  return formatScriptModelDisplay(option);
}

export function getScriptModelBillingKey(option: ScriptModelOption): string {
  return option.billingModel || SCRIPT_MODEL_PUBLIC_META[option.value]?.billingModel || String(option.value);
}

export function formatScriptModelHistoryLabel(
  modelName?: string | null,
  modelAlias?: string | null,
  options: readonly ScriptModelOption[] = DEFAULT_SCRIPT_MODEL_OPTIONS,
): string {
  const rawModelName = String(modelName || '').trim();
  const rawAlias = String(modelAlias || '').trim();
  if (rawModelName.toLowerCase() === 'legacy' || rawAlias === '历史版本') return '历史版本';

  const resolved = resolveScriptAiModel(rawModelName, options)
    || resolveScriptAiModel(rawAlias, options);
  if (resolved) {
    return formatScriptModelDisplay(getScriptModelOption(resolved, options));
  }
  return rawModelName || rawAlias ? '写作模型' : '';
}
