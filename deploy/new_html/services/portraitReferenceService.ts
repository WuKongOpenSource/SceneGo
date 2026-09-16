import { apiJson } from './httpClient';
import { normalizeSeedanceMediaForSubmission, type SeedanceParams } from './videoModelService';

type SourceEligibility = {
  purpose?: string;
  portrait_reference_scopes?: string[];
  portrait_reference_expires_at?: number;
};

export interface PortraitReferenceCheck {
  unsupportedIndices: number[];
  expiresAt: number;
}

/** Only server-verified originals qualify; display names and client labels do not. */
export async function checkPortraitReferenceInputs(
  value: SeedanceParams, signal: AbortSignal,
): Promise<PortraitReferenceCheck> {
  const media = normalizeSeedanceMediaForSubmission(value.media_inputs);
  const referenceFor = (item: SeedanceParams['media_inputs'][number]) => item.file_id || item.url;
  const references = [...new Set(media.filter(item => item.kind === 'image')
    .map(referenceFor).filter(ref => ref && !/^(data:|blob:)/i.test(ref)))];
  const sources: Record<string, SourceEligibility> = {};
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, 20000);
  try {
    for (let i = 0; i < references.length; i += 16) {
      const batch = references.slice(i, i + 16);
      const result = await apiJson<{ items: Record<string, SourceEligibility> }>('/api/materials/seedream-source', {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ references: batch, include_portrait_eligibility: true }),
      }, '仿真人参考素材检查');
      // An incomplete response is a failed check, not permission to remove everything.
      if (!result?.items || batch.some(ref => !Object.hasOwn(result.items, ref)
        || !result.items[ref] || typeof result.items[ref] !== 'object')) {
        throw new Error('参考素材检查返回不完整');
      }
      Object.assign(sources, result.items);
    }
    if (controller.signal.aborted) throw new Error('参考素材检查已取消或超时');
    let expiresAt = Infinity;
    const unsupportedIndices: number[] = [];
    media.forEach((item, index) => {
      if (item.kind === 'audio') return;
      const source = sources[referenceFor(item)];
      const expires = Number(source?.portrait_reference_expires_at) * 1000;
      if (item.kind !== 'image' || !Array.isArray(source?.portrait_reference_scopes)
        || !source.portrait_reference_scopes.includes(value.model_scope || 'workflow')
        || !['character_four_view', 'pure_background'].includes(source.purpose || '')
        || !Number.isFinite(expires) || expires <= Date.now()) {
        unsupportedIndices.push(index);
      } else expiresAt = Math.min(expiresAt, expires);
    });
    return { unsupportedIndices, expiresAt };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

/** Prompt edits may continue, but a check must never apply to changed media or modes. */
export function portraitReferenceCheckKey(value: SeedanceParams): string {
  return JSON.stringify([value.sub_model, value.model_scope, value.reference_mode,
    value.portrait_reference_mode, value.media_inputs]);
}
