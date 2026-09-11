import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { EpisodeProvider, useEpisode } from '../../contexts/EpisodeContext';
import { getAudioTracks, getVideoSegments } from '../../services/episodeDataService';

vi.mock('../../services/episodeDataService', () => ({
  getAudioTracks: vi.fn(), getVideoSegments: vi.fn(), getEpisodeScript: vi.fn(), getStoryboardItems: vi.fn(),
  getAssets: vi.fn(), getCharacterVoices: vi.fn(), updateStoryboardItem: vi.fn(), updateEpisodeScript: vi.fn(),
  batchCreateStoryboardItems: vi.fn(), extractToAssets: vi.fn(),
}));
vi.mock('../../services/scriptTimelineService', () => ({
  getWorkflowScript: vi.fn(async () => ({ success: true, script_id: null })),
  listEpisodeScripts: vi.fn(), selectWorkflowScript: vi.fn(), updateEpisodeScriptById: vi.fn(),
}));

let context: ReturnType<typeof useEpisode>;
function Probe({ onMount }: { onMount?: boolean }) {
  context = useEpisode();
  useEffect(() => { if (onMount) void context.loadSlices('audioTracks'); }, [onMount]);
  return <span>{context.audioTracks[0]?.trackId || 'empty'}</span>;
}
const tree = (key: string, children: React.ReactNode) => <MemoryRouter>
  <EpisodeProvider key={key} projectId="project" episodeId={key}>{children}</EpisodeProvider>
</MemoryRouter>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAudioTracks).mockResolvedValue({ success: true, tracks: [{ track_id: 'first' }] } as any);
  vi.mocked(getVideoSegments).mockResolvedValue({ success: true, segments: [] });
});

describe('workflow data reuse', () => {
  it('shares mount reads, reuses data between stages and refreshes only the mutated slice', async () => {
    const view = render(tree('ep1', <><Probe onMount /><Probe onMount /></>));
    await waitFor(() => expect(context.audioTracks[0]?.trackId).toBe('first'));
    expect(getAudioTracks).toHaveBeenCalledTimes(1);
    view.rerender(tree('ep1', <Probe onMount />));
    await act(async () => { await context.loadSlices('audioTracks', 'videoSegments'); });
    expect(getAudioTracks).toHaveBeenCalledTimes(1);
    expect(getVideoSegments).toHaveBeenCalledTimes(1);
    vi.mocked(getAudioTracks).mockResolvedValue({ success: true, tracks: [{ track_id: 'new' }] } as any);
    await act(async () => { await context.forceReloadSlicesQuiet('audioTracks'); });
    expect(context.audioTracks[0]?.trackId).toBe('new');
    expect(context.isLoading).toBe(false);
    expect(getVideoSegments).toHaveBeenCalledTimes(1);
  });

  it('retries failed loads instead of treating errors as cached success', async () => {
    vi.mocked(getAudioTracks).mockRejectedValueOnce(new Error('offline'));
    render(tree('ep1', <Probe onMount />));
    await waitFor(() => expect(context.error).toBeTruthy());
    await act(async () => { await context.loadSlices('audioTracks'); });
    expect(context.audioTracks[0]?.trackId).toBe('first');
    expect(getAudioTracks).toHaveBeenCalledTimes(2);
  });

  it('does not leak a late response from an old episode into the new stage', async () => {
    let release!: (data: any) => void;
    vi.mocked(getAudioTracks).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const view = render(tree('ep1', <Probe onMount />));
    await waitFor(() => expect(getAudioTracks).toHaveBeenCalledTimes(1));
    view.rerender(tree('ep2', <Probe onMount />));
    await waitFor(() => expect(context.audioTracks[0]?.trackId).toBe('first'));
    await act(async () => { release({ success: true, tracks: [{ track_id: 'old' }] }); });
    expect(context.audioTracks[0]?.trackId).toBe('first');
  });
});
