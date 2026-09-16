import type { Material } from '../types';
import type { UploadedImage, TaskGroup, MergedCardSnapshot } from '../services/videoTaskTypes';
import type { SeedanceAssetCandidate } from './seedanceMedia';
import { registeredImageFileId, removeMediaInput } from './seedanceMedia';
import type { SeedanceParams } from '../services/videoModelService';

export function getVideoCardSourceImage(
  group: Pick<TaskGroup, 'ids' | 'sourceImageOverrides'>, id: string, uploadedImages: UploadedImage[],
): UploadedImage | undefined {
  const original = uploadedImages.find(image => image.id === id);
  const override = group.sourceImageOverrides?.[id];
  if (override !== null) return override || original;
  return original && { ...original, url: '', storageUrl: undefined, fileId: undefined,
    comfyuiFilename: undefined, filename: '', isPlaceholder: true, isUploading: false,
    uploadFailed: false, uploadProgress: undefined };
}

/** Frame roles and storyboard ids stay in place, including after a later split. */
export function withVideoCardSourceImage(group: TaskGroup, id: string, image: UploadedImage | null): TaskGroup {
  const patch = <T extends Pick<TaskGroup, 'ids' | 'sourceImageOverrides'>>(card: T): T => card.ids.includes(id)
    ? { ...card, sourceImageOverrides: { ...card.sourceImageOverrides, [id]: image } } : card;
  return { ...patch(group), mergedFrom: group.mergedFrom?.map(patch), firstLastFrom: group.firstLastFrom?.map(patch) };
}

/** Remove only this original's inputs, keeping other media and their mention numbering intact. */
export function removeVideoImageReferences<T extends Pick<SeedanceParams, 'prompt'> & Partial<Pick<SeedanceParams, 'media_inputs'>>>(
  params: T, image: UploadedImage,
): T {
  const urls = new Set([image.url, image.storageUrl].filter(Boolean));
  const fileId = image.fileId || registeredImageFileId(image.storageUrl || image.url);
  let next = params;
  for (let index = (params.media_inputs || []).length - 1; index >= 0; index--) {
    const media = next.media_inputs![index];
    if (media.kind !== 'image' || !(urls.has(media.url)
      || (fileId && (media.file_id || registeredImageFileId(media.url)) === fileId))) continue;
    const removed = removeMediaInput({ sub_model: 'mini', ...next, media_inputs: next.media_inputs || [] }, index);
    next = { ...next, prompt: removed.prompt, media_inputs: removed.media_inputs };
  }
  // A deliberate refill of this slot may add the original again; automatic reload cannot.
  if ('reference_pool_keys' in next && Array.isArray(next.reference_pool_keys)) {
    next = { ...next, reference_pool_keys: next.reference_pool_keys.filter(key => key !== fileId && !urls.has(key)) };
  }
  return next;
}

export function removeVideoCardImage(group: TaskGroup, image: UploadedImage): TaskGroup {
  const removed = group.ids.includes(image.id) ? withVideoCardSourceImage(group, image.id, null) : group;
  const cleanSnapshot = (snapshot: MergedCardSnapshot): MergedCardSnapshot => {
    const refs = removeVideoImageReferences({ prompt: snapshot.prompt,
      media_inputs: snapshot.mediaInputs || snapshot.seedanceParams?.media_inputs || snapshot.dashScopeParams?.media_inputs || [] }, image);
    return { ...snapshot, prompt: refs.prompt, mediaInputs: refs.media_inputs,
      h3ReferenceContent: snapshot.h3ReferenceContent && removeVideoImageReferences(snapshot.h3ReferenceContent, image),
      candidateImages: snapshot.candidateImages?.filter(candidate => candidate.id !== image.id),
      seedanceParams: snapshot.seedanceParams && removeVideoImageReferences(snapshot.seedanceParams, image),
      dashScopeParams: snapshot.dashScopeParams && removeVideoImageReferences(snapshot.dashScopeParams, image) };
  };
  return { ...removed, candidateImages: group.candidateImages?.filter(candidate => candidate.id !== image.id),
    h3ReferenceContent: group.h3ReferenceContent && removeVideoImageReferences(group.h3ReferenceContent, image),
    mergedFrom: removed.mergedFrom?.map(cleanSnapshot), firstLastFrom: removed.firstLastFrom?.map(cleanSnapshot) };
}

/** Never persist an in-flight preview in place of a cleared original. */
export function persistVideoCardSources(group: TaskGroup): TaskGroup {
  const clean = <T extends Pick<TaskGroup, 'sourceImageOverrides'>>(card: T): T => !card.sourceImageOverrides ? card : {
    ...card, sourceImageOverrides: Object.fromEntries(Object.entries(card.sourceImageOverrides).map(([id, image]) => [id,
      image && (image.isUploading || image.uploadFailed || /^(blob:|data:)/.test(image.url)) ? null : image])),
  };
  return { ...clean(group), mergedFrom: group.mergedFrom?.map(clean), firstLastFrom: group.firstLastFrom?.map(clean) };
}

/** Pool images remain independent from storyboard membership. */
export function getVideoCardImages(group: TaskGroup, uploadedImages: UploadedImage[]): UploadedImage[] {
  const seen = new Set<string>();
  return [...group.ids.map(id => getVideoCardSourceImage(group, id, uploadedImages)).filter((image): image is UploadedImage => !!image),
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
