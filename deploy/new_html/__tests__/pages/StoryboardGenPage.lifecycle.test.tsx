import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const episode = vi.hoisted(() => ({
  episodeId: 'ep-1', projectId: 'project', selectedScriptId: 'script', script: null,
  storyboardItems: [{ itemId: 'one', sortOrder: 0 }, { itemId: 'two', sortOrder: 1 }],
  assets: [], audioTracks: [], isLoading: false, error: '',
  loadSlicesQuiet: vi.fn(async () => {}), forceReloadSlices: vi.fn(async () => {}),
  forceReloadSlicesQuiet: vi.fn(async () => {}), loadStoryboardItemsPage: vi.fn(async () => {}),
}));
vi.mock('../../contexts/EpisodeContext', () => ({ useEpisode: () => episode }));
vi.mock('../../hooks/useFilesMutation', () => ({ useSelectFileMutation: () => ({}), useDeleteFileMutation: () => ({}) }));
vi.mock('../../services/entityFileService', () => ({ fetchEntityFiles: async () => ({ items: [] }) }));
vi.mock('../../utils/episodeAdapters', () => ({
  scriptToProjectFile: () => ({ id: 'ep-1', storyboard: { items: [{ id: 'one' }, { id: 'two' }] } }),
  assetsToMaterialLibrary: () => ({}), storyboardItemToDbUpdate: () => ({}),
}));
vi.mock('../../components/GenerationPage', () => ({ GenerationPage: ({ onForceSave }: any) => {
  const [shot, setShot] = useState('one');
  const [pending, setPending] = useState(false);
  return <div>
    <button onClick={() => setPending(true)}>生成镜头一</button>
    <button onClick={() => setShot(shot === 'one' ? 'two' : 'one')}>切换镜头</button>
    <button onClick={onForceSave}>刷新已保存资料</button>
    {shot === 'one' && pending && <p>镜头一正在生成</p>}
  </div>;
} }));
import { StoryboardGenPage } from '../../pages/StoryboardGenPage';

describe('storyboard generation lifecycle', () => {
  it('keeps the workspace mounted across shot switches and background refresh or errors', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => <MemoryRouter><QueryClientProvider client={client}><StoryboardGenPage /></QueryClientProvider></MemoryRouter>;
    const view = render(tree());
    fireEvent.click(await screen.findByText('生成镜头一'));
    fireEvent.click(screen.getByText('切换镜头'));
    expect(screen.queryByText('镜头一正在生成')).not.toBeInTheDocument();
    episode.isLoading = true;
    view.rerender(tree());
    fireEvent.click(screen.getByText('切换镜头'));
    expect(screen.getByText('镜头一正在生成')).toBeInTheDocument();
    episode.error = 'background refresh failed';
    view.rerender(tree());
    expect(screen.getByText('镜头一正在生成')).toBeInTheDocument();
    fireEvent.click(screen.getByText('刷新已保存资料'));
    expect(episode.forceReloadSlicesQuiet).toHaveBeenCalledWith('script');
    episode.isLoading = false; episode.error = '';
    client.clear();
  });
});
