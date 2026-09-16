import { describe, expect, it } from 'vitest';
import { applyVideoProjectMaterial, getVideoCardImages, getVideoCardSourceImage, withVideoCardSourceImage, removeVideoCardImage, removeVideoImageReferences, persistVideoCardSources, withVideoCardCandidates } from '../../utils/videoProjectMaterial';
import { importStoryboardIntoWorkspace } from '../../services/videoWorkspaceService';
import { resolveVideoImageIdentifier } from '../../utils/videoImageIdentifier';
import type { Material } from '../../types';
import type { UploadedImage } from '../../services/videoTaskTypes';

const material: Material = { id: 'material', type: 'image', source: 'asset', timestamp: 0,
  fileId: 'file_original', url: '/api/files/file_original', thumbnail: '/thumb.jpg', name: '角色' };
const image: UploadedImage = { id: 'blank', url: '', filename: '空卡片', uploadTime: 1, isPlaceholder: true,
  linkedGroupUuids: ['card'], sortOrder: 3, comfyuiFilename: 'old.png' };

describe('video project material import', () => {
  it('removes a merged anchor locally, survives serialization and split, and never deletes the original', () => {
    const original = { ...image, id: 'first', url: '/api/files/file_first/download', storageUrl: '/api/files/file_first/download', fileId: 'file_first', comfyuiFilename: 'first.png', isPlaceholder: false };
    const group = { uuid: 'card', ids: ['first', 'last'], model: 'Seedance2Mini' as const, duration: 10,
      mergedFrom: [{ uuid: 'child', ids: ['first'], model: 'Seedance2Mini' as const, prompt: '动作图片1',
        mediaInputs: [{ kind: 'image' as const, url: original.url }] }] };
    const removed = JSON.parse(JSON.stringify(removeVideoCardImage(group, original)));
    expect(removed.ids).toEqual(group.ids);
    expect(removed.duration).toBe(10);
    expect(removed.mergedFrom[0].prompt).toBe('动作');
    expect(removed.mergedFrom[0].mediaInputs).toEqual([]);
    for (const card of [removed, removed.mergedFrom[0]]) {
      const empty = getVideoCardSourceImage(card, 'first', [original])!;
      expect(empty).toMatchObject({ id: 'first', url: '', isPlaceholder: true });
      expect(empty.fileId).toBeUndefined();
      expect(resolveVideoImageIdentifier(empty, false)).toBe('');
      expect(resolveVideoImageIdentifier(empty, true)).toBe('');
    }
    expect(getVideoCardSourceImage(group, 'first', [original])).toBe(original);
    const refilled = withVideoCardSourceImage(removed, 'first', applyVideoProjectMaterial(getVideoCardSourceImage(removed, 'first', [original])!, material));
    expect(getVideoCardImages(refilled, [original])[0].url).toBe(material.url);
    expect(original.url).toBe('/api/files/file_first/download');
    const uploading = withVideoCardSourceImage(removed, 'first', { ...original, url: 'blob:temporary', isUploading: true });
    expect(persistVideoCardSources(uploading).sourceImageOverrides?.first).toBeNull();
    expect(persistVideoCardSources(uploading).mergedFrom?.[0].sourceImageOverrides?.first).toBeNull();
  });
  it('removes all equivalent image references and renumbers only image tokens, keeping audio/video and params', () => {
    const params = { model: 'HappyHorse' as const, prompt: '图片1 图片2 图片3 视频1 音频1', media_inputs: [
      { kind: 'image' as const, url: '/api/files/file_original/download?token=old' },
      { kind: 'audio' as const, url: '/audio.mp3' }, { kind: 'image' as const, url: '/other.png' },
      { kind: 'image' as const, url: '/alias.png', file_id: 'file_original' }, { kind: 'video' as const, url: '/video.mp4' },
    ] };
    const removed = removeVideoImageReferences(params, { ...image, url: '/api/files/file_original/download', fileId: 'file_original' });
    expect(removed.prompt).toBe(' 图片1  视频1 音频1');
    expect(removed.media_inputs).toEqual([params.media_inputs[1], params.media_inputs[2], params.media_inputs[4]]);
    expect(removed.model).toBe('HappyHorse');
    expect(params.media_inputs).toHaveLength(5);
  });
  it('does not resurrect removed images during storyboard re-import or promote a tail to first frame', () => {
    const session = { task_groups: [{ uuid: 'pair', ids: ['sb_first', 'sb_last'], model: 'Seedance15' as const, sourceImageOverrides: { sb_first: null } }],
      uploaded_images: [{ ...image, id: 'sb_first', url: '/first.png', isPlaceholder: false }, { ...image, id: 'sb_last', url: '/last.png', isPlaceholder: false }],
      image_prompts: {}, tasks_status: {}, seedance_params: { pair: { sub_model: 'agent_plan' as const, prompt: '动作',
        media_inputs: [{ kind: 'image' as const, url: '/last.png', role: 'last_frame' as const }] } } };
    const imported = importStoryboardIntoWorkspace(session, { ...session, uploaded_images: session.uploaded_images.map(img => ({ ...img, storyboardItemId: img.id })) });
    expect(imported.seedance_params?.pair.media_inputs).toEqual(session.seedance_params.pair.media_inputs);
    expect(getVideoCardImages(imported.task_groups[0], imported.uploaded_images)[0].isPlaceholder).toBe(true);
  });
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
