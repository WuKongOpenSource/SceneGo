import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import ProfilePage from '../../pages/ProfilePage';
import { getMyEmailPreferences, getMyProfile } from '../../services/profileService';

vi.mock('../../services/profileService', () => ({
  getMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
  changeMyPassword: vi.fn(),
  getMyEmailPreferences: vi.fn(),
  sendMyEmailVerification: vi.fn(),
  verifyMyEmail: vi.fn(),
  updateMyEmailPreferences: vi.fn(),
}));

vi.mock('../../services/httpClient', () => ({
  apiFetch: vi.fn().mockResolvedValue({ success: true }),
  apiJson: vi.fn().mockResolvedValue(null),
  secureApiUrl: vi.fn((url: string) => url),
}));

vi.mock('../../admin/crmUI', () => ({
  crmMessage: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('username', '159****7184');
    (getMyProfile as any).mockResolvedValue({
      success: true,
      profile: {
        user_id: 'user_1',
        username: '未命名创作者',
        phone_number: '15900007184',
        phone_verified: true,
      },
      credits: {
        available_credits: 1200,
        account_credits: 1100,
        gift_credits: 100,
        frozen_credits: 30,
        total_used_credits: 450,
      },
      project_stats: {
        total: 5,
        active: 4,
        archived: 1,
        owned: 3,
        shared: 2,
      },
      recent_projects: [{
        project_id: 'project_1',
        project_name: '屏幕录制',
        description: '',
        is_archived: false,
        episode_count: 1,
        updated_at: '2026-07-25T00:00:00Z',
      }],
    });
    (getMyEmailPreferences as any).mockResolvedValue({
      success: true,
      email: 'creator@example.com',
      email_verified: true,
      preferences: {
        task_success: true,
        task_failure: true,
        credit_alert: true,
        sharing: true,
      },
    });
  });

  it('renders identity, phone verification, credits, and recent projects', async () => {
    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(getMyProfile).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: '个人中心' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('未命名创作者')).toBeInTheDocument();
    expect(screen.getByDisplayValue('15900007184')).toBeInTheDocument();
    expect(screen.getByDisplayValue('creator@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入 6 位邮箱验证码')).toBeInTheDocument();
    expect(screen.getByText('已验证')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('创作点数详情')).toBeInTheDocument();
    expect(screen.getByText('屏幕录制')).toBeInTheDocument();
  });

  it('uses the same wide desktop container as the credits center', async () => {
    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(getMyProfile).toHaveBeenCalled());
    expect(screen.getByTestId('profile-page-shell')).toHaveClass('max-w-[1680px]');
    expect(screen.getByTestId('profile-page-content')).not.toHaveClass('max-w-6xl');
  });
});
