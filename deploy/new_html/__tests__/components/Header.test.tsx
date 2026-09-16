import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AppView, AiModel } from '../../types';

vi.mock('../../services/creditService', () => ({
  getCreditBalance: vi.fn(),
}));
vi.mock('../../services/httpClient', () => ({
  apiFetch: vi.fn().mockResolvedValue({ success: true }),
  apiJson: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../components/NotificationPanel', () => ({
  NotificationPanel: () => <div data-testid="notification-panel" />,
}));
vi.mock('../../components/WorkspaceSwitcher', () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

import { getCreditBalance } from '../../services/creditService';
import { Header } from '../../components/Header';

const baseProps = {
  visibleColumns: [true, true, true],
  onToggleColumn: vi.fn(),
  onGlobalBatchProcess: vi.fn(),
  isProcessing: false,
  fileCount: 0,
  currentView: AppView.Editor,
  onChangeView: vi.fn(),
  onChangeModel: vi.fn(),
};

describe('Header model display and credit balance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('username', 'tester');
    (getCreditBalance as any).mockResolvedValue({ available_credits: 1280 });
  });

  it('shows public script model versions with capability suffixes', () => {
    render(<Header {...baseProps} aiModel={AiModel.Gemini} />);
    expect(screen.getByText('gemini-2.5-flash · 全能写作模型')).toBeTruthy();

    render(<Header {...baseProps} aiModel={AiModel.DeepseekChat} />);
    expect(screen.getByText('deepseek-v4-flash · 快速写作模型')).toBeTruthy();

    render(<Header {...baseProps} aiModel={AiModel.Deepseek} />);
    expect(screen.getByText('deepseek-v4-pro · 推理写作模型')).toBeTruthy();
  });

  it('keeps backend-resolved labels when runtime metadata is supplied', () => {
    render(
      <Header
        {...baseProps}
        aiModel={AiModel.DeepseekChat}
        modelOptions={[{
          value: AiModel.DeepseekChat,
          label: 'deepseek-v4-flash-admin · 快速写作模型',
          hint: '速度优先',
          operation: 'deepseek-chat',
          requestedProvider: 'deepseek',
          provider: 'deepseek',
          runtime: 'deepseek-v4-flash-admin',
          billingModel: 'script_tier_2',
          failoverActive: false,
        }]}
      />,
    );
    expect(screen.getByText('deepseek-v4-flash-admin · 快速写作模型')).toBeTruthy();
  });

  it('loads and renders the available credit balance', async () => {
    render(<Header {...baseProps} aiModel={AiModel.Gemini} />);

    await waitFor(() => {
      expect(screen.getByTestId('header-credit-balance').textContent).toContain('1,280');
    });
    expect(getCreditBalance).toHaveBeenCalled();
  });

  it('refreshes the balance on credits:updated events', async () => {
    (getCreditBalance as any).mockResolvedValue({ available_credits: 500 });
    render(<Header {...baseProps} aiModel={AiModel.Gemini} />);
    await waitFor(() => {
      expect(screen.getByTestId('header-credit-balance').textContent).toContain('500');
    });

    window.dispatchEvent(new CustomEvent('credits:updated', { detail: { balance: 480 } }));
    await waitFor(() => {
      expect(screen.getByTestId('header-credit-balance').textContent).toContain('480');
    });
  });

  it('shows a placeholder when the balance request fails', async () => {
    (getCreditBalance as any).mockRejectedValue(new Error('offline'));
    render(<Header {...baseProps} aiModel={AiModel.Gemini} />);

    await waitFor(() => {
      expect(screen.getByTestId('header-credit-balance').textContent).toContain('--');
    });
  });

  it('only explains portrait stars in thumbnail views, including after switching views', async () => {
    const view = render(<Header {...baseProps} currentView={AppView.Design} aiModel={AiModel.Gemini} />);
    await screen.findByText('1,280');
    for (const currentView of [AppView.Design, AppView.Materials, AppView.Generation]) {
      view.rerender(<Header {...baseProps} currentView={currentView} aiModel={AiModel.Gemini} />);
      expect(screen.getByText('可用于仿真人视频的 Seedream 文生图')).toBeInTheDocument();
    }
    for (const currentView of [AppView.Video, AppView.Editor]) {
      view.rerender(<Header {...baseProps} currentView={currentView} aiModel={AiModel.Gemini} />);
      expect(screen.queryByText('可用于仿真人视频的 Seedream 文生图')).not.toBeInTheDocument();
    }
    view.rerender(<Header {...baseProps} currentView={AppView.Design} aiModel={AiModel.Gemini} />);
    expect(screen.getByText('可用于仿真人视频的 Seedream 文生图')).toBeInTheDocument();
  });
});
