import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../pages/EnhancePage.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');

describe('EnhancePage AI audio subtitles', () => {
  it('uses audible voice clips and maps clip-relative timestamps onto the current timeline', () => {
    expect(source).toContain("clip.audioKind === 'voice'");
    expect(source).toContain('sourceOffsetMs: Math.round(clip.sourceOffset * 1000)');
    expect(source).toContain('const startTime = clip.startTime + segment.startMs / 1000');
    expect(source).toContain('duration: endTime - startTime');
    expect(source).toContain('AI 语音字幕');
  });

  it('does not silently replace existing subtitles or apply stale transcription results', () => {
    expect(source).toContain('当前已有字幕。继续将用 AI 识别结果替换现有字幕，是否继续？');
    expect(source).toContain('timelineRevisionRef.current !== requestedRevision');
    expect(source).toContain('currentSignature !== requestedSignature');
    expect(source).toContain('识别期间时间线已变化，未覆盖当前字幕');
  });
});
