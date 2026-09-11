import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();

vi.mock('../../services/httpClient', () => ({
  apiFetch: (...args: any[]) => apiFetch(...args),
}));

import { callMinimaxM3WithRetry } from '../../services/minimaxTextService';

const makeSseResponse = (body: string, status = 200) => new Response(body, {
  status,
  headers: { 'content-type': 'text/event-stream' },
});

describe('minimaxTextService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the stable M3 operation and forwards script task context', async () => {
    apiFetch.mockResolvedValue(
      makeSseResponse('data: {"type":"content","content":"ok"}\n\ndata: [DONE]\n\n'),
    );

    await expect(callMinimaxM3WithRetry('prompt', 'system', undefined, {
      operation: 'storyboard_script_generate',
      displayName: '分镜脚本生成',
      projectId: 'proj_1',
      episodeId: 'ep_1',
      sourcePage: 'script',
      sourceItemId: 'script_1',
    })).resolves.toBe('ok');

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toBe('/api/minimax/chat');
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toMatchObject({
      prompt: 'system\n\nprompt',
      response_format: 'text',
      model: 'minimax-m3',
      operation: 'storyboard_script_generate',
      display_name: '分镜脚本生成',
      project_id: 'proj_1',
      episode_id: 'ep_1',
      source_page: 'script',
      source_item_id: 'script_1',
    });
  });

  it('retries a transient backend stream error for non-streaming consumers', async () => {
    apiFetch
      .mockResolvedValueOnce(
        makeSseResponse('data: {"type":"error","message":"MiniMax API 调用失败: 502"}\n\ndata: [DONE]\n\n'),
      )
      .mockResolvedValueOnce(
        makeSseResponse('data: {"type":"content","content":"ok"}\n\ndata: [DONE]\n\n'),
      );

    const promise = callMinimaxM3WithRetry('prompt');
    const assertion = expect(promise).resolves.toBe('ok');
    await vi.advanceTimersByTimeAsync(1250);
    await assertion;

    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('does not replay visible streaming output after an error', async () => {
    apiFetch.mockResolvedValue(
      makeSseResponse('data: {"type":"error","message":"MiniMax API 调用失败: 502"}\n\ndata: [DONE]\n\n'),
    );

    await expect(callMinimaxM3WithRetry('prompt', undefined, () => undefined))
      .rejects.toThrow('MiniMax API 调用失败');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
