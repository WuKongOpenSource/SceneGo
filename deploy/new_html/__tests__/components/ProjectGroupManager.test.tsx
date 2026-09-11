import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectGroupManager from '../../components/ProjectGroupManager';

const mocks = vi.hoisted(() => ({ api: vi.fn(), confirm: vi.fn() }));
vi.mock('../../services/httpClient', () => ({ apiJson: mocks.api }));
vi.mock('../../admin/crmUI', () => ({ crmConfirm: mocks.confirm }));
const groups = [{ group_id: 'grp_1', group_name: '系列短剧', user_id: 'owner', project_count: 2 }];

beforeEach(() => { vi.clearAllMocks(); mocks.api.mockResolvedValue({ group: groups[0] }); });

describe('creator project-group management', () => {
  it('creates a group then refreshes the shared data', async () => {
    const changed = vi.fn().mockResolvedValue(undefined);
    render(<ProjectGroupManager groups={groups} onChanged={changed} onDeleted={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('分组名称'), { target: { value: ' 品牌广告 ' } });
    fireEvent.click(screen.getByRole('button', { name: '创建分组' }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(mocks.api).toHaveBeenCalledWith('/api/project-groups', { method: 'POST', body: JSON.stringify({ group_name: '品牌广告' }) }, '保存项目分组');
  });

  it('renames the existing ID and leaves a failed draft available for retry', async () => {
    mocks.api.mockRejectedValueOnce(new Error('Network unavailable'));
    const changed = vi.fn().mockResolvedValue(undefined);
    render(<ProjectGroupManager groups={groups} onChanged={changed} onDeleted={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    expect(screen.getByLabelText('分组名称')).toHaveValue('系列短剧');
    fireEvent.change(screen.getByLabelText('分组名称'), { target: { value: '新系列' } });
    fireEvent.click(screen.getByRole('button', { name: '保存分组名称' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.getByLabelText('分组名称')).toHaveValue('新系列');
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存分组名称' }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(mocks.api).toHaveBeenCalledWith('/api/project-groups/grp_1', { method: 'PUT', body: JSON.stringify({ group_name: '新系列' }) }, '保存项目分组');
  });

  it('only deletes the group after confirmation and retains projects', async () => {
    mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const deleted = vi.fn();
    render(<ProjectGroupManager groups={groups} onChanged={vi.fn().mockResolvedValue(undefined)} onDeleted={deleted} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '删除分组' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除分组' }));
    await waitFor(() => expect(deleted).toHaveBeenCalledWith('grp_1'));
    expect(mocks.api).toHaveBeenCalledWith('/api/project-groups/grp_1', { method: 'DELETE' }, '删除项目分组');
    expect(mocks.api.mock.calls.every(([url]) => !url.includes('/api/projects/'))).toBe(true);
  });
});
