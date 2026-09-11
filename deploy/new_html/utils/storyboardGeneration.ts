import type { GeneratedImage, StoryboardItem } from '../types';

export type StoryboardGenerationProgressMode = 'estimated' | 'live';

export interface StoryboardGenerationProgressState {
  startedAt: number;
  expectedSeconds: number;
  percent: number;
  etaSeconds: number | null;
  stage: string;
  mode: StoryboardGenerationProgressMode;
}

export interface OtherStoryboardImagePickerItem {
  key: string;
  shotId: string;
  shotLabel: string;
  imageId: string;
  url: string;
  thumbnail: string;
  fileId?: string | null;
  isSelected: boolean;
  imageLabel: string;
  searchText: string;
}

function formatStoryboardShotLabel(shot: StoryboardItem, index: number): string {
  const raw = String(shot.shotNumber || '').trim();
  if (raw) {
    if (/^镜头/i.test(raw)) return raw;
    if (/^\d+$/.test(raw)) return `镜头 ${raw.padStart(2, '0')}`;
    return raw;
  }
  return `镜头 ${String(index + 1).padStart(2, '0')}`;
}

export function buildOtherStoryboardImagePickerItems(
  shots: StoryboardItem[],
  currentShotId?: string | null,
): OtherStoryboardImagePickerItem[] {
  return shots.flatMap((shot, shotIndex) => {
    if (shot.id === currentShotId) return [];

    const candidates: GeneratedImage[] = [...(shot.generatedImages || [])];
    if (
      shot.generatedImage
      && !candidates.some(image => image.url === shot.generatedImage)
    ) {
      candidates.push({
        id: `legacy-${shot.id}`,
        url: shot.generatedImage,
        thumbnail: shot.generatedImage,
        timestamp: shot.timestamp || 0,
      });
    }

    const uniqueCandidates = candidates.filter((image, imageIndex, allImages) => {
      const url = image.url || image.thumbnail;
      if (!url) return false;
      return allImages.findIndex(candidate => (
        (candidate.fileId && image.fileId && candidate.fileId === image.fileId)
        || (candidate.url || candidate.thumbnail) === url
      )) === imageIndex;
    });
    if (uniqueCandidates.length === 0) return [];

    const selectedIndex = Math.max(
      0,
      uniqueCandidates.findIndex(image => image.id === shot.selectedImageId),
    );
    const orderedCandidates = [
      uniqueCandidates[selectedIndex],
      ...uniqueCandidates.filter((_, index) => index !== selectedIndex),
    ];
    const shotLabel = formatStoryboardShotLabel(shot, shotIndex);

    return orderedCandidates.map((image, imageIndex) => {
      const url = image.url || image.thumbnail || '';
      const isSelected = imageIndex === 0;
      const imageLabel = isSelected ? '当前采用图' : `候选图 ${imageIndex}`;
      return {
        key: `${shot.id}:${image.id || imageIndex}:${url}`,
        shotId: shot.id,
        shotLabel,
        imageId: image.id || `image-${imageIndex}`,
        url,
        thumbnail: image.thumbnail || url,
        fileId: image.fileId,
        isSelected,
        imageLabel,
        searchText: [
          shotLabel,
          imageLabel,
          shot.scriptSegment,
          shot.originalText,
          ...(shot.characters || []),
          shot.scene,
          ...(shot.props || []),
        ].filter(Boolean).join(' ').toLowerCase(),
      };
    });
  });
}

export function expectedStoryboardGenerationSeconds(model: string): number {
  if (model === 'nanobanana' || model === 'doubao') return 90;
  if (model === 'doubao_pro' || model === 'gpt_image_vip' || model === 'gpt_image_official') return 120;
  return 150;
}

export function createStoryboardGenerationProgress(
  model: string,
  startedAt = Date.now(),
  stage = '准备生成',
): StoryboardGenerationProgressState {
  const expectedSeconds = expectedStoryboardGenerationSeconds(model);
  return {
    startedAt,
    expectedSeconds,
    percent: 3,
    etaSeconds: expectedSeconds,
    stage,
    mode: 'estimated',
  };
}

export function estimateStoryboardGenerationProgress(
  state: StoryboardGenerationProgressState,
  now = Date.now(),
): StoryboardGenerationProgressState {
  if (state.mode === 'live') return state;

  const elapsedSeconds = Math.max(0, (now - state.startedAt) / 1000);
  const ratio = Math.min(1, elapsedSeconds / Math.max(1, state.expectedSeconds));
  const estimatedPercent = Math.round(3 + (85 * Math.pow(ratio, 0.7)));
  return {
    ...state,
    percent: Math.max(state.percent, Math.min(88, estimatedPercent)),
    etaSeconds: elapsedSeconds < state.expectedSeconds
      ? Math.max(0, Math.ceil(state.expectedSeconds - elapsedSeconds))
      : null,
  };
}

export function applyStoryboardProviderProgress(
  state: StoryboardGenerationProgressState,
  rawProgress: number,
  now = Date.now(),
  stage = '处理集群正在生成',
): StoryboardGenerationProgressState {
  const normalized = Math.max(0, Math.min(1, rawProgress > 1 ? rawProgress / 100 : rawProgress));
  const elapsedSeconds = Math.max(0, (now - state.startedAt) / 1000);
  const etaSeconds = normalized >= 0.03 && normalized < 1
    ? Math.max(0, Math.ceil(elapsedSeconds * (1 - normalized) / normalized))
    : state.etaSeconds;

  return {
    ...state,
    percent: Math.max(state.percent, Math.min(95, Math.round(normalized * 100))),
    etaSeconds,
    stage,
    mode: 'live',
  };
}

export function formatStoryboardGenerationEta(etaSeconds: number | null): string {
  if (etaSeconds === null) return '已超过常规耗时，仍在处理';
  if (etaSeconds <= 5) return '即将完成';
  if (etaSeconds < 60) return `预计剩余约 ${Math.ceil(etaSeconds / 5) * 5} 秒`;
  return `预计剩余约 ${Math.ceil(etaSeconds / 60)} 分钟`;
}

export function dedupeGeneratedImages(images: GeneratedImage[]): GeneratedImage[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    const key = image.fileId ? `file:${image.fileId}` : `url:${image.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveGenerationAttemptResults(
  initial: GeneratedImage[],
  retry?: GeneratedImage[],
): GeneratedImage[] {
  return dedupeGeneratedImages(retry?.length ? retry : initial);
}

export function runSingleFlight<T>(
  inFlight: Map<string, Promise<T>>,
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  let request: Promise<T>;
  try {
    request = factory();
  } catch (error) {
    return Promise.reject(error);
  }
  inFlight.set(key, request);
  return request.finally(() => {
    if (inFlight.get(key) === request) {
      inFlight.delete(key);
    }
  });
}
