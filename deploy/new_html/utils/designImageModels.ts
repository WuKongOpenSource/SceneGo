export type DesignImageEngine = 'nanobanana' | 'doubao';
export type DesignImageResolution = '1K' | '2K' | '4K';
export type DesignImageReferenceSourceKind = 'current' | 'related-scene' | 'external-upload';

export interface DesignImageReferenceQuotaItem {
  id: string;
  sourceKind?: DesignImageReferenceSourceKind;
}

export interface DesignImageModelOption {
  id: string;
  label: string;
  hint: string;
  billingModel: string;
  runtime: string;
  engine: DesignImageEngine;
  geminiModel: string;
  resolutions: readonly DesignImageResolution[];
  maxReferences: number;
  supportsImageToImageBatch: boolean;
}

export const DESIGN_IMAGE_BATCH_LIMIT = 15;

export const DESIGN_IMAGE_MODEL_OPTIONS: readonly DesignImageModelOption[] = [
  {
    id: 'doubao-seedream-5-0-lite-260128',
    label: 'Doubao-Seedream-5.0-lite · 参考图生图模型',
    hint: '参考优先',
    billingModel: 'image_tier_3',
    runtime: 'Doubao-Seedream-5.0-lite',
    engine: 'doubao',
    geminiModel: 'gemini-3-pro-image-preview',
    resolutions: ['1K', '2K', '4K'],
    maxReferences: 14,
    supportsImageToImageBatch: true,
  },
  {
    id: 'gemini-3-pro-image-preview',
    label: 'Gemini 3.1 Flash Image Preview · 高质量生图模型',
    hint: '质量优先',
    billingModel: 'image_tier_2',
    runtime: 'Gemini 3.1 Flash Image Preview',
    engine: 'nanobanana',
    geminiModel: 'gemini-3-pro-image-preview',
    resolutions: ['1K', '2K', '4K'],
    maxReferences: 6,
    supportsImageToImageBatch: false,
  },
  {
    id: 'gemini-2.5-flash-image',
    label: 'Gemini 2.5 Flash Image · 快速生图模型',
    hint: '速度优先',
    billingModel: 'image_tier_1',
    runtime: 'Gemini 2.5 Flash Image',
    engine: 'nanobanana',
    geminiModel: 'gemini-2.5-flash-image',
    resolutions: ['1K'],
    maxReferences: 6,
    supportsImageToImageBatch: false,
  },
] as const;

export function findDesignImageModel(
  engine: DesignImageEngine,
  geminiModel: string,
): DesignImageModelOption {
  return DESIGN_IMAGE_MODEL_OPTIONS.find(option => (
    option.engine === engine && option.geminiModel === geminiModel
  )) || DESIGN_IMAGE_MODEL_OPTIONS.find(option => option.engine === engine)
    || DESIGN_IMAGE_MODEL_OPTIONS[0];
}

export function normalizeDesignImageResolution(
  model: DesignImageModelOption,
  resolution: string,
): DesignImageResolution {
  return model.resolutions.includes(resolution as DesignImageResolution)
    ? resolution as DesignImageResolution
    : model.resolutions[0];
}

export function canUseDesignImageReferences(
  model: DesignImageModelOption,
  imageToImageEnabled: boolean,
): boolean {
  return model.supportsImageToImageBatch && imageToImageEnabled;
}

export function maxDesignImageOutputCount(referenceCount: number): number {
  return Math.max(1, DESIGN_IMAGE_BATCH_LIMIT - Math.max(0, referenceCount));
}

export function isDesignImageReferenceQuotaExempt(
  sourceKind?: DesignImageReferenceSourceKind,
): boolean {
  return sourceKind === 'related-scene';
}

export function countDesignImageQuotaReferences(
  selectedReferenceIds: Iterable<string>,
  references: Iterable<DesignImageReferenceQuotaItem>,
): number {
  const selected = new Set(selectedReferenceIds);
  let count = 0;
  for (const reference of references) {
    if (selected.has(reference.id) && !isDesignImageReferenceQuotaExempt(reference.sourceKind)) {
      count += 1;
    }
  }
  return count;
}

export function trimDesignImageReferenceSelectionToQuota(
  selectedReferenceIds: Iterable<string>,
  references: Iterable<DesignImageReferenceQuotaItem>,
  maxReferences: number,
): Set<string> {
  const sourceKindById = new Map(
    Array.from(references, reference => [reference.id, reference.sourceKind] as const),
  );
  const next = new Set<string>();
  let counted = 0;
  for (const id of selectedReferenceIds) {
    const sourceKind = sourceKindById.get(id);
    if (sourceKind === undefined && !sourceKindById.has(id)) continue;
    if (isDesignImageReferenceQuotaExempt(sourceKind)) {
      next.add(id);
      continue;
    }
    if (counted < Math.max(0, maxReferences)) {
      next.add(id);
      counted += 1;
    }
  }
  return next;
}
