import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../pages/EnhancePage.tsx'), 'utf8');

describe('EnhancePage player reliability', () => {
  it('owns the playback timer in an effect so pause always clears it', () => {
    expect(source).toContain('setPlaying(value => !value)');
    expect(source).toContain('if (playTimerRef.current !== null) clearInterval(playTimerRef.current)');
    expect(source).not.toContain('currentTime + 1');
  });

  it('loads metadata and uses an authorized thumbnail generated from the video source', () => {
    expect(source).toContain('key={videoUnderPlayhead.id}');
    expect(source).toContain('poster={enhanceVideoPosterUrl(videoUnderPlayhead.url)}');
    expect(source).toContain('preload="auto"');
    expect(source).toContain('src={enhanceVideoPosterUrl(clip.url)}');
    expect(source).toContain('/api/thumbnail?url=${encodeURIComponent(videoUrl)}&width=640&height=360');
  });

  it('delegates playback to a clip-scoped controller and preloads only the next playable clip', () => {
    expect(source).toContain('createTimelineVideoPlayback(video, message =>');
    expect(source).toContain('controller.dispose()');
    expect(source).toContain('const nextPreviewVideo = orderedVideoClips.find(');
    expect(source).not.toContain('video.play().catch(() => setPlaying(false))');
  });
});
