import { apiJson } from './httpClient';
import type { GenerationReference, MaterialLibrary } from '../types';

interface ImageReference { url: string; name?: string }
interface ImageReferenceScope { projectId?: string; episodeId?: string; shotId: string }

export class InvalidImageReferencesError extends Error {
  readonly urls: string[];
  constructor(references: readonly ImageReference[]) {
    super(`参考素材不可用：${references.map((ref, index) => ref.name || `参考图 ${index + 1}`).join('、')}。可能已删除或无权访问，请在「项目素材」中重新选择后再生成。`);
    this.urls = references.map(ref => ref.url);
  }
}

export async function validateImageReferences(references: readonly ImageReference[], scope: ImageReferenceScope): Promise<void> {
  if (references.length === 0) return;
  const response = await apiJson<{ invalid_indexes: number[] }>('/api/ai/image-references/validate', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      references: references.map(ref => ref.url),
      project_id: scope.projectId,
      episode_id: scope.episodeId,
      entity_type: 'storyboard_item',
      entity_id: scope.shotId,
    }),
  }, '参考素材校验');
  if (!Array.isArray(response?.invalid_indexes) || response.invalid_indexes.some(index => !Number.isInteger(index) || index < 0 || index >= references.length)) {
    throw new Error('参考素材校验未完成，请刷新后重试。');
  }
  if (response.invalid_indexes.length) {
    throw new InvalidImageReferencesError(response.invalid_indexes.map(index => references[index]));
  }
}

/** Repair only server-rejected bindings with one unambiguous same-asset original. */
export async function validateAndRecoverImageReferences(
  references: GenerationReference[],
  library: MaterialLibrary,
  scope: ImageReferenceScope,
): Promise<GenerationReference[]> {
  try {
    await validateImageReferences(references, scope);
    return references;
  } catch (error) {
    if (!(error instanceof InvalidImageReferencesError)) throw error;
    const invalid = new Set(error.urls);
    const repaired = references.map(reference => {
      if (!invalid.has(reference.url) || !reference.assetId) return reference;
      const candidates = new Map(Object.values(library).flat()
        .filter(material => material.assetId === reference.assetId && material.fileId
          && material.fileId !== reference.fileId && material.url && material.url !== reference.url)
        .map(material => [material.fileId!, material]));
      if (candidates.size !== 1) return reference;
      const material = [...candidates.values()][0];
      return { ...reference, fileId: material.fileId, url: material.url };
    });
    // Never silently drop missing/ambiguous inputs or retry the paid provider.
    if (repaired.some(reference => invalid.has(reference.url))) throw error;
    await validateImageReferences(repaired, scope);
    return repaired;
  }
}
