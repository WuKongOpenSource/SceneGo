import { describe, expect, it } from 'vitest';
import { fitAngleOutputDimensions } from '../../utils/angleOutputSize';

describe('fitAngleOutputDimensions', () => {
  it('preserves a 16:9 source within the GPU maximum edge', () => {
    expect(fitAngleOutputDimensions({ width: 1920, height: 1080 })).toEqual({
      width: 1024,
      height: 576,
    });
  });

  it('preserves portrait orientation', () => {
    expect(fitAngleOutputDimensions({ width: 1080, height: 1920 })).toEqual({
      width: 576,
      height: 1024,
    });
  });

  it('uses the storyboard 16:9 default when the image cannot be probed', () => {
    expect(fitAngleOutputDimensions(null)).toEqual({
      width: 1024,
      height: 576,
    });
  });
});
