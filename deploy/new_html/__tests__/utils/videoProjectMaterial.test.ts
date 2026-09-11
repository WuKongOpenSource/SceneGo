import { describe, expect, it } from 'vitest';
import { applyVideoProjectMaterial, getVideoCardImages, withVideoCardCandidates } from '../../utils/videoProjectMaterial';
import { resolveVideoImageIdentifier } from '../../utils/videoImageIdentifier';
import type { Material } from '../../types';
import type { UploadedImage } from '../../services/videoTaskTypes';

const material: Material = { id: 'material', type: 'image', source: 'asset', timestamp: 0,
  fileId: 'file_original', url: '/api/files/file_original', thumbnail: '/thumb.jpg', name: '角色' };
const image: UploadedImage = { id: 'blank', url: '', filename: '空卡片', uploadTime: 1, isPlaceholder: true,
  linkedGroupUuids: ['card'], sortOrder: 3, comfyuiFilename: 'old.png' };

describe('video project material import', () => {
  it('keeps pool originals independent from shot membership and dedupes picker copies', () => {
    const base = { ...image, url: '/first.png', isPlaceholder: false };
    const extra = { ...image, id: 'candidate', url: '/second.png', isPlaceholder: false };
    const group = { uuid: 'card', ids: ['blank'], model: 'Seedance15' as const, candidateImages: [base, extra, extra] };
    const images = getVideoCardImages(group, [base]);
    expect(images.map(image => image.url)).toEqual(['/first.png', '/second.png']);
    expect(group.ids).toEqual(['blank']);
    expect(withVideoCardCandidates(images, [{ id: 'dup', kind: 'image', group: 'assets', label: 'same', url: '/second.png', thumbnailUrl: '/small.png' }])).toHaveLength(2);
  });
  it('keeps the target id and original bytes reference without mutating either source', () => {
    const result = applyVideoProjectMaterial(image, material);
    expect(result).toMatchObject({ id: 'blank', url: material.url, storageUrl: material.url,
      fileId: material.fileId, isPlaceholder: false, linkedGroupUuids: ['card'], sortOrder: 3 });
    expect(result.comfyuiFilename).toBeUndefined();
    expect(resolveVideoImageIdentifier(result, true)).toBe('file_original');
    expect(image.url).toBe('');
    expect(material.thumbnail).toBe('/thumb.jpg');
  });
  it.each(['', 'blob:preview', 'data:image/png;base64,abc'])('rejects a missing original even if a thumbnail exists (%s)', url => {
    expect(() => applyVideoProjectMaterial(image, { ...material, url })).toThrow('原图地址');
  });
  it('does not replace an image or an ongoing upload', () => {
    expect(() => applyVideoProjectMaterial({ ...image, isPlaceholder: false, url: '/different.png' }, material)).toThrow('已有图片');
    expect(() => applyVideoProjectMaterial({ ...image, isUploading: true }, material)).toThrow('已有图片');
  });
  it('allows retrying the same selection after a save failure', () => {
    const filled = applyVideoProjectMaterial(image, material);
    expect(applyVideoProjectMaterial(filled, material)).toEqual(filled);
  });
});
