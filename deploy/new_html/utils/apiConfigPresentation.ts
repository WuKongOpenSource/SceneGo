export interface ApiConfigBindingLike {
  operation?: string;
  label?: string;
  model_name?: string;
  scope?: string;
  scope_label?: string;
}

export interface ApiConfigCategoryLike {
  provider?: string;
  category?: string;
  model_name?: string;
  model_bindings?: ApiConfigBindingLike[];
}

export interface ProviderAccessModeLike {
  mode: string;
  label?: string;
  endpoint: string;
  console_url?: string;
  docs_url?: string;
  description?: string;
  model_map?: Record<string, string>;
}

const KNOWN_CATEGORIES = new Set(['text', 'image', 'video', 'audio', 'other']);

function normalized(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function endpointIdentity(endpoint?: string): string {
  return normalized(endpoint).replace(/\/+$/, '');
}

export function providerAccessModeForEndpoint(
  accessModes: ProviderAccessModeLike[] = [],
  endpoint?: string,
): ProviderAccessModeLike | undefined {
  const target = endpointIdentity(endpoint);
  if (!target) return undefined;
  return accessModes.find(mode => endpointIdentity(mode.endpoint) === target);
}

export function apiBindingCategory(
  binding: ApiConfigBindingLike,
  provider?: string,
): string | undefined {
  const operation = normalized(binding.operation);
  const label = normalized(binding.label);
  const model = normalized(binding.model_name);
  const haystack = `${operation} ${label} ${model}`;

  if (/tts|speech|voice|audio|music|lyric|语音|声音|配音|音频|音乐/.test(haystack)) return 'audio';
  if (/video|hailuo|seedance|sora|veo|wan|kling|vidu|happyhorse|视频|图生视频|首尾帧/.test(haystack)) return 'video';
  if (/image|seedream|picture|photo|图像|图片|生图/.test(haystack)) return 'image';
  if (/text|chat|reason|language|文本|推理|对话/.test(haystack)) return 'text';

  const providerId = normalized(provider);
  if (providerId.includes('tts')) return 'audio';
  if (providerId.includes('seedance') || providerId.includes('sora') || providerId.includes('veo') || providerId.includes('dashscope')) return 'video';
  if (providerId.includes('image') || providerId.includes('doubao')) return 'image';
  return undefined;
}

export function apiConfigCategories(
  config: ApiConfigCategoryLike,
  providerCapabilities: string[] = [],
): string[] {
  const categories = new Set<string>();
  (config.model_bindings || []).forEach(binding => {
    const category = apiBindingCategory(binding, config.provider);
    if (category) categories.add(category);
  });

  if (!categories.size) {
    const primary = apiBindingCategory(
      { operation: 'default', model_name: config.model_name },
      config.provider,
    );
    if (primary) categories.add(primary);
  }

  const explicit = normalized(config.category);
  if (!categories.size && KNOWN_CATEGORIES.has(explicit)) categories.add(explicit);

  if (!categories.size) {
    providerCapabilities.map(normalized).filter(value => KNOWN_CATEGORIES.has(value)).forEach(value => categories.add(value));
  }

  if (!categories.size) categories.add('text');
  return Array.from(categories);
}

export function bindingsForCategory(
  bindings: ApiConfigBindingLike[] = [],
  provider: string | undefined,
  category: string | undefined,
): ApiConfigBindingLike[] {
  if (!category) return bindings;
  const categorized = bindings.map(binding => ({
    binding,
    category: apiBindingCategory(binding, provider),
  }));
  if (!categorized.some(item => item.category)) return bindings;
  return categorized.filter(item => item.category === category).map(item => item.binding);
}

export function apiConfigErrorMessage(
  provider: string | undefined,
  endpoint: string | undefined,
  error: string | undefined | null,
): string {
  const raw = String(error || '').trim();
  if (!raw || normalized(provider) !== 'minimax') return raw;
  if (!/401|authorized_error|authentication failed|login fail/i.test(raw)) return raw;

  const host = endpointIdentity(endpoint);
  const channel = host.includes('api.minimaxi.com')
    ? '国内站'
    : host.includes('api.minimax.io')
      ? '国际站'
      : '当前';
  return `${raw}\n提示：当前使用 MiniMax ${channel} Endpoint，请确认 API Key 也创建于同一站点；国内 Key 与国际 Key 不能混用。`;
}
