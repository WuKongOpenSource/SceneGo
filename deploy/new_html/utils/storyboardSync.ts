







import type { SyncMode } from '../components/video/StoryboardSyncModal';
import { generateUUID } from '@runtime/videoTaskService';
import {
    DEFAULT_VIDEO_MODEL,
    seedanceSubModelForVideoModel,
    type SeedanceParams,
    type ShotType,
} from '../services/videoModelService';
import type { TaskGroup, UploadedImage } from '../services/videoTaskTypes';
import { buildStoryboardVideoPrompt } from './storyboardVideoPrompt';
import {
    computeReactiveDurationFromMeta,
    patchWorkspaceSession,
    saveWorkspaceSession,
    type StoryboardMeta,
    type WorkspaceSession,
} from '../services/videoWorkspaceService';

interface PerItemArtifacts {
    image: UploadedImage;
    group: TaskGroup;
    sp: SeedanceParams;
    meta: StoryboardMeta;
    prompt: string;
}

function storyboardItemId(item: any): string {
    return String(item?.item_id ?? item?.itemId ?? item?.id ?? '').trim();
}







function buildArtifacts(item: any): PerItemArtifacts | null {
    const itemId = storyboardItemId(item);
    if (!itemId) return null;

    const rawUrl = (item.generated_image_url ?? item.generatedImageUrl ?? '') as string;
    const url = (rawUrl || '').toString().split('?')[0];
    let imgUrl = '';
    let isPlaceholder = true;
    if (url && (url.startsWith('http') || url.startsWith('/'))) {
        imgUrl = url;
        isPlaceholder = false;
    }

    const sortOrder = item.sort_order ?? item.sortOrder ?? 0;
    const prompt = buildStoryboardVideoPrompt(item);

    const audioUrls = {
        dialogue:  item.dialogue_audio_url ?? item.dialogueAudioUrl ?? undefined,
        narration: item.narration_audio_url ?? item.narrationAudioUrl ?? undefined,
        sfx:       item.sfx_audio_url ?? item.sfxAudioUrl ?? undefined,
    };
    const meta: StoryboardMeta = {
        plannedDurationMs: item.planned_duration_ms ?? item.plannedDurationMs ?? undefined,
        audioDurationMs:   item.audio_duration_ms ?? item.audioDurationMs ?? undefined,
        audioUrls: (audioUrls.dialogue || audioUrls.narration || audioUrls.sfx) ? audioUrls : undefined,
        mixedAudioUrl:  item.mixed_audio_url ?? item.mixedAudioUrl ?? undefined,
        mixedAudioHash: item.mixed_audio_hash ?? item.mixedAudioHash ?? undefined,
        sceneHeading: item.scene_heading ?? item.sceneHeading ?? undefined,
        actionText:   item.action_text ?? item.actionText ?? undefined,
        dialogue:     item.dialogue ?? undefined,
        lastSyncedAt: Date.now(),
    };

    const initialDuration = computeReactiveDurationFromMeta(meta);
    const groupUuid = generateUUID();

    const image: UploadedImage = {
        id: itemId,
        url: imgUrl,
        filename: imgUrl ? `storyboard_${sortOrder + 1}.png` : `placeholder_${sortOrder + 1}`,
        storageUrl: imgUrl || undefined,
        uploadTime: Date.now(),
        isPlaceholder,
        storyboardItemId: itemId,
        sortOrder,
        tags: [],
        linkedGroupUuids: [groupUuid],
    };
    const group: TaskGroup = {
        uuid: groupUuid,
        ids: [itemId],
        model: DEFAULT_VIDEO_MODEL,
        shotType: 'single' as ShotType,
        duration: initialDuration,
        durationUserOverride: false,
    };
    const sp: SeedanceParams = {
        sub_model: seedanceSubModelForVideoModel(DEFAULT_VIDEO_MODEL),
        prompt: prompt || (isPlaceholder ? '@' : ''),
        // Mirrors VideoGenPage.handleImportAll: the 1.5 default starts from the storyboard image.
        media_inputs: imgUrl
            ? [{ kind: 'image', url: imgUrl, role: 'first_frame' }]
            : [],
        duration: initialDuration,
        ratio: 'adaptive',
        seed: -1,
        watermark: false,
        generate_audio: true,
        camera_fixed: false,
    };
    const refAudio =
        meta.mixedAudioUrl
        || meta.audioUrls?.dialogue
        || meta.audioUrls?.narration
        || meta.audioUrls?.sfx
        || null;
    if (refAudio) {
        sp.media_inputs.push({
            kind: 'audio',
            url: refAudio,
            role: 'reference_audio',
        });
    }
    return { image, group, sp, meta, prompt };
}

export interface ApplySyncResult {




    shouldReimport?: boolean;
}







export async function applySyncStrategy(
    mode: SyncMode,
    storyboardItems: any[],
    session: WorkspaceSession,
    scope: string | undefined,
): Promise<ApplySyncResult> {
    if (mode === 'full_reset') {
        await saveWorkspaceSession({
            uploaded_images: [],
            task_groups: [],
            image_prompts: {},
            tasks_status: {},
            seedance_params: {},
            storyboard_meta: {},
        }, scope);
        return { shouldReimport: true };
    }

    const wsIds = new Set(
        (session.uploaded_images || []).map(i => i.storyboardItemId).filter(Boolean) as string[]
    );

    if (mode === 'add_new') {
        const newItems = storyboardItems.filter(s => {
            const id = storyboardItemId(s);
            return id && !wsIds.has(id);
        });
        if (newItems.length === 0) return {};

        const addImages: UploadedImage[] = [];
        const addGroups: TaskGroup[] = [];
        const addPrompts: Record<string, string> = {};
        const addMeta: Record<string, StoryboardMeta> = {};
        const addSP: Record<string, SeedanceParams> = {};

        for (const it of newItems) {
            const a = buildArtifacts(it);
            if (!a) continue;
            addImages.push(a.image);
            addGroups.push(a.group);
            if (a.prompt) addPrompts[a.image.id] = a.prompt;
            addMeta[a.image.id] = a.meta;
            addSP[a.group.uuid] = a.sp;
        }

        await patchWorkspaceSession(scope, (cur) => ({
            uploaded_images: [...(cur.uploaded_images || []), ...addImages],
            task_groups:     [...(cur.task_groups || []), ...addGroups],
            image_prompts:   { ...(cur.image_prompts || {}), ...addPrompts },
            seedance_params: { ...(cur.seedance_params || {}), ...addSP },
            storyboard_meta: { ...(cur.storyboard_meta || {}), ...addMeta },
        }));
        return {};
    }

    // mode === 'overwrite_unmodified'

    const sbByItemId = new Map<string, any>();
    for (const s of storyboardItems) {
        const id = storyboardItemId(s);
        if (id) sbByItemId.set(id, s);
    }

    const groups = session.task_groups || [];
    const sps = session.seedance_params || {};
    const meta = session.storyboard_meta || {};

    const newPrompts: Record<string, string> = {};
    const newSP: Record<string, SeedanceParams> = {};
    const newMeta: Record<string, StoryboardMeta> = {};
    const newImages = new Map<string, UploadedImage>();
    for (const img of session.uploaded_images || []) {
        newImages.set(img.id, img);
    }
    const newGroups: TaskGroup[] = [];

    for (const g of groups) {
        const itemId = g.ids?.[0];
        if (!itemId) {
            newGroups.push(g);
            continue;
        }
        const sb = sbByItemId.get(itemId);
        const m = meta[itemId];
        const sp = sps[g.uuid];
        const cardEdited = !!g.durationUserOverride
            || (sp?.media_inputs?.length || 0) > 1;
        const updatedAt = sb ? ((sb as any).updated_at ?? (sb as any).updatedAt) : undefined;
        const updatedTs = updatedAt ? new Date(updatedAt).getTime() : NaN;
        const modifiedSinceSync = sb && m?.lastSyncedAt && Number.isFinite(updatedTs)
            && updatedTs > (m.lastSyncedAt as number);

        if (sb && !cardEdited && modifiedSinceSync) {
            const a = buildArtifacts(sb);
            if (a) {
                newGroups.push({ ...a.group, uuid: g.uuid });
                newSP[g.uuid] = a.sp;
                newMeta[itemId] = a.meta;
                if (a.prompt) newPrompts[itemId] = a.prompt;
                newImages.set(itemId, { ...a.image, linkedGroupUuids: [g.uuid] });
                continue;
            }
        }
        newGroups.push(g);
        if (sp) newSP[g.uuid] = sp;
        if (m) newMeta[itemId] = m;
    }

    await patchWorkspaceSession(scope, (cur) => ({
        uploaded_images: Array.from(newImages.values()),
        task_groups: newGroups,
        image_prompts: { ...(cur.image_prompts || {}), ...newPrompts },
        seedance_params: { ...(cur.seedance_params || {}), ...newSP },
        storyboard_meta: { ...(cur.storyboard_meta || {}), ...newMeta },
    }));
    return {};
}
