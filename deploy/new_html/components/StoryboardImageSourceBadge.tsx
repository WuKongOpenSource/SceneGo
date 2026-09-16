import React from 'react';
import { ImageSourceBadgeOverlay } from './SeedreamSourceBadge';
import type { GeneratedImage } from '../types';
import { storyboardImageSourceLabel } from '../utils/storyboardImageSource';

export function StoryboardImageSourceBadge({ image }: { image: GeneratedImage }) {
  const fallbackLabel = /seedream|^doubao(?:_pro)?$/i.test(image.generationModel || '')
    ? undefined : storyboardImageSourceLabel(image);
  return <ImageSourceBadgeOverlay reference={image.fileId || image.url} fallbackLabel={fallbackLabel} />;
}
