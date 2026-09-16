import type { SeedanceParams } from '../services/videoModelService';
import type { TaskGroup, UploadedImage } from '../services/videoTaskTypes';
import { includeVideoCardReferences } from './videoProjectMaterial';

/** Reuse the image mention composer only; no Seedance provider settings are submitted. */
export type H3ReferenceContent = Pick<SeedanceParams, 'prompt' | 'media_inputs' | 'reference_pool_keys'>;
export const isH3Reference = (group: TaskGroup) => group.model === 'MiniMaxH3' && group.h3ReferenceMode === 'reference';

export function h3Composer(content: H3ReferenceContent | undefined, prompt: string, images: UploadedImage[]): SeedanceParams {
  return includeVideoCardReferences({ ...content, prompt: content?.prompt ?? prompt, media_inputs: content?.media_inputs ?? [],
    sub_model: 'standard', reference_mode: 'reference' }, images);
}

export function h3ReferenceSubmission(content: H3ReferenceContent): { prompt: string; images: string[] } {
  const media = content.media_inputs;
  if (!media.length || media.length > 9) throw new Error('H3 多图参考需要 1–9 张原图');
  const images = media.map((item, index) => {
    const reference = (item.file_id || item.url || '').trim();
    if (item.kind !== 'image' || !reference || /^(blob:|data:|asset:)/i.test(reference)) {
      throw new Error(`H3 图片${index + 1}缺少可用原图，请重新选择`);
    }
    return reference;
  });
  if (new Set(images).size !== images.length) throw new Error('H3 参考图片重复，请移除重复引用');
  const prompt = content.prompt.replace(/@?图片(\d+)/g, (_, raw) => {
    const index = Number(raw);
    if (index < 1 || index > images.length) throw new Error(`H3 图片${index}不存在，请重新关联图片`);
    return `<Picture ${index}>`;
  });
  for (const match of prompt.matchAll(/<Picture\s+(\d+)>/gi)) {
    if (Number(match[1]) < 1 || Number(match[1]) > images.length) throw new Error(`H3 图片${match[1]}不存在，请重新关联图片`);
  }
  return { prompt, images };
}
