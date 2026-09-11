export const DESIGN_CREDIT_FEATURES = {
  imageGeneration: 'design_image_generation',
  promptRefinement: 'design_prompt_refinement',
  angleAdjustment: 'design_angle_adjustment',
  multiAngleGeneration: 'design_multi_angle_generation',
  upscaleHd: 'design_upscale_hd',
} as const;

export const DESIGN_CREDIT_DEFAULTS = {
  imageGenerationPerImage: 8,
  onlineImageOperation: 60,
  promptRefinement: 1,
  angleAdjustment: 5,
  multiAngleGeneration: 60,
  upscaleHd: 5,
} as const;

const DESIGN_IMAGE_POINT_MATRIX: Record<string, Record<string, number>> = {
  image_tier_1: { '1K': 8 },
  image_tier_2: { '1K': 12, '2K': 18, '4K': 26 },
  image_tier_3: { '1K': 5, '2K': 10, '4K': 15 },
};

const DESIGN_PROMPT_REFINEMENT_TIER_COSTS: Record<string, number> = {
  script_tier_1: 1,
  script_tier_2: 2,
  script_tier_3: 3,
  script_tier_4: 4,
};

export function designImageCreditParams(options: {
  imageCount: number;
  model: string;
  resolution: string;
  aspectRatio: string;
}) {
  return {
    image_count: Math.max(1, Math.floor(options.imageCount || 1)),
    model: options.model,
    resolution: options.resolution,
    aspect_ratio: options.aspectRatio,
  };
}

export function designImageFallbackCost(model: string, resolution: string, imageCount: number): number {
  const normalizedCount = Math.max(1, Math.floor(imageCount || 1));
  const tierCosts = DESIGN_IMAGE_POINT_MATRIX[model];
  const perImage = tierCosts?.[String(resolution || '').toUpperCase()]
    ?? tierCosts?.['1K']
    ?? DESIGN_CREDIT_DEFAULTS.imageGenerationPerImage;
  return perImage * normalizedCount;
}

export function designOperationCreditParams(workflow: 'angle_adjustment' | 'human_multi_angle' | 'upscale_hd') {
  return {
    operation_count: 1,
    workflow,
    ...(workflow === 'human_multi_angle' ? { output_count: 14 } : {}),
  };
}

export function designPromptRefinementCreditParams(model: string) {
  return { model };
}

export function designPromptRefinementFallbackCost(model: string): number {
  return DESIGN_PROMPT_REFINEMENT_TIER_COSTS[model]
    || DESIGN_CREDIT_DEFAULTS.promptRefinement;
}

export function newDesignCreditUsageId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}:${uuid}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}
