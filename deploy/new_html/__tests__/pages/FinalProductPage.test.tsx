import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import FinalProductPage from '../../pages/FinalProductPage';
import { listMediaItems } from '../../services/mediaLibraryService';
import { getFinalShare, listFinalFeedback } from '../../services/finalProductShareService';

vi.mock('../../services/mediaLibraryService', () => ({ listMediaItems: vi.fn() }));
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
  beforeEach(() => {
    vi.clearAllMocks();
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
  });
});
