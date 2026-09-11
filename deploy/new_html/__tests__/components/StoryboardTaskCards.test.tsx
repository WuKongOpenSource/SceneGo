import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoryboardTaskCards } from '../../components/StoryboardTaskCards';
import { storyboardToolTasks, inferImageToolKind } from '../../utils/storyboardTaskStatus';
import type { RegisteredTask } from '../../types';

afterEach(cleanup);
const task: RegisteredTask = { taskId: 'task-1', title: '角度调整', kind: 'angle-adjust',
  targetPage: 'generation', targetEntityType: 'storyboard_item', targetEntityId: 'shot-23',
  episodeId: 'episode-1', targetProjectId: 'project-1', status: 'running', progress: 0.1, createdAt: 1 };
const scope = { shotId: 'shot-23', episodeId: 'episode-1', projectId: 'project-1' };

describe('storyboard processing cards', () => {
  it('returns when switching back to the shot, and disappears only after settlement', () => {
    const { rerender } = render(<StoryboardTaskCards tasks={storyboardToolTasks([task], scope)} />);
    expect(screen.getByText('角度调整 · 生成中 10%')).toBeInTheDocument();
    rerender(<StoryboardTaskCards tasks={storyboardToolTasks([task], { ...scope, shotId: 'shot-22' })} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(<StoryboardTaskCards tasks={storyboardToolTasks([task], scope)} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<StoryboardTaskCards tasks={storyboardToolTasks([{ ...task, status: 'completed' }], scope)} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('supports separate simultaneous tasks and honest queued/unknown progress', () => {
    render(<StoryboardTaskCards tasks={[{ ...task, progress: undefined }, {
      ...task, taskId: 'task-2', kind: 'human-multi-angle', status: 'queued',
    }]} />);
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getByText('角度调整 · 生成中')).toBeInTheDocument();
    expect(screen.getByText('多角度人物 · 排队中')).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it('does not mix episodes, projects, materials or ordinary AI image progress', () => {
    const rows = [task, { ...task, episodeId: 'episode-2' }, { ...task, targetProjectId: 'project-2' },
      { ...task, targetEntityType: 'character' }, { ...task, kind: 'doubao-image' as const }];
    expect(storyboardToolTasks(rows, scope)).toEqual([task]);
    expect(storyboardToolTasks(rows, {})).toEqual([]);
  });

  it.each([['i2i_fj', 'angle-adjust'], ['i2i_human', 'human-multi-angle'], ['i2i_around', 'around-angle']])(
    'recognizes recovered operation %s', (value, expected) => expect(inferImageToolKind(value)).toBe(expected),
  );
});
