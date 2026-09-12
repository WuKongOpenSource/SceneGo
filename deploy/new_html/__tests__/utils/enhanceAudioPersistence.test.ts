import { describe, expect, it } from 'vitest';
import { moveTimelineClip, restoreEnhanceTimeline, serializeEnhanceTimeline, splitTimelineClip } from '../../utils/enhanceTimelineEditor';
import { syncTimelineAudioPlayback } from '../../utils/enhanceTimelineAudio';
import type { EnhanceMediaClip } from '../../utils/enhanceSourceClips';
import { registerEnhanceSave, waitForEnhanceSaves } from '../../utils/enhanceTimelinePersistence';

const music: EnhanceMediaClip = { id: 'aud_track_music', url: '/music.mp3', type: 'audio', audioKind: 'bgm',
  audioTrackId: 'music', startTime: 0, duration: 30, sourceDuration: 30, sourceOffset: 0, volume: 0.35 };

describe('enhancement audio persistence', () => {
  it('blocks a quick route reload until the last queued save completes', async () => {
    let finish!: () => void;
    let read = false;
    const write = new Promise<void>(resolve => { finish = resolve; });
    registerEnhanceSave('ep', write);
    const reload = waitForEnhanceSaves('ep').then(() => { read = true; });
    await Promise.resolve();
    expect(read).toBe(false);
    await waitForEnhanceSaves('other');
    finish();
    await reload;
    expect(read).toBe(true);
  });
  it('restores dragging, trimming and zero volume from a snapshot against stale track metadata', () => {
    const moved = moveTimelineClip([music], music.id, 36, { ripple: false, snap: false }).clips;
    const edited = [{ ...moved[0], duration: 19, sourceOffset: 2, volume: 0, fadeIn: 1, fadeOut: 2 }];
    expect(restoreEnhanceTimeline([music], serializeEnhanceTimeline(edited, []))[0]).toMatchObject(edited[0]);
  });
  it('keeps split audio instances and excludes deleted tracks while accepting newly added music', () => {
    const split = splitTimelineClip([music], music.id, 10, 'split_music');
    const snapshot = serializeEnhanceTimeline(split, [], [], undefined, ['aud_track_deleted']);
    const deleted = { ...music, id: 'aud_track_deleted', audioTrackId: 'deleted' };
    const added = { ...music, id: 'aud_track_new', audioTrackId: 'new' };
    const restored = restoreEnhanceTimeline([music, deleted, added], snapshot);
    expect(restored.map(clip => clip.id)).toEqual([music.id, 'split_music', added.id]);
    expect(restored[1]).toMatchObject({ sourceOffset: 10, duration: 20 });
  });
  it('uses restored volume and position for preview playback', async () => {
    const clips = restoreEnhanceTimeline([music], serializeEnhanceTimeline([{ ...music, startTime: 8, volume: 0.12 }], []));
    const audio = { currentTime: 0, volume: 1, paused: true, play() { this.paused = false; }, pause() { this.paused = true; } };
    await syncTimelineAudioPlayback({ clips, audioElements: new Map([[music.id, audio]]), currentTime: 9, playing: true });
    expect(audio).toMatchObject({ currentTime: 1, volume: 0.12, paused: false });
  });
});
