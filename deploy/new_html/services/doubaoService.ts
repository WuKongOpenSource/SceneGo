import { apiJson } from './httpClient';
import type { GeminiImageReferenceMetadata } from './geminiImageService';

export interface GeneratedFileResult {
    url: string;
    fileId?: string;
    fileUrl?: string;
}

export interface DoubaoGenerationOptions {
    prompt: string;
    model?: string;
    modelScope?: string;
    seedancePortrait?: boolean;
    referenceMetadata?: GeminiImageReferenceMetadata[];
    references?: string[];
    size?: string;
    sequential?: 'disabled' | 'auto';
    count?: number;
    entityType?: string;
    entityId?: string;
    fileRole?: string;
    projectId?: string;
    episodeId?: string;
    sourcePage?: string;
    sourceItemId?: string;
}

interface DoubaoResponse {
    files?: Array<{
        file_url?: string;
        data_url?: string;
        file_id?: string;
    }>;
    images?: string[];
}

export interface ImageGenerationCapability {
    available: boolean;
    reason: string;
}

export interface ImageGenerationCapabilities {
    models: Partial<Record<'doubao' | 'doubao_pro' | 'gpt_image_vip' | 'gpt_image_official', ImageGenerationCapability>>;
    seedance_portrait: ImageGenerationCapability;
}

export async function fetchImageGenerationCapabilities(): Promise<ImageGenerationCapabilities> {
    return apiJson<ImageGenerationCapabilities>('/api/ai/image-generation-capabilities', {
        method: 'GET',
    }, '图像模型可用性');
}

export const generateDoubaoImages = async (options: DoubaoGenerationOptions): Promise<GeneratedFileResult[]> => {
    const data = await apiJson<DoubaoResponse>('/api/materials/doubao', {
        method: 'POST',
        body: JSON.stringify({
            prompt: options.prompt,
            model: options.model,
            model_scope: options.modelScope,
            seedance_portrait: options.seedancePortrait || false,
            reference_metadata: options.referenceMetadata || [],
            references: options.references || [],
            size: options.size || '2K',
            sequential: options.sequential || 'disabled',
            count: options.count || 1,
            entity_type: options.entityType,
            entity_id: options.entityId,
            file_role: options.fileRole,
            project_id: options.projectId,
            episode_id: options.episodeId,
            source_page: options.sourcePage,
            source_item_id: options.sourceItemId,
        })
    }, '豆包图像生成').catch(error => {
        if (error?.status === 504) {
            error.message = '生图等待超时，暂未取得结果。请先查看生成历史，勿连续重复提交。';
        }
        throw error;
    });

    if (data.files && data.files.length > 0) {
        return data.files.map((f: any) => ({
            url: f.file_url || f.data_url,
            fileId: f.file_id,
            fileUrl: f.file_url,
        }));
    }
    if (!data.images || data.images.length === 0) {
        throw new Error('图像生成失败，未返回任何图片');
    }
    return data.images.map((img: string) => ({ url: img }));
};
