import { describe, expect, it } from 'vitest';
import { getVideoDurationShortfall, mergeVideoTimingMetadata, resolveVideoGroupTiming, resolveVideoSelectedSeconds } from '../../utils/videoGroupTiming';

const images = [1, 2].map(i => ({ id: `image${i}`, storyboardItemId: `shot${i}`, storyboardShotLabel: `镜头2-${i}`, url: '', filename: '', uploadTime: 0 }));
const group = { ids: ['image1', 'image2'], duration: 3 };
describe('video card script/audio calibration', () => {
  it.each([[2500, 3000], [3000, 3000], [3100, 3600], [4000, 4500]])('retains the action floor and one tail for audio %i', (audioDurationMs, target) => {
    const timing = resolveVideoGroupTiming({ ids: ['image1'] }, images, { shot1: { plannedDurationMs: 3000, audioDurationMs } });
    expect(timing.targetMs).toBe(target);
    expect(timing.plannedMs).toBe(3000);
    expect(timing.shots[0].label).toBe('镜头2-1');
    expect(resolveVideoSelectedSeconds(group, timing, 4, 12)).toBe(Math.max(4, Math.ceil(target / 1000)));
  });
  it('sums both first/last shots instead of inheriting the first three seconds', () => {
    const timing = resolveVideoGroupTiming(group, images, { shot1: { plannedDurationMs: 3000 }, shot2: { plannedDurationMs: 3000, audioDurationMs: 2500 } });
    expect(timing.targetMs).toBe(6000);
    expect(resolveVideoSelectedSeconds(group, timing, 4, 12)).toBe(6);
  });
  it('calibrates per shot before summing and never counts candidate images', () => {
    const timing = resolveVideoGroupTiming(group, images, { shot1: { plannedDurationMs: 5000, audioDurationMs: 2000 }, shot2: { plannedDurationMs: 2000, audioDurationMs: 5000 }, extra: { plannedDurationMs: 10000 } });
    expect(timing.targetMs).toBe(10500);
    expect(resolveVideoSelectedSeconds(group, timing, 4, 12)).toBe(11);
    expect(getVideoDurationShortfall(timing, 10)).toContain('10.5秒');
    expect(getVideoDurationShortfall(timing, 11)).toBeNull();
  });
  it('shows the full target even when the provider maximum is shorter', () => {
    const timing = resolveVideoGroupTiming(group, images, { shot1: { plannedDurationMs: 8000 }, shot2: { plannedDurationMs: 8000 } });
    expect(timing.targetMs).toBe(16000);
    expect(resolveVideoSelectedSeconds(group, timing, 4, 12)).toBe(12);
    expect(getVideoDurationShortfall(timing, 12)).toContain('脚本 16秒');
    expect(resolveVideoSelectedSeconds({ duration: 5, durationUserOverride: true }, timing, 4, 12)).toBe(5);
    expect(resolveVideoSelectedSeconds({ duration: 3, durationUserOverride: true }, timing, 4, 12)).toBe(3);
  });
  it('does not invent script timing for manual cards or incomplete metadata', () => {
    const timing = resolveVideoGroupTiming(group, images, {});
    expect(timing.targetMs).toBeNull();
    expect(timing.plannedMs).toBeNull();
    expect(resolveVideoSelectedSeconds({ duration: 8 }, timing, 4, 12)).toBe(8);
    expect(getVideoDurationShortfall(timing, 4)).toBeNull();
    expect(resolveVideoGroupTiming(group, images, { shot1: { plannedDurationMs: 3000 } }).targetMs).toBeNull();
  });
  it('reload uses new script/audio values, clears removed audio and never compounds padding', () => {
    const saved = { shot1: { plannedDurationMs: 3000, audioDurationMs: 2500 }, shot2: { plannedDurationMs: 3000, audioDurationMs: 4000 } };
    const live = [{ item_id: 'shot1', planned_duration_ms: 5000, audio_duration_ms: 5500 }, { itemId: 'shot2', audioDurationMs: null }];
    const meta = mergeVideoTimingMetadata(saved, live);
    expect(resolveVideoGroupTiming(group, images, meta).targetMs).toBe(9000);
    expect(resolveVideoGroupTiming(group, images, mergeVideoTimingMetadata(JSON.parse(JSON.stringify(meta)), live)).targetMs).toBe(9000);
    expect(saved.shot1.plannedDurationMs).toBe(3000);
    expect(meta.shot2.audioDurationMs).toBeUndefined();
  });
});
