import type { EntityFile } from '../services/entityFileService';

export interface HistoryTaskSummary {
  task_id?: string;
  task_type?: string;
  status?: string;
  result?: unknown;
  error?: string | null;
  refund_status?: string | null;
  data?: Record<string, unknown>;
}

export interface ImageUpscaleHistorySpec {
  targetLongEdge: number;
  dpi: number;
  textClarity: boolean;
  width: number;
  height: number;
}

const UPSCALE_FILE_ROLES = new Set([
  'image_upscale',
  'upscaled_image',
  'urgent_image_upscale',
  'important_upscale_test',
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fileIdFromDownloadUrl(value: unknown): string {
  const url = nonEmptyString(value);
  const match = url.match(/\/api\/files\/([^/?]+)\/download(?:[?#].*)?$/);
  return match ? decodeURIComponent(match[1]) : '';
}

function sourceFileIdFromTask(task: HistoryTaskSummary): string {
  const data = asRecord(task.data);
  if (!data) return '';

  const explicitId = nonEmptyString(data.source_file_id);
  if (explicitId) return explicitId;

  const agentFiles = Array.isArray(data.agent_files) ? data.agent_files : [];
  for (const entry of agentFiles) {
    const item = asRecord(entry);
    if (!item) continue;
    const id = fileIdFromDownloadUrl(item.url);
    if (id) return id;
  }

  const imagePath = nonEmptyString(data.image_path);
  const filenameMatch = imagePath.match(/^(file_[A-Za-z0-9_-]+)(?:\.[^.]+)?$/);
  return filenameMatch?.[1] || '';
}

function sourceUrlFromTask(task: HistoryTaskSummary): string {
  const data = asRecord(task.data);
  if (!data) return '';

  const explicitUrl = nonEmptyString(data.source_thumbnail_url);
  if (explicitUrl) return explicitUrl;

  const agentFiles = Array.isArray(data.agent_files) ? data.agent_files : [];
  for (const entry of agentFiles) {
    const item = asRecord(entry);
    if (!item) continue;
    const url = nonEmptyString(item.url);
    if (url) return url;
  }

  const sourceFileId = sourceFileIdFromTask(task);
  return sourceFileId
    ? `/api/files/${encodeURIComponent(sourceFileId)}/download`
    : '';
}

export function isImageUpscaleTask(task: HistoryTaskSummary | undefined): boolean {
  if (!task) return false;
  const data = asRecord(task.data);
  const taskType = nonEmptyString(task.task_type).toLowerCase();
  if (taskType) return taskType === 'image_upscale';
  return nonEmptyString(data?.requested_workflow_type).toLowerCase() === 'image_upscale';
}

function positiveNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function getImageUpscaleHistorySpec(task: HistoryTaskSummary): ImageUpscaleHistorySpec {
  const result = asRecord(task.result) || {};
  const resultPayload = asRecord(result.result_payload) || {};
  const data = asRecord(task.data) || {};
  const verified = Object.keys(resultPayload).length > 0 ? resultPayload : result;
  const width = positiveNumber(verified.target_width);
  const height = positiveNumber(verified.target_height);
  return {
    targetLongEdge: positiveNumber(verified.target_long_edge)
      || Math.max(width, height)
      || positiveNumber(data.target_long_edge),
    dpi: positiveNumber(verified.dpi) || positiveNumber(data.dpi),
    textClarity: typeof verified.text_clarity === 'boolean'
      ? verified.text_clarity
      : data.text_clarity === true,
    width,
    height,
  };
}

export function getImageUpscaleHistoryError(task: HistoryTaskSummary): string {
  const status = nonEmptyString(task.status).toLowerCase();
  if (!['failed', 'timeout'].includes(status)) return '';
  const error = nonEmptyString(task.error).toLowerCase();
  if (error.includes('missing_node_type') || error.includes('int constant') || error.includes('http 400')) {
    return '处理节点缺少图片放大所需组件，本次未生成结果。';
  }
  if (error.includes('upgrade_required') || error.includes('版本不匹配') || error.includes('完整的图片放大能力')) {
    return '处理节点版本不支持当前放大规格，本次未生成结果。';
  }
  if (error.includes('offline') || error.includes('unreachable') || error.includes('离线') || error.includes('不可达')) {
    return '图片处理节点离线或不可达，本次未生成结果。';
  }
  return '图片放大失败，本次未生成结果。';
}

export function getImageUpscaleBillingNote(task: HistoryTaskSummary): string {
  const status = nonEmptyString(task.status).toLowerCase();
  if (!['failed', 'timeout', 'cancelled'].includes(status)) return '';
  return nonEmptyString(task.refund_status).toLowerCase() === 'pending'
    ? '预扣点数正在退回'
    : '预扣点数已退回';
}

export function isLocalImageUpscaleDelivery(task: HistoryTaskSummary): boolean {
  const result = asRecord(task.result) || {};
  const delivery = asRecord(result.delivery) || {};
  return nonEmptyString(delivery.kind).toLowerCase() === 'local_device';
}

export function isImageUpscaleHistoryFile(
  file: Pick<EntityFile, 'fileRole' | 'metadata'>,
): boolean {
  const metadata = asRecord(file.metadata);
  const role = nonEmptyString(file.fileRole).toLowerCase();
  return UPSCALE_FILE_ROLES.has(role)
    || nonEmptyString(metadata?.history_feature).toLowerCase() === 'image_upscale'
    || nonEmptyString(metadata?.requested_workflow_type).toLowerCase() === 'image_upscale'
    || nonEmptyString(metadata?.source_page).toLowerCase() === 'image-upscale';
}

export function isImageUpscaleResultFile(
  file: Pick<EntityFile, 'fileRole' | 'metadata'>,
): boolean {
  const metadata = asRecord(file.metadata);
  const role = nonEmptyString(file.fileRole).toLowerCase();
  return UPSCALE_FILE_ROLES.has(role)
    || (isImageUpscaleHistoryFile(file) && !!nonEmptyString(metadata?.task_id));
}

export function getHistoryPromptText(
  file: Pick<EntityFile, 'fileRole' | 'metadata'>,
): string {
  const prompt = file.metadata?.prompt;
  if (typeof prompt === 'string' && prompt.trim()) {
    return prompt;
  }

  return isImageUpscaleHistoryFile(file) ? '图片高清放大' : '';
}

export function getHistoryThumbnailSource(
  file: Pick<EntityFile, 'fileRole' | 'metadata'>,
): string {
  if (!isImageUpscaleHistoryFile(file)) return '';
  const sourceUrl = nonEmptyString(file.metadata?.source_thumbnail_url);
  if (sourceUrl) return sourceUrl;
  const sourceFileId = nonEmptyString(file.metadata?.source_file_id);
  return sourceFileId
    ? `/api/files/${encodeURIComponent(sourceFileId)}/download`
    : '';
}

export function getHistoryThumbnailFallbackSource(
  file: Pick<EntityFile, 'fileRole' | 'metadata'>,
): string {
  if (!isImageUpscaleHistoryFile(file)) return '';
  const metadata = asRecord(file.metadata);
  const sourceFileId = nonEmptyString(metadata?.source_file_id)
    || fileIdFromDownloadUrl(metadata?.source_thumbnail_url);
  return sourceFileId
    ? `/api/entity-files/${encodeURIComponent(sourceFileId)}/recycle-thumbnail`
    : '';
}

export function enrichHistoryTaskMetadata(
  files: EntityFile[],
  tasks: HistoryTaskSummary[],
): EntityFile[] {
  const taskById = new Map(
    tasks
      .map(task => [nonEmptyString(task.task_id), task] as const)
      .filter(([taskId]) => !!taskId),
  );

  return files.map(file => {
    const metadata = asRecord(file.metadata) || {};
    const task = taskById.get(nonEmptyString(metadata.task_id));
    const data = asRecord(task?.data);
    if (!task || !data) return file;

    const prompt = nonEmptyString(metadata.prompt)
      || nonEmptyString(data.prompt)
      || nonEmptyString(data.text_prompt)
      || nonEmptyString(data.positive_prompt);
    const model = nonEmptyString(metadata.model)
      || nonEmptyString(data.model)
      || nonEmptyString(data.model_name)
      || nonEmptyString(data.sub_model)
      || nonEmptyString(task.task_type);
    const thumbnailUrl = nonEmptyString(file.thumbnailUrl)
      || nonEmptyString(metadata.thumbnail_url)
      || nonEmptyString(data.thumbnail_url);

    return {
      ...file,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      metadata: {
        ...metadata,
        ...(prompt ? { prompt } : {}),
        ...(model ? { model } : {}),
      },
    };
  });
}

export function enrichImageUpscaleHistory(
  files: EntityFile[],
  tasks: HistoryTaskSummary[],
): EntityFile[] {
  const upscaleTasks = tasks.filter(isImageUpscaleTask);
  if (upscaleTasks.length === 0) return files;

  const taskById = new Map<string, HistoryTaskSummary>();
  const sourceTaskByFileId = new Map<string, HistoryTaskSummary>();
  const sourceUrlByTaskId = new Map<string, string>();

  for (const task of upscaleTasks) {
    const taskId = nonEmptyString(task.task_id);
    if (taskId) taskById.set(taskId, task);

    const sourceFileId = sourceFileIdFromTask(task);
    if (sourceFileId) sourceTaskByFileId.set(sourceFileId, task);

    const sourceUrl = sourceUrlFromTask(task);
    if (taskId && sourceUrl) sourceUrlByTaskId.set(taskId, sourceUrl);
  }

  return files.map(file => {
    const metadata = asRecord(file.metadata) || {};
    const taskId = nonEmptyString(metadata.task_id);
    const outputTask = taskId ? taskById.get(taskId) : undefined;
    const sourceTask = sourceTaskByFileId.get(file.fileId);
    if (!outputTask && !sourceTask && !isImageUpscaleHistoryFile(file)) return file;

    const sourceUrl = outputTask && taskId
      ? sourceUrlByTaskId.get(taskId) || ''
      : '';
    const sourceFileId = outputTask ? sourceFileIdFromTask(outputTask) : '';

    return {
      ...file,
      metadata: {
        ...metadata,
        history_feature: 'image_upscale',
        requested_workflow_type: 'image_upscale',
        source_page: 'image-upscale',
        display_name: nonEmptyString(metadata.display_name) || '图片高清放大',
        ...(sourceFileId ? { source_file_id: sourceFileId } : {}),
        ...(sourceUrl && sourceFileId !== file.fileId
          ? { source_thumbnail_url: sourceUrl }
          : {}),
      },
    };
  });
}
