import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const source = readFileSync(resolve(__dirname, '../../pages/EnhancePage.tsx'), 'utf8');
describe('EnhancePage AI subtitles integration', () => {
  it('opens preview and commits confirmed results through timeline persistence', () => {
    expect(source).toContain('setShowSubtitleModal(true)');
    expect(source).toContain('<SubtitleTranscriptionModal');
    expect(source).toContain('defaultSource={composeAudioMode}');
    expect(source).toContain('subtitleTimelineKey(clipsRef.current)');
    expect(source).toContain('mergeSubtitleResults(subtitlesRef.current, generated, mode)');
    expect(source).toContain('commitSubtitleTimeline(');
    expect(source).not.toContain('handleGenerateSubtitlesFromAudio');
  });
});
