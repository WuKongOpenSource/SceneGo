import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDoubaoImages } from '../../services/doubaoService';
import {
  buildOnlineImageOperationPrompt,
  ONLINE_IMAGE_OPERATION_MODEL,
  runOnlineImageOperation,
} from '../../services/onlineImageOperationService';

vi.mock('../../services/doubaoService', () => ({
  generateDoubaoImages: vi.fn(),
}));

const generateMock = vi.mocked(generateDoubaoImages);

describe('onlineImageOperationService', () => {
  beforeEach(() => {
    generateMock.mockReset();
  });

  it('keeps identity and content while applying the requested camera instruction', () => {
    const prompt = buildOnlineImageOperationPrompt('angle_adjustment', 'Rotate camera 45 degrees to the right.');

    expect(prompt).toContain('Rotate camera 45 degrees to the right.');
    expect(prompt).toContain('Preserve the subject identity');
    expect(prompt).toContain('Do not add or remove people, objects');
  });

  it('uses the public reference-image model and persists a 4K upscale result', async () => {
    generateMock.mockResolvedValue([{ url: '/files/upscaled.png', fileId: 'file-1' }]);

    const result = await runOnlineImageOperation({
      operation: 'upscale_hd',
      sourceImage: '/files/source.png',
      entityType: 'asset',
      entityId: 'asset-1',
      fileRole: 'reference_image',
      projectId: 'project-1',
      episodeId: 'episode-1',
    });

    expect(result).toEqual({ url: '/files/upscaled.png', fileId: 'file-1' });
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({
      model: ONLINE_IMAGE_OPERATION_MODEL,
      references: ['/files/source.png'],
      size: '4K',
      sequential: 'disabled',
      count: 1,
      entityType: 'asset',
      entityId: 'asset-1',
      fileRole: 'reference_image',
      projectId: 'project-1',
      episodeId: 'episode-1',
    }));
  });

  it('limits watermark cleanup to authorized images and does not add replacement branding', async () => {
    generateMock.mockResolvedValue([{ url: '/files/clean.png' }]);

    await runOnlineImageOperation({
      operation: 'remove_watermark',
      sourceImage: '/files/source.png',
    });

    const options = generateMock.mock.calls[0][0];
    expect(options.size).toBe('2K');
    expect(options.prompt).toContain('owns or is authorized to edit');
    expect(options.prompt.toLowerCase()).toContain('do not introduce replacement text or branding');
  });

  it('rejects an empty source before calling the provider', async () => {
    await expect(runOnlineImageOperation({
      operation: 'angle_adjustment',
      sourceImage: '   ',
    })).rejects.toThrow('请先选择一张要处理的图片');
    expect(generateMock).not.toHaveBeenCalled();
  });
});
