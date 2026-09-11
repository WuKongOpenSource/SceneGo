import { apiFetch } from './httpClient';
import type { TextTaskContext } from './textTaskContext';
import { toTextTaskPayload } from './textTaskContext';

const MAX_MINIMAX_ATTEMPTS = 3;
const MINIMAX_REQUEST_TIMEOUT_MS = 180_000;
const MINIMAX_STREAM_IDLE_TIMEOUT_MS = 90_000;

class MinimaxTimeoutError extends Error {}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isRetryableMinimaxError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/未登录|未配置|endpoint\s*未配置|api\s*key|401|403|unauthor|未扣创作点数|手动重试/i.test(message)) {
    return false;
  }
  return /请求失败|调用失败|超时|timeout|network|failed to fetch|fetch failed|econn|socket|stream|流式|空内容|429|500|502|503|504|rate|busy|overload|temporar/i.test(message);
};

const readErrorDetail = async (response: Response): Promise<string> => {
  try {
    const data = await response.clone().json();
    if (typeof data?.detail === 'string') return data.detail;
    if (typeof data?.message === 'string') return data.message;
    if (data && Object.keys(data).length > 0) return JSON.stringify(data);
  } catch {
    // Fall through to the plain text body.
  }
  return await response.text().catch(() => '') || `HTTP ${response.status}`;
};

const callMinimaxM3Once = async (
  prompt: string,
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
): Promise<string> => {
  const controller = new AbortController();
  let requestTimedOut = false;
  const requestTimer = window.setTimeout(() => {
    requestTimedOut = true;
    controller.abort();
  }, MINIMAX_REQUEST_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    const response = await apiFetch('/api/minimax/chat', {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({
        prompt,
        response_format: 'text',
        model: 'minimax-m3',
        ...toTextTaskPayload(taskContext),
      }),
    }, {
      apiName: 'MiniMax M3',
      authErrorMessage: '未登录，无法调用 MiniMax 服务',
    });

    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(detail || `MiniMax 请求失败 (HTTP ${response.status})`);
    }

    reader = response.body?.getReader();
    if (!reader) throw new Error('无法获取 MiniMax 响应流');

    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    let streamError = '';
    let streamFinished = false;

    while (!streamFinished) {
      let idleTimer: number | undefined;
      const readResult = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          idleTimer = window.setTimeout(() => {
            requestTimedOut = true;
            controller.abort();
            reject(new MinimaxTimeoutError('MiniMax 响应长时间没有新内容'));
          }, MINIMAX_STREAM_IDLE_TIMEOUT_MS);
        }),
      ]).finally(() => {
        if (idleTimer !== undefined) window.clearTimeout(idleTimer);
      });
      const { done, value } = readResult;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trimStart();
        if (data === '[DONE]') {
          streamFinished = true;
          break;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content' && parsed.content) {
            fullContent += parsed.content;
            onStream?.(parsed.content);
          } else if (parsed.type === 'error') {
            streamError = parsed.message || parsed.detail || 'MiniMax 流式返回错误';
          }
        } catch {
          // Ignore an incomplete or non-JSON SSE line.
        }
      }
    }

    if (streamError) throw new Error(streamError);
    if (!fullContent.trim()) throw new Error('MiniMax 返回空内容，请稍后重试');
    return fullContent;
  } catch (error) {
    if (
      requestTimedOut
      || error instanceof MinimaxTimeoutError
      || (error as { name?: string } | null)?.name === 'AbortError'
    ) {
      throw new Error('MiniMax 生成超时或连接中断，本次未扣创作点数，请手动重试');
    }
    throw error;
  } finally {
    window.clearTimeout(requestTimer);
    if (requestTimedOut) void reader?.cancel().catch(() => undefined);
  }
};

export const callMinimaxM3WithRetry = async (
  prompt: string,
  systemPrompt?: string,
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
): Promise<string> => {
  const finalPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  // Streaming output is already visible, so replaying it would duplicate text.
  const maxAttempts = onStream ? 1 : MAX_MINIMAX_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callMinimaxM3Once(finalPrompt, onStream, taskContext);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableMinimaxError(error)) throw error;
      await sleep(1200 * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('MiniMax 请求失败，请检查 API 服务。');
};
