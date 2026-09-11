
import { callGeminiProxyWithRetry } from './geminiProxyService';
import { callDeepseekChatWithRetry } from './deepseekService';

export type RewriteBackend = 'geminiProxy' | 'geminiSDK' | 'deepseek';

export const REWRITE_BACKEND_LABELS: Record<RewriteBackend, string> = {
    geminiProxy: 'gemini-2.5-flash · 全能写作模型（默认）',
    geminiSDK:   'gemini-2.5-flash · 全能写作模型（兼容旧选项）',
    deepseek:    'deepseek-v4-flash · 快速写作模型（中文优化）',
};


export const REWRITE_PRESETS: Array<{ id: string; label: string; instruction: string }> = [
    {
        id: 'detail',
        label: '详细化（补镜头/动作/环境）',
        instruction: '请把这段视频提示词写得更详细，补充镜头运动（推、拉、摇、移、跟）、人物动作神态、环境光线与氛围。保持核心动作不变，输出单一段落，不要列表。',
    },
    {
        id: 'concise',
        label: '简洁化（削冗余/留关键）',
        instruction: '请把这段视频提示词压缩到 1-2 句话，只保留最关键的镜头、动作、氛围词。删除重复或修饰过度的描述。',
    },
    {
        id: 'camera',
        label: '加运镜（推拉摇移跟）',
        instruction: '请在原文基础上补充镜头运动描述（推、拉、摇、移、跟、升降镜头之一），明确镜头是从哪里到哪里、以什么节奏运动。其他内容尽量保留。',
    },
    {
        id: 'mood',
        label: '加氛围（光线/情绪/色温）',
        instruction: '请在原文基础上补充画面氛围描述：光线（顶光/侧光/逆光/夕阳/月光/霓虹...）、色温（冷/暖/中性）、人物情绪基调。原有动作描述不要改。',
    },
    {
        id: 'en',
        label: '翻译为英文（兼容海外模型）',
        instruction: '请把这段中文视频提示词翻译为英文（自然语序，prompt-style），保留核心镜头与动作信息，不要逐字直译。',
    },
];

export interface RewriteRequest {
    originalPrompt: string;

    instruction: string;
    backend: RewriteBackend;
}

const SYSTEM_PROMPT = `你是一位资深的视频生成提示词工程师，擅长 Seedance / Sora / 通义万相 等视频模型的提示词风格。
你会根据用户的「改写要求」，对原提示词进行最小但有效的改写——保留原意，避免凭空增加或删除关键元素。
直接输出改写后的提示词文本，不要加任何标题、引号、解释或前缀（如"改写后："）。`;





export async function rewritePrompt(req: RewriteRequest): Promise<string> {
    const { originalPrompt, instruction, backend } = req;
    if (!originalPrompt.trim()) throw new Error('原提示词为空');
    if (!instruction.trim()) throw new Error('改写要求为空');

    const userPrompt = [
        '【原提示词】',
        originalPrompt.trim(),
        '',
        '【改写要求】',
        instruction.trim(),
        '',
        '请直接输出改写后的提示词：',
    ].join('\n');

    let result: string;
    if (backend === 'geminiProxy') {
        result = await callGeminiProxyWithRetry(userPrompt, SYSTEM_PROMPT);
    } else if (backend === 'deepseek') {
        result = await callDeepseekChatWithRetry(userPrompt, SYSTEM_PROMPT);
    } else if (backend === 'geminiSDK') {
        result = await callGeminiProxyWithRetry(userPrompt, SYSTEM_PROMPT);
    } else {
        throw new Error(`未知 backend: ${backend}`);
    }

    return cleanResult(result);
}


function cleanResult(raw: string): string {
    let s = (raw || '').trim();

    s = s.replace(/^```(?:\w+)?\s*\n?/, '').replace(/\n?```\s*$/, '');

    s = s.replace(/^(改写后[:：]?\s*|改写结果[:：]?\s*|输出[:：]?\s*)/i, '');

    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('“') && s.endsWith('”'))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}
