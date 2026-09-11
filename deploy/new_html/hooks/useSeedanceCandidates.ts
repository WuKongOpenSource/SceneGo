import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SeedanceParams } from '../services/videoModelService';
import type { SeedanceAssetCandidate } from '../utils/seedanceMedia';
import { buildCandidates, buildVideoMaterialLibrary } from '../utils/seedanceCandidateBuilder';
import { useEpisode } from '../contexts/EpisodeContext';
import { useEntityFilesQuery } from './useEntityFilesQuery';
import { listMediaItems } from '../services/mediaLibraryService';

export interface UseSeedanceCandidatesProps {
    currentParams: SeedanceParams;
    /** Optional. When provided, storyboard_data and audio candidates are
     *  filtered to this item only. Pass undefined for upload-only cards. */
    currentStoryboardItemId?: string;
    /** Optional history-videos slice. If absent, derived from EpisodeContext.videoSegments. */
    historyVideos?: any[];
}

export interface UseSeedanceCandidatesResult {
    candidates: SeedanceAssetCandidate[];
    isLoading: boolean;
}

// Hoisted stable empty-array constants so that fallbacks for missing context
// slices don't break referential equality across renders (memo test relies on this).
const EMPTY_ASSETS: any[] = [];
const EMPTY_AUDIO: any[] = [];
const EMPTY_VIDEO: any[] = [];
const EMPTY_STORYBOARD: any[] = [];
const EMPTY_FILES: any[] = [];

export function useSeedanceCandidates(p: UseSeedanceCandidatesProps): UseSeedanceCandidatesResult {
    const ep = useEpisode();
    const ufQuery = useEntityFilesQuery('episode', ep.episodeId || null);
    const mediaLibraryQuery = useQuery({
        queryKey: ['video-media-library-candidates', ep.projectId],
        queryFn: async () => {
            const pageSize = 200;
            const items: any[] = [];
            let offset = 0;
            let total = 0;
            do {
                const response = await listMediaItems({
                    project_id: ep.projectId || undefined,
                    include_shared: true,
                    limit: pageSize,
                    offset,
                });
                const page = response.items || [];
                items.push(...page);
                total = response.total || items.length;
                offset += page.length;
                if (page.length === 0) break;
            } while (items.length < total);
            return items;
        },
        enabled: !!ep.projectId,
        staleTime: 30_000,
    });

    const materialLibrary = useMemo(() => {
        const assets = ep.assets ?? EMPTY_ASSETS;
        const audioTracks = ep.audioTracks ?? EMPTY_AUDIO;
        return buildVideoMaterialLibrary(assets, audioTracks);
    }, [ep.assets, ep.audioTracks]);

    const historyVideosResolved = useMemo(() => {
        if (p.historyVideos) return p.historyVideos;
        const segs = ep.videoSegments ?? EMPTY_VIDEO;
        return segs.map((v: any) => ({
            id: v.segmentId || v.id,
            url: v.videoUrl || v.url || '',
            label: v.label || v.name || `镜头 ${v.sortOrder ?? ''}`.trim(),
            durationMs: v.durationMs,
        }));
    }, [p.historyVideos, ep.videoSegments]);

    const userFilesAdapted = useMemo(() => {
        const items = ufQuery.data?.items ?? EMPTY_FILES;
        return items.map((f: any) => ({
            id: f.fileId || f.entityFileId || f.id || f.fileUrl,
            file_url: f.fileUrl,
            file_name: f.fileName,
            mime_type: f.fileType || f.mimeType,
        }));
    }, [ufQuery.data]);

    const storyboardItems = ep.storyboardItems ?? EMPTY_STORYBOARD;




    const characterVoices = (ep as any).characterVoices ?? EMPTY_AUDIO;
    const audioTracksAll  = (ep as any).audioTracks     ?? EMPTY_AUDIO;

    const candidates = useMemo<SeedanceAssetCandidate[]>(
        () => buildCandidates({
            currentParams: p.currentParams,
            currentStoryboardItemId: p.currentStoryboardItemId,
            materialLibrary,
            storyboardItems,
            historyVideos: historyVideosResolved,
            userFiles: userFilesAdapted,
            mediaLibraryItems: mediaLibraryQuery.data ?? EMPTY_FILES,
            characterVoices,
            audioTracks: audioTracksAll,
        }),
        [p.currentParams, p.currentStoryboardItemId, materialLibrary, storyboardItems, historyVideosResolved, userFilesAdapted, mediaLibraryQuery.data, characterVoices, audioTracksAll],
    );

    return { candidates, isLoading: !!ufQuery.isLoading || !!mediaLibraryQuery.isLoading };
}
