import type { SeedanceParams } from '../services/videoModelService';
import type { SeedanceAssetCandidate, SeedanceMediaKind } from './seedanceMedia';

export interface CandidateBuildContext {
    currentParams: SeedanceParams;
    /** storyboard_item.item_id for the card the popover belongs to.
     *  When set, storyboard_data and per-item audio (dialogue/narration/sfx/mixed)
     *  are scoped to this item; episode-wide materialLibrary.audio is NOT bled in.
     *  characterVoices + audioTracks are episode/project-wide and ALWAYS shown
     *  (they're catalogue resources, not scene-specific).
     *  When undefined (e.g. tests, manual upload card), legacy "all" behavior. */
    currentStoryboardItemId?: string;
    materialLibrary: any;     // MaterialLibrary (loose typing intentional; see types/material.ts)
    storyboardItems: any[];
    historyVideos: any[];
    userFiles: any[];
    /** Project media-library items, including generated design/material/storyboard resources. */
    mediaLibraryItems?: any[];

    characterVoices?: any[];

    audioTracks?: any[];
}

function inferKindFromMime(mime: string | undefined): SeedanceMediaKind | null {
    if (!mime) return null;
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return null;
}

function inferKindFromLibraryItem(item: any): SeedanceMediaKind | null {
    const explicit = String(item?.item_type || item?.itemType || '').toLowerCase();
    if (explicit === 'image' || explicit === 'video' || explicit === 'audio') {
        return explicit;
    }
    const mimeKind = inferKindFromMime(item?.mime_type || item?.mimeType || item?.file_type || item?.fileType);
    if (mimeKind) return mimeKind;
    const url = String(item?.file_url || item?.fileUrl || '');
    if (/\.(png|jpe?g|webp|gif|bmp|avif)(?:$|[?#])/i.test(url)) return 'image';
    if (/\.(mp4|mov|webm|mkv|avi)(?:$|[?#])/i.test(url)) return 'video';
    if (/\.(mp3|wav|m4a|aac|ogg|flac)(?:$|[?#])/i.test(url)) return 'audio';
    return null;
}

function isLikelyImageFile(file: any): boolean {
    const rawType = String(file?.fileType || file?.file_type || file?.mimeType || file?.mime_type || '').toLowerCase();
    const role = String(file?.fileRole || file?.file_role || '').toLowerCase();
    const url = String(file?.fileUrl || file?.file_url || '');
    if (rawType.startsWith('video') || rawType.startsWith('audio')) return false;
    return rawType.startsWith('image')
        || role.includes('image')
        || /\.(png|jpe?g|webp|gif|bmp|avif)(?:$|[?#])/i.test(url);
}

export function buildVideoMaterialLibrary(assets: any[] = [], audioTracks: any[] = []) {
    const grouped: Record<'characters' | 'scenes' | 'props', any[]> = {
        characters: [],
        scenes: [],
        props: [],
    };

    assets.forEach((asset: any) => {
        const assetType = asset?.assetType || asset?.asset_type;
        const group = assetType === 'character'
            ? 'characters'
            : assetType === 'scene'
                ? 'scenes'
                : assetType === 'prop'
                    ? 'props'
                    : null;
        if (!group) return;

        const sources: Array<{ id: string; url: string; suffix?: string; fileId?: string }> = [];
        const pushSource = (id: string, url: unknown, suffix?: string, fileId?: string) => {
            const normalized = String(url || '').trim();
            if (!normalized) return;
            const existing = sources.find(source => source.url === normalized);
            if (existing) { if (fileId) existing.fileId = fileId; return; }
            sources.push({ id, url: normalized, suffix, fileId });
        };

        pushSource('thumbnail', asset.thumbnailUrl || asset.thumbnail_url, '封面');
        (asset.referenceImages || asset.reference_images || []).forEach((url: string, index: number) => {
            pushSource(`reference-${index + 1}`, url, `参考图 ${index + 1}`);
        });
        (asset.entityFiles || asset.entity_files || []).forEach((file: any, index: number) => {
            if (!isLikelyImageFile(file)) return;
            pushSource(
                String(file.fileId || file.file_id || file.entityFileId || file.entity_file_id || `file-${index + 1}`),
                file.fileUrl || file.file_url,
                file.fileRole || file.file_role || `版本 ${index + 1}`,
                file.fileId || file.file_id,
            );
        });

        sources.forEach((source, index) => {
            grouped[group].push({
                id: `${asset.assetId || asset.asset_id || asset.id}-${source.id}`,
                name: index === 0
                    ? (asset.name || asset.assetId || asset.asset_id)
                    : `${asset.name || asset.assetId || asset.asset_id} · ${source.suffix || index + 1}`,
                currentVersion: { url: source.url, fileId: source.fileId },
            });
        });
    });

    return {
        ...grouped,
        audio: audioTracks.map((track: any) => ({
            id: track.trackId || track.track_id || track.id || track.audioTrackId,
            name: track.name || track.title || '音轨',
            currentVersion: {
                url: track.audioUrl || track.audio_url || track.url || '',
                durationMs: track.durationMs || track.duration_ms,
            },
        })),
    };
}

// Episode data may be normalized to camelCase or retain its server-side snake_case shape.
function sb(item: any) {
    return {
        itemId:            item.item_id            ?? item.itemId            ?? '',
        sortOrder:         item.sort_order         ?? item.sortOrder         ?? 0,
        sceneHeading:      item.scene_heading      ?? item.sceneHeading      ?? '',
        dialogue:          item.dialogue           ?? '',
        imagePrompt:       item.image_prompt       ?? item.imagePrompt       ?? '',
        videoPrompt:       item.video_prompt       ?? item.videoPrompt       ?? '',
        lines:             item.lines              ?? '',
        generatedImageUrl: item.generated_image_url ?? item.generatedImageUrl ?? '',
        dialogueAudioUrl:  item.dialogue_audio_url  ?? item.dialogueAudioUrl  ?? '',
        narrationAudioUrl: item.narration_audio_url ?? item.narrationAudioUrl ?? '',
        sfxAudioUrl:       item.sfx_audio_url       ?? item.sfxAudioUrl       ?? '',
        mixedAudioUrl:     item.mixed_audio_url     ?? item.mixedAudioUrl     ?? '',
    };
}

export function buildCandidates(ctx: CandidateBuildContext): SeedanceAssetCandidate[] {
    const out: SeedanceAssetCandidate[] = [];

    ctx.currentParams.media_inputs.forEach((m, i) => {
        out.push({
            id: `current_${i}`,
            fileId: m.file_id,
            group: 'current_card',
            kind: m.kind,
            label: `${m.kind === 'image' ? '图片' : m.kind === 'video' ? '视频' : '音频'} #${i + 1}`,
            url: m.url,
            thumbnailUrl: m.kind === 'image' ? m.url : undefined,
        });
    });

    const sbItems = (ctx.storyboardItems || []).map(sb).filter(s =>
        ctx.currentStoryboardItemId ? s.itemId === ctx.currentStoryboardItemId : true
    );
    sbItems.forEach((s) => {
        if (s.sceneHeading) {
            out.push({
                id: `sb_text_heading_${s.itemId}`,
                group: 'storyboard_data',
                kind: 'text',
                label: `SB-${s.sortOrder} 场景: ${String(s.sceneHeading).slice(0, 16)}`,
                text: s.sceneHeading,
                storyboardItemId: s.itemId,
            });
        }
        if (s.dialogue) {
            out.push({
                id: `sb_text_dialogue_${s.itemId}`,
                group: 'storyboard_data',
                kind: 'text',
                label: `SB-${s.sortOrder} 台词: ${String(s.dialogue).slice(0, 16)}`,
                text: s.dialogue,
                storyboardItemId: s.itemId,
            });
        }
        if (s.imagePrompt) {
            out.push({
                id: `sb_text_image_prompt_${s.itemId}`,
                group: 'storyboard_data',
                kind: 'text',
                label: `SB-${s.sortOrder} 图片提示词: ${String(s.imagePrompt).slice(0, 16)}`,
                text: s.imagePrompt,
                storyboardItemId: s.itemId,
            });
        }
        if (s.videoPrompt) {
            out.push({
                id: `sb_text_video_prompt_${s.itemId}`,
                group: 'storyboard_data',
                kind: 'text',
                label: `SB-${s.sortOrder} 视频提示词: ${String(s.videoPrompt).slice(0, 16)}`,
                text: s.videoPrompt,
                storyboardItemId: s.itemId,
            });
        }
        if (s.lines) {
            out.push({
                id: `sb_text_lines_${s.itemId}`,
                group: 'storyboard_data',
                kind: 'text',
                label: `SB-${s.sortOrder} 旁白: ${String(s.lines).slice(0, 16)}`,
                text: s.lines,
                storyboardItemId: s.itemId,
            });
        }
        if (s.generatedImageUrl) {
            out.push({
                id: `sb_img_${s.itemId}`,
                group: 'storyboard_data',
                kind: 'image',
                label: `SB-${s.sortOrder} 画面`,
                url: s.generatedImageUrl,
                thumbnailUrl: s.generatedImageUrl,
                storyboardItemId: s.itemId,
            });
        }
    });

    // Text and audio stay shot-scoped, but storyboard images remain reusable references.
    if (ctx.currentStoryboardItemId) {
        (ctx.storyboardItems || []).map(sb).forEach((s) => {
            if (!s.generatedImageUrl || s.itemId === ctx.currentStoryboardItemId) return;
            out.push({
                id: `sb_library_img_${s.itemId}`,
                group: 'storyboard_library',
                kind: 'image',
                label: `SB-${s.sortOrder} 生成画面`,
                url: s.generatedImageUrl,
                thumbnailUrl: s.generatedImageUrl,
                storyboardItemId: s.itemId,
            });
        });
    }

    const lib = ctx.materialLibrary || {};
    const assetGroups: Array<{ key: string; items: any[] }> = [
        { key: 'characters', items: lib.characters || [] },
        { key: 'scenes',     items: lib.scenes || [] },
        { key: 'props',      items: lib.props || [] },
    ];
    assetGroups.forEach(({ key, items }) => {
        items.forEach((it: any) => {
            const url = it?.currentVersion?.url || it?.url;
            if (!url) return;
            out.push({
                id: `asset_${key}_${it.id}`,
                fileId: it?.currentVersion?.fileId || it.fileId || it.file_id,
                group: 'assets',
                kind: 'image',
                label: it.name || it.id,
                url,
                thumbnailUrl: url,
            });
        });
    });

    // Shot cards receive only their own audio; legacy upload cards may use library audio.
    const sbAudioItems = (ctx.storyboardItems || []).map(sb).filter(s =>
        ctx.currentStoryboardItemId ? s.itemId === ctx.currentStoryboardItemId : true
    );
    sbAudioItems.forEach((s) => {
        const audioFields: Array<[string, string, string]> = [
            ['dialogue',  s.dialogueAudioUrl,  'dialogue'],
            ['narration', s.narrationAudioUrl, 'narration'],
            ['sfx',       s.sfxAudioUrl,       'sfx'],
        ];
        audioFields.forEach(([tag, url]) => {
            if (!url) return;
            out.push({
                id: `audio_sb_${s.itemId}_${tag}`,
                group: 'audio',
                kind: 'audio',
                label: `SB-${s.sortOrder} ${tag}`,
                url,
                storyboardItemId: s.itemId,
            });
        });
        if (s.mixedAudioUrl) {
            out.push({
                id: `audio_sb_${s.itemId}_mixed`,
                group: 'audio',
                kind: 'audio',
                label: `SB-${s.sortOrder} 混音`,
                url: s.mixedAudioUrl,
                storyboardItemId: s.itemId,
            });
        }
    });
    if (!ctx.currentStoryboardItemId) {
        (lib.audio || []).forEach((a: any) => {
            const url = a?.currentVersion?.url || a?.url;
            if (!url) return;
            out.push({
                id: `audio_lib_${a.id}`,
                group: 'audio',
                kind: 'audio',
                label: a.name || a.id,
                url,
                durationMs: a?.currentVersion?.durationMs,
            });
        });
    }


    (ctx.characterVoices || []).forEach((cv: any) => {
        const url = cv.sampleAudioUrl ?? cv.sample_audio_url;
        if (!url) return;
        const character = cv.characterName ?? cv.character_name ?? cv.voiceId ?? cv.voice_id;
        const voice = cv.voiceName ?? cv.voice_name;
        const id = cv.voiceId ?? cv.voice_id;
        out.push({
            id: `cv_${id}`,
            group: 'audio',
            kind: 'audio',
            label: voice ? `${character} · ${voice}` : `${character}`,
            url,
        });
    });


    (ctx.audioTracks || []).forEach((t: any) => {
        const url = t.audioUrl ?? t.audio_url;
        if (!url) return;
        const id = t.trackId ?? t.track_id;
        const type = t.trackType ?? t.track_type;
        const name = t.name || id;
        out.push({
            id: `track_${id}`,
            group: 'audio',
            kind: 'audio',
            label: type ? `${name} (${type})` : name,
            url,
            durationMs: t.durationMs ?? t.duration_ms,
        });
    });

    (ctx.historyVideos || []).forEach((v: any) => {
        if (!v.url) return;
        out.push({
            id: `vid_${v.id}`,
            group: 'video_segments',
            kind: 'video',
            label: v.label || v.id,
            url: v.url,
            durationMs: v.durationMs,
        });
    });

    (ctx.userFiles || []).forEach((f: any) => {
        const kind = inferKindFromMime(f.mime_type);
        if (!kind) return;
        out.push({
            id: `uf_${f.id}`,
            fileId: f.file_id || f.fileId || f.id,
            group: 'user_files',
            kind,
            label: f.file_name || f.id,
            url: f.file_url,
            thumbnailUrl: kind === 'image' ? f.file_url : undefined,
        });
    });

    (ctx.mediaLibraryItems || []).forEach((item: any) => {
        const kind = inferKindFromLibraryItem(item);
        if (!kind) return;
        const url = item.file_url || item.fileUrl || (kind === 'image' ? item.thumbnail_url || item.thumbnailUrl : '');
        if (!url) return;
        out.push({
            id: `media_library_${item.library_item_id || item.libraryItemId || item.file_id || item.fileId || url}`,
            fileId: item.file_id || item.fileId,
            group: 'media_library',
            kind,
            label: item.title || item.file_name || item.fileName || item.source || '素材库资源',
            url,
            thumbnailUrl: kind === 'image' ? (item.thumbnail_url || item.thumbnailUrl || url) : undefined,
            durationMs: item.duration_seconds != null
                ? Math.round(Number(item.duration_seconds) * 1000)
                : item.durationMs,
        });
    });

    out.push({
        id: 'ark_input',
        group: 'ark_asset_id',
        kind: 'image',   // popover will let user pick the kind via small chip; default image
        label: '手输 asset://...（远程 ID）',
    });

    const seenMedia = new Set<string>();
    const fileIds = new Map(out.filter(candidate => candidate.fileId && candidate.url).map(candidate => [candidate.url, candidate.fileId]));
    out.forEach(candidate => { if (!candidate.fileId && candidate.url) candidate.fileId = fileIds.get(candidate.url); });
    return out.filter((candidate) => {
        if (candidate.kind === 'text' || candidate.group === 'ark_asset_id') return true;
        const mediaUrl = String(candidate.url || candidate.arkAssetId || '').trim();
        if (!mediaUrl) return true;
        const key = `${candidate.kind}:${mediaUrl}`;
        if (seenMedia.has(key)) return false;
        seenMedia.add(key);
        return true;
    });
}
