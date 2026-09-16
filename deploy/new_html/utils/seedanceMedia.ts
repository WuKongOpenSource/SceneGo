import type {
    SeedanceMediaInput,
    SeedanceMediaKind,
    SeedanceMediaRole,
    SeedanceParams,
} from '../services/videoModelService';

export type { SeedanceMediaInput, SeedanceMediaKind, SeedanceMediaRole };

// Mention metadata is transient and must not be persisted with task inputs.
export interface SeedanceMentionMeta {
    arkAssetId?: string;
    label?: string;
    sourceId?: string;
}

export type SeedanceCandidateGroup =
    | 'current_card'
    | 'storyboard_data'
    | 'storyboard_library'
    | 'assets'
    | 'audio'
    | 'video_segments'
    | 'user_files'
    | 'media_library'
    | 'ark_asset_id';

export interface SeedanceAssetCandidate {
    id: string;
    group: SeedanceCandidateGroup;
    kind: SeedanceMediaKind | 'text';
    label: string;
    url?: string;
    text?: string;
    arkAssetId?: string;
    storyboardItemId?: string;
    durationMs?: number;
    thumbnailUrl?: string;
    fileId?: string;
}

export const TOKEN_PREFIX: Record<SeedanceMediaKind, string> = {
    image: '图片',
    video: '视频',
    audio: '音频',
};

export type WithSeedanceParams = Pick<SeedanceParams, 'prompt' | 'media_inputs' | 'sub_model'>;

export function nextTokenIndex(
    value: Pick<SeedanceParams, 'media_inputs'>,
    kind: SeedanceMediaKind,
): number {
    return value.media_inputs.filter(m => m.kind === kind).length + 1;
}

function tokenRegex(kind: SeedanceMediaKind, n: number | '\\d+'): RegExp {
    if (n === '\\d+') return new RegExp(`${TOKEN_PREFIX[kind]}(\\d+)`, 'g');
    return new RegExp(`${TOKEN_PREFIX[kind]}${n}(?!\\d)`, 'g');
}

function normalizedMediaUrl(url: string): string {
    return (url || '').trim();
}

function findExistingMediaIndex(
    value: Pick<SeedanceParams, 'media_inputs'>,
    kind: SeedanceMediaKind,
    url: string,
    fileId?: string,
): number {
    const normalizedUrl = normalizedMediaUrl(url);
    return value.media_inputs.findIndex(m =>
        m.kind === kind && (normalizedMediaUrl(m.url) === normalizedUrl
            || (!!fileId && (m.file_id || registeredImageFileId(m.url)) === fileId)),
    );
}

function tokenIndexForMediaInput(value: Pick<SeedanceParams, 'media_inputs'>, absIdx: number): number {
    const media = value.media_inputs[absIdx];
    if (!media) return 0;
    return value.media_inputs
        .slice(0, absIdx + 1)
        .filter(m => m.kind === media.kind)
        .length;
}

export function hasMediaTokenReference(
    prompt: string,
    kind: SeedanceMediaKind,
    tokenIndex: number,
): boolean {
    return tokenRegex(kind, tokenIndex).test(prompt || '');
}









export interface InsertMentionOptions {
    atPos?: number;
    caretPos?: number;
}

export function insertMention(
    value: SeedanceParams,
    candidate: SeedanceAssetCandidate,
    opts?: InsertMentionOptions,
): SeedanceParams {
    const useCaret = opts != null && opts.atPos != null && opts.caretPos != null
        && opts.atPos >= 0 && opts.caretPos >= opts.atPos;

    if (candidate.kind === 'text') {
        const text = candidate.text || '';
        if (useCaret) {
            const before = (value.prompt || '').slice(0, opts!.atPos);
            const after = (value.prompt || '').slice(opts!.caretPos);
            return { ...value, prompt: before + text + after };
        }
        return { ...value, prompt: (value.prompt || '') + text };
    }

    const kind = candidate.kind as SeedanceMediaKind;
    const url = candidate.arkAssetId || candidate.url;
    if (!url) return value;

    const durationSeconds = (kind === 'video' || kind === 'audio') && Number.isFinite(candidate.durationMs)
        ? Math.max(0, Number(candidate.durationMs) / 1000)
        : undefined;
    const newInput: SeedanceMediaInput = {
        kind,
        url,
        ...((candidate.fileId || registeredImageFileId(url)) ? { file_id: candidate.fileId || registeredImageFileId(url) } : {}),
        ...(durationSeconds && durationSeconds > 0 ? { duration_seconds: durationSeconds } : {}),
    };
    const existingIdx = findExistingMediaIndex(value, kind, url, newInput.file_id);
    const hasExistingInput = existingIdx >= 0;
    const idx = hasExistingInput
        ? tokenIndexForMediaInput(value, existingIdx)
        : nextTokenIndex(value, kind);
    const token = `${TOKEN_PREFIX[kind]}${idx}`;
    const mediaInputs = hasExistingInput ? value.media_inputs : [...value.media_inputs, newInput];

    if (useCaret) {
        const before = (value.prompt || '').slice(0, opts!.atPos);
        const after = (value.prompt || '').slice(opts!.caretPos);

        const trail = after === '' || /^\s/.test(after) ? '' : ' ';
        return {
            ...value,
            media_inputs: mediaInputs,
            prompt: before + token + trail + after,
        };
    }

    // legacy append
    const promptHasToken = tokenRegex(kind, idx).test(value.prompt || '');
    const sep = (value.prompt || '').endsWith(' ') || !value.prompt ? '' : ' ';
    const newPrompt = promptHasToken
        ? value.prompt
        : (value.prompt || '') + sep + token;

    return {
        ...value,
        media_inputs: mediaInputs,
        prompt: newPrompt,
    };
}

export function removeMediaInput(value: SeedanceParams, idxToRemove: number): SeedanceParams {
    const removed = value.media_inputs[idxToRemove];
    if (!removed) return value;

    const kind = removed.kind;
    const sameKindIndices = value.media_inputs
        .map((m, i) => ({ m, i }))
        .filter(x => x.m.kind === kind)
        .map(x => x.i);
    const removedRank = sameKindIndices.indexOf(idxToRemove); // 0-based among same kind
    const removedTokenN = removedRank + 1;

    let prompt = value.prompt || '';
    // 1) Remove the deleted-rank token (replace with empty)
    prompt = prompt.replace(tokenRegex(kind, removedTokenN), '');
    // 2) Renumber tokens > removedTokenN: walk ascending; replace N → N-1
    const totalSameKind = sameKindIndices.length;
    for (let n = removedTokenN + 1; n <= totalSameKind; n++) {
        const re = tokenRegex(kind, n);
        prompt = prompt.replace(re, `${TOKEN_PREFIX[kind]}${n - 1}`);
    }

    return {
        ...value,
        media_inputs: value.media_inputs.filter((_, i) => i !== idxToRemove),
        prompt,
    };
}

export function registeredImageFileId(url: string): string | undefined {
    const match = url.match(/\/api\/files\/([A-Za-z0-9_-]+)\/download(?:[?#].*)?$/);
    return match?.[1];
}

export interface CanonicalizeResult {
    prompt: string;
    orphans: string[];   // tokens in prompt with no backing media
    added: string[];     // tokens appended for media that had none
}

export function canonicalizePrompt(value: SeedanceParams): CanonicalizeResult {
    const orphans: string[] = [];
    const added: string[] = [];
    let prompt = value.prompt || '';

    for (const kind of ['image', 'video', 'audio'] as const) {
        const count = value.media_inputs.filter(m => m.kind === kind).length;

        const re = new RegExp(`${TOKEN_PREFIX[kind]}(\\d+)`, 'g');
        const seen = new Set<number>();
        let match: RegExpExecArray | null;
        while ((match = re.exec(prompt)) !== null) {
            const n = parseInt(match[1], 10);
            seen.add(n);
            if (n > count) orphans.push(`${TOKEN_PREFIX[kind]}${n}`);
        }
        for (let n = 1; n <= count; n++) {
            if (!seen.has(n)) {
                const tok = `${TOKEN_PREFIX[kind]}${n}`;
                prompt = (prompt + (prompt && !prompt.endsWith(' ') ? ' ' : '') + tok);
                added.push(tok);
            }
        }
    }

    return { prompt, orphans, added };
}

export function shouldEnableWebSearch(value: SeedanceParams): boolean {
    if (value.media_inputs.length > 0) return false;
    if (!(value.prompt || '').trim()) return false;
    // sub_model whitelist matches videoModelService.SeedanceParams.sub_model union
    return value.sub_model === 'standard' || value.sub_model === 'fast';
}

export function parseArkAssetId(raw: string): string | null {
    const s = (raw || '').trim();
    if (!s.startsWith('asset://')) return null;
    if (s.length <= 'asset://'.length) return null;
    return s;
}
