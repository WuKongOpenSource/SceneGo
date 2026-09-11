




//   status   = 'unread' | 'read' | 'dismissed'
//   category = 'video' | 'image' | 'text' | 'material'





import type { RegisteredTask, SourcePage, TaskKind, GlobalTaskStatus, TaskNotification } from '../types';
import { formatPublicTaskText } from '../utils/publicTaskTerminology';
import { inferImageToolKind } from '../utils/storyboardTaskStatus';


export interface ServerNotificationRow {
    notification_id: string;
    user_id: string;
    task_id: string | null;
    type: string;
    category: string | null;
    title: string;
    message: string | null;
    status: 'unread' | 'read' | 'dismissed';
    target_view: string | null;
    target_project_id: string | null;
    target_page: string | null;
    target_item_id: string | null;
    metadata?: Record<string, unknown> | null;
    created_at: string;
    read_at?: string | null;
}


const VALID_PAGES: ReadonlyArray<SourcePage> = [
    'editor', 'script', 'design', 'materials', 'audio',
    'storyboard', 'generation', 'video', 'enhance',
    'postprocess', 'canvas', 'history', 'global',
    'image-upscale',
];

function normalizeTargetPage(raw: string | null): SourcePage {
    if (raw && (VALID_PAGES as ReadonlyArray<string>).includes(raw)) {
        return raw as SourcePage;
    }
    return 'global';
}





function inferKindFromCategoryAndTitle(
    category: string | null,
    title: string,
    metadata?: Record<string, unknown>,
): TaskKind {
    const context = [
        title,
        metadata?.task_type,
        metadata?.provider,
        metadata?.model,
        metadata?.modelName,
        metadata?.sub_model,
    ].filter(value => typeof value === 'string').join(' ').toLowerCase();
    const t = context;
    const toolKind = inferImageToolKind(t);
    if (toolKind) return toolKind;
    if (/image[_ -]?upscale|图片高清放大/.test(t)) return 'image-upscale';
    if (category === 'video' || /upscale|放大|i2v|视频|seedance|wan2|kling|vidu|happyhorse|sora|veo/.test(t)) {
        if (/upscale|放大/.test(t)) return 'video-upscale';
        if (/seedance[\s_-]*1[.\s_-]?5|agent_plan/.test(t)) return 'seedance-1.5';
        if (/seedance.*fast/.test(t)) return 'seedance-fast';
        if (/seedance.*mini/.test(t)) return 'seedance-mini';
        if (/seedance/.test(t)) return 'seedance';
        if (/wan2/.test(t)) return 'wan2';
        if (/kling/.test(t)) return 'kling';
        if (/vidu/.test(t)) return 'vidu';
        if (/happyhorse|happy[ -_]?horse/.test(t)) return 'happyhorse';
        if (/sora/.test(t)) return 'sora2';
        if (/veo/.test(t)) return 'veo';
        return 'video-i2v';
    }
    if (category === 'text' || /改写|分镜|rewrite|storyboard/.test(t)) {
        if (/改写|rewrite/.test(t)) return 'prompt-rewrite';
        if (/分镜|storyboard/.test(t)) return 'auto-storyboard';
        return 'script-segment';
    }
    if (category === 'material' || /抠图|matting/.test(t)) return 'matting';
    if (category === 'image' || /图|image/.test(t)) {
        if (/qwen.*lora/.test(t)) return 'qwen-lora';
        if (/qwen/.test(t)) return 'qwen-image';
        if (/kontext/.test(t)) return 'kontext';
        if (/角度|angle/.test(t)) return 'angle-adjust';
        if (/融合|fusion/.test(t)) return 'image-fusion';
        if (/全景|panorama/.test(t)) return 'panorama-360';
        if (/gemini|^ai\s*生图任务/.test(t)) return 'gemini-image';
        if (/doubao|豆包/.test(t)) return 'doubao-image';
        if (/nanobanana|香蕉/.test(t)) return 'nanobanana';
        if (/comfyui|集群|节点/.test(t)) return 'comfyui-image';
        return 'other';
    }
    if (/tts|配音/.test(t)) {
        if (/minimax/.test(t)) return 'minimax-tts';
        if (/gemini/.test(t)) return 'gemini-tts';
        return 'minimax-tts';
    }
    return 'other';
}




function inferStatusFromTitle(title: string): GlobalTaskStatus {
    if (/失败|failed|error/i.test(title)) return 'failed';
    return 'completed';
}




function stripStatusSuffix(title: string): string {
    return title
        .replace(/\s*已完成\s*$/, '')
        .replace(/\s*失败\s*$/, '')
        .replace(/\s*completed\s*$/i, '')
        .replace(/\s*failed\s*$/i, '')
        .trim() || title;
}




function parseTs(input: string | null | undefined): number {
    if (!input) return Date.now();
    const t = Date.parse(input);
    if (Number.isFinite(t)) return t;
    return Date.now();
}





export function mapNotificationToTask(n: ServerNotificationRow): RegisteredTask | null {
    if (!n || !n.title) return null;
    const status = inferStatusFromTitle(n.title);
    const taskId = n.task_id || n.notification_id;
    if (!taskId) return null;

    const ts = parseTs(n.created_at);


    const metadata = (n.metadata && typeof n.metadata === 'object' && !Array.isArray(n.metadata))
        ? (n.metadata as Record<string, unknown>)
        : undefined;

    const metadataText = (key: string): string | undefined => {
        const value = metadata?.[key];
        return typeof value === 'string' && value.trim() ? value : undefined;
    };
    const entityType = metadataText('entity_type');
    const entityId = metadataText('entity_id');
    const sourceItemId = metadataText('source_item_id');
    const persistedSourcePage = n.target_page || metadataText('source_page') || null;
    const sourcePage = entityType === 'storyboard_item' && persistedSourcePage === 'design'
        ? 'generation'
        : persistedSourcePage;
    const kind = inferKindFromCategoryAndTitle(n.category, n.title, metadata);
    return {
        taskId,
        notificationId: n.notification_id,
        kind,
        title: formatPublicTaskText(stripStatusSuffix(n.title), kind),
        status,
        progress: status === 'completed' ? 1 : undefined,
        createdAt: ts,
        startedAt: ts,
        completedAt: ts,
        targetPage: normalizeTargetPage(sourcePage),
        targetProjectId: n.target_project_id || metadataText('project_id'),
        targetItemId: n.target_item_id || sourceItemId || entityId,
        targetEntityType: entityType,
        targetEntityId: entityId,
        episodeId: metadataText('episode_id'),
        fileRole: metadataText('file_role'),
        error: status === 'failed' ? (n.message || '任务失败') : undefined,
        metadata,


        _fromServer: true,
    } as RegisteredTask;
}






export function mapRuntimeNotificationToTask(n: TaskNotification): RegisteredTask | null {
    const taskId = n.taskId || n.id;
    if (!taskId) return null;
    const timestamp = Number.isFinite(n.timestamp) ? n.timestamp : Date.now();
    const rawTitle = stripStatusSuffix(n.message || taskId);
    const status: GlobalTaskStatus = n.status === 'failed' ? 'failed' : 'completed';
    const kind = inferKindFromCategoryAndTitle(n.type, `${rawTitle} ${n.taskType || ''} ${n.taskId || n.id}`);

    return {
        taskId,
        notificationId: n.id && n.id !== taskId ? n.id : undefined,
        kind,
        title: formatPublicTaskText(rawTitle, kind),
        status,
        progress: status === 'completed' ? 1 : undefined,
        createdAt: timestamp,
        startedAt: timestamp,
        completedAt: timestamp,
        targetPage: n.targetPage || 'global',
        targetProjectId: n.targetProjectId,
        targetItemId: n.targetItemId,
        targetEntityType: n.entityType,
        targetEntityId: n.entityId,
        episodeId: n.episodeId,
        fileRole: n.fileRole,
        metadata: {
            ...(n.provider ? { provider: n.provider } : {}),
            ...(n.modelName ? { modelName: n.modelName } : {}),
        },
        error: status === 'failed' ? (n.message || '任务失败') : undefined,
    };
}




export function mapNotificationsToTasks(rows: ServerNotificationRow[]): RegisteredTask[] {
    return rows
        .filter(n => n && n.status !== 'dismissed')
        .map(mapNotificationToTask)
        .filter((t): t is RegisteredTask => t != null);
}
