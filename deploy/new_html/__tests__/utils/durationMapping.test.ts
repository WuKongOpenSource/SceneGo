import { describe, it, expect } from 'vitest';
import {
    clampSec,
    computeReactiveDuration,
    resolveShotTargetDurationMs,
    estimateDurationMs,
    parseDurationString,
    estimateDurationFromText,
    ESTIMATE_DURATION_FALLBACK_MS,
    ESTIMATE_DURATION_MAX_MS,
    ESTIMATE_DURATION_MIN_MS,
} from '../../utils/durationMapping';

describe('clampSec', () => {
    it('clamps to [3, 15] integer seconds', () => {
        expect(clampSec(0)).toBe(3);
        expect(clampSec(2.4)).toBe(3);
        expect(clampSec(3)).toBe(3);
        expect(clampSec(7.6)).toBe(8);
        expect(clampSec(15)).toBe(15);
        expect(clampSec(99)).toBe(15);
    });
    it('returns fallback for non-finite', () => {
        expect(clampSec(NaN, 5)).toBe(5);
        expect(clampSec(Infinity, 5)).toBe(5);
        expect(clampSec(-Infinity, 5)).toBe(5);
    });
    it('supports provider-specific max seconds', () => {
        expect(clampSec(13, 5, 12)).toBe(12);
        expect(clampSec(NaN, 15, 12)).toBe(12);
    });
});

describe('computeReactiveDuration', () => {
    it.each([[2500, 3000], [3000, 3000], [3100, 3600], [4000, 4500]])('reserves the exact shot window for %i ms audio', (audioDurationMs, expected) => {
        const input = { audioDurationMs, plannedDurationMs: 3000 };
        expect(resolveShotTargetDurationMs(input)).toBe(expected);
        expect(resolveShotTargetDurationMs(input)).toBe(expected);
        expect(computeReactiveDuration(input)).toBe(Math.ceil(expected / 1000));
        expect(input.plannedDurationMs).toBe(3000);
    });
    it('preserves the planned action window for shorter audio', () => {
        expect(computeReactiveDuration({ audioDurationMs: 4200, plannedDurationMs: 9000 })).toBe(9);
    });
    it('falls back to plannedDurationMs when audio missing', () => {
        expect(computeReactiveDuration({ plannedDurationMs: 7400 })).toBe(8);
    });
    it('uses default 5 when both missing', () => {
        expect(computeReactiveDuration({})).toBe(5);
    });
    it('clamps audio to [3, 15]', () => {
        expect(computeReactiveDuration({ audioDurationMs: 1500 })).toBe(3);
        expect(computeReactiveDuration({ audioDurationMs: 22000 })).toBe(15);
    });
    it('treats audioDurationMs of 0 as missing (falls back)', () => {
        expect(computeReactiveDuration({ audioDurationMs: 0, plannedDurationMs: 8000 })).toBe(8);
    });
    it('clamps to provider-specific max seconds', () => {
        expect(computeReactiveDuration({ audioDurationMs: 13000 }, 12)).toBe(12);
    });
});


describe('parseDurationString', () => {
    it('parses 中文 秒 / 分 单位', () => {
        expect(parseDurationString('2秒')).toBe(2000);
        expect(parseDurationString('3.5秒')).toBe(3500);
        expect(parseDurationString('1分')).toBe(60000);
    });
    it('parses bare number as seconds', () => {
        expect(parseDurationString('4')).toBe(4000);
        expect(parseDurationString('4s')).toBe(4000);
    });
    it('returns null for empty / unparseable', () => {
        expect(parseDurationString('')).toBeNull();
        expect(parseDurationString(undefined)).toBeNull();
        expect(parseDurationString('hi')).toBeNull();
    });
});

describe('estimateDurationFromText', () => {
    it('returns 2000ms fallback for empty text', () => {
        expect(estimateDurationFromText('')).toBe(ESTIMATE_DURATION_FALLBACK_MS);
        expect(estimateDurationFromText(null)).toBe(ESTIMATE_DURATION_FALLBACK_MS);
    });
    it('uses ~4 中文字/秒 for normal text', () => {
        // 8 chars / 4 = 2s → 2000ms
        expect(estimateDurationFromText('我是一段台词内容')).toBe(2000);
        // 16 chars / 4 = 4s = 4000ms
        expect(estimateDurationFromText('这段台词应当大约持续大概是四秒钟')).toBe(4000);
    });
    it('clamps to MAX 8000ms', () => {
        const long = '台词'.repeat(50); // 100 chars → 25s → clamp to 8s
        expect(estimateDurationFromText(long)).toBe(ESTIMATE_DURATION_MAX_MS);
    });
    it('ignores whitespace in counting', () => {
        expect(estimateDurationFromText('我  是  一  段  台  词')).toBe(2000); // 6 chars → 1.5s → clamp 2s
    });
});

describe('estimateDurationMs', () => {
    it('prefers explicit durationStr when parseable', () => {
        expect(estimateDurationMs({ durationStr: '3秒', dialogueText: 'X'.repeat(20) })).toBe(3000);
    });
    it('falls back to dialogue estimate when durationStr empty / null', () => {
        expect(estimateDurationMs({ durationStr: '', dialogueText: '一二三四五六七八' }))
            .toBe(2000); // 8 chars / 4 = 2s
    });
    it('returns 2000ms when both inputs are empty', () => {
        expect(estimateDurationMs({})).toBe(ESTIMATE_DURATION_FALLBACK_MS);
    });
    it('always returns >= ESTIMATE_DURATION_MIN_MS', () => {
        expect(estimateDurationMs({ durationStr: '0.5秒' })).toBe(ESTIMATE_DURATION_MIN_MS);
    });
});
