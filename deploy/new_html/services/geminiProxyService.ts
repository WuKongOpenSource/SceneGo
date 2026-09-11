




import { apiFetch, apiJson } from './httpClient';
import type { TextTaskContext } from './textTaskContext';
import { toTextTaskPayload } from './textTaskContext';

interface GeminiTextResponse {
  content?: string;
}

const GEMINI_STREAM_IDLE_TIMEOUT_MS = 45_000;

export const callGeminiProxyStream = async (
  prompt: string,
  systemPrompt: string | undefined,
  model: string | undefined,
  taskContext: TextTaskContext | undefined,
  onStream: (chunk: string) => void,
): Promise<string> => {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timedOut = false;
  try {
    const body: Record<string, unknown> = {
      prompt,
      system_prompt: systemPrompt,
      temperature: 0.7,
      ...toTextTaskPayload(taskContext),
    };
    if (model?.trim()) body.model = model.trim();

    const response = await apiFetch('/api/gemini/text/stream', {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify(body),
    }, {
      apiName: 'Gemini 文本流式代理',
      authErrorMessage: '未登录，无法调用 Gemini 服务',
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(detail || `Gemini 文本生成失败 (HTTP ${response.status})`);
    }

    reader = response.body?.getReader();
    if (!reader) throw new Error('无法获取 Gemini 响应流');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let streamError = '';
    let finished = false;
    while (!finished) {
      let idleTimer: number | undefined;
      const readResult = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          idleTimer = window.setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new Error('Gemini 长时间没有返回新内容'));
          }, GEMINI_STREAM_IDLE_TIMEOUT_MS);
        }),
      ]).finally(() => {
        if (idleTimer !== undefined) window.clearTimeout(idleTimer);
      });
      if (readResult.done) break;
      buffer += decoder.decode(readResult.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trimStart();
        if (data === '[DONE]') {
          finished = true;
          break;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content' && parsed.content) {
            fullContent += parsed.content;
            onStream(parsed.content);
          } else if (parsed.type === 'error') {
            streamError = parsed.message || parsed.detail || 'Gemini 流式返回错误';
          }
        } catch {
          // Ignore incomplete or non-JSON SSE lines.
        }
      }
    }
    if (streamError) throw new Error(streamError);
    if (!fullContent.trim()) throw new Error('Gemini 返回空内容');
    return fullContent;
  } catch (error) {
    if (timedOut || (error as { name?: string } | null)?.name === 'AbortError') {
      throw new Error('Gemini 生成超时或连接中断，本次未扣创作点数，请手动重试');
    }
    throw error;
  } finally {
    if (timedOut) void reader?.cancel().catch(() => undefined);
  }
};




export const callGeminiProxy = async (
  prompt: string,
  systemPrompt?: string,
  model?: string,
  taskContext?: TextTaskContext,
): Promise<string> => {
  try {
    console.log('📤 发送请求到后端Gemini代理');

    const body: Record<string, unknown> = {
      prompt,
      system_prompt: systemPrompt,
      temperature: 0.7,
      ...toTextTaskPayload(taskContext),
    };
    if (model?.trim()) {
      body.model = model.trim();
    }

    const data = await apiJson<GeminiTextResponse>('/api/gemini/text', {
      method: 'POST',
      body: JSON.stringify(body)
    }, 'Gemini 文本代理');

    const content = data.content;
    
    if (!content) {
      console.error('❌ 返回内容为空');
      throw new Error('Gemini返回内容为空');
    }

    console.log('✅ 成功获取内容，长度:', content.length);
    return content;
  } catch (error) {
    console.error('❌ Gemini API调用失败:', error);
    throw error;
  }
};




export const callGeminiProxyWithRetry = async (
  prompt: string,
  systemPrompt?: string,
  maxRetries: number = 3,
  model?: string,
  taskContext?: TextTaskContext,
): Promise<string> => {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await callGeminiProxy(prompt, systemPrompt, model, taskContext);
    } catch (error) {
      lastError = error as Error;
      console.warn(`⚠️ Gemini中转站调用失败（第${i + 1}次），重试中...`);
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
      }
    }
  }
  
  throw lastError || new Error('Gemini中转站调用失败');
};

