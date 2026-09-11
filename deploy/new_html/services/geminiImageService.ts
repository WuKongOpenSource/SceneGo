




import { apiJson } from './httpClient';

export interface GeneratedFileResult {
    url: string;
    fileId?: string;
    fileUrl?: string;
}

export interface GeminiImageReferenceMetadata {
    referenceId?: string;
    assetId?: string;
    fileId?: string;
    type: 'character' | 'scene' | 'pose' | 'prop' | 'effect';
    name?: string;
    description?: string;
    source?: 'identity_anchor' | 'material_binding' | 'manual';
    isLocked?: boolean;
}

export interface GeminiImageOptions {
    model?: string;
    modelScope?: string;
    prompt: string;
    references?: string[];
    referenceMetadata?: GeminiImageReferenceMetadata[];
    aspectRatio?: string;
    imageSize?: '1K' | '2K' | '4K';
    entityType?: string;
    entityId?: string;
    fileRole?: string;
    projectId?: string;
    episodeId?: string;
    sourcePage?: string;
    sourceItemId?: string;
}

interface GeminiImageProxyResponse {
    files?: Array<{
        file_url?: string;
        data_url?: string;
        file_id?: string;
    }>;
    images?: string[];
}

const DEFAULT_ASPECT = '1:1';
const DEFAULT_IMAGE_SIZE: '1K' | '2K' | '4K' = '2K';




export const generateGeminiImageViaProxy = async (options: GeminiImageOptions): Promise<GeneratedFileResult[]> => {
    const { model, prompt, references = [], aspectRatio = DEFAULT_ASPECT, imageSize = DEFAULT_IMAGE_SIZE } = options;

    console.log('📤 发送图像生成请求到后端');
    
    try {
        const result = await apiJson<GeminiImageProxyResponse>('/api/gemini/image', {
            method: 'POST',
            body: JSON.stringify({
                prompt,
                ...(model ? { model } : {}),
                ...(options.modelScope ? { model_scope: options.modelScope } : {}),
                references,
                reference_metadata: options.referenceMetadata || [],
                aspectRatio,
                imageSize,
                entity_type: options.entityType,
                entity_id: options.entityId,
                file_role: options.fileRole,
                project_id: options.projectId,
                episode_id: options.episodeId,
                source_page: options.sourcePage,
                source_item_id: options.sourceItemId,
            })
        }, 'Gemini 图像生成');

        if (result.files && result.files.length > 0) {
            console.log('✅ 成功生成图片（files），数量:', result.files.length);
            return result.files.map((f: any) => ({
                url: f.file_url || f.data_url,
                fileId: f.file_id,
                fileUrl: f.file_url,
            }));
        }

        const images = result.images || [];
        
        if (images.length === 0) {
            throw new Error('Gemini未返回任何图片');
        }
        
        console.log('✅ 成功生成图片，数量:', images.length);
        return images.map((img: string) => ({ url: img }));
    } catch (error) {
        console.error('❌ Gemini图像生成失败:', error);
        throw error;
    }
};




export const generateGeminiImageWithRetry = async (
    options: GeminiImageOptions,
    maxRetries: number = 3
): Promise<GeneratedFileResult[]> => {
    let lastError: Error | null = null;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await generateGeminiImageViaProxy(options);
        } catch (error) {
            lastError = error as Error;
            console.warn(`⚠️ 图像生成失败（第${i + 1}次），重试中...`);
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
            }
        }
    }
    
    throw lastError || new Error('图像生成失败');
};
