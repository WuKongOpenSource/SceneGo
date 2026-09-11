import type { AppNode } from '../types';
import { NodeType } from '../types';
import {
  getVideoCreditEstimateParams,
  getVideoCreditFallbackCost,
  isMiniMaxH3Model,
  type VideoModel,
} from '@app/services/videoModelService';
import {
  STUDIO_AUDIO_MODEL_SPEECH_HD,
  STUDIO_IMAGE_MODEL_CONFIGURED,
  STUDIO_TEXT_MODEL_CONFIGURED,
  getStudioVideoDuration,
  normalizeStudioAudioModel,
  normalizeStudioImageModel,
  normalizeStudioVideoModel,
} from './modelOptions';

export type StudioCreditFeature =
  | 'prompt_optimize'
  | 'image_generation'
  | 'video_generation'
  | 'audio_generation_tts';

export interface StudioCreditRequest {
  featureKey: StudioCreditFeature;
  params: Record<string, unknown>;
  /**
   * One queued video task is reserved and settled independently. The quote API
   * returns the price of one task, so the canvas multiplies it for batch video
   * generation before the first task is submitted.
   */
  quantity: number;
  fallbackUnitCost: number;
}

export interface StudioCreditQuote {
  enabled: boolean;
  estimatedCost: number;
  balance: number | null;
  enough: boolean;
}

export interface StudioCreditSummary extends StudioCreditQuote {
  totalCost: number;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function fallbackVideoUnitCost(model: VideoModel, duration: number, h3Upscale720p: boolean): number {
  const seedanceFiveSecondCost: Partial<Record<VideoModel, number>> = {
    Seedance15: 32,
    Seedance2: 105,
    Seedance2Fast: 85,
    Seedance2Mini: 50,
  };
  const seedanceCost = seedanceFiveSecondCost[model];
  if (seedanceCost) return Math.max(1, Math.round((seedanceCost * duration) / 5));
  return getVideoCreditFallbackCost(model, { h3_upscale_720p: h3Upscale720p });
}

export function estimateStudioTextTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const nonCjkLength = Math.max(0, text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, '').trim().length);
  return Math.max(1, cjkCount + Math.ceil(nonCjkLength / 4));
}

export function buildStudioTextCreditRequest(text: string): StudioCreditRequest {
  return {
    featureKey: 'prompt_optimize',
    params: {
      input_tokens: estimateStudioTextTokens(text),
      output_tokens: 1200,
      model: STUDIO_TEXT_MODEL_CONFIGURED,
    },
    quantity: 1,
    fallbackUnitCost: 2,
  };
}

export function buildStudioNodeCreditRequest(
  node: AppNode,
  promptOverride?: string,
): StudioCreditRequest | null {
  const prompt = promptOverride ?? node.data.prompt ?? '';

  if (node.type === NodeType.IMAGE_GENERATOR || node.type === NodeType.IMAGE_EDITOR) {
    return {
      featureKey: 'image_generation',
      params: {
        image_count: node.type === NodeType.IMAGE_EDITOR ? 1 : positiveInt(node.data.imageCount, 1),
        model: normalizeStudioImageModel(node.data.model) || STUDIO_IMAGE_MODEL_CONFIGURED,
        resolution: node.data.resolution || '2K',
        aspect_ratio: node.data.aspectRatio || '16:9',
      },
      quantity: 1,
      fallbackUnitCost: 10,
    };
  }

  if (node.type === NodeType.VIDEO_GENERATOR) {
    const model = normalizeStudioVideoModel(node.data.model);
    const resolution = String(node.data.resolution || '720p').toLowerCase();
    const duration = getStudioVideoDuration(model, positiveInt(node.data.duration, 5), resolution);
    const h3Upscale720p = isMiniMaxH3Model(model) && resolution === '720p';
    return {
      featureKey: 'video_generation',
      params: getVideoCreditEstimateParams(model, {
        duration_seconds: duration,
        resolution: resolution.toUpperCase(),
        h3_upscale_720p: h3Upscale720p,
        ...(model === 'MINI' ? {
          minimax_resolution: resolution === '1080p' ? '1080P' : '768P',
        } : {}),
      }),
      quantity: positiveInt(node.data.videoCount, 1),
      fallbackUnitCost: fallbackVideoUnitCost(model, duration, h3Upscale720p),
    };
  }

  if (node.type === NodeType.AUDIO_GENERATOR) {
    return {
      featureKey: 'audio_generation_tts',
      params: {
        character_count: prompt.length,
        model: normalizeStudioAudioModel(node.data.model) || STUDIO_AUDIO_MODEL_SPEECH_HD,
      },
      quantity: 1,
      fallbackUnitCost: 2,
    };
  }

  return null;
}

export function summarizeStudioCreditQuote(
  request: StudioCreditRequest,
  quote: StudioCreditQuote | null,
): StudioCreditSummary {
  const enabled = quote?.enabled ?? true;
  const unitCost = enabled
    ? Math.max(0, quote?.estimatedCost ?? request.fallbackUnitCost)
    : 0;
  const totalCost = unitCost * Math.max(1, request.quantity);
  const balance = quote?.balance ?? null;
  return {
    enabled,
    estimatedCost: unitCost,
    totalCost,
    balance,
    enough: !enabled || balance === null || balance >= totalCost,
  };
}
