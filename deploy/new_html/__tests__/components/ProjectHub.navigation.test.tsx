import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import ProjectHub from '../../components/ProjectHub';
import { apiJson } from '../../services/httpClient';
import { uploadEntityFile } from '../../services/entityFileService';
import { prepareCoverUploadFile } from '../../utils/coverImage';
import { cleanupReplacedCoverFile } from '../../utils/coverCleanup';
import {
  addProjectMember,
  getProjectMembers,
  updateProject,
  updateProjectMember,
} from '../../services/projectWorkflowService';
import { crmMessage } from '../../admin/crmUI';

vi.mock('../../services/httpClient', () => ({
  apiJson: vi.fn(),
  apiFetch: vi.fn().mockResolvedValue({ success: true }),
  secureApiUrl: vi.fn((url: string) => url),
}));

vi.mock('../../contexts/WorkspaceContext', () => ({
  useCurrentOrgId: () => null,
  useWorkspace: () => ({ isOrgWorkspace: false, currentName: '个人空间' }),
}));

vi.mock('../../services/shareService', () => ({
  createShare: vi.fn(),
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

vi.mock('../../services/projectWorkflowService', () => ({
  updateProject: vi.fn(),
  getProjectMembers: vi.fn(),
  addProjectMember: vi.fn(),
  removeProjectMember: vi.fn(),
  updateProjectMember: vi.fn(),
}));

vi.mock('../../admin/crmUI', () => ({
  crmMessage: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
  crmConfirm: vi.fn(),
}));

vi.mock('../../components/ShareResourceDialog', () => ({
  default: () => <div data-testid="share-resource-dialog" />,
}));

const projectRows = [
  {
    project_id: 'active-1',
    project_name: '树洞里的星辰',
    description: '未归档项目',
    cover_url: '/api/files/file_old_project_cover/download',
    tags: '[]',
    user_id: 'u1',
    owner_name: 'admin',
    member_count: 1,
    is_archived: false,
    created_at: '2026-07-01T08:00:00Z',
    updated_at: '2026-07-21T08:00:00Z',
    last_accessed_at: null,
    episode_count: 1,
  },
  {
    project_id: 'active-2',
    project_name: '默认项目',
    description: '第二个未归档项目',
    cover_url: null,
    tags: [],
    user_id: 'u1',
    owner_name: 'admin',
    member_count: 1,
    is_archived: false,
    created_at: '2026-07-02T08:00:00Z',
    updated_at: '2026-07-20T08:00:00Z',
    last_accessed_at: null,
    episode_count: 0,
  },
  {
    project_id: 'archived-1',
    project_name: '旧项目归档',
    description: '只应出现在已归档 tab',
    cover_url: null,
    tags: [],
    user_id: 'u1',
    owner_name: 'admin',
    member_count: 1,
    is_archived: true,
    created_at: '2026-06-01T08:00:00Z',
    updated_at: '2026-06-20T08:00:00Z',
    last_accessed_at: null,
    episode_count: 2,
  },
];

describe('ProjectHub navigation and filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('username', '159****7184');
    localStorage.setItem('auth_token', 'token-cover');
    (apiJson as any).mockImplementation(async (url: string) => {
      if (url.startsWith('/api/projects?')) {
        return { success: true, projects: projectRows };
      }
      return { success: true };
    });
    (uploadEntityFile as any).mockResolvedValue({
      fileId: 'file_cover',
      fileUrl: '/api/files/file_cover/download',
    });
    (prepareCoverUploadFile as any).mockImplementation(async (file: File) => (
      new File(['optimized-project-cover'], `small-${file.name}.jpg`, { type: 'image/jpeg' })
    ));
    (cleanupReplacedCoverFile as any).mockResolvedValue('hard_deleted');
    (updateProject as any).mockResolvedValue({ success: true });
    (getProjectMembers as any).mockResolvedValue({
      success: true,
      members: [
        { user_id: 'owner', username: 'admin', role: 'owner', responsibility: 'all' },
        { user_id: 'user_2', username: 'alice', role: 'member', responsibility: 'art' },
      ],
    });
    (addProjectMember as any).mockResolvedValue({
      success: true,
      member: { user_id: 'user_3', username: 'bob', role: 'member', responsibility: 'all' },
    });
  });

  it('filters real group IDs and refreshes a backend rename when returning to the page', async () => {
    let name = '系列短剧';
    (apiJson as any).mockImplementation(async (url: string) => {
      if (url === '/api/project-groups') return { groups: [{ group_id: 'grp_1', group_name: name, user_id: 'u1' }] };
      if (!url.startsWith('/api/projects?')) return { success: true };
      return { success: true, projects: projectRows.map(p => ({ ...p, group_id: p.project_id === 'active-1' ? 'grp_1' : null, group_name: name })) };
    });
    render(<MemoryRouter><ProjectHub /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '系列短剧' }));
    expect(screen.getByText('树洞里的星辰')).toBeInTheDocument();
    expect(screen.queryByText('默认项目')).not.toBeInTheDocument();
    name = '后台改名';
    fireEvent(window, new Event('focus'));
    expect(await screen.findByRole('button', { name: '后台改名' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '未分组' }));
    expect(screen.getByText('默认项目')).toBeInTheDocument();
    expect(screen.queryByText('树洞里的星辰')).not.toBeInTheDocument();
  });

  it('does not let an older refresh restore stale group names or project assignments', async () => {
    const pending: Array<(value: unknown) => void> = [];
    (apiJson as any).mockImplementation((url: string) => {
      if (url === '/api/project-groups' || url.startsWith('/api/projects?')) {
        return new Promise(resolve => { pending.push(resolve); });
      }
      return Promise.resolve({ success: true });
    });
    render(<MemoryRouter><ProjectHub /></MemoryRouter>);
    expect(pending).toHaveLength(2);
    (apiJson as any).mockImplementation(async (url: string) => {
      if (url === '/api/project-groups') return { groups: [{ group_id: 'grp_1', group_name: '最新分组', user_id: 'u1' }] };
      if (url.startsWith('/api/projects?')) return { success: true, projects: projectRows.map(p => ({ ...p, group_id: 'grp_1', group_name: '最新分组' })) };
      return { success: true };
    });
    fireEvent(window, new Event('focus'));
    fireEvent.click(await screen.findByRole('button', { name: '最新分组' }));
    await screen.findByText('树洞里的星辰');
    await act(async () => {
      pending[0]({ success: true, projects: projectRows });
      pending[1]({ groups: [{ group_id: 'grp_1', group_name: '过期分组', user_id: 'u1' }] });
    });
    expect(screen.getByRole('button', { name: '最新分组' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '过期分组' })).not.toBeInTheDocument();
    expect(screen.getByText('树洞里的星辰')).toBeInTheDocument();
    expect(screen.getByText('默认项目')).toBeInTheDocument();
  });

  it('saves a project group with the project metadata instead of changing project identity', async () => {
    (apiJson as any).mockImplementation(async (url: string) => url === '/api/project-groups'
      ? { groups: [{ group_id: 'grp_1', group_name: '系列短剧', user_id: 'u1' }] }
      : url.startsWith('/api/projects?') ? { success: true, projects: projectRows.map(p => ({ ...p, member_role: 'owner' })) } : { success: true });
    render(<MemoryRouter><ProjectHub /></MemoryRouter>);
    await screen.findByText('树洞里的星辰');
    fireEvent.click(screen.getByLabelText('树洞里的星辰 更多操作'));
    fireEvent.click(screen.getByText('编辑项目'));
    fireEvent.change(screen.getByLabelText('项目所属分组'), { target: { value: 'grp_1' } });
    fireEvent.click(screen.getByText('保存信息'));
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('active-1', {
      project_name: '树洞里的星辰', description: '未归档项目', group_id: 'grp_1',
    }));
  });

  it('keeps stable tab counts while switching between active and archived projects', async () => {
    render(
      <MemoryRouter>
        <ProjectHub />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(apiJson).toHaveBeenCalledWith(
        expect.stringContaining('include_archived=true'),
        {},
        '项目列表',
      );
    });

    expect(await screen.findByText('树洞里的星辰')).toBeInTheDocument();
    expect(screen.getByText('默认项目')).toBeInTheDocument();
    expect(screen.queryByText('旧项目归档')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /全部项目\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已归档\s*1/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /已归档\s*1/ }));

    expect(screen.getByText('旧项目归档')).toBeInTheDocument();
    expect(screen.queryByText('树洞里的星辰')).not.toBeInTheDocument();
    expect(screen.queryByText('默认项目')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /全部项目\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /已归档\s*1/ })).toBeInTheDocument();
  });

  it('opens the account dropdown with a personal center entry', async () => {
    render(
      <MemoryRouter>
        <ProjectHub />
      </MemoryRouter>,
    );

    await screen.findByText('树洞里的星辰');


    fireEvent.click(screen.getAllByRole('button', { name: /159\*\*\*\*7184/ })[0]);

    expect(screen.getByRole('menuitem', { name: /个人中心/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /退出登录/ })).toBeInTheDocument();
  });

  it('places the create project action in the project list toolbar', async () => {
    const { container } = render(
      <MemoryRouter>
        <ProjectHub />
      </MemoryRouter>,
    );

    await screen.findByText('树洞里的星辰');
    const header = container.querySelector('header');
    const main = container.querySelector('main');
    expect(header).not.toBeNull();
    expect(main).not.toBeNull();
    expect(within(header as HTMLElement).queryByRole('button', { name: /新建项目/ })).not.toBeInTheDocument();

    const createButton = within(main as HTMLElement).getByRole('button', { name: /新建项目/ });
    fireEvent.click(createButton);

    expect(screen.getByRole('dialog', { name: '新建项目' })).toBeInTheDocument();
  });

  it('always renders the wide project shell without a width toggle', async () => {
    localStorage.setItem('project_hub_layout', 'narrow');
    const { container } = render(
      <MemoryRouter>
        <ProjectHub />
      </MemoryRouter>,
    );

    await screen.findByText('树洞里的星辰');
    expect(screen.queryByRole('button', { name: /宽屏|窄屏/ })).not.toBeInTheDocument();
    expect(container.querySelector('.max-w-none')).not.toBeNull();
    expect(container.innerHTML).toContain('2xl:grid-cols-5');
  });

  it('uploads a project cover from the card menu and renders it with crop styling', async () => {
    render(
      <MemoryRouter>
        <ProjectHub />
      </MemoryRouter>,
    );

    await screen.findByText('树洞里的星辰');
    fireEvent.click(screen.getByLabelText('树洞里的星辰 更多操作'));
    fireEvent.click(screen.getByText('上传封面'));

    const file = new File(['cover-bytes'], 'cover.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('选择项目封面图片'), { target: { files: [file] } });

    await waitFor(() => {
      expect(prepareCoverUploadFile).toHaveBeenCalledWith(file);
      expect(uploadEntityFile).toHaveBeenCalled();
    });
    const optimizedCover = (uploadEntityFile as any).mock.calls[0][0] as File;
    expect(optimizedCover).not.toBe(file);
    expect(optimizedCover.type).toBe('image/jpeg');
    expect(uploadEntityFile).toHaveBeenCalledWith(optimizedCover, 'project', 'active-1', 'cover');

    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith('active-1', {
        cover_url: '/api/files/file_cover/download',
      });
      expect(cleanupReplacedCoverFile).toHaveBeenCalledWith('/api/files/file_old_project_cover/download', 'file_cover');
    });
    const cover = await screen.findByAltText('树洞里的星辰 封面');
    expect(cover).toHaveClass('object-cover');
    expect(cover.getAttribute('src')).toContain('/api/files/file_cover/download');
  });

  it('adds members, saves project metadata, and closes the edit dialog', async () => {
    render(
      <MemoryRouter>
        <ProjectHub />
      </MemoryRouter>,
    );

    await screen.findByText('树洞里的星辰');
    fireEvent.click(screen.getByLabelText('树洞里的星辰 更多操作'));
    fireEvent.click(screen.getByText('编辑项目'));

    await waitFor(() => expect(getProjectMembers).toHaveBeenCalledWith('active-1'));
    expect(screen.getAllByText('admin').some(node => node.tagName.toLowerCase() === 'div')).toBe(true);
    expect(screen.getAllByText('alice').some(node => node.tagName.toLowerCase() === 'div')).toBe(true);
    expect(screen.getAllByRole('option', { name: '成员·member' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option', { name: '管理·admin' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option', { name: '只读·readonly' }).length).toBeGreaterThan(0);

    const memberInput = screen.getByPlaceholderText('例如 admin 或 user_xxx，可换行输入多个成员');
    expect(memberInput.tagName).toBe('TEXTAREA');
    expect(memberInput).toHaveClass('min-h-[88px]', 'w-full');
    fireEvent.change(memberInput, {
      target: { value: 'bob' },
    });
    fireEvent.click(screen.getByText('添加'));

    await waitFor(() => {
      expect(addProjectMember).toHaveBeenCalledWith('active-1', 'bob', 'member', 'all');
      expect(screen.getByRole('button', { name: '添加' })).toBeEnabled();
    });

    fireEvent.change(screen.getByDisplayValue('树洞里的星辰'), {
      target: { value: '树洞里的星辰 · 新封面版' },
    });
    fireEvent.change(screen.getByDisplayValue('未归档项目'), {
      target: { value: '更新后的项目描述' },
    });
    fireEvent.click(screen.getByText('保存信息'));

    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith('active-1', {
        project_name: '树洞里的星辰 · 新封面版',
        description: '更新后的项目描述',
      });
      expect(screen.queryByRole('dialog', { name: '编辑项目' })).not.toBeInTheDocument();
    });
  });

  it('keeps the edit dialog open when interacting outside and closes only explicitly', async () => {
    render(
      <MemoryRouter>
        <ProjectHub />
      </MemoryRouter>,
    );

    await screen.findByText('树洞里的星辰');
    fireEvent.click(screen.getByLabelText('树洞里的星辰 更多操作'));
    fireEvent.click(screen.getByText('编辑项目'));

    const dialog = await screen.findByRole('dialog', { name: '编辑项目' });
    fireEvent.click(dialog);
    expect(screen.getByRole('dialog', { name: '编辑项目' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog', { name: '编辑项目' })).not.toBeInTheDocument();
  });

  it('does not save or show success when the disabled owner role is clicked', async () => {
    render(
      <MemoryRouter>
        <ProjectHub />
      </MemoryRouter>,
    );

    await screen.findByText('树洞里的星辰');
    fireEvent.click(screen.getByLabelText('树洞里的星辰 更多操作'));
    fireEvent.click(screen.getByText('编辑项目'));

    const dialog = await screen.findByRole('dialog', { name: '编辑项目' });
    await waitFor(() => expect(getProjectMembers).toHaveBeenCalledWith('active-1'));
    const ownerRole = within(dialog).getByDisplayValue('owner');
    const ownerResponsibility = within(dialog).getByDisplayValue('all');

    expect(ownerRole).toBeDisabled();
    fireEvent.focus(ownerResponsibility);
    fireEvent.click(ownerRole);
    fireEvent.blur(ownerResponsibility);

    expect(updateProjectMember).not.toHaveBeenCalled();
    expect(crmMessage.success).not.toHaveBeenCalledWith('成员信息已更新');
  });

  it('still saves a responsibility after its value actually changes', async () => {
    render(
      <MemoryRouter>
        <ProjectHub />
      </MemoryRouter>,
    );

    await screen.findByText('树洞里的星辰');
    fireEvent.click(screen.getByLabelText('树洞里的星辰 更多操作'));
    fireEvent.click(screen.getByText('编辑项目'));

    const dialog = await screen.findByRole('dialog', { name: '编辑项目' });
    const responsibility = await within(dialog).findByDisplayValue('art');
    fireEvent.focus(responsibility);
    fireEvent.change(responsibility, { target: { value: 'script' } });
    fireEvent.blur(responsibility);

    await waitFor(() => {
      expect(updateProjectMember).toHaveBeenCalledWith('active-1', 'user_2', {
        responsibility: 'script',
      });
      expect(crmMessage.success).toHaveBeenCalledWith('成员信息已更新');
    });
  });
});
