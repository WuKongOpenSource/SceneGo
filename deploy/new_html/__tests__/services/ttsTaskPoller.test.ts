import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pollTtsTaskUntilDone } from '../../services/ttsTaskPoller';

describe('pollTtsTaskUntilDone', () => {
  beforeEach(() => vi.useFakeTimers());

  it('stops immediately on server cancellation', async () => {
    const getStatus = vi.fn().mockResolvedValue({ status: 'cancelled' });
    await expect(pollTtsTaskUntilDone('cancelled-tts', { getStatus })).rejects.toThrow('任务已取消');
    expect(getStatus).toHaveBeenCalledOnce();
  });

  it('completed 状态返回 audio_url + file_id', async () => {
    const getStatus = vi.fn()
      .mockResolvedValueOnce({ status: 'processing', progress: 50 })
      .mockResolvedValueOnce({
        status: 'completed',
        result: { audio_url: '/storage/audio/x.mp3', file_id: 'fid-1', duration_ms: 1200 },
      });
    const promise = pollTtsTaskUntilDone('task-1', { intervalMs: 100, timeoutMs: 60000, getStatus });
    await vi.advanceTimersByTimeAsync(250);
    const result = await promise;
    expect(result).toEqual({ audio_url: '/storage/audio/x.mp3', file_id: 'fid-1', duration_ms: 1200 });
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it('failed 状态抛错', async () => {
    const getStatus = vi.fn().mockResolvedValueOnce({
      status: 'failed', result: { error: 'TTS 任务超时: mx-1' },
    });
    const promise = pollTtsTaskUntilDone('task-2', { intervalMs: 100, timeoutMs: 60000, getStatus });
    const rejection = expect(promise).rejects.toThrow(/TTS 任务超时/);
    await vi.advanceTimersByTimeAsync(150);
    await rejection;
  });

  it('AbortSignal 取消时抛 AbortError', async () => {
    const ctrl = new AbortController();
    const getStatus = vi.fn().mockResolvedValue({ status: 'processing' });
    const promise = pollTtsTaskUntilDone('task-3', {
      intervalMs: 100, timeoutMs: 60000, getStatus, signal: ctrl.signal,
    });
    const rejection = expect(promise).rejects.toThrow(/abort/i);
    setTimeout(() => ctrl.abort(), 50);
    await vi.advanceTimersByTimeAsync(200);
    await rejection;
  });

  it('timeout 抛 TtsTimeoutError', async () => {
    const getStatus = vi.fn().mockResolvedValue({ status: 'processing' });
    const promise = pollTtsTaskUntilDone('task-4', { intervalMs: 100, timeoutMs: 300, getStatus });
    const rejection = expect(promise).rejects.toThrow(/超时|timeout/i);
    await vi.advanceTimersByTimeAsync(400);
    await rejection;
  });
});
