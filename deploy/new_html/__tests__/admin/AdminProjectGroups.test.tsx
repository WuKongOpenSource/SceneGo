import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminFeatureTabs } from '../../components/AdminFeatureTabs';

const mocks = vi.hoisted(() => ({ api: vi.fn(), prompt: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../../services/httpClient', () => ({ apiJson: mocks.api }));
vi.mock('../../admin/crmUI', async () => ({
  ...(await vi.importActual('../../admin/crmUI')),
  crmPrompt: mocks.prompt,
  crmMessage: { success: mocks.success, error: mocks.error },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.mockImplementation(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return { group: { group_id: 'grp_1', group_name: '新名称' } };
    if (url.includes('/users')) return { users: [] };
    if (url.endsWith('/projects') || url.endsWith('/ungrouped-projects')) return { projects: [{ project_id: 'proj_1', project_name: '组内项目', user_id: 'owner' }] };
    return { groups: [{ group_id: 'grp_1', group_name: '原名称', owner_name: 'owner', project_count: 3 }] };
  });
});

describe('project group rename', () => {
  it('opens corresponding projects and the ungrouped list', async () => {
    render(<AdminFeatureTabs embedTab="groups" />);
    fireEvent.click(await screen.findByRole('button', { name: '3 个项目 · 查看' }));
    expect(await screen.findByRole('link', { name: '组内项目' })).toHaveAttribute('href', '/projects/proj_1');
    expect(mocks.api).toHaveBeenCalledWith('/api/admin/project-groups/grp_1/projects', { method: 'GET' }, 'Admin API');
    fireEvent.click(screen.getByRole('button', { name: '关闭组内项目' }));
    fireEvent.click(screen.getByRole('button', { name: '查看未分组项目' }));
    await screen.findByRole('dialog', { name: '分组内项目' });
    expect(mocks.api).toHaveBeenCalledWith('/api/admin/ungrouped-projects', { method: 'GET' }, 'Admin API');
  });

  it('renames by stable group ID and preserves ownership and project counts', async () => {
    mocks.prompt.mockResolvedValue(' 新名称 ');
    render(<AdminFeatureTabs embedTab="groups" />);
    fireEvent.click(await screen.findByRole('button', { name: '重命名' }));
    await screen.findByText('新名称');
    expect(mocks.api).toHaveBeenCalledWith('/api/admin/project-groups/grp_1', {
      method: 'PUT', body: JSON.stringify({ group_name: '新名称' }),
    }, 'Admin API');
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3 个项目 · 查看' })).toBeInTheDocument();
  });

  it('refreshes the open group name and projects after changes in another tab', async () => {
    render(<AdminFeatureTabs embedTab="groups" />);
    fireEvent.click(await screen.findByRole('button', { name: '原名称' }));
    await screen.findByRole('link', { name: '组内项目' });
    const original = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((url, options) => url.endsWith('/grp_1/projects')
      ? Promise.resolve({ group: { group_name: '前台改名' }, projects: [{ project_id: 'proj_2', project_name: '新归组项目', user_id: 'owner' }] })
      : original(url, options));
    fireEvent(window, new Event('focus'));
    expect(await screen.findByRole('heading', { name: '项目分组 / 前台改名' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '新归组项目' })).toHaveAttribute('href', '/projects/proj_2');
    expect(screen.queryByRole('link', { name: '组内项目' })).not.toBeInTheDocument();
  });

  it('does not reopen a closed group when a refresh finishes late', async () => {
    render(<AdminFeatureTabs embedTab="groups" />);
    fireEvent.click(await screen.findByRole('button', { name: '原名称' }));
    await screen.findByRole('link', { name: '组内项目' });
    let complete!: (value: unknown) => void;
    const pending = new Promise(resolve => { complete = resolve; });
    const original = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((url, options) => url.endsWith('/grp_1/projects') ? pending : original(url, options));
    fireEvent(window, new Event('focus'));
    fireEvent.click(screen.getByRole('button', { name: '关闭组内项目' }));
    await act(async () => { complete({ projects: [] }); await pending; });
    await waitFor(() => expect(screen.getByRole('button', { name: '原名称' })).toBeEnabled());
    expect(screen.queryByRole('dialog', { name: '分组内项目' })).not.toBeInTheDocument();
  });

  it('ignores an older group list after a newer refresh has completed', async () => {
    let complete!: (value: unknown) => void;
    const pending = new Promise(resolve => { complete = resolve; });
    const original = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((url, options) => url === '/api/admin/project-groups' ? pending : original(url, options));
    render(<AdminFeatureTabs embedTab="groups" />);
    mocks.api.mockImplementation((url, options) => url === '/api/admin/project-groups'
      ? Promise.resolve({ groups: [{ group_id: 'grp_1', group_name: '前台新名称', project_count: 4 }] })
      : original(url, options));
    fireEvent(window, new Event('focus'));
    await screen.findByRole('button', { name: '前台新名称' });
    await act(async () => { complete({ groups: [{ group_id: 'grp_1', group_name: '过期名称', project_count: 1 }] }); await pending; });
    expect(screen.getByRole('button', { name: '前台新名称' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4 个项目 · 查看' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '过期名称' })).not.toBeInTheDocument();
  });

  it.each([null, '  ', '原名称'])('does not write cancelled, empty or unchanged names: %s', async value => {
    mocks.prompt.mockResolvedValue(value);
    render(<AdminFeatureTabs embedTab="groups" />);
    fireEvent.click(await screen.findByRole('button', { name: '重命名' }));
    await waitFor(() => expect(mocks.prompt).toHaveBeenCalled());
    expect(mocks.api.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
    expect(screen.getByText('原名称')).toBeInTheDocument();
  });

  it('keeps the old name when persistence fails', async () => {
    mocks.prompt.mockResolvedValue('新名称');
    const original = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((url, options) => options?.method === 'PUT'
      ? Promise.reject(new Error('Denied')) : original(url, options));
    render(<AdminFeatureTabs embedTab="groups" />);
    fireEvent.click(await screen.findByRole('button', { name: '重命名' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(screen.getByText('原名称')).toBeInTheDocument();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
