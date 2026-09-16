import { apiJson } from './httpClient';
import { normalizeSeedanceMediaForSubmission, type SeedanceParams } from './videoModelService';

type SourceEligibility = {
  file_id?: string;
  portrait_reference_status?: 'eligible' | 'unsupported' | 'unverified';
  portrait_reference_reason?: string;
  portrait_reference_scopes?: string[];
  portrait_reference_expires_at?: number;
};

export interface PortraitReferenceCheck {
  unsupportedIndices: number[];
  expiresAt: number;
  normalizedInputs?: SeedanceParams['media_inputs'];
  unsupportedReasons?: Record<number, string>;
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
        body: JSON.stringify({ references: batch, include_portrait_eligibility: true, portrait_sub_model: value.sub_model }),
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
    const unsupportedReasons: Record<number, string> = {};
    const normalizedInputs = media.map(item => ({ ...item }));
    media.forEach((item, index) => {
      if (item.kind === 'audio') return;
      const source = sources[referenceFor(item)];
      const expires = Number(source?.portrait_reference_expires_at) * 1000;
      if (item.kind === 'video' || /^(data:|blob:)/i.test(referenceFor(item))
        || source?.portrait_reference_status === 'unsupported') {
        unsupportedIndices.push(index);
        unsupportedReasons[index] = item.kind === 'video' ? '仿真人模式不支持参考视频'
          : source?.portrait_reference_reason || '临时图片没有原图登记记录';
      } else if ((!source?.portrait_reference_status || source.portrait_reference_status === 'eligible')
        && source.portrait_reference_scopes?.includes(value.model_scope || 'workflow')
        && Number.isFinite(expires) && expires > Date.now()) {
        expiresAt = Math.min(expiresAt, expires);
        if (source.file_id) normalizedInputs[index].file_id = source.file_id;
      } else {
        // Unknown provenance/configuration is not evidence for deletion.
        const rank = media.slice(0, index + 1).filter(row => row.kind === item.kind).length;
        throw new Error(`图片${rank}：${source?.portrait_reference_reason || '来源尚未核实或当前模型不可用'}。未启用仿真人模式，所有素材保持不变。`);
      }
    });
    return { unsupportedIndices, expiresAt, normalizedInputs, unsupportedReasons };
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
