import type { GenerationReference, StoryboardItem } from '../types';

export const SEEDREAM_PRO_MODEL = 'doubao-seedream-5-0-pro-260628';
export const SEEDREAM_LITE_MODEL = 'doubao-seedream-5-0-lite-260128';

export function isSeedreamStoryboardModel(model: string): boolean {
  return model === 'doubao' || model === 'doubao_pro';
}

export function storyboardSubmissionReferences(
  shot: StoryboardItem,
  references: GenerationReference[],
  portraitMode: boolean,
): GenerationReference[] {
  if (portraitMode) return [];
  if (references.length) return [...references];
  const generated = shot.selectedImageId
    ? shot.generatedImages?.find(image => image.id === shot.selectedImageId)
    : shot.generatedImages?.[0];
  const url = generated?.url || shot.generatedImage;
  return url ? [{ id: `current-result:${shot.id}`, url, type: 'effect', name: '当前分镜结果', source: 'manual' }] : [];
}

export function seedreamTextOnlyPrompt(prompt: string, references: GenerationReference[]): string {
  const descriptions = references.filter(reference => reference.description?.trim())
    .map(reference => `【${reference.name || '素材'}】${reference.description!.trim()}`);
  return [prompt, descriptions.length ? `文字素材设定（未附图片）：\n${descriptions.join('\n')}` : '']
    .filter(Boolean).join('\n\n');
}
