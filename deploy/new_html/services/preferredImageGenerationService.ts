import { generateDoubaoImages, type DoubaoGenerationOptions } from './doubaoService';
import {
  generateGeminiImageVariant,
} from './geminiImageGenerationService';
import type {
  GeminiImageOptions,
  GeneratedFileResult,
} from './geminiImageService';

export const PREFERRED_IMAGE_MODEL = 'doubao-seedream-5-0-lite-260128';
export const PREFERRED_IMAGE_BILLING_MODEL = 'image_tier_3';
export const IMAGE_FALLBACK_MODEL = 'gemini-3-pro-image-preview';
export const IMAGE_FALLBACK_BILLING_MODEL = 'image_tier_2';
export const IMAGE_FALLBACK_REASON = 'preferred_provider_unavailable';

export interface PreferredImageGenerationResult {
  files: GeneratedFileResult[];
  actualEngine: 'doubao' | 'nanobanana';
  actualModel: string;
  actualBillingModel: string;
  fallbackReason?: typeof IMAGE_FALLBACK_REASON;
}

export function isPreferredImageFallbackEligible(error: unknown): boolean {
  return Number((error as { status?: unknown } | null)?.status) === 503;
}

export function imageEngineForModel(model: string): 'doubao' | 'nanobanana' {
  return model.startsWith('doubao-seedream') ? 'doubao' : 'nanobanana';
}

export async function generateImageWithPreferredFallback(options: {
  engine: 'doubao' | 'nanobanana';
  model: string;
  billingModel: string;
  count?: number;
  allowFallback?: boolean;
  doubao: Omit<DoubaoGenerationOptions, 'model' | 'count'>;
  gemini: Omit<GeminiImageOptions, 'model'>;
}): Promise<PreferredImageGenerationResult> {
  if (options.engine === 'nanobanana') {
    return {
      files: await generateGeminiImageVariant({ ...options.gemini, model: options.model }),
      actualEngine: 'nanobanana',
      actualModel: options.model,
      actualBillingModel: options.billingModel,
    };
  }

  const count = Math.max(1, Math.round(options.count || 1));
  try {
    return {
      files: await generateDoubaoImages({ ...options.doubao, model: options.model, count }),
      actualEngine: 'doubao',
      actualModel: options.model,
      actualBillingModel: options.billingModel,
    };
  } catch (error) {
    const references = options.gemini.references || [];
    const fallbackAllowed = options.allowFallback !== false
      && options.model === PREFERRED_IMAGE_MODEL
      && !options.doubao.seedancePortrait
      && references.length <= 6
      && isPreferredImageFallbackEligible(error);
    if (!fallbackAllowed) throw error;

    const files: GeneratedFileResult[] = [];
    for (let index = 0; index < count; index += 1) {
      const generated = await generateGeminiImageVariant({
        ...options.gemini,
        model: IMAGE_FALLBACK_MODEL,
      });
      files.push(...generated.slice(0, 1));
    }
    if (!files.length) throw new Error('备用图像模型未返回有效图片');
    return {
      files,
      actualEngine: 'nanobanana',
      actualModel: IMAGE_FALLBACK_MODEL,
      actualBillingModel: IMAGE_FALLBACK_BILLING_MODEL,
      fallbackReason: IMAGE_FALLBACK_REASON,
    };
  }
}
