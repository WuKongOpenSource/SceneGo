import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { EpisodeHubPage } from '../../pages/EpisodeHubPage';
import { apiJson } from '../../services/httpClient';
import { uploadEntityFile } from '../../services/entityFileService';
import { prepareCoverUploadFile } from '../../utils/coverImage';
import { cleanupReplacedCoverFile } from '../../utils/coverCleanup';

vi.mock('../../services/httpClient', () => ({
  apiJson: vi.fn(),
  secureApiUrl: vi.fn((url: string) => url),
}));

vi.mock('../../services/entityFileService', () => ({
  uploadEntityFile: vi.fn(),
}));

vi.mock('../../utils/coverImage', () => ({
  prepareCoverUploadFile: vi.fn(),
}));

vi.mock('../../utils/coverCleanup', () => ({
  cleanupReplacedCoverFile: vi.fn(),
}));

vi.mock('../../admin/crmUI', () => ({
  crmMessage: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
  crmConfirm: vi.fn(),
}));

const episodeRows = [
  {
    episode_id: 'ep_8',
    project_id: 'proj_1',
    episode_number: 8,
    episode_name: '第八期',
    description: '',
    status: 'draft',
    settings: { cover_url: '/api/files/file_old_episode_cover/download' },
    sort_order: 0,
    created_at: '2026-07-27T01:00:00Z',
    updated_at: '2026-07-27T02:00:00Z',
  },
  {
    episode_id: 'ep_2',
    project_id: 'proj_1',
    episode_number: 2,
    episode_name: '第二集',
    description: '',
    status: 'draft',
    settings: {},
    sort_order: 1,
    created_at: '2026-07-27T03:00:00Z',
    updated_at: '2026-07-27T04:00:00Z',
  },
];

function renderEpisodeHub() {
  return render(
    <MemoryRouter initialEntries={['/projects/proj_1']}>
      <Routes>
        <Route path="/projects/:projectId" element={<EpisodeHubPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EpisodeHubPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('username', 'admin');
    localStorage.setItem('auth_token', 'token-episode');
    (apiJson as any).mockImplementation(async (url: string) => {
      if (url === '/api/projects/proj_1/episodes') {
        return { success: true, episodes: episodeRows };
      }
      return { success: true };
    });
    (uploadEntityFile as any).mockResolvedValue({
      fileId: 'file_episode_cover',
      fileUrl: '/api/files/file_episode_cover/download',
    });
    (prepareCoverUploadFile as any).mockImplementation(async (file: File) => (
      new File(['optimized-episode-cover'], `small-${file.name}.jpg`, { type: 'image/jpeg' })
    ));
    (cleanupReplacedCoverFile as any).mockResolvedValue('hard_deleted');
  });

  it('places the back action in the tab row and the create action in the list toolbar', async () => {
    const { container } = renderEpisodeHub();

    await screen.findByText('第八期');
    const header = container.querySelector('header');
    const main = container.querySelector('main');
    expect(header).not.toBeNull();
    expect(main).not.toBeNull();
    expect(within(header as HTMLElement).queryByRole('button', { name: /新建分集/ })).not.toBeInTheDocument();
    expect(within(header as HTMLElement).getByRole('button', { name: '返回项目列表' })).toBeInTheDocument();

    const createButton = within(main as HTMLElement).getByRole('button', { name: /新建分集/ });
    fireEvent.click(createButton);

    expect(screen.getByRole('dialog', { name: '新建分集' })).toBeInTheDocument();
  });

  it('always renders the wide episode shell without a width toggle', async () => {
    localStorage.setItem('episode_hub_layout', 'narrow');
    const { container } = renderEpisodeHub();

    await screen.findByText('第八期');
    expect(screen.queryByRole('button', { name: /宽屏|窄屏/ })).not.toBeInTheDocument();
    expect(container.querySelector('.max-w-none')).not.toBeNull();
    expect(container.innerHTML).toContain('2xl:grid-cols-5');
  });

  it('persists drag reorder and keeps EP labels based on the current visual order', async () => {
    const { container } = renderEpisodeHub();

    await screen.findByText('第八期');
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => 'ep_8'),
      setDragImage: vi.fn(),
    };

    const draggedCard = screen.getByTestId('episode-card-ep_8');

    fireEvent.dragStart(draggedCard, { dataTransfer, clientX: 120, clientY: 160 });
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(expect.any(HTMLElement), 0, 0);
    const floatingCard = document.querySelector('[data-episode-drag-overlay="true"]') as HTMLElement;
    expect(floatingCard).not.toBeNull();
    expect(floatingCard.style.opacity).toBe('1');
    expect(floatingCard.style.position).toBe('fixed');
    fireEvent.dragOver(screen.getByTestId('episode-card-ep_2'), { dataTransfer });

    await waitFor(() => {
      const previewCards = Array.from(container.querySelectorAll('[data-testid^="episode-card-"]'));
      expect(previewCards[0]).toHaveStyle({ order: '1' });
      expect(previewCards[1]).toHaveStyle({ order: '0' });
      expect(previewCards[0]).toHaveAttribute('data-drop-placeholder', 'true');
      expect(previewCards[0]).toHaveClass('opacity-25');
      expect(within(previewCards[0] as HTMLElement).getByTestId('episode-title-row-ep_8')).toHaveTextContent('EP 02');
      expect(within(previewCards[1] as HTMLElement).getByTestId('episode-title-row-ep_2')).toHaveTextContent('EP 01');
    });
    expect((apiJson as any).mock.calls.filter((call: any[]) => call[0] === '/api/projects/proj_1/episodes/reorder')).toHaveLength(0);

    fireEvent.drop(screen.getByTestId('episode-card-ep_2'), { dataTransfer });

    await waitFor(() => {
      expect(apiJson).toHaveBeenCalledWith(
        '/api/projects/proj_1/episodes/reorder',
        {
          method: 'POST',
          body: JSON.stringify({ episode_ids: ['ep_2', 'ep_8'] }),
        },
        'reorderEpisodes',
      );
    });
    expect(document.querySelector('[data-episode-drag-overlay="true"]')).toBeNull();

    const cards = Array.from(container.querySelectorAll('[data-testid^="episode-card-"]'));
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText('第二集')).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByTestId('episode-title-row-ep_2')).toHaveTextContent('EP 01');
    expect(within(cards[1] as HTMLElement).getByText('第八期')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByTestId('episode-title-row-ep_8')).toHaveTextContent('EP 02');
  });

  it('restores the original order when a drag preview is cancelled', async () => {
    const { container } = renderEpisodeHub();

    await screen.findByText('第八期');
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => 'ep_8'),
    };

    const draggedCard = screen.getByTestId('episode-card-ep_8');
    fireEvent.dragStart(draggedCard, { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('episode-card-ep_2'), { dataTransfer });

    await waitFor(() => {
      const previewCards = Array.from(container.querySelectorAll('[data-testid^="episode-card-"]'));
      expect(previewCards[0]).toHaveStyle({ order: '1' });
      expect(previewCards[1]).toHaveStyle({ order: '0' });
      expect(previewCards[0]).toHaveAttribute('data-drop-placeholder', 'true');
    });

    fireEvent.dragEnd(draggedCard, { dataTransfer });

    await waitFor(() => {
      const restoredCards = Array.from(container.querySelectorAll('[data-testid^="episode-card-"]'));
      expect(restoredCards[0]).toHaveStyle({ order: '0' });
      expect(restoredCards[1]).toHaveStyle({ order: '1' });
      expect(within(restoredCards[0] as HTMLElement).getByText('第八期')).toBeInTheDocument();
      expect(within(restoredCards[0] as HTMLElement).getByTestId('episode-title-row-ep_8')).toHaveTextContent('EP 01');
      expect(within(restoredCards[1] as HTMLElement).getByText('第二集')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-episode-drag-overlay="true"]')).toBeNull();
    expect((apiJson as any).mock.calls.filter((call: any[]) => call[0] === '/api/projects/proj_1/episodes/reorder')).toHaveLength(0);
  });

  it('makes the whole card draggable without a separate drag handle', async () => {
    renderEpisodeHub();

    await screen.findByText('第八期');
    const card = screen.getByTestId('episode-card-ep_8');

    expect(card).toHaveAttribute('draggable', 'true');
    expect(card).toHaveAttribute('aria-label', '第八期 拖动排序');
    expect(card).toHaveClass('cursor-grab');
    expect(within(card).queryByTestId('episode-drag-handle-ep_8')).not.toBeInTheDocument();
    expect(within(card).getByTestId('episode-title-row-ep_8')).toHaveTextContent('EP 01第八期');
  });

  it('filters episodes by stable status tabs without renumbering the global EP labels', async () => {
    (apiJson as any).mockImplementation(async (url: string) => {
      if (url === '/api/projects/proj_1/episodes') {
        return {
          success: true,
          episodes: [
            { ...episodeRows[0], episode_id: 'ep_draft', episode_name: '草稿集', status: 'draft', sort_order: 0 },
            { ...episodeRows[1], episode_id: 'ep_started', episode_name: '制作中集', status: 'in_progress', sort_order: 1 },
            { ...episodeRows[1], episode_id: 'ep_done', episode_name: '完成集', status: 'completed', sort_order: 2 },
            { ...episodeRows[1], episode_id: 'ep_live', episode_name: '发布集', status: 'published', sort_order: 3 },
          ],
        };
      }
      return { success: true };
    });

    renderEpisodeHub();

    expect(await screen.findByRole('button', { name: /全部分集\s*4/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /草稿\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /制作中\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已完成\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已发布\s*1/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /制作中\s*1/ }));

    expect(screen.getByText('制作中集')).toBeInTheDocument();
    expect(screen.queryByText('草稿集')).not.toBeInTheDocument();
    expect(screen.queryByText('完成集')).not.toBeInTheDocument();
    expect(screen.queryByText('发布集')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('episode-card-ep_started')).getByTestId('episode-title-row-ep_started')).toHaveTextContent('EP 02');
    expect(screen.getByRole('button', { name: /全部分集\s*4/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /草稿\s*1/ })).toBeInTheDocument();
  });

  it('uploads an episode cover from the card menu and renders it with crop styling', async () => {
    renderEpisodeHub();

    await screen.findByText('第八期');
    fireEvent.click(screen.getByLabelText('第八期 更多操作'));
    fireEvent.click(screen.getByText('上传封面'));

    const file = new File(['cover-bytes'], 'episode-cover.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('选择分集封面图片'), { target: { files: [file] } });

    await waitFor(() => {
      expect(prepareCoverUploadFile).toHaveBeenCalledWith(file);
      expect(uploadEntityFile).toHaveBeenCalled();
    });
    const optimizedCover = (uploadEntityFile as any).mock.calls[0][0] as File;
    expect(optimizedCover).not.toBe(file);
    expect(optimizedCover.type).toBe('image/jpeg');
    expect(uploadEntityFile).toHaveBeenCalledWith(optimizedCover, 'episode', 'ep_8', 'cover');

    await waitFor(() => {
      expect(apiJson).toHaveBeenCalledWith(
        '/api/episodes/ep_8',
        {
          method: 'PUT',
          body: JSON.stringify({ settings: { cover_url: '/api/files/file_episode_cover/download' } }),
        },
        'updateEpisode',
      );
      expect(cleanupReplacedCoverFile).toHaveBeenCalledWith('/api/files/file_old_episode_cover/download', 'file_episode_cover');
    });

    const cover = await screen.findByAltText('第八期 封面');
    expect(cover).toHaveClass('object-cover');
    expect(cover).toHaveClass('object-center');
    expect(cover.getAttribute('src')).toContain('/api/files/file_episode_cover/download');
  });
});
