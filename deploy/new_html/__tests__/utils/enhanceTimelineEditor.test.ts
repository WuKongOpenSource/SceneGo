import { describe, expect, it } from 'vitest';
import type { EnhanceMediaClip } from '../../utils/enhanceSourceClips';
import {
  DEFAULT_ENHANCE_SUBTITLE_STYLE,
  normalizeEnhanceSubtitleStyle,
  resolveSubtitleCoordinates,
  composeSubtitleItems,
  composeSubtitleStyle,
  composeTimelineItems,
  deleteTimelineClip,
  duplicateTimelineClip,
  formatTimelineTime,
  layoutVideoClips,
  moveTimelineClip,
  moveSubtitleCue,
  resolveTimelineSnap,
  restoreEnhanceTimeline,
  restoreEnhanceSubtitles,
  restoreEnhanceSubtitleStyle,
  serializeEnhanceTimeline,
  splitTimelineClip,
  trimTimelineClip,
  trimSubtitleCue,
} from '../../utils/enhanceTimelineEditor';

function video(id: string, startTime: number, duration: number): EnhanceMediaClip {
  return {
    id,
    sourceId: id,
    url: `/${id}.mp4`,
    startTime,
    duration,
    sourceDuration: duration,
    sourceOffset: 0,
    type: 'video',
    settings: { upscale: false, interpolate: false, lipSync: false },
  };
}

describe('enhance timeline editor', () => {
  it('round-trips subtitle coordinates and bounds malformed positions', () => {
    const style = { ...DEFAULT_ENHANCE_SUBTITLE_STYLE, positionX: 25.25, positionY: 72.5 };
    const saved = serializeEnhanceTimeline([], [], [], style);
    const restored = restoreEnhanceSubtitleStyle(saved);
    expect(restored).toEqual(style);
    expect(composeSubtitleStyle(restored)).toMatchObject({ position_x: 25.25, position_y: 72.5 });
    expect(resolveSubtitleCoordinates(style)).toEqual({ x: 25.25, y: 72.5 });
    expect(normalizeEnhanceSubtitleStyle({ positionX: -1, positionY: 200 })).toMatchObject({ positionX: 0, positionY: 100 });
    expect(resolveSubtitleCoordinates({ ...style, position: 'top', positionX: NaN, positionY: Infinity })).toEqual({ x: 50, y: 6 });
  });
  it('splits a clip without changing the total video duration', () => {
    const result = splitTimelineClip([video('a', 0, 5), video('b', 5, 4)], 'a', 2, 'a-copy');

    expect(result.filter(clip => clip.type === 'video')).toMatchObject([
      { id: 'a', startTime: 0, duration: 2, sourceOffset: 0 },
      { id: 'a-copy', sourceId: 'a', startTime: 2, duration: 3, sourceOffset: 2 },
      { id: 'b', startTime: 5, duration: 4 },
    ]);
  });

  it('ripple-deletes and reorders the single video lane', () => {
    const clips = [video('a', 0, 2), video('b', 2, 3), video('c', 5, 4)];
    const deleted = deleteTimelineClip(clips, 'b');
    expect(deleted.map(clip => [clip.id, clip.startTime])).toEqual([['a', 0], ['c', 2]]);

    const moved = moveTimelineClip(clips, 'c', 0.1, { ripple: true, snap: false }).clips;
    expect(moved.filter(clip => clip.type === 'video').map(clip => [clip.id, clip.startTime]))
      .toEqual([['a', 4], ['b', 6], ['c', 0]]);
  });

  it('trims source in/out and keeps following video clips contiguous', () => {
    const clips = [video('a', 0, 5), video('b', 5, 4)];
    const left = trimTimelineClip(clips, 'a', 'left', 1);
    expect(left[0]).toMatchObject({ startTime: 0, sourceOffset: 1, duration: 4 });
    expect(left[1].startTime).toBe(4);

    const right = trimTimelineClip(left, 'a', 'right', -1.5);
    expect(right[0].duration).toBe(2.5);
    expect(right[1].startTime).toBe(2.5);
  });

  it('duplicates a source and sends both cuts to composition', () => {
    const duplicated = duplicateTimelineClip([video('a', 0, 5)], 'a', 'a-2');
    expect(composeTimelineItems(duplicated)).toEqual([
      { clip_id: 'a', segment_id: 'a', start_ms: 0, duration_ms: 5000, source_offset_ms: 0, source_duration_ms: 5000 },
      { clip_id: 'a-2', segment_id: 'a', start_ms: 5000, duration_ms: 5000, source_offset_ms: 0, source_duration_ms: 5000 },
    ]);
  });

  it('round-trips persisted cuts and remembers excluded source clips', () => {
    const source = [video('a', 0, 5), video('b', 5, 4), video('c', 9, 2)];
    const edited = splitTimelineClip(deleteTimelineClip(source, 'b'), 'a', 2, 'a-split');
    const saved = serializeEnhanceTimeline(edited, source.map(clip => clip.id));
    const restored = restoreEnhanceTimeline(source, saved);

    expect(restored.filter(clip => clip.type === 'video').map(clip => clip.id)).toEqual(['a', 'a-split', 'c']);
    expect(saved).toContainEqual({ kind: 'excluded_video', sourceId: 'b' });
  });

  it('persists transitions and reserves timeline space for a black screen', () => {
    const first = { ...video('a', 0, 5), transitionAfter: 'black' as const, transitionDuration: 0.7 };
    const laidOut = layoutVideoClips([first, video('b', 5, 4)]);
    expect(laidOut[1].startTime).toBe(5.7);

    const saved = serializeEnhanceTimeline(laidOut, ['a', 'b']);
    expect(saved[0]).toMatchObject({
      transitionAfter: 'black',
      transitionDurationMs: 700,
    });
    expect(composeTimelineItems(laidOut)[0]).toMatchObject({
      transition_after: 'black',
      transition_duration_ms: 700,
    });
    expect(restoreEnhanceTimeline([video('a', 0, 5), video('b', 5, 4)], saved)[0])
      .toMatchObject({ transitionAfter: 'black', transitionDuration: 0.7 });
  });

  it('uses the closest snap point and formats frame timecode', () => {
    expect(resolveTimelineSnap(4.91, [0, 5, 9], 0.2)).toEqual({ time: 5, guide: 5 });
    expect(formatTimelineTime(65.5, 30)).toBe('00:01:05:15');
  });

  it('moves and trims subtitle cues inside the final video duration', () => {
    const source = [{ id: 's1', text: '中文字幕', startTime: 1, duration: 3 }];
    expect(moveSubtitleCue(source, 's1', 9, 10)[0]).toMatchObject({ startTime: 7, duration: 3 });

    const left = trimSubtitleCue(source, 's1', 'left', 1, 10);
    expect(left[0]).toMatchObject({ startTime: 2, duration: 2 });
    const right = trimSubtitleCue(left, 's1', 'right', 20, 10);
    expect(right[0]).toMatchObject({ startTime: 2, duration: 8 });
  });

  it('persists subtitles and style while keeping legacy video snapshots compatible', () => {
    const subtitles = [{ id: 's1', text: '第一行\n第二行', startTime: 1.25, duration: 2.5 }];
    const style = { ...DEFAULT_ENHANCE_SUBTITLE_STYLE, position: 'top' as const, backgroundOpacity: 0.3 };
    const saved = serializeEnhanceTimeline([video('a', 0, 5)], ['a'], subtitles, style);

    expect(restoreEnhanceSubtitles(saved)).toEqual(subtitles);
    expect(restoreEnhanceSubtitleStyle(saved)).toEqual(style);
    expect(restoreEnhanceSubtitles([{ kind: 'video', sourceId: 'a' }])).toEqual([]);
    expect(restoreEnhanceSubtitleStyle([{ kind: 'video', sourceId: 'a' }]))
      .toEqual(DEFAULT_ENHANCE_SUBTITLE_STYLE);
  });

  it('builds a bounded subtitle composition payload and drops blank cues', () => {
    expect(composeSubtitleItems([
      { id: 'blank', text: '   ', startTime: 0, duration: 1 },
      { id: 's1', text: '字幕', startTime: 1.234, duration: 2.345 },
    ])).toEqual([{
      cue_id: 's1',
      text: '字幕',
      start_ms: 1234,
      duration_ms: 2345,
    }]);
    expect(composeSubtitleStyle({
      fontSize: 999,
      textColor: '#12abef',
      backgroundColor: 'bad',
      backgroundOpacity: -1,
      position: 'center',
    })).toEqual({
      font_size: 96,
      text_color: '#12ABEF',
      background_color: '#000000',
      background_opacity: 0,
      position: 'center',
    });
  });
});
