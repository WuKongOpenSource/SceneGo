import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MusicAssetSidebar } from '../../components/audio/MusicAssetSidebar';
import type { AudioTrack } from '../../types';

function track(overrides: Partial<AudioTrack>): AudioTrack {
  return {
    trackId: 'track_1',
    episodeId: 'ep_1',
    trackType: 'bgm',
    name: 'AI 背景音乐',
    audioUrl: '/storage/audio/music.wav',
    durationMs: 30_000,
    startItemId: null,
    endItemId: null,
    generationParams: { source: 'local_minimax_music3', mode: 'instrumental' },
    ...overrides,
  };
}

describe('MusicAssetSidebar', () => {
  it('shows an empty state before music is generated', () => {
    render(<MusicAssetSidebar audioTracks={[]} />);

    expect(screen.getByRole('complementary', { name: '音频资产' })).toBeInTheDocument();
    expect(screen.getByText('暂无音乐资产')).toBeInTheDocument();
  });

  it('lists persisted music assets newest first and excludes sound effects', () => {
    render(
      <MusicAssetSidebar
        audioTracks={[
          track({ trackId: 'old', name: '旧背景音乐' }),
          track({
            trackId: 'theme',
            name: '新主题曲',
            durationMs: 65_000,
            generationParams: { source: 'local_minimax_music3', mode: 'theme' },
          }),
          track({ trackId: 'sfx', trackType: 'sfx_global', name: '环境音效' }),
        ]}
      />,
    );

    expect(screen.getByText('新主题曲')).toBeInTheDocument();
    expect(screen.getByText('旧背景音乐')).toBeInTheDocument();
    expect(screen.queryByText('环境音效')).not.toBeInTheDocument();
    expect(screen.getAllByText('AI 生成')).toHaveLength(2);
    expect(screen.getByText('主题曲')).toBeInTheDocument();
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.getByLabelText('下载 新主题曲')).toHaveAttribute('href', '/storage/audio/music.wav');
    const names = screen.getAllByText(/背景音乐|主题曲/).map(node => node.textContent);
    expect(names.indexOf('新主题曲')).toBeLessThan(names.indexOf('旧背景音乐'));
  });

  it('shows generated sound effects in the parallel asset category', () => {
    render(
      <MusicAssetSidebar
        audioTracks={[
          track({
            trackId: 'sfx',
            trackType: 'sfx_global',
            name: 'AI 雷声音效',
            durationMs: 4_000,
            generationParams: { source: 'minimax_sfx', description: '远处雷声' },
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: '音效 1' }));

    expect(screen.getByText('AI 雷声音效')).toBeInTheDocument();
    expect(screen.getByText('AI 生成')).toBeInTheDocument();
    expect(screen.getByText('音效')).toBeInTheDocument();
    expect(screen.getByText('0:04')).toBeInTheDocument();
  });
});
