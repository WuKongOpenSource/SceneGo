import type { ProjectVideoTask } from '@runtime/videoMediaService';
import type { TaskGroup, UploadedImage } from '../services/videoTaskTypes';
import { buildStoryboardVideoPrompt } from './storyboardVideoPrompt';

export interface VideoTaskImportBuildOptions {
  normalizeUrl: (url: string) => string;
  now?: () => number;
  random?: () => number;
}

export interface VideoTaskImportBuildResult {
  images: UploadedImage[];
  groups: TaskGroup[];
  prompts: Record<string, string>;
  skipped: Array<{ storyboardId?: string; reason: string }>;
}

function suffixFromRandom(random: () => number): string {
  return random().toString(36).slice(2, 11);
}

export function buildVideoTaskImport(
  tasks: ProjectVideoTask[],
  options: VideoTaskImportBuildOptions,
): VideoTaskImportBuildResult {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const images: UploadedImage[] = [];
  const groups: TaskGroup[] = [];
  const prompts: Record<string, string> = {};
  const skipped: VideoTaskImportBuildResult['skipped'] = [];

  tasks.forEach((task, index) => {
    const imageUrl = options.normalizeUrl(task.image_url || '');
    if (!imageUrl) {
      skipped.push({ storyboardId: task.storyboard_id, reason: 'missing_image_url' });
      return;
    }

    const imageTs = now();
    const imgId = `img_${imageTs}_${index}_${suffixFromRandom(random)}`;
    const groupTs = now();
    const groupId = `task_${groupTs}_${suffixFromRandom(random)}`;

    images.push({
      id: imgId,
      url: imageUrl,
      storageUrl: imageUrl,
      filename: `${task.scene || 'shot'}_${task.storyboard_id || index + 1}.png`,
      uploadTime: imageTs,
    });

    prompts[imgId] = buildStoryboardVideoPrompt(task);
    groups.push({
      uuid: groupId,
      ids: [imgId],
      model: 'HappyHorse',
      createdAt: groupTs,
    });

    (task.resolved_bindings || []).forEach((binding, bindingIndex) => {
      if (binding.is_disabled || !binding.file_url) return;
      const referenceUrl = options.normalizeUrl(binding.file_url);
      if (!referenceUrl) return;
      const referenceId = `ref_${groupId}_${binding.binding_id || bindingIndex}`;
      images.push({
        id: referenceId,
        fileId: binding.file_id || undefined,
        url: referenceUrl,
        storageUrl: referenceUrl,
        filename: `${binding.tag_key || 'binding'}_reference.png`,
        uploadTime: now(),
        linkedGroupUuids: [groupId],
        tags: [binding.tag_key || 'binding', binding.scope || 'project'],
      });
    });
  });

  return { images, groups, prompts, skipped };
}
