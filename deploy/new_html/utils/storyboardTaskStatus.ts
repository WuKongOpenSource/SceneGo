import type { RegisteredTask, TaskKind } from '../types';

export const IMAGE_TOOL_LABELS: Partial<Record<TaskKind, string>> = {
  'angle-adjust': '角度调整', 'human-multi-angle': '多角度人物',
  'around-angle': '全景角度', matting: '抠图', 'image-fusion': '图像融合',
  'panorama-360': '360 全景', 'panorama-fusion': '全景融合',
  'auto-storyboard': '自动分镜', 'multi-grid-storyboard': '多格分镜',
  'image-upscale': '图片放大',
};

/** Legacy backend operation IDs describe an operation, not a second task/model. */
export function inferImageToolKind(value: string): TaskKind | undefined {
  if (/i2i_human|human-multi-angle|多角度人物/i.test(value)) return 'human-multi-angle';
  if (/i2i_around|around-angle|全景角度/i.test(value)) return 'around-angle';
  if (/i2i_fj|angle-adjust|角度调整/i.test(value)) return 'angle-adjust';
  return undefined;
}

export function storyboardToolTasks(
  tasks: RegisteredTask[], scope: { shotId?: string | null; projectId?: string; episodeId?: string },
): RegisteredTask[] {
  if (!scope.shotId) return [];
  const seen = new Set<string>();
  return tasks.filter(task => {
    if (!['pending', 'queued', 'running'].includes(task.status)) return false;
    if (!IMAGE_TOOL_LABELS[task.kind] || task.targetEntityType !== 'storyboard_item') return false;
    if (task.targetEntityId !== scope.shotId) return false;
    if (task.episodeId && scope.episodeId && task.episodeId !== scope.episodeId) return false;
    if (task.targetProjectId && scope.projectId && task.targetProjectId !== scope.projectId) return false;
    const id = String(task.metadata?.backendTaskId || task.taskId);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function imageTaskPercent(task: RegisteredTask): number | undefined {
  if (typeof task.progress !== 'number' || !Number.isFinite(task.progress)) return undefined;
  return Math.round(Math.max(0, Math.min(1, task.progress)) * 100);
}
