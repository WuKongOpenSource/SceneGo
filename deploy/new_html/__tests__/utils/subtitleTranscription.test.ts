import { describe, expect, it } from 'vitest';
import { buildSubtitleChunks, mergeSubtitleResults, subtitleTimelineKey } from '../../utils/subtitleTranscription';
import type { EnhanceMediaClip } from '../../utils/enhanceSourceClips';
const video: EnhanceMediaClip = { id: 'v', type: 'video', url: '/storage/v.mp4', sourceOffset: 2, startTime: 5, duration: 125 };
const manual = { id: 'manual', text: 'edited', startTime: 1, duration: 2 };
const auto = { id: 'asr_old', text: 'old', startTime: 5, duration: 2 };
const generated = [{ ...manual, id: 'asr_1' }, { ...auto, id: 'asr_2' }];
describe('subtitle timeline planning', () => {
  it('preserves original crop offsets and timeline placement across minute chunks', () => {
    expect(buildSubtitleChunks([video], 'video_original').map(c => [c.sourceOffsetMs, c.timelineStartMs, c.durationMs])).toEqual([[2000,5000,60000],[62000,65000,60000],[122000,125000,5000]]);
  });
  it('only includes audible voice tracks, never music or sound effects', () => {
    const voice: EnhanceMediaClip = { ...video, id: 'a', type: 'audio', audioKind: 'voice', startTime: 128, duration: 9 };
    const chunks = buildSubtitleChunks([video, voice, { ...voice, id:'b', audioKind:'bgm' }, { ...voice, id:'c', audioKind:'sfx' }, { ...voice,id:'d',volume:0 }], 'reference_dubbing');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ clipId:'a',durationMs:2000,sourceOffsetMs:2000,timelineStartMs:128000 });
  });
  it('rejects invalid ranges and detects changes to clip content', () => {
    expect(() => buildSubtitleChunks([{...video,sourceOffset:-1}], 'video_original')).toThrow();
    expect(subtitleTimelineKey([video])).not.toBe(subtitleTimelineKey([{...video,sourceOffset:3}]));
  });
  it('does not lose a tiny remainder at minute boundaries', () => {
    expect(buildSubtitleChunks([{...video,duration:60.05}], 'video_original').map(c=>c.durationMs)).toEqual([59900,150]);
  });
  it('preserves manual cues by default and updates only generated cues when requested', () => {
    expect(mergeSubtitleResults([manual,auto],generated,'fill_gaps')).toMatchObject({subtitles:[manual,auto],added:0,skipped:2});
    expect(mergeSubtitleResults([manual,auto],generated,'update_generated').subtitles).toEqual([manual,generated[1]]);
    expect(mergeSubtitleResults([manual,auto],generated,'replace').subtitles).toEqual(generated);
    expect(manual.text).toBe('edited');
  });
});
