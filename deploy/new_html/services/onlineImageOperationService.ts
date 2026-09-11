import { generateDoubaoImages, type GeneratedFileResult } from './doubaoService';

export type OnlineImageOperation = 'angle_adjustment' | 'upscale_hd' | 'remove_watermark';

export const ONLINE_IMAGE_OPERATION_MODEL = 'doubao-seedream-5-0-lite-260128';
export const ONLINE_IMAGE_OPERATION_BILLING_MODEL = 'image_tier_3';
export const ONLINE_IMAGE_OPERATION_LABEL = 'Doubao-Seedream-5.0-lite · 参考图生图模型';

export interface OnlineImageOperationOptions {
  operation: OnlineImageOperation;
  sourceImage: string;
  instruction?: string;
  entityType?: string;
  entityId?: string;
  fileRole?: string;
  projectId?: string;
  episodeId?: string;
}

export function onlineImageOperationResolution(operation: OnlineImageOperation): '2K' | '4K' {
  return operation === 'upscale_hd' ? '4K' : '2K';
}

export function buildOnlineImageOperationPrompt(
  operation: OnlineImageOperation,
  instruction?: string,
): string {
  const shared = [
    'Use the supplied image as the only visual reference.',
    'Preserve the subject identity, visual style, colors, materials, lighting, and all content that the instruction does not explicitly change.',
    'Return one clean full-frame image. Do not add text, logos, borders, or watermarks.',
  ];

  if (operation === 'angle_adjustment') {
    return [
      'Reconstruct the same scene from the requested camera angle and framing.',
      instruction?.trim() || 'Adjust the camera angle slightly while keeping the original composition recognizable.',
      ...shared,
      'Do not add or remove people, objects, or environmental elements.',
    ].join(' ');
  }

  if (operation === 'upscale_hd') {
    return [
      'Reconstruct the exact same image at high definition and 4K quality.',
      'Enhance edges, textures, and small details without cropping, reframing, restyling, or changing the composition.',
      ...shared,
    ].join(' ');
  }

  return [
    'For an image the user owns or is authorized to edit, remove visible watermark, logo, stamp, or overlay artifacts and reconstruct only the covered background.',
    ...shared,
    'Do not alter unrelated regions and do not introduce replacement text or branding.',
  ].join(' ');
}

/**
 * Online image operations deliberately share the public reference-image model.
 * Results are persisted by the existing image proxy, so callers only append the
 * returned file to their candidate list after a successful response.
 */
export async function runOnlineImageOperation(
  options: OnlineImageOperationOptions,
): Promise<GeneratedFileResult> {
  const sourceImage = options.sourceImage?.trim();
  if (!sourceImage) throw new Error('请先选择一张要处理的图片');

  const results = await generateDoubaoImages({
    prompt: buildOnlineImageOperationPrompt(options.operation, options.instruction),
    model: ONLINE_IMAGE_OPERATION_MODEL,
    references: [sourceImage],
    size: onlineImageOperationResolution(options.operation),
    sequential: 'disabled',
    count: 1,
    entityType: options.entityType,
    entityId: options.entityId,
    fileRole: options.fileRole,
    projectId: options.projectId,
    episodeId: options.episodeId,
  });

  const result = results[0];
  if (!result?.url) throw new Error('在线图片处理未返回结果');
  return result;
}
