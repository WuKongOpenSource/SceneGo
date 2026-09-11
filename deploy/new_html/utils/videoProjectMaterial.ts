import type { Material } from '../types';
import type { UploadedImage, TaskGroup } from '../services/videoTaskTypes';
import type { SeedanceAssetCandidate } from './seedanceMedia';

/** Candidate images are not storyboard members or automatically submitted inputs. */
export function getVideoCardImages(group: TaskGroup, uploadedImages: UploadedImage[]): UploadedImage[] {
  const seen = new Set<string>();
  return [...group.ids.map(id => uploadedImages.find(image => image.id === id)).filter((image): image is UploadedImage => !!image),
    ...(group.candidateImages || [])].filter(image => {
      const key = image.storageUrl || image.url || image.id;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
}

export function withVideoCardCandidates(images: UploadedImage[], candidates: SeedanceAssetCandidate[]): SeedanceAssetCandidate[] {
  const seen = new Set<string>();
  return [...images.filter(image => !!(image.storageUrl || image.url)).map((image, index) => ({
    id: `card-pool:${image.id}`, group: 'current_card' as const, kind: 'image' as const,
    label: `画面${index + 1} · ${image.filename || '图片'}`, url: image.storageUrl || image.url,
    thumbnailUrl: image.storageUrl || image.url,
  })), ...candidates].filter(item => {
    const key = item.kind === 'text' ? item.id : `${item.kind}:${item.url || item.id}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

/** Fill the existing placeholder id so ordering, prompts and card ownership stay intact. */
export function applyVideoProjectMaterial(image: UploadedImage, material: Material): UploadedImage {
  const url = material.url?.trim();
  if (!url || (!url.startsWith('/') && !/^https?:\/\//i.test(url))) {
    throw new Error('素材缺少可用原图地址，请重新上传或选择其他素材。');
  }
  if (image.isUploading || (!image.isPlaceholder && image.url && image.url !== url)) {
    throw new Error('当前卡片已有图片，请先清空图片再选择项目素材。');
  }
  return {
    ...image,
    url,
    storageUrl: url,
    fileId: material.fileId,
    filename: material.name || '项目素材',
    comfyuiFilename: undefined,
    isPlaceholder: false,
    isUploading: false,
    uploadFailed: false,
    uploadProgress: undefined,
  };
}
