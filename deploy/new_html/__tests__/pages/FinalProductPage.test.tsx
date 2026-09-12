import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import FinalProductPage from '../../pages/FinalProductPage';
import { deleteMediaItem, listMediaItems } from '../../services/mediaLibraryService';
import { getComposeStatus } from '../../services/videoWorkflowService';
import { getFinalShare, listFinalFeedback } from '../../services/finalProductShareService';

vi.mock('../../services/mediaLibraryService', () => ({ listMediaItems: vi.fn(), deleteMediaItem: vi.fn() }));
vi.mock('../../services/videoWorkflowService', () => ({
  getVideoTakes: vi.fn(),
  startCompose: vi.fn(),
  getComposeStatus: vi.fn().mockResolvedValue({ status: 'idle', total: 0, done: 0 }),
}));
vi.mock('../../services/finalProductShareService', () => ({
  getFinalShare: vi.fn(),
  listFinalFeedback: vi.fn(),
  createFinalShare: vi.fn(),
  deactivateFinalShare: vi.fn(),
  finalShareUrl: vi.fn((token: string) => `https://app.example.test/share/final/${token}`),
}));
vi.mock('../../contexts/EpisodeContext', () => ({
  useEpisode: () => ({ episodeId: 'ep_1', assetScopeMode: 'episode', setAssetScopeMode: vi.fn() }),
}));
vi.mock('../../components/LazyVideo', () => ({
  LazyVideo: ({ src }: { src: string }) => <video data-testid="final-video" src={src} preload="none" />,
}));

describe('FinalProductPage', () => {
  const renderPage = () => render(<MemoryRouter initialEntries={['/projects/proj_1/ep/ep_1/workflow/final']}>
    <Routes><Route path="/projects/:projectId/ep/:episodeId/workflow/final" element={<FinalProductPage />} /></Routes>
  </MemoryRouter>);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteMediaItem).mockResolvedValue({ success: true });
    (listMediaItems as any).mockResolvedValue({
      success: true,
      items: [
        { library_item_id: 'mli_3', source: 'composed_final', title: '第三次合成', file_url: '/3.mp4', created_at: '2026-08-15T03:00:00Z', duration_seconds: 30 },
        { library_item_id: 'mli_2', source: 'composed_final', title: '第二次合成', file_url: '/2.mp4', created_at: '2026-08-15T02:00:00Z', duration_seconds: 28 },
        { library_item_id: 'mli_1', source: 'composed_final', title: '第一次合成', file_url: '/1.mp4', created_at: '2026-08-15T01:00:00Z', duration_seconds: 25 },
      ],
    });
    (getFinalShare as any).mockResolvedValue({ success: true, share: null });
    (listFinalFeedback as any).mockResolvedValue({ success: true, feedback: [{ feedback_id: 'f1', author_name: '审片人', content: '节奏再慢一点', timestamp_seconds: 8, created_at: '2026-08-15T04:00:00Z' }] });
  });

  it('requests a bounded page and appends older versions only on demand', async () => {
    const rows = Array.from({ length: 24 }, (_, index) => ({ library_item_id: `final${index}`,
      title: `成片 ${index}`, file_url: `/final${index}.mp4`, created_at: '2026-09-12T00:00:00Z' }));
    vi.mocked(listMediaItems).mockResolvedValueOnce({ success: true, items: rows, total: 26 } as any)
      .mockResolvedValueOnce({ success: true, items: [rows[23], { ...rows[0], library_item_id: 'older', title: '更早成片' }], total: 26 } as any);
    render(<MemoryRouter initialEntries={['/projects/p/ep/ep/workflow/final']}>
      <Routes><Route path="/projects/:projectId/ep/:episodeId/workflow/final" element={<FinalProductPage />} /></Routes>
    </MemoryRouter>);
    const more = await screen.findByRole('button', { name: /加载更多成品/ });
    expect(listMediaItems).toHaveBeenNthCalledWith(1, expect.objectContaining({ limit: 24 }));
    fireEvent.click(more);
    fireEvent.click(more);
    expect(await screen.findByText('更早成片')).toBeInTheDocument();
    expect(listMediaItems).toHaveBeenCalledTimes(2);
    expect(listMediaItems).toHaveBeenNthCalledWith(2, expect.objectContaining({ limit: 24, offset: 24 }));
    expect(screen.getAllByText('成片 23')).toHaveLength(1);
    expect(screen.getByText('成片 0')).toBeInTheDocument();
  });

  it.each(['第三次合成', '第二次合成'])('requires confirmation before deleting %s', async title => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: `删除成品：${title}` }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('源视频、配音和编辑时间线均保留'));
    expect(deleteMediaItem).not.toHaveBeenCalled();
    expect(screen.getByText(title)).toBeInTheDocument();
    confirm.mockRestore();
  });

  it('deletes only the confirmed final and reloads the first page without creating a share', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const remove = await screen.findByRole('button', { name: '删除成品：第三次合成' });
    vi.mocked(listMediaItems).mockResolvedValue({ success: true, items: [], total: 0 });
    fireEvent.click(remove);
    fireEvent.click(remove);
    await waitFor(() => expect(deleteMediaItem).toHaveBeenCalledExactlyOnceWith('mli_3', '删除废弃成品'));
    expect(await screen.findByText(/还没有成品视频/)).toBeInTheDocument();
    expect(listMediaItems).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 24, source: 'composed_final' }));
    expect(listMediaItems).not.toHaveBeenLastCalledWith(expect.objectContaining({ offset: expect.any(Number) }));
    expect(getFinalShare).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '合成成品' })).toBeEnabled();
    confirm.mockRestore();
  });

  it('retains the final and permits retry when deletion fails', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(deleteMediaItem).mockRejectedValueOnce(new Error('/private/path'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '删除成品：第二次合成' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('删除成品失败，请稍后重试。');
    expect(screen.getByText('第二次合成')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除成品：第二次合成' })).toBeEnabled();
    expect(listMediaItems).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it('does not restart compose polling after leaving the page', async () => {
    let resolveStatus!: (value: any) => void;
    vi.mocked(getComposeStatus).mockReturnValueOnce(new Promise(resolve => { resolveStatus = resolve; }));
    const timer = vi.spyOn(window, 'setTimeout');
    const view = render(<MemoryRouter><FinalProductPage /></MemoryRouter>);
    view.unmount();
    resolveStatus({ status: 'running', total: 9, done: 1 });
    await Promise.resolve();
    expect(timer.mock.calls.some(call => call[1] === 3000 || call[1] === 4000)).toBe(false);
    timer.mockRestore();
  });

  it('shows every composed version and opens its review feedback', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/proj_1/ep/ep_1/workflow/final']}>
        <Routes><Route path="/projects/:projectId/ep/:episodeId/workflow/final" element={<FinalProductPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('第三次合成')).toBeInTheDocument();
    expect(screen.getByText('第二次合成')).toBeInTheDocument();
    expect(screen.getByText('第一次合成')).toBeInTheDocument();
    expect(screen.getByText('共 3 个成品，最新版本置顶，历史版本不会覆盖。')).toBeInTheDocument();
    expect(screen.getByTestId('final-product-scroll')).toHaveClass(
      'h-full',
      'min-h-0',
      'overflow-y-auto',
    );
    expect(screen.getByTestId('final-product-content')).not.toHaveClass('max-w-6xl');
    expect(listMediaItems).toHaveBeenCalledWith(expect.objectContaining({ source: 'composed_final' }));

    fireEvent.click(screen.getAllByRole('button', { name: '意见' })[0]);
    await waitFor(() => expect(listFinalFeedback).toHaveBeenCalledWith('mli_3'));
    fireEvent.click(screen.getByRole('button', { name: /审阅意见/ }));
    expect(await screen.findByText('节奏再慢一点')).toBeInTheDocument();
    const shareTab = screen.getByRole('button', { name: '分享链接' });
    const reviewTab = screen.getByRole('button', { name: /审阅意见/ });
    expect(shareTab.parentElement).toHaveClass('ui-tabs');
    expect(shareTab).toHaveClass('ui-tab');
    expect(reviewTab).toHaveClass('ui-tab');
    expect(reviewTab).toHaveAttribute('aria-pressed', 'true');
    expect(shareTab).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(shareTab);
    expect(shareTab).toHaveAttribute('aria-pressed', 'true');
    expect(reviewTab).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('节奏再慢一点')).not.toBeInTheDocument();
    fireEvent.click(reviewTab);
    expect(screen.getByText('节奏再慢一点')).toBeInTheDocument();
    // Switching presentation must not refetch, create a share, or lose feedback.
    expect(listFinalFeedback).toHaveBeenCalledTimes(1);
    expect(getFinalShare).toHaveBeenCalledTimes(1);
  });
});
