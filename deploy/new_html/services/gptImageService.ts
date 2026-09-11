















import {
  recommendGptImageSize,
  type GptImageRatio,
  type GptImageK,
} from '../utils/gptImageSizeMap';
import { apiJson } from './httpClient';
import type { GeminiImageReferenceMetadata } from './geminiImageService';

export type GptImageTier = 'vip' | 'official';
export type GptImageQuality = 'auto' | 'low' | 'medium' | 'high';

export interface GenerateGptImageOptions {
  tier: GptImageTier;
  prompt: string;
  referenceMetadata?: GeminiImageReferenceMetadata[];
  references?: string[];
  ratio?: GptImageRatio;
  k?: GptImageK;
  quality?: GptImageQuality;
  n?: number;
  entityType?: string;
  entityId?: string;
  fileRole?: string;
  projectId?: string;
  episodeId?: string;
  sourcePage?: string;
  sourceItemId?: string;
}

export interface GptImageResult {
  data_url?: string | null;
  url?: string | null;
  file_id?: string | null;
  file_url?: string | null;
}

export interface GenerateGptImageResponse {
  success: boolean;
  images: string[];
  files: GptImageResult[];
  model: string;
  tier: GptImageTier;
}

export async function generateGptImage(
  opts: GenerateGptImageOptions
): Promise<GenerateGptImageResponse> {
  if (!opts.prompt || !opts.prompt.trim()) {
    throw new Error('prompt 不能为空');
  }
  if (opts.tier !== 'vip' && opts.tier !== 'official') {
    throw new Error(`不支持的 tier: ${opts.tier}（应为 vip|official）`);
  }

  const ratio: GptImageRatio = opts.ratio ?? 'auto';
  const k: GptImageK = opts.k ?? 'auto';
  const size = recommendGptImageSize(ratio, k);
  const quality: GptImageQuality = opts.quality ?? 'auto';
  const n = Math.max(1, Math.min(4, opts.n ?? 1));

  const body = {
    tier: opts.tier,
    prompt: opts.prompt,
    reference_metadata: opts.referenceMetadata ?? [],
    references: opts.references ?? [],
    size,
    quality,
    n,
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    file_role: opts.fileRole,
    project_id: opts.projectId,
    episode_id: opts.episodeId,
    source_page: opts.sourcePage,
    source_item_id: opts.sourceItemId,
  };

  const data = await apiJson<GenerateGptImageResponse>('/api/gpt-image/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  }, 'GPT Image 生成');

  if (!data || !Array.isArray(data.images) || data.images.length === 0) {
    throw new Error('GPT Image 未返回图片');
  }
  return data;
}
