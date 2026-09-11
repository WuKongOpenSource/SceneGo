






import { AiModel } from '../types';
import { callGeminiProxyStream, callGeminiProxyWithRetry } from './geminiProxyService';
import { callDeepseekWithRetry, callDeepseekChatWithRetry } from './deepseekService';
import { callMinimaxM3WithRetry } from './minimaxTextService';
import { PromptTemplate, fillPrompt } from '../prompts';
import type { TextTaskContext } from './textTaskContext';










export async function callAI(
  model: AiModel,
  promptTemplate: PromptTemplate,
  variables: Record<string, string> = {},
  onStream?: (chunk: string) => void,
  taskContext?: TextTaskContext,
): Promise<string> {

  const userPrompt = fillPrompt(promptTemplate.user, variables);
  const systemPrompt = promptTemplate.system;


  if (model === AiModel.MinimaxM3) {
    return await callMinimaxM3WithRetry(userPrompt, systemPrompt, onStream, taskContext);
  } else if (model === AiModel.Deepseek) {
    return await callDeepseekWithRetry(userPrompt, systemPrompt, onStream, 'deepseek-reasoner', taskContext);
  } else if (model === AiModel.DeepseekChat) {
    return await callDeepseekChatWithRetry(userPrompt, systemPrompt, onStream, taskContext);
  } else {
    if (onStream) {
      return await callGeminiProxyStream(
        userPrompt,
        systemPrompt,
        undefined,
        taskContext,
        onStream,
      );
    }
    return await callGeminiProxyWithRetry(userPrompt, systemPrompt, 3, undefined, taskContext);
  }
}









export async function callAIForJSON<T = any>(
  model: AiModel,
  promptTemplate: PromptTemplate,
  variables: Record<string, string> = {},
  taskContext?: TextTaskContext,
): Promise<T> {
  const response = await callAI(model, promptTemplate, variables, undefined, taskContext);


  const cleanResponse = response
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();


  let jsonStr = cleanResponse;


  const objectMatch = cleanResponse.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }


  const arrayMatch = cleanResponse.match(/\[[\s\S]*\]/);
  if (arrayMatch && !objectMatch) {
    jsonStr = arrayMatch[0];
  }

  try {
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('❌ JSON解析失败，原始响应:', cleanResponse);
    throw new Error(`JSON解析失败: ${(error as Error).message}`);
  }
}











export async function callAIWithRetry(
  model: AiModel,
  promptTemplate: PromptTemplate,
  variables: Record<string, string> = {},
  maxRetries: number = 3,
  onStream?: (chunk: string) => void
): Promise<string> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await callAI(model, promptTemplate, variables, onStream);
    } catch (error) {
      lastError = error as Error;
      console.warn(`⚠️ AI调用失败（第${i + 1}次），重试中...`);
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
      }
    }
  }

  throw lastError || new Error('AI调用失败');
}









export async function batchCallAI<T = any>(
  model: AiModel,
  tasks: Array<{ promptTemplate: PromptTemplate; variables: Record<string, string> }>,
  concurrency: number = 3
): Promise<T[]> {
  const results: T[] = [];
  const queue = [...tasks];


  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;

      try {
        const result = await callAIForJSON<T>(model, task.promptTemplate, task.variables);
        results.push(result);
      } catch (error) {
        console.error('❌ 批量任务失败:', error);
        results.push(null as any);
      }
    }
  });

  await Promise.all(workers);
  return results;
}
