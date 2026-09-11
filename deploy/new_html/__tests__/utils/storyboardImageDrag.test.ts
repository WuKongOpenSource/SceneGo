import { describe, expect, it } from 'vitest';
import type { GeneratedImage, StoryboardItem } from '../../types';
import {
  resolveStoryboardImageDrag,
  serializeStoryboardImageDrag,
} from '../../utils/storyboardImageDrag';

const sourceImage: GeneratedImage = {
  id: 'image-1',
  url: '/api/files/image-1.png',
  thumbnail: '/api/files/image-1-thumb.png',
  timestamp: 123,
  fileId: 'file-1',
  generationModel: 'gemini-2.5-flash-image',
};

const storyboardItems = [
  {
    id: 'shot-1',
    originalText: '',
    scriptSegment: '',
    generatedImages: [sourceImage],
  },
  {
    id: 'shot-2',
    originalText: '',
    scriptSegment: '',
  },
] as StoryboardItem[];

describe('storyboard image drag payload', () => {
  it('resolves the original image by source shot and image id', () => {
    const raw = serializeStoryboardImageDrag('shot-1', sourceImage);

    expect(resolveStoryboardImageDrag(raw, storyboardItems)).toEqual({
      sourceShotId: 'shot-1',
      image: sourceImage,
    });
  });

  it('falls back to the plain image URL when custom drag data is unavailable', () => {
    expect(resolveStoryboardImageDrag('', storyboardItems, sourceImage.url)).toEqual({
      sourceShotId: 'shot-1',
      image: sourceImage,
    });
  });

  it('rejects malformed or unknown drag data', () => {
    expect(resolveStoryboardImageDrag('{broken', storyboardItems)).toBeNull();
    expect(resolveStoryboardImageDrag('', storyboardItems, '/missing.png')).toBeNull();
  });
});
