import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkflowLayout } from '../../layouts/WorkflowLayout';

vi.mock('../../contexts/EpisodeContext', () => ({
  EpisodeProvider: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock('../../components/AppSidebar', () => ({ default: () => null }));
vi.mock('../../components/NotificationPanel', () => ({ NotificationPanel: () => null }));
vi.mock('../../components/TaskBadge', () => ({
  TaskBadge: ({ page }: { page: string }) => <span data-testid={`task-badge-${page}`} />,
}));
vi.mock('../../services/creditService', () => ({
  getCreditBalance: vi.fn().mockResolvedValue({ available_credits: 10 }),
}));
vi.mock('../../services/httpClient', () => ({
  apiJson: vi.fn().mockResolvedValue({ episodes: [{ episode_id: 'episode-1', episode_name: 'Test episode' }] }),
}));

afterEach(cleanup);

const base = '/projects/project-1/ep/episode-1/workflow';
async function openWorkflow(page: string) {
  render(
    <MemoryRouter initialEntries={[`${base}/${page}`]}>
      <Routes>
        <Route path="/projects/:projectId/ep/:episodeId/workflow" element={<WorkflowLayout />}>
          {['script', 'design', 'materials', 'audio', 'storyboard', 'video', 'enhance', 'final', 'image-upscale', 'history', 'recycle-bin', 'canvas'].map(path => (
            <Route key={path} path={path} element={<div data-testid={`page-${path}`} />} />
          ))}
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('button', { name: '可用创作点数：10' });
}

describe('third-stage navigation order', () => {
  it('keeps next-step actions aligned with materials, audio, storyboard, then video', () => {
    for (const [page, next] of [['MaterialsPage', 'audio'], ['AudioStagePage', 'storyboard'], ['StoryboardGenPage', 'video']]) {
      const source = readFileSync(resolve(__dirname, `../../pages/${page}.tsx`), 'utf-8');
      expect(source).toContain('navigate(`/projects/${projectId}/ep/${episodeId}/workflow/' + next + '`');
    }
  });

  it.each(['audio', 'storyboard'])('shows audio as 3-1 and storyboard as 3-2 on the %s deep link', async page => {
    await openWorkflow(page);
    const steps = within(screen.getByRole('navigation', { name: '排声音和画面阶段步骤' }));
    const links = steps.getAllByRole('link');
    expect(links.map(link => link.getAttribute('aria-label'))).toEqual([
      '声音对白，第 3-1 步', '镜头画面，第 3-2 步',
    ]);
    expect(links[0]).toHaveAttribute('href', `${base}/audio`);
    expect(links[1]).toHaveAttribute('href', `${base}/storyboard`);
    expect(within(links[0]).getByTestId('task-badge-audio')).toBeInTheDocument();
    expect(within(links[1]).getByTestId('task-badge-storyboard')).toBeInTheDocument();
    expect(links[page === 'audio' ? 0 : 1]).toHaveAttribute('aria-current', 'step');
    expect(within(links[page === 'audio' ? 0 : 1]).getByText('当前步骤')).toBeInTheDocument();
    expect(within(links[page === 'audio' ? 1 : 0]).getByText(page === 'audio' ? '下一步' : '已完成')).toBeInTheDocument();
  });

  it('opens audio first when entering the third stage', async () => {
    await openWorkflow('design');
    fireEvent.click(screen.getByRole('button', { name: /排声音和画面/ }));
    expect(await screen.findByTestId('page-audio')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '声音对白，第 3-1 步' })).toHaveAttribute('aria-current', 'step');
  });

  it('navigates between the reordered steps without changing their route identities', async () => {
    await openWorkflow('audio');
    fireEvent.click(screen.getByRole('link', { name: '镜头画面，第 3-2 步' }));
    expect(await screen.findByTestId('page-storyboard')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '声音对白，第 3-1 步' }));
    expect(await screen.findByTestId('page-audio')).toBeInTheDocument();
  });
});

describe('thumbnail-only portrait legend', () => {
  it.each(['design', 'materials', 'storyboard'])('keeps the legend in the %s thumbnail workspace', async page => {
    await openWorkflow(page);
    expect(screen.getByText('可用于仿真人视频的 Seedream 文生图')).toBeInTheDocument();
  });

  it.each(['script', 'audio', 'video', 'enhance', 'final', 'image-upscale', 'history', 'recycle-bin', 'canvas'])('omits the thumbnail legend from %s', async page => {
    await openWorkflow(page);
    expect(screen.queryByText('可用于仿真人视频的 Seedream 文生图')).not.toBeInTheDocument();
  });

  it('removes the legend when navigating to video and restores it when returning to design', async () => {
    await openWorkflow('design');
    fireEvent.click(screen.getByRole('button', { name: /生成短片/ }));
    expect(await screen.findByTestId('page-video')).toBeInTheDocument();
    expect(screen.queryByText('可用于仿真人视频的 Seedream 文生图')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /定角色和场景/ }));
    expect(await screen.findByTestId('page-design')).toBeInTheDocument();
    expect(screen.getByText('可用于仿真人视频的 Seedream 文生图')).toBeInTheDocument();
  });
});
