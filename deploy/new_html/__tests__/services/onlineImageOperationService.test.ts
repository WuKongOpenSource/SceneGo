import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDoubaoImages } from '../../services/doubaoService';
import { buildHorizontalCameraOrbitInstruction, CAMERA_VIEWPOINT_GUARD } from '../../utils/cameraAnglePrompt';
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
    expect(prompt).toContain(CAMERA_VIEWPOINT_GUARD);
  });

  it.each([-90, -45, 0, 45, 90])('submits the original reference and guarded %s degree instruction', async angle => {
    generateMock.mockResolvedValue([{ url: '/files/new-angle.png', fileId: 'new-angle' }]);
    const instruction = buildHorizontalCameraOrbitInstruction(angle);
    await runOnlineImageOperation({
      operation: 'angle_adjustment', sourceImage: '/files/original.png', instruction,
      entityType: 'asset', entityId: 'asset-1', fileRole: 'reference_image',
      projectId: 'project-1', episodeId: 'episode-1',
    });
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({
      model: ONLINE_IMAGE_OPERATION_MODEL, references: ['/files/original.png'],
      entityType: 'asset', entityId: 'asset-1', fileRole: 'reference_image',
      projectId: 'project-1', episodeId: 'episode-1', count: 1, size: '2K', sequential: 'disabled',
    }));
    const prompt = generateMock.mock.calls[0][0].prompt;
    expect(prompt).toContain(CAMERA_VIEWPOINT_GUARD);
    if (angle) expect(prompt).toContain(instruction);
  });

  it('does not impose camera-motion instructions on upscale or watermark removal', () => {
    for (const operation of ['upscale_hd', 'remove_watermark'] as const) {
      expect(buildOnlineImageOperationPrompt(operation)).not.toContain(CAMERA_VIEWPOINT_GUARD);
    }
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
