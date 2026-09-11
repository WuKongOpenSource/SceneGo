





import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { minimaxTTSSync } from '@runtime/audioGenerationService';

function jsonResponse(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('minimaxTTSSync', () => {
  beforeEach(() => {

    const store: Record<string, string> = { auth_token: 'test-token' };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    } as Storage);

    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('成功调用，返回 audio_url 与 file_id', async () => {
    (globalThis.fetch as any).mockResolvedValue(jsonResponse({
      success: true,
      audio_url: '/storage/audio/x.mp3',
      file_id: 'fid-1',
      file_url: '/storage/audio/x.mp3',
      duration_ms: 1500,
      minimax_trace_id: 'mx-1',
    }));
    const result = await minimaxTTSSync({
      text: '测试',
      voice_id: 'female-shaonv',
    });
    expect(result.success).toBe(true);
    expect(result.audio_url).toBe('/storage/audio/x.mp3');
    expect(result.file_id).toBe('fid-1');
    expect(result.duration_ms).toBe(1500);
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toMatch(/\/api\/minimax\/tts\/sync$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.text).toBe('测试');
    expect(body.voice_id).toBe('female-shaonv');
  });

  it('text 过长 413 抛带提示的错误（让调用方 fallback 到 worker）', async () => {
    (globalThis.fetch as any).mockResolvedValue(jsonResponse(
      { detail: 'text 过长 (1500 > 1000)，请改用 POST /api/minimax/tts（走 worker 异步路径，支持长文本）' },
      413,
    ));
    await expect(
      minimaxTTSSync({ text: 'x'.repeat(1500), voice_id: 'v' }),
    ).rejects.toThrow(/1500.*1000|过长|过大|/);
  });

  it('AbortSignal 被透传给 fetch（让组件 unmount 时能取消）', async () => {
    const ctrl = new AbortController();
    const seenSignal = vi.fn();
    (globalThis.fetch as any).mockImplementation((_url: string, opts: any) => {
      seenSignal(opts?.signal);
      return new Promise(() => {}); // never resolve
    });


    minimaxTTSSync({ text: 't', voice_id: 'v' }, ctrl.signal).catch(() => {});
    expect(seenSignal).toHaveBeenCalled();
    expect(seenSignal.mock.calls[0][0]).toBe(ctrl.signal);
  });
});
