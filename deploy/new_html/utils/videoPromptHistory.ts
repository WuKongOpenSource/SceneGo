import type { TaskStatus, VideoTask } from '../services/videoTaskTypes';

export const videoPromptKey = (url: string): string => url.split('?')[0].replace(/^https?:\/\/[^/]+/, '');

/** Only a server request snapshot or the matching submitted task can supply history. */
export function captureVideoPromptHistory(previous: TaskStatus, task: VideoTask, urls: string[]): Record<string, string> {
  const prompts = { ...previous.videoPrompts };
  const prompt = typeof task.data?.prompt === 'string' ? task.data.prompt
    : previous.taskId === task.task_id ? previous.pendingVideoPrompt : undefined;
  if (prompt !== undefined) urls.forEach(url => { prompts[videoPromptKey(url)] = prompt; });
  return prompts;
}

export function getVideoResultPrompt(status: TaskStatus, draft: string): string {
  const result = status.result || status.videos?.at(-1);
  if (!result) return status.pendingVideoPrompt ?? draft;
  const key = videoPromptKey(result);
  if (status.uploadedVideos?.[key]) return '外部上传视频（无生成提示词）';
  return status.videoPrompts?.[key] ?? '历史提示词未记录';
}
