import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CreatePage from '../../pages/CreatePage';
import { apiJson } from '../../services/httpClient';
import { readCreateIdeaSeed } from '../../utils/createIdeaSeed';

vi.mock('../../services/httpClient', () => ({
  apiJson: vi.fn(),
}));

vi.mock('../../components/AppSidebar', () => ({
  default: () => <aside data-testid="app-sidebar" />,
}));

describe('CreatePage project preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    (apiJson as any)
      .mockResolvedValueOnce({ success: true, project: { project_id: 'proj_school' } })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true, episodes: [{ episode_id: 'ep_school' }] });
  });

  it('separates genre, duration, and orientation and persists custom project defaults', async () => {
    render(
      <MemoryRouter>
        <CreatePage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('create-page-content')).toHaveClass('max-w-[1440px]');
    expect(screen.getByRole('button', { name: '校园' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '转学生发现旧教学楼每天重置同一天。' },
    });
    fireEvent.click(screen.getByText(/可选：调整故事类型/));
    fireEvent.click(screen.getByRole('button', { name: '自定义' }));
    fireEvent.change(screen.getByLabelText('自定义故事类型'), {
      target: { value: '校园奇幻' },
    });
    fireEvent.click(screen.getByRole('button', { name: '90秒' }));
    fireEvent.click(screen.getByRole('button', { name: '横屏 · 16:9' }));
    fireEvent.click(screen.getByRole('button', { name: '开始创作' }));

    await waitFor(() => expect(apiJson).toHaveBeenCalledTimes(3));
    const createOptions = (apiJson as any).mock.calls[0][1];
    const createBody = JSON.parse(createOptions.body);
    expect(createBody.settings).toEqual({
      creation_preferences: {
        genre: '校园奇幻',
        duration_seconds: 90,
        orientation: 'landscape',
        aspect_ratio: '16:9',
      },
    });
    expect(createBody.description).toContain('时长：90秒');
    expect(createBody.description).toContain('画面：横屏 16:9');
    expect(readCreateIdeaSeed(sessionStorage, 'ep_school')).toEqual(expect.objectContaining({
      genre: '校园奇幻',
      durationSeconds: 90,
      orientation: 'landscape',
      aspectRatio: '16:9',
    }));
  });
});
