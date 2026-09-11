import type { RegisteredTask, SourcePage } from '../types';

/**
 * Build a workflow URL from the task context persisted with a notification.
 * Storyboard image tasks carry the shot id in the query string so the target
 * page can select and reveal the exact shot instead of only opening the page.
 */
export function buildNotificationTargetUrl(task: RegisteredTask): string | null {
    const { targetPage, episodeId, targetProjectId, targetItemId, targetEntityId } = task;
    const globalToolTargets: Partial<Record<SourcePage, string>> = {
        'image-upscale': '/tools/image-upscale',
        history: '/tools/history',
        'media-library': '/tools/media-library',
    };
    if (globalToolTargets[targetPage]) return globalToolTargets[targetPage]!;
    if (!targetProjectId || !episodeId) {
        return targetProjectId ? `/projects/${targetProjectId}/episodes` : null;
    }

    const base = `/projects/${targetProjectId}/ep/${episodeId}/workflow`;
    const shotId = targetItemId || (
        task.targetEntityType === 'storyboard_item' ? targetEntityId : undefined
    );
    const storyboardTarget = (path: string) => {
        if (!shotId) return path;
        return `${path}?${new URLSearchParams({ shotId }).toString()}`;
    };
    const map: Record<SourcePage, string | null> = {
        editor: `${base}/script`,
        script: `${base}/script`,
        design: `${base}/design`,
        materials: `${base}/materials`,
        audio: `${base}/audio`,
        storyboard: storyboardTarget(`${base}/storyboard`),
        generation: storyboardTarget(`${base}/storyboard`),
        video: `${base}/video`,
        enhance: `${base}/enhance`,
        postprocess: `${base}/postprocess`,
        canvas: `/projects/${targetProjectId}/ep/${episodeId}/canvas`,
        history: '/tools/history',
        'media-library': '/tools/media-library',
        final: `${base}/final`,
        'video-reverse': `${base}/video-reverse`,
        'image-upscale': '/tools/image-upscale',
        global: null,
    };
    return map[targetPage] || null;
}
