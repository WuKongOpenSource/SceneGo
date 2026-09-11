import React from 'react';
import type { RegisteredTask } from '../types';
import { IMAGE_TOOL_LABELS, imageTaskPercent } from '../utils/storyboardTaskStatus';

export function StoryboardTaskCards({ tasks }: { tasks: RegisteredTask[] }) {
  return <>{tasks.map(task => {
    const percent = imageTaskPercent(task);
    const running = task.status === 'running';
    const status = running ? '生成中' : '排队中';
    return <div key={task.taskId} data-testid="storyboard-tool-task" data-task-id={task.taskId}
      role="status" aria-label={`${IMAGE_TOOL_LABELS[task.kind]}${status}`}
      className="aspect-video rounded-md border-2 border-dashed border-primary/50 bg-n0 px-5 flex flex-col items-center justify-center">
      <div className="mb-2 h-7 w-7 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      <span className="text-sm font-bold text-primary">{IMAGE_TOOL_LABELS[task.kind]} · {status}{running && percent !== undefined ? ` ${percent}%` : ''}</span>
      <span className="mt-2 text-xs text-n300">{running ? '任务正在处理，可切换镜头，完成后自动刷新' : '等待处理，提交后自动更新进度'}</span>
      {running && percent !== undefined && <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>}
    </div>;
  })}</>;
}
