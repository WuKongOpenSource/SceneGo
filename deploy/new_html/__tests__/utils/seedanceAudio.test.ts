import { describe, expect, it } from 'vitest';
import { seedanceAudioError, audioDurationLabel, seedanceAudioBudget } from '../../utils/seedanceAudio';
import { insertMention } from '../../utils/seedanceMedia';
import type { SeedanceMediaInput, SeedanceParams } from '../../services/videoModelService';

const audio = (duration_seconds?: number): SeedanceMediaInput => ({ kind: 'audio', url: '/audio.mp3', duration_seconds });

describe('Seedance reference audio budget hints', () => {
    it('validates each clip and the combined duration, not output duration', () => {
        expect(seedanceAudioError([audio(15.804)])).toContain('15.804');
        expect(seedanceAudioError([audio(8.028), audio(8.028)])).toContain('16.056');
        expect(seedanceAudioError([audio(1.5)])).toContain('至少需要 2 秒');
        expect(seedanceAudioError([audio(7), audio(8)])).toBeNull();
        expect(seedanceAudioError([audio(3), audio(3), audio(3), audio(3)])).toContain('3 段');
    });
    it('allocates proportional prefixes only when explicitly selected', () => {
        expect(seedanceAudioBudget([15.804, 8.028])).toEqual([9.947, 5.052]);
        expect(seedanceAudioBudget([2, 100, 2])).toEqual([2, 11, 2]);
        expect(seedanceAudioError([audio(15.804), audio(8.028)], 'trim_to_15')).toBeNull();
        expect(seedanceAudioError([audio(1.5), audio(20)], 'trim_to_15')).toContain('至少需要 2 秒');
    });
    it('does not invent five-second duration for old records', () => {
        expect(audioDurationLabel()).toBe('时长待服务器校验');
        expect(seedanceAudioError([audio()])).toBeNull();
        expect(audioDurationLabel(15.804)).toBe('15.804 秒');
    });
    it('carries audio duration from asset candidates without changing the original', () => {
        const value = { media_inputs: [], prompt: '', sub_model: 'mini' } as unknown as SeedanceParams;
        const result = insertMention(value, { id: 'voice', group: 'audio', kind: 'audio', label: '配音', url: '/voice.mp3', durationMs: 8028 });
        expect(result.media_inputs[0].duration_seconds).toBe(8.028);
        expect(value.media_inputs).toEqual([]);
    });
});
