import type { StoryboardQualityReview } from '../types';
import { apiJson } from './httpClient';

interface RawQualityReview {
  status: StoryboardQualityReview['status'];
  character_consistency_score?: number;
  script_compliance_score?: number;
  visual_quality_score?: number;
  characters?: Array<{ name: string; score: number; issues?: string[] }>;
  issues?: string[];
  retry_prompt?: string;
}

export interface StoryboardQualityRequest {
  imageUrl: string;
  fileId?: string;
  generationModel?: string;
  generationAttempt?: number;
  prompt: string;
  scriptSegment?: string;
  scene?: string;
  characters: Array<{
    name: string;
    description?: string;
    anchor?: Record<string, unknown>;
  }>;
  referenceImages: Array<{ name: string; url: string }>;
}

export async function reviewStoryboardImage(
  itemId: string,
  request: StoryboardQualityRequest,
): Promise<StoryboardQualityReview> {
  const raw = await apiJson<RawQualityReview>(`/api/storyboard-items/${itemId}/quality-review`, {
    method: 'POST',
    body: JSON.stringify({
      image_url: request.imageUrl,
      file_id: request.fileId,
      generation_model: request.generationModel,
      generation_attempt: request.generationAttempt || 1,
      prompt: request.prompt,
      script_segment: request.scriptSegment || '',
      scene: request.scene || '',
      characters: request.characters,
      reference_images: request.referenceImages,
    }),
  }, '分镜视觉验收');

  return normalizeStoryboardQualityReview({
    ...raw,
    attempt: request.generationAttempt || 1,
  });
}

export function normalizeStoryboardQualityReview(rawValue: unknown): StoryboardQualityReview {
  const raw = (rawValue && typeof rawValue === 'object' ? rawValue : {}) as RawQualityReview & Record<string, any>;
  const characterConsistencyScore = Number(raw.character_consistency_score ?? raw.characterConsistencyScore ?? 0);
  const scriptComplianceScore = Number(raw.script_compliance_score ?? raw.scriptComplianceScore ?? 0);
  const visualQualityScore = Number(raw.visual_quality_score ?? raw.visualQualityScore ?? 0);
  const characterScores = (raw.characters || raw.characterScores || []).map((item: any) => ({
    name: String(item.name || ''),
    score: Number(item.score || 0),
    issues: Array.isArray(item.issues) ? item.issues.map(String) : [],
  }));
  return {
    status: raw.status,
    characterConsistencyScore,
    scriptComplianceScore,
    visualQualityScore,
    overallScore: Math.round(characterConsistencyScore * 0.45 + scriptComplianceScore * 0.35 + visualQualityScore * 0.2),
    characterScores,
    issues: raw.issues || [],
    retryPrompt: raw.retry_prompt || raw.retryPrompt || '',
    reviewedAt: raw.reviewedAt || new Date().toISOString(),
    reviewerModel: raw.reviewerModel,
    attempt: Number(raw.attempt || 1),
  };
}
