import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getStoryboardItems, getAssets, getVideoSegments, getEpisodeScript, updateStoryboardItem } from '../services/episodeDataService';

const STORYBOARD_QUERY_INITIAL_LIMIT = 10;

export function useStoryboardItems(episodeId: string | null) {
  return useQuery({
    queryKey: ['storyboardItems', episodeId],
    queryFn: async () => {
      const r = await getStoryboardItems(episodeId!, undefined, {
        limit: STORYBOARD_QUERY_INITIAL_LIMIT,
        includeTotal: true,
      });
      return r.items || [];
    },
    enabled: !!episodeId,
    staleTime: 30_000,
  });
}

export function useAssets(projectId: string | null, episodeId: string | null) {
  return useQuery({
    queryKey: ['assets', projectId, episodeId],
    queryFn: async () => {
      const r = await getAssets(projectId!, episodeId);
      return r.assets || [];
    },
    enabled: !!projectId && !!episodeId,
    staleTime: 30_000,
  });
}

export function useVideoSegments(episodeId: string | null) {
  return useQuery({
    queryKey: ['videoSegments', episodeId],
    queryFn: async () => {
      const r = await getVideoSegments(episodeId!);
      return r.segments || [];
    },
    enabled: !!episodeId,
    staleTime: 30_000,
  });
}

export function useScript(episodeId: string | null) {
  return useQuery({
    queryKey: ['script', episodeId],
    queryFn: async () => {
      const r = await getEpisodeScript(episodeId!);
      return r.script || '';
    },
    enabled: !!episodeId,
    staleTime: 30_000,
  });
}

export function useSaveStoryboardItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { itemId: string; data: Record<string, any>; episodeId: string }) =>
      updateStoryboardItem(vars.itemId, vars.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['storyboardItems', vars.episodeId] });
    },
  });
}
