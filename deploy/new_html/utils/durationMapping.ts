// Pure helpers for video card duration. No React, no I/O.

export const DURATION_MIN_SEC = 3;
export const DURATION_MAX_SEC = 15;
export const DURATION_DEFAULT_SEC = 5;
export const SEEDANCE_AGENT_PLAN_MAX_DURATION_SEC = 12;

function normalizeMaxSec(maxSec: number = DURATION_MAX_SEC): number {
    const n = Number(maxSec);
    if (!Number.isFinite(n)) return DURATION_MAX_SEC;
    return Math.max(DURATION_MIN_SEC, Math.round(n));
}

function clampFiniteSec(value: number, maxSec: number): number {
    const rounded = Math.round(value);
    if (rounded < DURATION_MIN_SEC) return DURATION_MIN_SEC;
    if (rounded > maxSec) return maxSec;
    return rounded;
}

export function clampSec(
    value: unknown,
    fallback: number = DURATION_DEFAULT_SEC,
    maxSec: number = DURATION_MAX_SEC,
): number {
    const max = normalizeMaxSec(maxSec);
    const n = Number(value);
    if (!Number.isFinite(n)) return clampFiniteSec(Number(fallback), max);
    return clampFiniteSec(n, max);
}

export interface DurationInputs {
    audioDurationMs?: number;
    plannedDurationMs?: number;
}

// Keep the designed action window. Only overflowing audio needs an extra tail.
// Never persist this derived value as audio duration or the tail would compound.
export function resolveShotTargetDurationMs(inputs: DurationInputs, fallbackMs = 5000): number {
    const planned = Number(inputs.plannedDurationMs);
    const audio = Number(inputs.audioDurationMs);
    const design = Number.isFinite(planned) && planned > 0 ? planned
        : Number.isFinite(audio) && audio > 0 ? 0 : fallbackMs;
    return Number.isFinite(audio) && audio > design ? audio + 500 : design;
}

export function computeReactiveDuration(
    inputs: DurationInputs,
    maxSec: number = DURATION_MAX_SEC,
): number {
    const targetMs = resolveShotTargetDurationMs(inputs);
    // Integer-second providers must not round away the reserved action tail.
    return clampSec(Math.ceil(targetMs / 1000), DURATION_DEFAULT_SEC, maxSec);
}












export const ESTIMATE_DURATION_FALLBACK_MS = 2000;
export const ESTIMATE_DURATION_MIN_MS = 2000;
export const ESTIMATE_DURATION_MAX_MS = 8000;
export const ESTIMATE_CHARS_PER_SECOND = 4;

export function parseDurationString(raw: string | undefined | null): number | null {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    let totalMs = 0;
    const minMatch = s.match(/([\d.]+)\s*分/);
    if (minMatch) totalMs += parseFloat(minMatch[1]) * 60 * 1000;
    const secMatch = s.match(/([\d.]+)\s*秒/);
    if (secMatch) totalMs += parseFloat(secMatch[1]) * 1000;
    if (totalMs === 0) {
        const sMatch = s.match(/([\d.]+)\s*s\b/i);
        if (sMatch) totalMs = parseFloat(sMatch[1]) * 1000;
    }
    if (totalMs === 0) {
        const numMatch = s.match(/([\d.]+)/);
        if (numMatch) totalMs = parseFloat(numMatch[1]) * 1000;
    }
    return totalMs > 0 ? Math.round(totalMs) : null;
}

export function estimateDurationFromText(text: string | undefined | null): number {
    const len = (text || '').replace(/\s/g, '').length;
    if (len === 0) return ESTIMATE_DURATION_FALLBACK_MS;
    const ms = Math.round((len / ESTIMATE_CHARS_PER_SECOND) * 1000);
    return Math.max(ESTIMATE_DURATION_MIN_MS, Math.min(ESTIMATE_DURATION_MAX_MS, ms));
}

export interface EstimateDurationInputs {
    durationStr?: string;
    dialogueText?: string;
}


export function estimateDurationMs(inputs: EstimateDurationInputs): number {
    const parsed = parseDurationString(inputs.durationStr);
    if (parsed != null) return Math.max(ESTIMATE_DURATION_MIN_MS, parsed);
    const estimated = estimateDurationFromText(inputs.dialogueText || '');
    return estimated;
}
