import { describe, expect, it } from 'vitest';
import { captureVideoPromptHistory, getVideoResultPrompt } from '../../utils/videoPromptHistory';
import { mergeTaskStatusHistories } from '../../utils/videoTaskMerge';
import { reconcileActiveVideoTasks } from '../../services/videoTaskReconciliation';
import type { VideoTask } from '../../services/videoTaskTypes';

const task: VideoTask = { task_id: 'submitted', task_type: 'seedance_multi', status: 'completed', created_at: '2026-09-11',
  data: { workspace_group_id: 'card', prompt: '生成时动作 A' }, result: { videos: [{ url: '/a.mp4' }] } };
describe('video result prompt history', () => {
  it('records the server prompt per output and never substitutes an edited draft', () => {
    const videoPrompts = captureVideoPromptHistory({}, task, ['https://media.example/a.mp4?token=1']);
    expect(getVideoResultPrompt({ result: '/a.mp4?token=2', videoPrompts }, '后续编辑 B')).toBe('生成时动作 A');
    expect(getVideoResultPrompt({ videos: ['/unknown.mp4'] }, '后续编辑 B')).toBe('历史提示词未记录');
  });
  it('only accepts the pending snapshot from the same task', () => {
    const noServerPrompt = { ...task, data: {} };
    expect(captureVideoPromptHistory({ taskId: 'submitted', pendingVideoPrompt: '已提交' }, noServerPrompt, ['/a.mp4']))
      .toEqual({ '/a.mp4': '已提交' });
    expect(captureVideoPromptHistory({ taskId: 'other', pendingVideoPrompt: '另一任务' }, noServerPrompt, ['/a.mp4'])).toEqual({});
  });
  it('preserves an intentionally empty prompt and displays new card provider drafts before a result exists', () => {
    expect(getVideoResultPrompt({ result: '/a', videoPrompts: { '/a': '' } }, '不应用的新文本')).toBe('');
    expect(getVideoResultPrompt({}, '新增镜头动作')).toBe('新增镜头动作');
    expect(getVideoResultPrompt({ pendingVideoPrompt: '已提交' }, '后续编辑')).toBe('已提交');
  });
  it('preserves each child history through a merge and selected-result changes', () => {
    const merged = mergeTaskStatusHistories([
      { videos: ['/a'], videoPrompts: { '/a': 'A' }, result: '/a' }, { videos: ['/b'], videoPrompts: { '/b': 'B' } },
    ])!;
    expect(getVideoResultPrompt(merged, '新合并文本')).toBe('A');
    expect(getVideoResultPrompt({ ...merged, result: '/b' }, '新合并文本')).toBe('B');
  });
  it('backfills reliable server history on reload without changing the beautify selection', () => {
    const status = reconcileActiveVideoTasks([{ uuid: 'card', ids: ['i'], model: 'Seedance15' }], {
      card: { result: '/older.mp4', videos: ['/older.mp4'], videoPrompts: { '/older.mp4': '旧结果' } },
    }, [task]).statuses.card;
    expect(status.videoPrompts).toEqual({ '/older.mp4': '旧结果', '/a.mp4': '生成时动作 A' });
    expect(status.result).toBe('/older.mp4');
    expect(getVideoResultPrompt(JSON.parse(JSON.stringify(status)), '现有草稿')).toBe('旧结果');
  });
});
