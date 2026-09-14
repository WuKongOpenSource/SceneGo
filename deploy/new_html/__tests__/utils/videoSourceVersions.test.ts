import { describe, expect, it } from 'vitest';
import { applyVideoSource, videoSourceLabels, videoSourceSettings } from '../../utils/videoSourceVersions';
import { restoreEnhanceTimeline, serializeEnhanceTimeline } from '../../utils/enhanceTimelineEditor';
import type { EnhanceMediaClip } from '../../utils/enhanceSourceClips';
import type { EntityFile } from '../../services/entityFileService';

const file = (fields: Partial<EntityFile>): EntityFile => ({ fileId: 'f', fileUrl: '/v.mp4', fileType: 'video',
  fileRole: 'video', isSelected: false, createdAt: '', ...fields });

describe('video source provenance', () => {
  it.each(['upscale', 'viedo_upscaler', 'video_upscale'])('labels historical %s results', model => {
    expect(videoSourceLabels(videoSourceSettings(file({ metadata: { model } })))).toEqual(['已高清化']);
  });
  it('does not classify a source using its filename or old editing settings', () => {
    expect(videoSourceLabels(videoSourceSettings(file({ fileUrl: '/upscale.mp4', metadata: { model: 'Seedance' } })))).toEqual([]);
  });
  it('recognizes a verified legacy HD timing contract without labeling ordinary engine outputs', () => {
    const timing = { source_duration_ms: 5086, output_duration_ms: 5086, source_frame_count: 121, source_fps: '24' };
    expect(videoSourceLabels(videoSourceSettings(file({ metadata: { model: 'Wan2', timing_contract: timing } })))).toEqual(['已高清化']);
    expect(videoSourceLabels(videoSourceSettings(file({ metadata: { model: 'Wan2' } })))).toEqual([]);
    expect(videoSourceLabels(videoSourceSettings(file({ metadata: { timing_contract: {} } })))).toEqual([]);
    expect(videoSourceLabels(videoSourceSettings(file({ metadata: { timing_contract: { ...timing, output_duration_ms: 4840 } } })))).toEqual([]);
  });
  it('restores all cuts of a source without moving or mutating any edit or audio', () => {
    const clips: EnhanceMediaClip[] = [
      { id: 'a', sourceId: 'v', url: '/hd.mp4', type: 'video', startTime: 2, duration: 3, sourceOffset: 1, transitionAfter: 'fade', transitionDuration: .5 },
      { id: 'b', sourceId: 'v', url: '/hd.mp4', type: 'video', startTime: 5, duration: 2, sourceOffset: 8 },
      { id: 'music', url: '/m.mp3', type: 'audio', startTime: 4, duration: 8, sourceOffset: 0, volume: .35, fadeOut: 2 },
    ];
    const changed = applyVideoSource(clips, 'v', file({ durationSeconds: 12 }), '/original.mp4');
    expect(changed[0]).toMatchObject({ url: '/original.mp4', startTime: 2, duration: 3, sourceOffset: 1, transitionAfter: 'fade', transitionDuration: .5 });
    expect(changed[1]).toMatchObject({ url: '/original.mp4', startTime: 5, duration: 2, sourceOffset: 8 });
    expect(changed[2]).toBe(clips[2]);
    expect(clips[0].url).toBe('/hd.mp4');
  });
  it('reads processing labels from the current source after reload, not stale saved flags', () => {
    const clip: EnhanceMediaClip = { id: 'v', url: '/original.mp4', type: 'video', startTime: 0, duration: 5, sourceOffset: 0,
      settings: { upscale: false, interpolate: false, lipSync: false }, enhancement: { upscale: false, interpolate: false, lipSync: false } };
    const saved = serializeEnhanceTimeline([{ ...clip, settings: { ...clip.settings!, upscale: true } }], ['v']);
    expect(restoreEnhanceTimeline([clip], saved)[0].enhancement?.upscale).toBe(false);
    expect(restoreEnhanceTimeline([{ ...clip, url: '/hd.mp4', enhancement: { ...clip.enhancement!, upscale: true } }], saved)[0].enhancement?.upscale).toBe(true);
  });
});
