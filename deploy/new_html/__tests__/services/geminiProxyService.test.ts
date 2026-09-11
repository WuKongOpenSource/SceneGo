import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiJson = vi.fn();
const apiFetch = vi.fn();

vi.mock('../../services/httpClient', () => ({
  apiFetch: (...args: any[]) => apiFetch(...args),
  apiJson: (...args: any[]) => apiJson(...args),
}));

import { callGeminiProxy, callGeminiProxyStream } from '../../services/geminiProxyService';

const makeSseResponse = (body: string) => new Response(body, {
  status: 200,
  headers: { 'content-type': 'text/event-stream' },
});

describe('geminiProxyService task context', () => {
  beforeEach(() => {
    apiJson.mockReset();
    apiFetch.mockReset();
    apiJson.mockResolvedValue({ content: 'ok' });
  });

  it('sends readable task context to the backend notification pipeline', async () => {
    await expect(callGeminiProxy('prompt', undefined, 'gemini-model', {
      operation: 'script_rewrite',
      displayName: '剧本修改',
      projectId: 'proj_1',
      episodeId: 'ep_1',
      sourcePage: 'script',
      sourceItemId: 'script_1',
      modelScope: 'studio',
    })).resolves.toBe('ok');

    const request = apiJson.mock.calls[0][1];
    expect(JSON.parse(request.body)).toMatchObject({
      operation: 'script_rewrite',
      display_name: '剧本修改',
      project_id: 'proj_1',
      episode_id: 'ep_1',
      source_page: 'script',
      source_item_id: 'script_1',
      model_scope: 'studio',
      model: 'gemini-model',
    });
  });

  it('streams script text from the dedicated Gemini endpoint without full-request retries', async () => {
    apiFetch.mockResolvedValue(makeSseResponse([
      'data: {"type":"content","content":"分段01"}',
      '',
      'data: {"type":"content","content":"\\n镜头01"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')));
    const chunks: string[] = [];

    await expect(callGeminiProxyStream(
      'prompt',
      'system',
      undefined,
      { operation: 'storyboard_script_generate', sourceItemId: 'script_1' },
      chunk => chunks.push(chunk),
    )).resolves.toBe('分段01\n镜头01');

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toBe('/api/gemini/text/stream');
    expect(chunks).toEqual(['分段01', '\n镜头01']);
  });
});
