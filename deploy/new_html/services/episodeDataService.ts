import { apiJson } from './httpClient';

export async function getAssets(projectId: string, episodeId?: string, assetType?: string, scriptId?: string) {
    const params = new URLSearchParams();
    if (episodeId) params.set('episode_id', episodeId);
    if (assetType) params.set('asset_type', assetType);
    if (scriptId) params.set('script_id', scriptId);
    const qs = params.toString() ? `?${params}` : '';
    return apiJson<any>(`/api/projects/${projectId}/assets${qs}`, { method: 'GET' }, 'getAssets');
}

export interface StoryboardItemsQueryOptions {
    limit?: number;
    offset?: number;
    includeTotal?: boolean;
    fields?: 'audio' | 'video' | 'audio_stage' | 'materials' | string;
    fallbackToEpisode?: boolean;
}

async function getStoryboardItemsRaw(
    episodeId: string,
    scriptId?: string,
    options: StoryboardItemsQueryOptions = {},
) {
    const params = new URLSearchParams();
    if (scriptId) params.set('script_id', scriptId);
    if (typeof options.limit === 'number') params.set('limit', String(options.limit));
    if (typeof options.offset === 'number') params.set('offset', String(options.offset));
    if (options.includeTotal) params.set('include_total', 'true');
    if (options.fields) params.set('fields', options.fields);
    const qs = params.toString() ? `?${params}` : '';
    return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items${qs}`, { method: 'GET' }, 'getStoryboardItems');
}

export async function getStoryboardItems(
    episodeId: string,
    scriptId?: string,
    options: StoryboardItemsQueryOptions = {},
) {
    const result = normalizeStoryboardFallbackResult(await getStoryboardItemsRaw(episodeId, scriptId, options));
    const shouldFallback =
        !!scriptId &&
        options.fallbackToEpisode === true &&
        result?.success &&
        Array.isArray(result.items) &&
        result.items.length === 0 &&
        (typeof result.total !== 'number' || result.total === 0);

    if (!shouldFallback) return result;

    const fallback = await getStoryboardItemsRaw(episodeId, undefined, {
        ...options,
        fallbackToEpisode: false,
    });
    if (fallback?.success && Array.isArray(fallback.items) && fallback.items.length > 0) {
        return {
            ...fallback,
            fallbackScriptId: scriptId,
            fallbackReason: 'empty_script_storyboard',
        };
    }
    return result;
}

function normalizeStoryboardFallbackResult(result: any) {
    if (!result || typeof result !== 'object') return result;
    const fallbackScriptId = result.fallbackScriptId ?? result.fallback_script_id;
    const fallbackReason = result.fallbackReason ?? result.fallback_reason;
    if (!fallbackScriptId && !fallbackReason) return result;
    return {
        ...result,
        fallbackScriptId,
        fallbackReason,
    };
}

export async function updateStoryboardItem(itemId: string, data: any) {
    return apiJson<any>(`/api/storyboard-items/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateStoryboardItem');
}

export async function getVideoSegments(episodeId: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/video-segments`, { method: 'GET' }, 'getVideoSegments');
}

export async function getAudioTracks(episodeId: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/audio-tracks`, { method: 'GET' }, 'getAudioTracks');
}

export async function getEpisodeScript(episodeId: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/script`, { method: 'GET' }, 'getEpisodeScript');
}

export async function updateEpisodeScript(episodeId: string, data: any) {
    return apiJson<any>(`/api/episodes/${episodeId}/script`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateEpisodeScript');
}

export async function getCharacterVoices(projectId: string) {
    return apiJson<any>(`/api/projects/${projectId}/character-voices`, { method: 'GET' }, 'getCharacterVoices');
}

export async function batchCreateStoryboardItems(episodeId: string, items: any[], scriptId?: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items/batch`, {
        method: 'POST',
        body: JSON.stringify({ items, script_id: scriptId })
    }, 'batchCreateStoryboardItems');
}

export async function syncStoryboardItems(episodeId: string, items: any[], scriptId?: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/storyboard-items/sync`, {
        method: 'POST',
        body: JSON.stringify({ items, script_id: scriptId })
    }, 'syncStoryboardItems');
}

export async function extractToAssets(episodeId: string, characters: any[], scenes: any[], props: any[] = [], scriptId?: string) {
    return apiJson<any>(`/api/episodes/${episodeId}/extract-to-assets`, {
        method: 'POST',
        body: JSON.stringify({ characters, scenes, props, script_id: scriptId })
    }, 'extractToAssets');
}
