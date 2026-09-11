import { describe, expect, it } from 'vitest';
import { providerCredentialLinksForEndpoint } from '../../utils/providerCredentialLinks';

const googleMeta = {
  console_url: 'https://aistudio.google.com/app/apikey',
  docs_url: 'https://ai.google.dev/gemini-api/docs/api-key',
  key_help: 'Create a Google AI Studio API key.',
};

describe('providerCredentialLinksForEndpoint', () => {
  it('uses LaoZhang resources when a Gemini provider runs through the LaoZhang gateway', () => {
    const links = providerCredentialLinksForEndpoint(googleMeta, 'https://api.laozhang.ai/v1');

    expect(links?.console_url).toBe('https://api2.laozhang.ai/');
    expect(links?.docs_url).toContain('docs.laozhang.ai');
    expect(links?.key_help).toContain('LaoZhang');
    expect(links?.key_help).not.toContain('Google');
  });

  it('recognizes endpoints that omit the URL scheme', () => {
    const links = providerCredentialLinksForEndpoint(googleMeta, 'api.laozhang.ai/v1beta');

    expect(links?.console_url).toBe('https://api2.laozhang.ai/');
  });

  it('keeps Google resources for a native Google endpoint', () => {
    const links = providerCredentialLinksForEndpoint(googleMeta, 'https://generativelanguage.googleapis.com/v1beta');

    expect(links?.console_url).toBe(googleMeta.console_url);
    expect(links?.docs_url).toBe(googleMeta.docs_url);
    expect(links?.key_help).toContain('Google');
  });

  it('falls back to provider metadata for an unknown custom endpoint', () => {
    const links = providerCredentialLinksForEndpoint(googleMeta, 'https://gateway.example.com/v1');

    expect(links).toEqual(googleMeta);
  });

  it('separates MiniMax domestic and international credential portals', () => {
    const domestic = providerCredentialLinksForEndpoint(undefined, 'https://api.minimaxi.com/v1');
    const international = providerCredentialLinksForEndpoint(undefined, 'https://api.minimax.io/v1');

    expect(domestic?.console_url).toBe('https://platform.minimaxi.com/console/personal-info');
    expect(domestic?.key_help).toContain('国内');
    expect(international?.console_url).toBe('https://platform.minimax.io/');
    expect(international?.key_help).toContain('国际');
  });
});
