import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineTrack } from '../../components/TimelineTrack';

describe('TimelineTrack audio actions', () => {
  beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('shows BGM and sound-effect actions even before audio clips exist', () => {
    const onAddBgm = vi.fn();
    const onGenerateBgm = vi.fn();
    const onAddSfx = vi.fn();
    const onGenerateSfx = vi.fn();

    render(
      <TimelineTrack
        mode="combined"
        clips={[
          {
            id: 'image-1',
            label: '镜头 1',
            track: 'image',
            durationMs: 3000,
            startMs: 0,
          },
        ]}
        totalDurationMs={3000}
        onAddBgm={onAddBgm}
        onGenerateBgm={onGenerateBgm}
        onAddSfx={onAddSfx}
        onGenerateSfx={onGenerateSfx}
      />,
    );

    expect(screen.getByText('BGM')).toBeInTheDocument();
    expect(screen.getByText('音效')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('添加本地 BGM'));
    fireEvent.click(screen.getByTitle('AI 音乐制作'));
    fireEvent.click(screen.getByTitle('添加本地音效'));
    fireEvent.click(screen.getByTitle('AI 音效制作'));

    expect(onAddBgm).toHaveBeenCalledOnce();
    expect(onGenerateBgm).toHaveBeenCalledOnce();
    expect(onAddSfx).toHaveBeenCalledOnce();
    expect(onGenerateSfx).toHaveBeenCalledOnce();
  });

  it('exposes delete actions for BGM and sound-effect clips', () => {
    const onDeleteClip = vi.fn();

    render(
      <TimelineTrack
        mode="combined"
        clips={[
          {
            id: 'track_bgm_1',
            label: 'BGM',
            track: 'bgm',
            audioUrl: '/bgm.mp3',
            durationMs: 3000,
            startMs: 0,
          },
          {
            id: 'track_sfx_1',
            label: '音效',
            track: 'sfx',
            audioUrl: '/sfx.mp3',
            durationMs: 1000,
            startMs: 1000,
          },
        ]}
        totalDurationMs={3000}
        onDeleteClip={onDeleteClip}
      />,
    );

    fireEvent.click(screen.getByTitle('删除 BGM'));
    fireEvent.click(screen.getByTitle('删除音效'));

    expect(onDeleteClip).toHaveBeenCalledTimes(2);
    expect(onDeleteClip.mock.calls[0][0].id).toBe('track_bgm_1');
    expect(onDeleteClip.mock.calls[1][0].id).toBe('track_sfx_1');
  });
});
