import type { GeneratedImage, StoryboardItem } from '../types';

export const STORYBOARD_IMAGE_DRAG_MIME = 'application/x-ostory-storyboard-image';

interface StoryboardImageDragPayload {
  sourceShotId: string;
  imageId: string;
  imageUrl: string;
}

export interface ResolvedStoryboardImageDrag {
  sourceShotId: string;
  image: GeneratedImage;
}

export function serializeStoryboardImageDrag(
  sourceShotId: string,
  image: GeneratedImage,
): string {
  return JSON.stringify({
    sourceShotId,
    imageId: image.id,
    imageUrl: image.url,
  } satisfies StoryboardImageDragPayload);
}

export function resolveStoryboardImageDrag(
  rawPayload: string,
  storyboardItems: StoryboardItem[],
  fallbackUrl = '',
): ResolvedStoryboardImageDrag | null {
  let payload: StoryboardImageDragPayload | null = null;

  if (rawPayload) {
    try {
      const parsed = JSON.parse(rawPayload) as Partial<StoryboardImageDragPayload>;
      if (
        typeof parsed.sourceShotId === 'string'
        && typeof parsed.imageId === 'string'
        && typeof parsed.imageUrl === 'string'
      ) {
        payload = parsed as StoryboardImageDragPayload;
      }
    } catch {
      payload = null;
    }
  }

  if (payload) {
    const sourceShot = storyboardItems.find((item) => item.id === payload.sourceShotId);
    const image = sourceShot?.generatedImages?.find((candidate) => (
      candidate.id === payload.imageId || candidate.url === payload.imageUrl
    ));
    if (sourceShot && image) {
      return { sourceShotId: sourceShot.id, image };
    }
  }

  const imageUrl = fallbackUrl || payload?.imageUrl || '';
  if (!imageUrl) return null;

  for (const sourceShot of storyboardItems) {
    const image = sourceShot.generatedImages?.find((candidate) => candidate.url === imageUrl);
    if (image) return { sourceShotId: sourceShot.id, image };
  }

  return null;
}
