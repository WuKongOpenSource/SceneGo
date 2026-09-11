import { describe, expect, it } from 'vitest';
import { hasStoredVideoResult, mergeStoredVideoResult } from '../../utils/videoResultPresentation';

describe('hasStoredVideoResult', () => {
  it('keeps a previous successful video visible after a retry fails', () => {
    expect(hasStoredVideoResult({
      state: 'failed',
      videos: ['/storage/videos/previous-success.mp4'],
      error: 'latest generation failed',
    })).toBe(true);
  });

  it('does not treat an empty result list as video history', () => {
    expect(hasStoredVideoResult({ state: 'failed', videos: [] })).toBe(false);
    expect(hasStoredVideoResult({ state: 'failed', videos: [''] })).toBe(false);
  });

  it('adds a DB fallback video without hiding the latest failed attempt', () => {
    const merged = mergeStoredVideoResult(
      { state: 'failed', progress: 0, error: 'latest generation failed' },
      'https://app.example.test/storage/video/u/p/e/202607/ok.mp4?token=x',
      'Seedance2Mini',
    );

    expect(merged.state).toBe('failed');
    expect(merged.progress).toBe(0);
    expect(merged.result).toBe('https://app.example.test/storage/video/u/p/e/202607/ok.mp4?token=x');
    expect(merged.videos).toEqual(['https://app.example.test/storage/video/u/p/e/202607/ok.mp4?token=x']);
    expect(merged.videoModels).toEqual(['Seedance2Mini']);
    expect(merged.keepResult).toBe(true);
  });

  it('deduplicates the same stored video across absolute and relative URLs', () => {
    const original = {
      state: 'done' as const,
      videos: ['https://app.example.test/storage/video/u/p/e/202607/ok.mp4?token=old'],
    };
    const merged = mergeStoredVideoResult(original, '/storage/video/u/p/e/202607/ok.mp4');

    expect(merged).toBe(original);
  });

  it('backfills a missing historical model when the persisted segment identifies it', () => {
    const original = {
      state: 'done' as const,
      videos: ['https://app.example.test/storage/video/u/p/e/202607/ok.mp4?token=old'],
    };
    const merged = mergeStoredVideoResult(
      original,
      '/storage/video/u/p/e/202607/ok.mp4',
      'Kling',
    );

    expect(merged.videoModels).toEqual(['Kling']);
  });
});
