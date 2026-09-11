




import { TOKEN_PREFIX, type SeedanceMediaKind } from './seedanceMedia';

export type PromptSegment =
    | { type: 'text'; text: string }
    | { type: 'token'; text: string; kind: SeedanceMediaKind; n: number };

const KIND_BY_PREFIX: Record<string, SeedanceMediaKind> = {
    [TOKEN_PREFIX.image]: 'image',
    [TOKEN_PREFIX.video]: 'video',
    [TOKEN_PREFIX.audio]: 'audio',
};


const TOKEN_RE = new RegExp(
    `(${TOKEN_PREFIX.image}|${TOKEN_PREFIX.video}|${TOKEN_PREFIX.audio})(\\d+)`,
    'g',
);

/**
 * Split prompt into a flat list of segments preserving original characters.
 * Joining `seg.text` for all segments must yield the original input string.
 */
export function splitPromptSegments(prompt: string): PromptSegment[] {
    if (!prompt) return [];

    const out: PromptSegment[] = [];
    let lastIdx = 0;

    // RegExp.exec loop with /g flag — we manage lastIndex for safety.
    const re = new RegExp(TOKEN_RE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(prompt)) !== null) {
        const start = match.index;
        if (start > lastIdx) {
            out.push({ type: 'text', text: prompt.slice(lastIdx, start) });
        }
        const prefix = match[1];
        const n = parseInt(match[2], 10);
        const kind = KIND_BY_PREFIX[prefix];
        if (kind) {
            out.push({ type: 'token', text: match[0], kind, n });
        } else {
            out.push({ type: 'text', text: match[0] });
        }
        lastIdx = re.lastIndex;
    }
    if (lastIdx < prompt.length) {
        out.push({ type: 'text', text: prompt.slice(lastIdx) });
    }

    return out;
}

/**
 * CSS class for each token kind. Tailwind-friendly (matches other Seedance UI).
 * Used by SeedanceMentionPromptEditor mask overlay AND SeedanceMentionTokensRow chips.
 */
export const TOKEN_KIND_CLASS: Record<SeedanceMediaKind, string> = {
    image: 'bg-blue-500/25 text-blue-200 border border-blue-400/40',
    video: 'bg-purple-500/25 text-purple-200 border border-purple-400/40',
    audio: 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/40',
};







export const TOKEN_KIND_OVERLAY_CLASS: Record<SeedanceMediaKind, string> = {
    image: 'bg-blue-500/30 text-blue-200',
    video: 'bg-purple-500/30 text-purple-200',
    audio: 'bg-emerald-500/30 text-emerald-200',
};

export const TOKEN_KIND_DOT: Record<SeedanceMediaKind, string> = {
    image: 'bg-blue-400',
    video: 'bg-purple-400',
    audio: 'bg-emerald-400',
};
