import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/audio/MusicModal.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');

describe('MusicModal story summary and lyrics', () => {
  it('prefills the persisted summary and protects a manual edit', () => {
    expect(source).toContain('script?.metadata?.story_summary');
    expect(source).toContain('summaryDirtyRef.current = true');
    expect(source).toContain('if (!summaryDirtyRef.current) setLyricsInput(summary)');
    expect(source).toContain('STORY_SUMMARY_MAX_CHARACTERS');
  });

  it('uses the text task pipeline instead of the retired MiniMax lyrics endpoint', () => {
    expect(source).toContain('generateLyricsFromSummary(text');
    expect(source).toContain("operation: 'music_lyrics_generate'");
    expect(source).not.toContain('minimaxLyrics');
    expect(source).not.toContain('/api/minimax/lyrics');
  });
});
