import type { Material } from '../types';
import type { UploadedImage, TaskGroup } from '../services/videoTaskTypes';
import type { SeedanceAssetCandidate } from './seedanceMedia';
import { registeredImageFileId } from './seedanceMedia';
import type { SeedanceParams } from '../services/videoModelService';

/** Pool images remain independent from storyboard membership. */
export function getVideoCardImages(group: TaskGroup, uploadedImages: UploadedImage[]): UploadedImage[] {
  const seen = new Set<string>();
  return [...group.ids.map(id => uploadedImages.find(image => image.id === id)).filter((image): image is UploadedImage => !!image),
    ...(group.candidateImages || [])].filter(image => {
      const key = image.storageUrl || image.url || image.id;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
}

/** Add new pool originals once without reordering mentions or resurrecting removed references. */
export function includeVideoCardReferences(params: SeedanceParams, images: UploadedImage[]): SeedanceParams {
  if (params.sub_model === 'agent_plan' || params.reference_mode === 'first_last'
    || (!params.reference_mode && params.media_inputs.some(item => item.role === 'first_frame' || item.role === 'last_frame'))) return params;
  const keys = new Set(params.reference_pool_keys || []);
  const inputs = [...params.media_inputs];
  for (const image of images) {
    const url = image.storageUrl || image.url;
    if (!url || image.isPlaceholder || image.isUploading || image.uploadFailed || /^(blob:|data:)/.test(url)) continue;
    const fileId = image.fileId || registeredImageFileId(url);
    const key = fileId || url;
    if (keys.has(key)) continue;
    keys.add(key);
    if (!inputs.some(item => item.kind === 'image' && (item.url === url || (fileId && (item.file_id || registeredImageFileId(item.url)) === fileId)))) {
      inputs.push({ kind: 'image', url, role: 'reference_image', ...(fileId ? { file_id: fileId } : {}) });
    }
  }
  // Never silently truncate an over-limit pool; the composer and submit validation explain it.
  if (keys.size === (params.reference_pool_keys || []).length) return params;
  return { ...params, reference_pool_keys: [...keys], media_inputs: inputs };
}

export function withVideoCardCandidates(images: UploadedImage[], candidates: SeedanceAssetCandidate[]): SeedanceAssetCandidate[] {
  const seen = new Set<string>();
  return [...images.filter(image => !!(image.storageUrl || image.url)).map((image, index) => ({
    id: `card-pool:${image.id}`, group: 'current_card' as const, kind: 'image' as const,
    label: `画面${index + 1} · ${image.filename || '图片'}`, url: image.storageUrl || image.url,
    thumbnailUrl: image.storageUrl || image.url,
    fileId: image.fileId,
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
