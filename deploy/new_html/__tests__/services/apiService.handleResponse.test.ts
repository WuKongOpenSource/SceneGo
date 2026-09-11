import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleResponse } from '../../services/apiService';

function makeRes(status: number, body: any): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('handleResponse — 504 detail dict 平铺到 Error', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('当 504 detail 是 dict 时，task_id / error / message 应平铺到 Error 对象', async () => {
    const res = makeRes(504, {
      detail: {
        error: 'tts_timeout',
        task_id: '401652318130377',
        message: 'TTS 任务超时: 401652318130377',
        hint: 'MiniMax 端任务未在窗口内完成',
      },
    });
    await expect(handleResponse(res, 'minimaxTTS')).rejects.toMatchObject({
      message: expect.stringContaining('tts_timeout'),
      task_id: '401652318130377',
      error: 'tts_timeout',
      hint: expect.stringContaining('MiniMax'),
      status: 504,
    });
  });

  it('当 detail 是字符串时，行为不变（向后兼容）', async () => {
    const res = makeRes(500, { detail: 'something broke' });
    await expect(handleResponse(res, 'X')).rejects.toThrow(/something broke/);
  });

  it('统一隐藏后端错误中的内部处理技术名称', async () => {
    const res = makeRes(503, { detail: 'ComfyUI GPU Agent 当前离线' });
    const assertion = expect(handleResponse(res, 'ComfyUI upload')).rejects.toThrow();

    await assertion;
    try {
      await handleResponse(makeRes(503, { detail: 'ComfyUI GPU Agent 当前离线' }), 'ComfyUI upload');
    } catch (error) {
      expect((error as Error).message).toContain('处理节点');
      expect((error as Error).message).not.toMatch(/GPU|ComfyUI/i);
    }
  });

  it('200 OK 正常解析 JSON', async () => {
    const res = makeRes(200, { success: true, task_id: 'abc' });
    const data = await handleResponse(res, 'X');
    expect(data).toEqual({ success: true, task_id: 'abc' });
  });
});
