import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, Outlet } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import App from '../../App';
import { PlatformShell } from '../../components/PlatformShell';
import { ADMIN_BASE_PATH } from '../../admin/adminRoute';

vi.mock('../../contexts/WorkspaceContext', () => ({ WorkspaceProvider: ({ children }: React.PropsWithChildren) => children }));
vi.mock('../../contexts/TaskContext', () => ({ TaskProvider: ({ children }: React.PropsWithChildren) => children }));
vi.mock('../../utils/idleScheduler', () => ({ runWhenIdle: () => () => {} }));
vi.mock('../../components/ProjectHub', () => ({ default: () => <div>项目工作台<Link to="/updates">查看平台更新</Link></div> }));
vi.mock('../../pages/CreatePage', () => ({ default: () => <div>创建作品</div> }));
vi.mock('../../components/ProjectWorkspace', () => ({ default: () => <Outlet /> }));
vi.mock('../../layouts/WorkflowLayout', () => ({ WorkflowLayout: () => <Outlet /> }));
vi.mock('../../layouts/GlobalToolsLayout', () => ({ GlobalToolsLayout: () => <Outlet /> }));
vi.mock('../../pages/StoryboardGenPage', () => ({ StoryboardGenPage: () => <div>分镜工作台</div> }));
vi.mock('../../pages/AudioStagePage', () => ({ AudioStagePage: () => <div>声音工作台</div> }));
vi.mock('../../pages/ImageUpscalePage', () => ({ default: () => <div>放大工具</div> }));
vi.mock('../../pages/ProfilePage', () => ({ default: () => <div>个人资料</div> }));
vi.mock('../../pages/FinalProductSharePage', () => ({ default: () => <div>分享成片</div> }));
vi.mock('../../admin/AdminLayout', () => ({ default: () => <Outlet /> }));
vi.mock('../../admin/AdminSettingsPage', () => ({ default: () => <div>系统设置</div> }));

beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected API request'))));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('workspace footer visibility', () => {
  it.each([
    ['/projects', '项目工作台'],
    ['/create', '创建作品'],
    ['/projects/project-1/ep/episode-1/workflow/storyboard', '分镜工作台'],
    ['/projects/project-1/ep/episode-1/workflow/audio', '声音工作台'],
    ['/tools/image-upscale', '放大工具'],
    ['/profile', '个人资料'],
    [`${ADMIN_BASE_PATH}/settings?item=cluster`, '系统设置'],
  ])('uses the full workspace without a release footer on %s', async (path, content) => {
    window.history.replaceState({}, '', path);
    const { container } = render(<App />);
    expect(await screen.findByText(content)).toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(container.querySelector('.platform-release-dialog')).not.toBeInTheDocument();
    expect(container.querySelector('.platform-shell')).toHaveClass('platform-shell-workspace');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['/updates', '/updates/', '/share/final/test-token'])('preserves public release information on %s', async path => {
    window.history.replaceState({}, '', path);
    const { container } = render(<App />);
    if (path.startsWith('/updates')) await screen.findByRole('heading', { name: '更新记录' });
    else await screen.findByText('分享成片');
    expect(screen.getByRole('contentinfo', { name: '平台版本与更新记录' })).toBeInTheDocument();
    expect(container.querySelector('.platform-shell')).not.toHaveClass('platform-shell-workspace');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('updates both visibility and height reservation when navigating between public and workspace routes', async () => {
    window.history.replaceState({}, '', '/projects');
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: '查看平台更新' }));
    await screen.findByRole('heading', { name: '更新记录' });
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← 返回创作平台' })).toHaveAttribute('href', '/projects');
    act(() => {
      window.history.replaceState({}, '', '/projects');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByText('项目工作台');
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(container.querySelector('.platform-shell')).toHaveClass('platform-shell-workspace');
  });

  it('defaults standalone workspaces to no footer and removes the reserved footer height', () => {
    const { container } = render(<PlatformShell><main>自由创作</main></PlatformShell>);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(container.querySelector('.platform-shell')).toHaveClass('platform-shell-workspace');
    const css = readFileSync(resolve(__dirname, '../../styles/platform-release.css'), 'utf8');
    expect(css).toContain('.platform-shell-workspace { --platform-footer-height: 0px; }');
    expect(css).toContain('--platform-page-height: calc(100dvh - var(--platform-footer-height))');
  });
});
