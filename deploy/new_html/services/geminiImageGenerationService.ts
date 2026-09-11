import { generateGeminiImageViaProxy, GeminiImageOptions, GeneratedFileResult } from './geminiImageService';
import type { GeminiImageReferenceMetadata } from './geminiImageService';

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

export const generateGeminiImageVariant = async (options: GeminiImageOptions): Promise<GeneratedFileResult[]> => {
    return generateGeminiImageViaProxy(options);
};

export const generateMaterialImage = async (
    name: string,
    type: 'character' | 'scene',
    context: string,
): Promise<string> => {
    const prompt = `
        Generate a high quality reference image for a ${type} named "${name}".

        Context/Description from script:
        "${context}"

        Visual style rule: Follow the style explicitly requested in the context. Do not substitute a different default style. Keep the result high detail and suitable for a character sheet or environment reference.
    `;
    const results = await generateGeminiImageVariant({
        prompt,
        aspectRatio: '1:1',
        imageSize: '2K',
    });
    return results[0].url;
};

export const generateFinalIllustration = async (
    prompt: string,
    referenceImages: string[],
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; projectId?: string; episodeId?: string; sourcePage?: string; sourceItemId?: string },
    imageOptions?: { aspectRatio?: string; imageSize?: '1K' | '2K' | '4K' },
    referenceMetadata?: GeminiImageReferenceMetadata[],
): Promise<string> => {
    const result = await generateFinalIllustrationResult(prompt, referenceImages, entityOptions, imageOptions, referenceMetadata);
    return result.url;
};

export const generateFinalIllustrationResult = async (
    prompt: string,
    referenceImages: string[],
    entityOptions?: { entityType?: string; entityId?: string; fileRole?: string; projectId?: string; episodeId?: string; sourcePage?: string; sourceItemId?: string },
    imageOptions?: { aspectRatio?: string; imageSize?: '1K' | '2K' | '4K' },
    referenceMetadata?: GeminiImageReferenceMetadata[],
): Promise<GeneratedFileResult> => {
    return callWithRetry(async () => {
        const results = await generateGeminiImageVariant({
            // The storyboard's public `nanobanana` option is the stable alias
            // for Gemini 3.1 Flash Image Preview. Sending it explicitly also
            // lets task notifications retain the selected model/version.
            model: 'nanobanana',
            prompt,
            references: referenceImages,
            referenceMetadata,
            aspectRatio: imageOptions?.aspectRatio ?? '16:9',
            imageSize: imageOptions?.imageSize ?? '2K',
            entityType: entityOptions?.entityType,
            entityId: entityOptions?.entityId,
            fileRole: entityOptions?.fileRole,
            projectId: entityOptions?.projectId,
            episodeId: entityOptions?.episodeId,
            sourcePage: entityOptions?.sourcePage,
            sourceItemId: entityOptions?.sourceItemId,
        });

        if (!results || results.length === 0) {
            throw new Error("No image generated");
        }

        return results[0];
    });
};
