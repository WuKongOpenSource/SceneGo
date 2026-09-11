import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import FinalProductSharePage from '../../pages/FinalProductSharePage';
import { getPublicFinal, submitPublicFeedback } from '../../services/finalProductShareService';

vi.mock('../../services/finalProductShareService', () => ({
  getPublicFinal: vi.fn(),
  submitPublicFeedback: vi.fn(),
}));

describe('FinalProductSharePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getPublicFinal as any).mockResolvedValue({
      success: true,
      final: { share_id: 'fps_1', library_item_id: 'mli_1', title: '漫剧成品 V3', description: '', file_url: '/final.mp4', thumbnail_url: null, duration_seconds: 90, created_at: '2026-08-15T03:00:00Z', shared_at: '2026-08-15T04:00:00Z' },
      feedback: [],
    });
    (submitPublicFeedback as any).mockResolvedValue({
      success: true,
      feedback: { feedback_id: 'fpf_1', author_name: '导演', content: '结尾停留两秒', timestamp_seconds: 0, created_at: '2026-08-15T05:00:00Z' },
    });
  });

  it('lets a visitor review the shared final without workspace data', async () => {
    render(
      <MemoryRouter initialEntries={['/share/final/public-token']}>
        <Routes><Route path="/share/final/:token" element={<FinalProductSharePage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('漫剧成品 V3')).toBeInTheDocument();
    expect(screen.getByTestId('final-product-share-content')).toHaveClass('max-w-[1680px]');
    fireEvent.change(screen.getByPlaceholderText('称呼（选填）'), { target: { value: '导演' } });
    fireEvent.change(screen.getByPlaceholderText(/请说明需要调整/), { target: { value: '结尾停留两秒' } });
    fireEvent.click(screen.getByRole('button', { name: '提交意见' }));
    await waitFor(() => expect(submitPublicFeedback).toHaveBeenCalledWith('public-token', expect.objectContaining({ content: '结尾停留两秒' })));
    expect(await screen.findByText('结尾停留两秒')).toBeInTheDocument();
  });
});
