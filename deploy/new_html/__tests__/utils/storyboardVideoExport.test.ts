import { describe, expect, it } from 'vitest';
import {
  STORYBOARD_VIDEO_EXPORT_STATE_KEY,
  buildStoryboardVideoExportImageMap,
  buildStoryboardVideoExportNavigationState,
  isDurableStoryboardImageUrl,
  normalizeStoryboardVideoExportPayload,
  readStoryboardVideoExportNavigationState,
  selectStoryboardItemsForVideoExport,
} from '../../utils/storyboardVideoExport';

describe('storyboard video export handoff', () => {
  it('normalizes the selected shots and rejects duplicate or invalid ids', () => {
    expect(normalizeStoryboardVideoExportPayload({
      items: [
        { shotId: ' sb_2 ', finalImage: ' /storage/two.png ', videoPrompt: ' 推镜 ' },
        { shotId: '', finalImage: '/storage/missing.png' },
        { shotId: 'sb_2', finalImage: '/storage/duplicate.png' },
        { shotId: 'sb_4', finalImage: null },
      ],
    })).toEqual({
      version: 1,
      items: [
        { shotId: 'sb_2', finalImage: '/storage/two.png', videoPrompt: '推镜', script: undefined, imagePrompt: undefined },
        { shotId: 'sb_4', finalImage: null, script: undefined, imagePrompt: undefined, videoPrompt: undefined },
      ],
    });
  });

  it('round-trips the payload through router navigation state', () => {
    const payload = normalizeStoryboardVideoExportPayload({
      items: [{ shotId: 'sb_1', finalImage: '/storage/one.png' }],
    })!;
    const state = buildStoryboardVideoExportNavigationState(payload);

    expect(state).toHaveProperty(STORYBOARD_VIDEO_EXPORT_STATE_KEY);
    expect(readStoryboardVideoExportNavigationState(state)).toEqual(payload);
    expect(readStoryboardVideoExportNavigationState({})).toBeNull();
  });

  it('imports only selected shots while preserving canonical storyboard order', () => {
    const storyboardItems = [
      { item_id: 'sb_1', sort_order: 0 },
      { item_id: 'sb_2', sort_order: 1 },
      { item_id: 'sb_3', sort_order: 2 },
    ];
    const payload = normalizeStoryboardVideoExportPayload({
      items: [{ shotId: 'sb_3' }, { shotId: 'sb_1' }],
    });

    expect(selectStoryboardItemsForVideoExport(storyboardItems, payload)).toEqual([
      storyboardItems[0],
      storyboardItems[2],
    ]);
  });

  it('keeps selected entity-file images as import overrides and identifies durable urls', () => {
    const payload = normalizeStoryboardVideoExportPayload({
      items: [
        { shotId: 'sb_1', finalImage: '/storage/selected.png' },
        { shotId: 'sb_2', finalImage: null },
      ],
    });

    expect(buildStoryboardVideoExportImageMap(payload).get('sb_1')).toBe('/storage/selected.png');
    expect(buildStoryboardVideoExportImageMap(payload).has('sb_2')).toBe(false);
    expect(isDurableStoryboardImageUrl('/storage/selected.png')).toBe(true);
    expect(isDurableStoryboardImageUrl('https://cdn.example/selected.png')).toBe(true);
    expect(isDurableStoryboardImageUrl('blob:temporary')).toBe(false);
    expect(isDurableStoryboardImageUrl('data:image/png;base64,abc')).toBe(false);
  });
});
