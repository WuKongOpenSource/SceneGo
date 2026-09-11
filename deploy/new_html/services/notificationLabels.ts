import type { RegisteredTask } from '../types';
import { getModelDisplayName } from '../utils/modelNames';

/**
 * Return the concrete creator-facing model name carried by a notification.
 * Older task rows may not have model metadata, so callers keep their existing
 * generic kind label as the fallback.
 */
export function getNotificationModelLabel(task: RegisteredTask): string | undefined {
    if (task.kind !== 'gemini-image') return undefined;
    const rawModel = task.metadata?.modelName || task.metadata?.model;
    if (typeof rawModel !== 'string' || !rawModel.trim()) return undefined;
    return getModelDisplayName(rawModel.trim(), 'image');
}
