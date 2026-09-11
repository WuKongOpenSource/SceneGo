import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectMaterialPicker, useProjectMaterialPicker } from '../../components/ProjectMaterialPicker';
import type { MaterialLibrary } from '../../types';

const library: MaterialLibrary = {
  阿亮: [{ id: 'person', url: '/original.png', thumbnail: '/preview.png', assetType: 'character', name: '阿亮', description: '蓝色衣服', type: 'image', source: 'asset', timestamp: 0 }],
  茶馆: [{ id: 'scene', url: '/scene.png', assetType: 'scene', name: '茶馆', type: 'image', source: 'asset', timestamp: 0 }],
};
const select = vi.fn();
const refresh = vi.fn();
function Harness({ busy = false, selected = false, close = vi.fn() }: { busy?: boolean; selected?: boolean; close?: () => void }) {
  const picker = useProjectMaterialPicker(library, undefined, undefined, undefined, 'all');
  return <ProjectMaterialPicker {...picker} hideShotFilters busy={busy}
    references={selected ? [{ url: '/original.png' }] : []} maxSelected={1}
    handleMaterialPickerFilterChange={picker.setMaterialPickerFilter}
    handleAddProjectMaterial={select} onClose={close} onRefresh={refresh} />;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('shared project material picker', () => {
  it('reuses categories, counts, search and applies the original image only after confirmation', async () => {
    const close = vi.fn();
    render(<Harness close={close} />);
    expect(screen.getByRole('dialog', { name: '项目素材' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /人物\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /场景\s*1/ })).toBeInTheDocument();
    expect(screen.queryByText('其他分镜图片')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /人物\s*1/ }));
    expect(screen.queryByTitle('添加 茶馆')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('搜索镜头、人物、场景或道具'), { target: { value: '蓝色衣服' } });
    expect(screen.getByAltText('阿亮')).toHaveAttribute('src', '/preview.png');
    fireEvent.click(screen.getByTitle('选择 阿亮'));
    expect(select).not.toHaveBeenCalled();
    expect(screen.getByTitle('取消选择 阿亮')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ material: expect.objectContaining({ url: '/original.png' }) }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '刷新素材' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('shows a search-empty state', () => {
    render(<Harness />);
    fireEvent.change(screen.getByPlaceholderText('搜索镜头、人物、场景或道具'), { target: { value: '不存在' } });
    expect(screen.getByText('没有匹配的素材或分镜图片')).toBeInTheDocument();
  });
  it('blocks extra selections at the reference limit', () => {
    render(<Harness selected />);
    expect(screen.getByTitle('选择 茶馆')).toBeDisabled();
    expect(screen.getByTitle('已在当前参考图中')).toBeDisabled();
  });
  it('blocks duplicate selection while saving', () => {
    render(<Harness busy />);
    fireEvent.click(screen.getByTitle('选择 阿亮'));
    expect(select).not.toHaveBeenCalled();
  });

  it('lets users change the draft selection without saving either click', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTitle('选择 阿亮'));
    fireEvent.click(screen.getByTitle('取消选择 阿亮'));
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(select).not.toHaveBeenCalled();
  });
});
