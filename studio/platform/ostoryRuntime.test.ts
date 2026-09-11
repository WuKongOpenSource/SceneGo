import { describe, expect, it } from 'vitest';
import {
  buildSeedanceMediaInputs,
  assertStudioBatchCredits,
  chargeSuccessfulResult,
  extractVideoResult,
  getStudioVideoTaskKind,
  parseStudioSnapshot,
  stripEmbeddedMedia,
} from './ostoryRuntime';

describe('创剧 Studio runtime helpers', () => {
  it('maps first/last frame references without duplicating the input image', () => {
    expect(buildSeedanceMediaInputs('FIRST_LAST_FRAME', 'first.png', ['first.png', 'last.png', 'ref.png']))
      .toEqual([
        { kind: 'image', url: 'first.png', role: 'first_frame' },
        { kind: 'image', url: 'last.png', role: 'last_frame' },
        { kind: 'image', url: 'ref.png', role: 'reference_image' },
      ]);
  });

  it('removes embedded data URLs before persistence', () => {
    expect(stripEmbeddedMedia({ image: 'data:image/png;base64,abc', nested: ['https://files/image.png'] }))
      .toEqual({ image: '', nested: ['https://files/image.png'] });
  });

  it('rejects snapshots from another schema', () => {
    expect(parseStudioSnapshot({ schemaVersion: 2, assets: [], workflows: [], nodes: [], connections: [], groups: [] }))
      .toBeNull();
  });

  it('extracts the generated video URL from supported task payloads', () => {
    expect(extractVideoResult({ result: { videos: [{ url: '/storage/video.mp4' }] } }))
      .toBe('/storage/video.mp4');
    expect(extractVideoResult({ result: { file_url: '/storage/fallback.mp4' } }))
      .toBe('/storage/fallback.mp4');
  });

  it('never charges a failed generation', async () => {
    let chargeCalls = 0;
    await expect(chargeSuccessfulResult(
      async () => {
        throw new Error('provider failed');
      },
      async () => {
        chargeCalls += 1;
      },
    )).rejects.toThrow('provider failed');
    expect(chargeCalls).toBe(0);
  });

  it('blocks a batch before submission when the total video balance is insufficient', () => {
    expect(() => assertStudioBatchCredits({
      enabled: true,
      estimated_cost: 75,
      balance: 149,
    }, 2)).toThrow('本次预计需要 150 创作点数');

    expect(() => assertStudioBatchCredits({
      enabled: true,
      estimated_cost: 75,
      balance: 150,
    }, 2)).not.toThrow();
  });

  it('maps the complete model catalog to notification task kinds', () => {
    expect(getStudioVideoTaskKind('Seedance2Mini')).toBe('seedance-fast');
    expect(getStudioVideoTaskKind('MiniMaxH3')).toBe('video-comfy');
    expect(getStudioVideoTaskKind('Kling')).toBe('kling');
    expect(getStudioVideoTaskKind('Vidu')).toBe('vidu');
    expect(getStudioVideoTaskKind('HappyHorse')).toBe('happyhorse');
  });
});
