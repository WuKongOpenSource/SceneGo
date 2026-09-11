import { describe, expect, it } from 'vitest';

import {
  calculateCoverCropRect,
  COVER_IMAGE_TARGET_HEIGHT,
  COVER_IMAGE_TARGET_WIDTH,
  prepareCoverUploadFile,
} from '../../utils/coverImage';

describe('coverImage utilities', () => {
  it('center-crops large images into the 16:9 cover ratio and shrinks uploads', () => {
    const crop = calculateCoverCropRect(4000, 3000);

    expect(crop.sourceX).toBeCloseTo(0);
    expect(crop.sourceY).toBeCloseTo(375);
    expect(crop.sourceWidth).toBeCloseTo(4000);
    expect(crop.sourceHeight).toBeCloseTo(2250);
    expect(crop.outputWidth).toBe(COVER_IMAGE_TARGET_WIDTH);
    expect(crop.outputHeight).toBe(COVER_IMAGE_TARGET_HEIGHT);
  });

  it('center-crops tall images without stretching the cover', () => {
    const crop = calculateCoverCropRect(1000, 2000);

    expect(crop.sourceX).toBeCloseTo(0);
    expect(crop.sourceY).toBeCloseTo(718.75);
    expect(crop.sourceWidth).toBeCloseTo(1000);
    expect(crop.sourceHeight).toBeCloseTo(562.5);
    expect(crop.outputWidth).toBe(COVER_IMAGE_TARGET_WIDTH);
    expect(crop.outputHeight).toBe(COVER_IMAGE_TARGET_HEIGHT);
  });

  it('does not upscale already-small cover images', () => {
    const crop = calculateCoverCropRect(320, 240);

    expect(crop.sourceWidth).toBeCloseTo(320);
    expect(crop.sourceHeight).toBeCloseTo(180);
    expect(crop.outputWidth).toBe(320);
    expect(crop.outputHeight).toBe(180);
  });

  it('keeps svg cover files unchanged because they are already lightweight vectors', async () => {
    const file = new File(['<svg />'], 'cover.svg', { type: 'image/svg+xml' });

    await expect(prepareCoverUploadFile(file)).resolves.toBe(file);
  });
});
