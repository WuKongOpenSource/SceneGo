import { v4 as uuidv4 } from 'uuid';
import { StoryboardData, StoryboardItem } from '../types';
import { apiFetch } from './httpClient';
import type { TextTaskContext } from './textTaskContext';
import { toTextTaskPayload } from './textTaskContext';

type ResponseFormat = 'text' | 'json';

const MAX_DEEPSEEK_ATTEMPTS = 3;
const DEEPSEEK_REQUEST_TIMEOUT_MS = 180_000;
const DEEPSEEK_STREAM_IDLE_TIMEOUT_MS = 90_000;
const SCRIPT_SPLIT_REQUEST_TIMEOUT_MS = 120_000;
const SCRIPT_SPLIT_STREAM_IDLE_TIMEOUT_MS = 60_000;

class DeepseekTimeoutError extends Error {}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isInternalScriptSplit = (taskContext?: TextTaskContext): boolean => (
    taskContext?.operation === 'storyboard_script_generate'
    && taskContext?.displayName === '剧本拆分'
);

const isRetryableDeepseekError = (error: unknown): boolean => {
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
        // Fall through to plain text body.
    }
    return await response.text().catch(() => '') || `HTTP ${response.status}`;
};










export const callDeepseekWithRetry = async (
    prompt: string,
    systemPrompt?: string,
    onStream?: (chunk: string) => void,
    model: string = 'deepseek-reasoner',
    taskContext?: TextTaskContext,
): Promise<string> => {

    const finalPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    return await callDeepseek(finalPrompt, 'text', onStream, model, taskContext);
};









export const callDeepseekChatWithRetry = async (
    prompt: string,
    systemPrompt?: string,
    onStream?: (chunk: string) => void,
    taskContext?: TextTaskContext,
): Promise<string> => {

    const finalPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    return await callDeepseek(finalPrompt, 'text', onStream, 'deepseek-chat', taskContext);
};

const callDeepseekOnce = async (
    prompt: string,
    responseFormat: ResponseFormat = 'text',
    onStream?: (chunk: string) => void,
    model: string = 'deepseek-reasoner',
    taskContext?: TextTaskContext,
): Promise<string> => {
    const controller = new AbortController();
    const splitTask = isInternalScriptSplit(taskContext);
    const requestTimeoutMs = splitTask ? SCRIPT_SPLIT_REQUEST_TIMEOUT_MS : DEEPSEEK_REQUEST_TIMEOUT_MS;
    const streamIdleTimeoutMs = splitTask
        ? SCRIPT_SPLIT_STREAM_IDLE_TIMEOUT_MS
        : DEEPSEEK_STREAM_IDLE_TIMEOUT_MS;
    let requestTimedOut = false;
    const requestTimer = window.setTimeout(() => {
        requestTimedOut = true;
        controller.abort();
    }, requestTimeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
        const response = await apiFetch('/api/deepseek/chat', {
            method: 'POST',
            signal: controller.signal,
            body: JSON.stringify({
                prompt,
                response_format: responseFormat,
                model,
                ...toTextTaskPayload(taskContext),
            })
        }, { apiName: 'DeepSeek', authErrorMessage: '未登录，无法调用 DeepSeek 服务' });

        if (!response.ok) {
            const detail = await readErrorDetail(response);
            throw new Error(detail || `DeepSeek 请求失败 (HTTP ${response.status})`);
        }


        reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';
        let streamError = '';
        let streamFinished = false;

        if (!reader) {
            throw new Error('无法获取响应流');
        }

        while (!streamFinished) {
            let idleTimer: number | undefined;
            const readResult = await Promise.race([
                reader.read(),
                new Promise<never>((_, reject) => {
                    idleTimer = window.setTimeout(() => {
                        requestTimedOut = true;
                        controller.abort();
                        reject(new DeepseekTimeoutError('DeepSeek 响应长时间没有新内容'));
                    }, streamIdleTimeoutMs);
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
                if (line.startsWith('data:')) {
                    const data = line.slice(5).trimStart();
                if (data === '[DONE]') {
                        streamFinished = true;
                        break;
                }

                try {
                    const parsed = JSON.parse(data);
                    if (parsed.type === 'content' && parsed.content) {
                        fullContent += parsed.content;
                        if (onStream) {
                            onStream(parsed.content);
                        }
                    } else if (parsed.type === 'error') {
                        streamError = parsed.message || parsed.detail || 'DeepSeek 流式返回错误';
                    }

                } catch (e) {

                }
                }
            }
        }

        if (streamError) {
            throw new Error(streamError);
        }
        if (!fullContent.trim()) {
            throw new Error('DeepSeek 返回空内容，请稍后重试');
        }
        return fullContent;
    } catch (error) {
        if (requestTimedOut || error instanceof DeepseekTimeoutError || (error as { name?: string } | null)?.name === 'AbortError') {
            throw new Error('DeepSeek 生成超时或连接中断，本次未扣创作点数，请手动重试');
        }
        throw error;
    } finally {
        window.clearTimeout(requestTimer);
        if (requestTimedOut) {
            void reader?.cancel().catch(() => undefined);
        }
    }
};

const callDeepseek = async (
    prompt: string,
    responseFormat: ResponseFormat = 'text',
    onStream?: (chunk: string) => void,
    model: string = 'deepseek-reasoner',
    taskContext?: TextTaskContext,
): Promise<string> => {
    // Streaming UI writes chunks directly to the page, so only retry non-streaming calls.
    // Stage-one splitting has a lossless local fallback, so retrying the same
    // failed provider call only leaves the whole pipeline sitting at 0/1.
    const maxAttempts = onStream || isInternalScriptSplit(taskContext) ? 1 : MAX_DEEPSEEK_ATTEMPTS;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await callDeepseekOnce(prompt, responseFormat, onStream, model, taskContext);
        } catch (error) {
            lastError = error;
            if (attempt >= maxAttempts || !isRetryableDeepseekError(error)) {
                throw error;
            }
            await sleep(1200 * attempt);
        }
    }

    throw lastError instanceof Error ? lastError : new Error('DeepSeek 请求失败，请检查 API 服务。');
};

export const rewriteNovelToScript = async (text: string, onStream?: (chunk: string) => void): Promise<string> => {
    const prompt = `
你是一位专业的中文动画编剧。
请将以下小说/文本内容改写成符合行业标准的动画剧本格式。

要求：
1. 准确识别场景（Scene）、角色（Character）、对话（Dialogue）和动作（Action）。
2. 使用标准的剧本格式（场景标题加粗，角色名居中，对话清晰，包含必要的括弧指导）。
3. 增加适合动画制作的视觉描述（画面感）。
4. 保持原著的语气和情节，但要适应视听语言。
5. **必须使用中文输出剧本内容**。

输入文本:
${text}
`;
    const result = await callDeepseek(prompt, 'text', onStream);
    return result.trim();
};

export const extractScriptMetadata = async (scriptText: string): Promise<{ characters: string[]; scenes: string[]; props: string[] }> => {
    const prompt = `
请分析以下剧本并输出 JSON。
JSON 结构必须为 {"characters": [], "scenes": [], "props": []}
道具只包含人物使用或画面需要稳定展示的物品，例如手持物、武器、关键陈设；人物衣着、服装、妆容属于人物，不要放进 props。

剧本内容:
${scriptText}
`;
    const result = await callDeepseek(prompt, 'json');
    try {
        const parsed = JSON.parse(result);
        return {
            characters: parsed.characters || [],
            scenes: parsed.scenes || [],
            props: parsed.props || []
        };
    } catch (error) {
        console.error('DeepSeek metadata parse error', error);
        return { characters: [], scenes: [], props: [] };
    }
};

export const generateStoryboards = async (scriptText: string): Promise<StoryboardData> => {
    const prompt = `
请分析以下中文动画剧本，将其拆解为一系列关键镜头（Shot），并返回 JSON。

JSON 结构必须为 {"items": [ ... ]}
每个 item 需要包含以下字段：
- originalText: 对应的原文段落（从剧本中直接复制，用于高亮匹配）
- scriptSegment: AI提炼的场景描述（简洁的场景和动作描述，用于图像生成）
- imagePrompt: 图像生成提示词（中文，充分想象画面）
- videoPrompt: 视频生成提示词（中文，描述镜头运动和画面）
- dialogue: 人物台词（如果有）
- characters: 出现的角色列表（数组）
- scene: 场景位置（字符串）
- props: 道具列表（数组；服装衣着不要作为道具）

重要：originalText 必须是剧本中的原始文本段落，scriptSegment 是你提炼的场景描述。

剧本:
${scriptText}
`;
    const result = await callDeepseek(prompt, 'json');
    try {
        const parsed = JSON.parse(result);
        const items = (parsed.items || []).map((item: any) => ({
            ...item,
            id: uuidv4(),
            originalText: item.originalText || item.scriptSegment
        }));
        return { items };
    } catch (error) {
        console.error('DeepSeek storyboard parse error', error);
        throw new Error('DeepSeek 无法生成有效的分镜数据');
    }
};

export const regenerateSingleShot = async (scriptSegment: string, instruction?: string): Promise<Omit<StoryboardItem, 'id'>> => {
    const prompt = `
请根据以下剧本片段，重新生成分镜描述信息，并返回 JSON。
JSON 必须包含: imagePrompt, videoPrompt, dialogue, characters, scene, props。

剧本片段: "${scriptSegment}"
${instruction ? `用户额外要求: ${instruction}` : ''}
`;
    const result = await callDeepseek(prompt, 'json');
    const data = JSON.parse(result);
    return {
        scriptSegment,
        ...data
    };
};

export const refineScriptSegment = async (originalSegment: string, instruction: string, fullContext: string): Promise<string> => {
    const prompt = `
你是一个专业的中文剧本润色助手，请根据用户要求改写以下片段，直接返回修改后的文本:

用户要求: ${instruction}
片段: "${originalSegment}"
上下文:
${fullContext.slice(0, 500)}...
`;
    const result = await callDeepseek(prompt, 'text');
    return result.trim();
};

export const restructureShot = async (
    selection: string,
    instruction: string,
    operation: 'split' | 'merge'
): Promise<{ newScriptSegment: string; newStoryboardItems: Omit<StoryboardItem, 'id'>[] }> => {
    const isSplit = operation === 'split';
    const prompt = `
用户希望对以下剧本片段执行 "${isSplit ? '拆分' : '合并'}" 操作。请返回 JSON，结构为:
{
  "newScriptSegment": "...",
  "newStoryboardItems": [
    { "scriptSegment": "...", "imagePrompt": "...", "videoPrompt": "...", "dialogue": "...", "characters": [], "scene": "" }
  ]
}

片段:
${selection}

指令:
${instruction}
`;
    const result = await callDeepseek(prompt, 'json');
    const data = JSON.parse(result);
    return data;
};





export const extractShotsFromScript = async (scriptText: string): Promise<{items: Array<{originalText: string; scriptSegment: string}>}> => {
    console.log(`📏 开始处理剧本，长度: ${scriptText.length}字符`);


    const shots = splitScriptByShots(scriptText);
    console.log(`📦 剧本分割完成，共 ${shots.length} 个镜头`);


    const allItems: Array<{originalText: string; scriptSegment: string}> = [];

    for (let i = 0; i < shots.length; i++) {
        const shot = shots[i];
        console.log(`🎬 处理镜头 ${i + 1}/${shots.length} (${shot.shotNumber})，长度: ${shot.originalText.length}字符`);

        try {

            const scriptSegment = await generateScriptSegment(shot.originalText);

            allItems.push({
                originalText: shot.originalText,
                scriptSegment: scriptSegment
            });

            console.log(`✅ 镜头 ${shot.shotNumber} 完成，scriptSegment: ${scriptSegment.substring(0, 50)}...`);
        } catch (error) {
            console.error(`❌ 镜头 ${shot.shotNumber} 处理失败:`, error);
            throw error;
        }
    }

    console.log(`🎉 全部完成，共 ${allItems.length} 个镜头`);
    return { items: allItems };
};








function splitScriptByShots(scriptText: string): Array<{shotNumber: string; originalText: string}> {
    const lines = scriptText.split('\n');
    const shots: Array<{shotNumber: string; originalText: string}> = [];
    let currentShot = '';
    let currentShotNumber = '';
    let hasStarted = false;


    const shotPatterns = [
        /^(\d{3})\s*[\t\【\(（]/,
        /^镜头\s*(\d+(?:-\d+)?)\s*(?:[\(（\【\|｜:]|$)/,
        /^[Ss]hot\s*(\d+)\s*[\(\[]/i,
    ];

    const matchShotNumber = (line: string): string | null => {
        for (const pattern of shotPatterns) {
            const match = line.match(pattern);
            if (match) {
                return match[1];
            }
        }
        return null;
    };

    for (const line of lines) {
        const shotNumber = matchShotNumber(line);

        if (shotNumber) {
            hasStarted = true;


            if (currentShot) {
                shots.push({
                    shotNumber: currentShotNumber,
                    originalText: currentShot.trim()
                });
            }

            currentShotNumber = shotNumber;
            currentShot = line;
        } else if (hasStarted) {

            currentShot += '\n' + line;
        }
    }


    if (currentShot) {
        shots.push({
            shotNumber: currentShotNumber,
            originalText: currentShot.trim()
        });
    }

    console.log(`📋 分割完成，共 ${shots.length} 个镜头`);
    return shots;
}




async function generateScriptSegment(originalText: string): Promise<string> {
    const prompt = `你是专业的分镜师。请为以下镜头生成一个精炼的场景描述。

**要求：**
- 只输出场景描述文本，不要JSON格式
- 控制在40字以内
- 只包含最核心的视觉信息：镜头类型、主要动作、氛围
- 去除对话、音效、时长等信息
- 例如："大广角俯视，林临渊黑袍走入藏书阁，光柱中尘埃浮动，肃穆压抑。"

**镜头原文：**
${originalText}

**请直接输出场景描述（40字以内，纯文本，无需JSON）：**`;

    const result = await callDeepseek(prompt, 'text');
    return result.trim();
}





export const generateShotDetails = async (
    originalText: string,
    scriptSegment: string,
    userRequirements?: string
): Promise<{
    imagePrompt: string;
    videoPrompt: string;
    dialogue: string;
    characters: string[];
    scene: string;
}> => {
    const prompt = `你是专业的镜头设计师。请为以下场景生成详细的镜头设计信息。

**场景信息：**
原文段落：
${originalText}

场景描述：
${scriptSegment}

${userRequirements ? `**用户整体要求：**\n${userRequirements}\n` : ''}

**请返回JSON格式：**
{
  "imagePrompt": "中文图像生成提示词，描述画面构图、光影效果、角色状态、视觉风格",
  "videoPrompt": "中文视频提示词，描述镜头运动（推拉摇移跟）、画面节奏、转场方式",
  "dialogue": "人物台词（直接从原文提取）",
  "characters": ["角色1", "角色2"],
  "scene": "场景位置"
}`;

    const result = await callDeepseek(prompt, 'json');
    return JSON.parse(result);
};
