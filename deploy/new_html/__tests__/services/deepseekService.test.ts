import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const apiFetch = vi.fn();

vi.mock('../../services/httpClient', () => ({
  apiFetch: (...args: any[]) => apiFetch(...args),
}));

import { callDeepseekChatWithRetry } from '../../services/deepseekService';

const makeSseResponse = (body: string, status = 200) => new Response(body, {
  status,
  headers: { 'content-type': 'text/event-stream' },
});

describe('deepseekService retry handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries once when the backend streams a DeepSeek error event', async () => {
    apiFetch
      .mockResolvedValueOnce(makeSseResponse('data: {"type":"error","message":"DeepSeek API 调用失败: 502"}\n\ndata: [DONE]\n\n'))
      .mockResolvedValueOnce(makeSseResponse('data: {"type":"content","content":"ok"}\n\ndata: [DONE]\n\n'));

    const promise = callDeepseekChatWithRetry('prompt');
    const assertion = expect(promise).resolves.toBe('ok');
    await vi.advanceTimersByTimeAsync(1200 + 50);
    await assertion;

    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry configuration/authentication errors', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'DeepSeek 服务未配置' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(callDeepseekChatWithRetry('prompt')).rejects.toThrow('DeepSeek 服务未配置');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('sends readable task context to the backend notification pipeline', async () => {
    apiFetch.mockResolvedValue(makeSseResponse('data: {"type":"content","content":"ok"}\n\ndata: [DONE]\n\n'));

    await expect(callDeepseekChatWithRetry('prompt', undefined, undefined, {
      operation: 'storyboard_script_generate',
      displayName: '分镜脚本生成',
      projectId: 'proj_1',
      episodeId: 'ep_1',
      sourcePage: 'script',
      sourceItemId: 'script_1',
    })).resolves.toBe('ok');

    const request = apiFetch.mock.calls[0][1];
    expect(JSON.parse(request.body)).toMatchObject({
      operation: 'storyboard_script_generate',
      display_name: '分镜脚本生成',
      project_id: 'proj_1',
      episode_id: 'ep_1',
      source_page: 'script',
      source_item_id: 'script_1',
    });
  });

  it('does not repeatedly retry an internal split that has a local fallback', async () => {
    apiFetch.mockResolvedValue(makeSseResponse(
      'data: {"type":"error","message":"DeepSeek API 调用失败: 502"}\n\ndata: [DONE]\n\n',
    ));

    await expect(callDeepseekChatWithRetry('prompt', undefined, undefined, {
      operation: 'storyboard_script_generate',
      displayName: '剧本拆分',
      suppressNotification: true,
    })).rejects.toThrow('502');

    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('times out a stalled stream once and explains that credits were not charged', async () => {
    apiFetch.mockResolvedValue(new Response(new ReadableStream({ start() {} }), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    const promise = callDeepseekChatWithRetry('prompt', undefined, () => undefined);
    const assertion = expect(promise).rejects.toThrow('本次未扣创作点数');
    await vi.advanceTimersByTimeAsync(90_000 + 50);
    await assertion;

    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
