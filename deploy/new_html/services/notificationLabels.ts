import type { RegisteredTask } from '../types';
import { getModelDisplayName } from '../utils/modelNames';
import { getModelDisplayName as getVideoModelDisplayName, isSeedanceVideoModel, type VideoModel } from './videoModelService';

/**
 * Return the concrete creator-facing model name carried by a notification.
 * Older task rows may not have model metadata, so callers keep their existing
 * generic kind label as the fallback.
 */
export function getNotificationModelLabel(task: RegisteredTask): string | undefined {
    const rawModel = task.metadata?.modelName || task.metadata?.model;
    if (typeof rawModel !== 'string' || !rawModel.trim()) return undefined;
    if (isSeedanceVideoModel(rawModel as VideoModel)) return getVideoModelDisplayName(rawModel as VideoModel);
    if (task.kind !== 'gemini-image') return undefined;
    return getModelDisplayName(rawModel.trim(), 'image');
}
