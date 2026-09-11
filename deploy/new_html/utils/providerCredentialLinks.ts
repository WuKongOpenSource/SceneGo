export interface ProviderCredentialLinkFields {
  console_url?: string;
  docs_url?: string;
  key_help?: string;
}

interface EndpointCredentialSource extends ProviderCredentialLinkFields {
  domains: string[];
}

const ENDPOINT_CREDENTIAL_SOURCES: EndpointCredentialSource[] = [
  {
    domains: ['laozhang.ai'],
    console_url: 'https://api2.laozhang.ai/',
    docs_url: 'https://docs.laozhang.ai/en/getting-started',
    key_help: 'Create a LaoZhang API token for this gateway endpoint.',
  },
  {
    domains: ['googleapis.com'],
    console_url: 'https://aistudio.google.com/app/apikey',
    docs_url: 'https://ai.google.dev/gemini-api/docs/api-key',
    key_help: 'Create a Google AI Studio API key for this Google endpoint.',
  },
  {
    domains: ['deepseek.com'],
    console_url: 'https://platform.deepseek.com/api_keys',
    docs_url: 'https://api-docs.deepseek.com/api/deepseek-api',
    key_help: 'Create a DeepSeek API key for this endpoint.',
  },
  {
    domains: ['volces.com', 'volcengine.com'],
    console_url: 'https://console.volcengine.com/ark',
    docs_url: 'https://www.volcengine.com/docs/82379/',
    key_help: 'Create a Volcengine Ark API key for this endpoint.',
  },
  {
    domains: ['aliyuncs.com', 'aliyun.com'],
    console_url: 'https://bailian.console.aliyun.com/',
    docs_url: 'https://www.alibabacloud.com/help/en/model-studio/first-api-call-to-qwen',
    key_help: 'Create an Alibaba Cloud Model Studio API key for this endpoint.',
  },
  {
    domains: ['minimaxi.com'],
    console_url: 'https://platform.minimaxi.com/console/personal-info',
    docs_url: 'https://platform.minimaxi.com/docs/api-reference/api-overview',
    key_help: '请使用 MiniMax 国内站创建的按量或 Token Plan API Key；Token Plan Key 选择 token_plan 模式。',
  },
  {
    domains: ['minimax.io'],
    console_url: 'https://platform.minimax.io/',
    docs_url: 'https://platform.minimax.io/docs/guides/quickstart-preparation',
    key_help: '请使用 MiniMax 国际站创建的 API Key；国际 Key 仅用于 api.minimax.io。',
  },
];

function endpointHostname(endpoint?: string): string {
  const value = String(endpoint || '').trim();
  if (!value) return '';
  try {
    const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
      ? value
      : `https://${value.replace(/^\/\//, '')}`;
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function providerCredentialLinksForEndpoint(
  meta?: ProviderCredentialLinkFields,
  endpoint?: string,
): ProviderCredentialLinkFields | undefined {
  const host = endpointHostname(endpoint);
  const source = host
    ? ENDPOINT_CREDENTIAL_SOURCES.find(item => item.domains.some(domain => hostMatchesDomain(host, domain)))
    : undefined;
  if (!meta && !source) return undefined;
  if (!source) return meta;
  return {
    ...meta,
    console_url: source.console_url,
    docs_url: source.docs_url,
    key_help: source.key_help,
  };
}
