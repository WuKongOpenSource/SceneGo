import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppSidebar, { APP_SIDEBAR_COLLAPSED_STORAGE_KEY } from '../../components/AppSidebar';
import { apiJson } from '../../services/httpClient';
import { getCreditBalance } from '../../services/creditService';
import { getCurrentAdminSession } from '../../services/adminAccessService';
import { adminPath } from '../../admin/adminRoute';
import release from '../../../static/platform-release.json';

vi.mock('../../services/httpClient', () => ({
  apiFetch: vi.fn(),
  apiJson: vi.fn(),
}));

vi.mock('../../services/creditService', () => ({
  getCreditBalance: vi.fn(),
}));

vi.mock('../../services/accountStorage', () => ({
  clearAccountIdentity: vi.fn(),
  getStoredUsername: vi.fn(() => '普通用户'),
}));

vi.mock('../../services/adminAccessService', () => ({
  getCurrentAdminSession: vi.fn(),
}));

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
};

describe('AppSidebar public tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    (getCreditBalance as any).mockResolvedValue({ available_credits: 100 });
    (apiJson as any).mockResolvedValue({ success: true, projects: [] });
    (getCurrentAdminSession as any).mockResolvedValue(null);
  });

  it('shows the management entry only after the signed-in account passes the admin role check', async () => {
    (getCurrentAdminSession as any).mockResolvedValue({
      user_id: 'admin_1',
      username: 'admin',
      role: 'admin',
    });
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /普通用户/ }));
    const adminEntry = await screen.findByRole('menuitem', { name: '管理后台' });
    expect(adminEntry).toHaveAttribute('href', adminPath());
    expect(adminEntry).toHaveAttribute('target', '_blank');
    expect(adminEntry).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('管理员')).toBeInTheDocument();
  });

  it('shows every more-feature entry when a page does not provide scoped tools', async () => {
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    expect(screen.getByText('更多功能')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '专业画布' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '我的素材' })).toHaveAttribute('href', '/tools/media-library');
    expect(screen.getByRole('link', { name: '生成历史' })).toHaveAttribute('href', '/tools/history');
    expect(screen.getByRole('link', { name: '回收站' })).toHaveAttribute('href', '/tools/recycle-bin');
    expect(screen.getByRole('link', { name: '图片高清放大' })).toHaveAttribute('href', '/tools/image-upscale');
    expect(
      screen.getByText('图片高清放大').compareDocumentPosition(screen.getByText('生成历史'))
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByText('生成历史').compareDocumentPosition(screen.getByText('回收站'))
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await waitFor(() => expect(apiJson).toHaveBeenCalledWith('/api/projects', {}, '最近项目'));
  });

  it('opens image upscale without resolving a project or episode', async () => {
    (apiJson as any).mockResolvedValueOnce({ success: true, projects: [{ project_id: 'proj_1', project_name: '测试项目' }] });

    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppSidebar />
        <LocationProbe />
      </MemoryRouter>,
    );

    await screen.findByText('测试项目');
    fireEvent.click(screen.getByRole('link', { name: '图片高清放大' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/tools/image-upscale');
    });
    expect(apiJson).not.toHaveBeenCalledWith('/api/projects/proj_1/episodes', {}, '最近分集');
  });

  it('opens my assets in the global tool shell', async () => {
    (apiJson as any).mockResolvedValueOnce({ success: true, projects: [{ project_id: 'proj_1', project_name: '测试项目' }] });

    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppSidebar />
        <LocationProbe />
      </MemoryRouter>,
    );

    await screen.findByText('测试项目');
    fireEvent.click(screen.getByRole('link', { name: '我的素材' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/tools/media-library');
    });
  });

  it('asks which project to open before entering professional canvas', async () => {
    (apiJson as any)
      .mockResolvedValueOnce({
        success: true,
        projects: [
          { project_id: 'proj_1', project_name: '最近项目' },
          { project_id: 'proj_2', project_name: '目标项目' },
        ],
      })
      .mockResolvedValueOnce({ success: true, episodes: [{ episode_id: 'ep_2' }] });

    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppSidebar />
        <LocationProbe />
      </MemoryRouter>,
    );

    await screen.findByText('目标项目');
    fireEvent.click(screen.getByRole('button', { name: '专业画布' }));

    const picker = screen.getByRole('dialog', { name: '选择专业画布所属项目' });
    expect(picker).toBeInTheDocument();
    fireEvent.click(within(picker).getByRole('button', { name: /目标项目/ }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/projects/proj_2/ep/ep_2/canvas');
    });
    expect(apiJson).toHaveBeenCalledWith('/api/projects/proj_2/episodes', {}, '最近分集');
  });

  it('prompts users to create a project when professional canvas has no target', async () => {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppSidebar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '专业画布' }));
    expect(await screen.findByText('请先创建项目')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '前往创建项目' })).toBeInTheDocument();
  });

  it('collapses to an icon rail, stays navigable, and remembers the preference', async () => {
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    const sidebar = screen.getByTestId('app-sidebar');
    const collapseButton = screen.getByRole('button', { name: '收起左侧导航' });
    expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    expect(sidebar).toHaveClass('z-50', 'overflow-visible');
    expect(collapseButton).toHaveClass('z-[60]');
    fireEvent.click(collapseButton);

    expect(screen.getByTestId('app-sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('button', { name: '展开左侧导航' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '专业画布' })).toBeInTheDocument();
    expect(screen.queryByText('更多功能')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(window.localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('true');
    });
  });

  it('docks the version and release notes above credits, outside the scrolling navigation', async () => {
    render(<MemoryRouter><AppSidebar /></MemoryRouter>);
    const sidebar = screen.getByTestId('app-sidebar');
    const releaseInfo = within(sidebar).getByLabelText('平台版本与更新记录');
    const credits = within(sidebar).getByRole('button', { name: '查看创作点数明细' });
    expect(releaseInfo.parentElement).toBe(sidebar);
    expect(releaseInfo.compareDocumentPosition(credits) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('app-sidebar-scroll')).not.toContainElement(releaseInfo);
    expect(within(releaseInfo).getByText(`v${release.version}`)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '收起左侧导航' }));
    expect(within(sidebar).getByRole('button', { name: /版本与更新记录/ })).toHaveAttribute('title', `v${release.version} · 更新记录`);
    await waitFor(() => expect(apiJson).toHaveBeenCalled());
  });

  it('opens the public repository safely between release notes and credits, including collapsed mode', async () => {
    render(<MemoryRouter><AppSidebar /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /本产品已开源发布 · 助力点亮 Star/ });
    expect(link).toHaveTextContent('本产品已开源发布 · 助力点亮 Star');
    expect(link).toHaveAttribute('href', 'https://github.com/WuKongOpenSource/SceneGo');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByLabelText('平台版本与更新记录').compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(screen.getByRole('button', { name: '查看创作点数明细' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('app-sidebar-scroll')).not.toContainElement(link);
    fireEvent.click(screen.getByRole('button', { name: '收起左侧导航' }));
    expect(screen.getByRole('link', { name: /本产品已开源发布 · 助力点亮 Star/ })).toBeVisible();
    await waitFor(() => expect(apiJson).toHaveBeenCalled());
  });

  it('opens the standalone recycle bin without project context', async () => {
    (apiJson as any).mockResolvedValueOnce({ success: true, projects: [{ project_id: 'proj_1', project_name: '测试项目' }] });

    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppSidebar />
        <LocationProbe />
      </MemoryRouter>,
    );

    await screen.findByText('测试项目');
    fireEvent.click(screen.getByRole('link', { name: '回收站' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/tools/recycle-bin');
    });
  });
});
