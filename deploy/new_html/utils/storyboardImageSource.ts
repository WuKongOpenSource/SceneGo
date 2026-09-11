import type { GeneratedImage } from '../types';
import { STORYBOARD_GENERATION_MODEL_OPTIONS } from './storyboardGenerationModels';

function record(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Read the individual file's saved identity, never the currently selected model.
// These fields are display data, not a replacement for server provenance checks.
export function storyboardImageSource(metadata: unknown): Pick<GeneratedImage, 'source' | 'generationModel'> {
  const saved = record(metadata);
  const provenance = record(saved.seedance_provenance);
  const source = text(saved.source);
  return {
    source: source || undefined,
    generationModel: source === 'upload' ? undefined : (
      text(provenance.model) || text(saved.model) || text(saved.storyboard_generation_model)
      || (source === 'local_transform' && saved.transform === 'horizontal_mirror' ? 'horizontal_mirror' : undefined)
    ),
  };
}

export function storyboardImageSourceLabel(image: Pick<GeneratedImage, 'source' | 'generationModel'>): string {
  if (image.source === 'upload') return '外部上传';
  const model = text(image.generationModel);
  if (!model) return '模型未记录';
  if (model === 'i2i_fj' || model === 'angle-adjust') return '角度调整';
  if (model === 'i2i_human' || model === 'human-multi-angle') return '多角度人物';
  if (model === 'i2i_around' || model === 'around-angle') return '全景角度';
  if (model === 'horizontal_mirror') return '水平镜像';
  if (/^doubao-seedream-5[.-]0-lite(?:-\d+)?$/i.test(model) || model === 'doubao') return 'Doubao-Seedream-5.0-lite';
  if (/^doubao-seedream-5[.-]0-pro(?:-\d+)?$/i.test(model) || model === 'doubao_pro') return 'Doubao-Seedream-5.0-Pro';
  const option = STORYBOARD_GENERATION_MODEL_OPTIONS.find(item => item.value === model);
  return option ? option.shortLabel.split(' · ')[0] : model;
}
