import { StoryboardData, RestructureResponse, StoryboardItem } from "../types";
import { v4 as uuidv4 } from 'uuid';
import { callGeminiProxyWithRetry } from './geminiProxyService';

const MODEL_TEXT = 'gemini-2.5-flash';
const MODEL_LOGIC = 'gemini-2.5-flash'; 

const stripJsonFences = (value: string): string => {
    return (value || '')
        .replace(/```json\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();
};

const parseJsonFromGemini = <T>(value: string): T => {
    const clean = stripJsonFences(value);
    const objectMatch = clean.match(/\{[\s\S]*\}/);
    const arrayMatch = clean.match(/\[[\s\S]*\]/);
    const json = objectMatch?.[0] || arrayMatch?.[0] || clean;
    return JSON.parse(json) as T;
};

export const callGeminiText = async (
    prompt: string,
    systemPrompt?: string,
    model: string = MODEL_TEXT,
): Promise<string> => {
    return callGeminiProxyWithRetry(prompt, systemPrompt, 3, model);
};

const callGeminiJson = async <T>(
    prompt: string,
    systemPrompt?: string,
    model: string = MODEL_LOGIC,
): Promise<T> => {
    const response = await callGeminiText(prompt, systemPrompt, model);
    return parseJsonFromGemini<T>(response);
};

// Helper for retrying 503 errors
const callWithRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
    try {
        return await fn();
    } catch (error: any) {
        if (retries > 0 && (error.message?.includes('503') || error.message?.includes('Model isn\'t available'))) {
            console.warn(`Model busy, retrying... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return callWithRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
};

export const rewriteNovelToScript = async (text: string): Promise<string> => {
  return callWithRetry(async () => {
      try {
        const prompt = `
          你是一位专业的动画编剧。
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

        return await callGeminiText(prompt, "你是一个专业的中文动画编剧助手。", MODEL_TEXT);
      } catch (error) {
        console.error("Rewrite Error:", error);
        throw new Error("Failed to rewrite script.");
      }
  });
};

export const extractScriptMetadata = async (scriptText: string): Promise<{ characters: string[], scenes: string[], props: string[] }> => {
  return callWithRetry(async () => {
    try {
        const prompt = `
          Analyze the following script and extract:
          1. A list of all unique **Characters** (names).
          2. A list of all unique **Scene Locations** (headings).
          3. A list of all unique **Props** that are used by characters or must stay visually consistent.
          Props exclude clothing, outfits, makeup, and appearance details because those belong to characters.
          Return only JSON in this shape: {"characters":[],"scenes":[],"props":[]}.
          
          Script Content:
          ${scriptText}
        `;

        return await callGeminiJson<{ characters: string[], scenes: string[], props: string[] }>(prompt, undefined, MODEL_LOGIC);

    } catch (error) {
        console.error("Extraction Error:", error);
        return { characters: [], scenes: [], props: [] };
    }
  });
};

export const generateStoryboards = async (scriptText: string): Promise<StoryboardData> => {
  return callWithRetry(async () => {
    try {
        const prompt = `
          请分析以下中文动画剧本，将其拆解为一系列关键镜头（Shot）。
          
          对于每一个镜头，请生成：
          1. **originalText**: 对应的原文段落（从剧本中直接复制，用于高亮匹配，**必须完全匹配原文**）。
          2. **scriptSegment**: AI提炼的场景描述（简洁的场景和动作描述，用于图像生成）。
          3. **imagePrompt**: 用于AI生图（如Midjourney）的**中文**提示词。详细描述构图、光影、风格、角色和背景。
          4. **videoPrompt**: 用于AI视频生成（如Runway）的**中文**提示词。详细描述运镜和动作。
          5. **dialogue**: 该镜头中的人物台词（如果没有台词则留空）。
          6. **characters**: 该镜头中出现的角色名字列表。
          7. **scene**: 该镜头所在的场景地点。
          8. **props**: 该镜头中需要稳定展示或被人物使用的道具列表；服装衣着不要作为道具。

          重要：originalText 必须是剧本中的原始文本段落，scriptSegment 是你提炼的场景描述。

          Script Content:
          ${scriptText}
        `;

        const data = await callGeminiJson<any>(prompt, undefined, MODEL_LOGIC);
        const items = (data.items || []).map((item: any) => ({
          ...item,
          id: uuidv4()
        }));
        return { items };

    } catch (error) {
        console.error("Storyboard Error:", error);
        throw new Error("Failed to generate storyboards.");
    }
  });
};

export const regenerateSingleShot = async (scriptSegment: string, instruction?: string): Promise<Omit<StoryboardItem, 'id'>> => {
    return callWithRetry(async () => {
        try {
            const prompt = `
              请根据以下剧本片段，重新生成分镜描述信息。
              ${instruction ? `\n用户的具体修改要求: "${instruction}"\n请根据该要求调整提示词。\n` : ''}

              剧本片段: "${scriptSegment}"

              请返回 JSON 包含 imagePrompt, videoPrompt, dialogue, characters, scene, props。
            `;

            const data = await callGeminiJson<any>(prompt, undefined, MODEL_LOGIC);
            return {
                scriptSegment: scriptSegment,
                ...data
            };

        } catch (error) {
            console.error("Regenerate Shot Error:", error);
            throw new Error("Failed to regenerate single shot.");
        }
    });
};

export const refineScriptSegment = async (originalSegment: string, instruction: string, fullContext: string): Promise<string> => {
  return callWithRetry(async () => {
    try {
        const prompt = `
          你是一个专业的剧本润色助手。
          请根据用户的要求，修改或重写以下选中的剧本片段。
          
          用户要求: ${instruction}
          
          选中片段:
          "${originalSegment}"
          
          (上下文):
          ${fullContext.slice(0, 500)}...
          
          **只输出修改后的文本内容，不要包含任何解释或Markdown标记。**
        `;

        return await callGeminiText(prompt, undefined, MODEL_TEXT) || originalSegment;
    } catch (error) {
        console.error("Refine Error:", error);
        throw new Error("Failed to refine script.");
    }
  });
};

export const restructureShot = async (
    selection: string, 
    instruction: string, 
    operation: 'split' | 'merge'
): Promise<RestructureResponse> => {
    return callWithRetry(async () => {
        try {
            const isSplit = operation === 'split';
            const prompt = `
                用户希望对一段中文动画剧本进行"${isSplit ? '拆分 (Split)' : '合并 (Merge)'}"操作。
                这是一个精确的编剧任务。

                **输入信息**:
                选中剧本片段: "${selection}"
                用户指令: "${instruction}"

                **规则**:
                1. **${isSplit ? '拆分 (Split)' : '合并 (Merge)'}**:
                   ${isSplit 
                      ? '用户希望把这段剧情拆解成多个镜头。**非常重要：不要修改或重写剧本原文文字**。newScriptSegment 必须与输入的选中片段完全一致。你需要做的是将这段文字在逻辑上拆分成多个画面描述。' 
                      : '用户希望把多段剧情合并为一个镜头。你需要将剧本文字进行必要的融合或精简，使其成为一段连贯的描述。'
                   }

                2. **生成分镜 (Storyboards)**:
                   - ${isSplit ? '必须生成 **多个 (>1)** 分镜项。' : '必须生成 **1个** 分镜项。'}
                   - 每个分镜项的 "scriptSegment" 字段：
                     ${isSplit 
                        ? '如果是拆分：请直接引用原文中的子句或整句。如果一个镜头涵盖整句，就用整句。确保所有分镜的scriptSegment组合起来能覆盖原文意思。' 
                        : '如果是合并：引用重写后的 newScriptSegment。'
                     }

                **返回格式 (JSON)**:
                {
                    "newScriptSegment": "${isSplit ? '必须返回原封不动的选中片段' : '重写后的剧本段落'}",
                    "newStoryboardItems": [
                        {
                            "scriptSegment": "引用文本",
                            "imagePrompt": "中文画面提示词",
                            "videoPrompt": "中文视频提示词",
                            "dialogue": "台词",
                            "characters": ["角色名"],
                            "scene": "场景名"
                        }
                    ]
                }
            `;

            return await callGeminiJson<RestructureResponse>(prompt, undefined, MODEL_LOGIC);

        } catch (error) {
            console.error("Restructure Error:", error);
            throw new Error("Failed to restructure shot.");
        }
    });
}

export { generateGeminiImageVariant, generateMaterialImage, generateFinalIllustration } from './geminiImageGenerationService';
