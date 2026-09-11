import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const musicSource = readFileSync(resolve(__dirname, '../../components/audio/MusicModal.tsx'), 'utf-8');
const mediaSource = readFileSync(resolve(__dirname, '../../pages/MediaLibraryPage.tsx'), 'utf-8');

describe('generation and media interaction feedback', () => {
  it('renders lyrics, music and upload failures inside the music panel', () => {
    expect(musicSource).toContain('歌词生成失败：{lyricsError}');
    expect(musicSource).toContain('音乐生成失败：{musicError}');
    expect(musicSource).toContain('上传失败：{uploadError}');
    expect(musicSource.match(/role="alert"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(musicSource).not.toContain('alert(`歌词生成失败');
    expect(musicSource).not.toContain('alert(`音乐生成失败');
  });

  it('uses an in-page folder editor instead of a browser prompt', () => {
    expect(mediaSource).toContain('aria-labelledby="media-folder-editor-title"');
    expect(mediaSource).toContain("mode: 'create' | 'rename'");
    expect(mediaSource).toContain('创建文件夹');
    expect(mediaSource).not.toContain('window.prompt');
  });

  it('renders video library cards from cached thumbnails using the filmstrip treatment', () => {
    expect(mediaSource).toContain('/api/thumbnail?url=${encodeURIComponent(item.file_url)}&width=640&height=360');
    expect(mediaSource).toContain('<FilmstripThumbnail src={thumb} alt="视频缩略图" />');
  });
});
