import type { Material } from '../types';
import type { UploadedImage } from '../services/videoTaskTypes';

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
