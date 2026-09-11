












import { getTaskStatus as defaultGetStatus } from '@runtime/videoTaskService';

export interface TtsResult {
  audio_url: string;
  file_id?: string;
  duration_ms?: number;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  getStatus?: (taskId: string) => Promise<{
    status: string;
    progress?: number;
    result?: any;
  }>;
}

export class TtsTimeoutError extends Error {
  constructor(public taskId: string, public elapsedMs: number) {
    super(`TTS 轮询超时: task_id=${taskId} elapsed=${Math.round(elapsedMs / 1000)}s`);
    this.name = 'TtsTimeoutError';
  }
}

export async function pollTtsTaskUntilDone(
  taskId: string,
  opts: PollOptions = {},
): Promise<TtsResult> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 8 * 60 * 1000;
  const signal = opts.signal;
  const getStatus = opts.getStatus ?? (defaultGetStatus as any);
  const start = Date.now();

  while (true) {
    if (signal?.aborted) throw new DOMException('TTS poll aborted', 'AbortError');
    if (Date.now() - start > timeoutMs) throw new TtsTimeoutError(taskId, Date.now() - start);

    let s: any;
    try {
      s = await getStatus(taskId);
    } catch (e: any) {

      if (signal?.aborted) throw new DOMException('TTS poll aborted', 'AbortError');
      await sleep(intervalMs, signal);
      continue;
    }

    const status = s?.status;
    if (status === 'completed') {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('credits:updated'));
      }
      const result = s.result || {};
      return {
        audio_url: result.audio_url || result.file_url || '',
        file_id: result.file_id,
        duration_ms: result.duration_ms,
      };
    }
    if (status === 'cancelled') {
      window.dispatchEvent(new CustomEvent('credits:updated'));
      throw new Error('任务已取消');
    }
    if (status === 'failed') {
      throw new Error(s?.result?.error || 'TTS 任务失败');
    }
    await sleep(intervalMs, signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('TTS poll aborted', 'AbortError'));
      }, { once: true });
    }
  });
}
