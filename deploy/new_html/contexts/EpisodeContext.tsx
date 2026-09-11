import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  batchCreateStoryboardItems as apiBatchCreateStoryboardItems,
  extractToAssets as apiExtractToAssets,
  getEpisodeScript,
  getStoryboardItems,
  getAssets,
  getAudioTracks,
  getVideoSegments,
  getCharacterVoices,
  updateStoryboardItem as apiUpdateStoryboardItem,
  updateEpisodeScript as apiUpdateEpisodeScript,
} from '../services/episodeDataService';
import {
  getWorkflowScript,
  listEpisodeScripts,
  selectWorkflowScript,
  updateEpisodeScriptById,
} from '../services/scriptTimelineService';
import type { AssetItem, StoryboardItemDB, VideoSegment, AudioTrack, EpisodeScript, CharacterVoice } from '../types';
import { filterAssetsForEpisodeScope, type AssetScopeMode } from '../utils/assetScope';
import {
  normalizeStoryboardRecord,
  parseRecord,
  parseStringArray,
} from '../utils/episodeAdapters';

const EPISODE_CONTEXT_INITIAL_STORYBOARD_COUNT = 10;



function normalizeAsset(r: any): AssetItem {
  return {
    assetId: String(r.asset_id ?? r.assetId ?? ''),
    projectId: String(r.project_id ?? r.projectId ?? ''),
    episodeId: r.episode_id ?? r.episodeId ?? null,
    scriptId: r.script_id ?? r.scriptId ?? null,
    assetType: (r.asset_type ?? r.assetType ?? 'character') as AssetItem['assetType'],
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    thumbnailUrl: r.thumbnail_url ?? r.thumbnailUrl ?? null,
    referenceImages: parseStringArray(r.reference_images ?? r.referenceImages),
    styleParams: parseRecord(r.style_params ?? r.styleParams),
    tags: parseStringArray(r.tags),
    entityFiles: Array.isArray(r.entity_files)
      ? r.entity_files.map((f: any) => ({
          fileId: String(f.file_id ?? f.fileId ?? ''),
          fileUrl: String(f.file_url ?? f.fileUrl ?? ''),
          fileType: String(f.file_type ?? f.fileType ?? ''),
          fileRole: String(f.file_role ?? f.fileRole ?? ''),
          isSelected: !!(f.is_selected ?? f.isSelected),
          createdAt: String(f.created_at ?? f.createdAt ?? ''),
        }))
      : [],
    createdBy: String(r.created_by ?? r.createdBy ?? ''),
    createdAt: String(r.created_at ?? r.createdAt ?? ''),
  };
}

function normalizeVideoSegment(r: any): VideoSegment {
  return {
    segmentId: r.segment_id ?? r.segmentId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    storyboardItemId: r.storyboard_item_id ?? r.storyboardItemId ?? null,
    sortOrder: typeof (r.sort_order ?? r.sortOrder) === 'number' ? (r.sort_order ?? r.sortOrder) : 0,
    generationMode: r.generation_mode ?? r.generationMode ?? '',
    model: r.model ?? '',
    inputParams: parseRecord(r.input_params ?? r.inputParams),
    videoUrl: r.video_url ?? r.videoUrl ?? null,
    thumbnailUrl: r.thumbnail_url ?? r.thumbnailUrl ?? null,
    durationMs: r.duration_ms ?? r.durationMs ?? null,
    taskId: r.task_id ?? r.taskId ?? null,
    status: r.status ?? 'pending',
  };
}

function normalizeAudioTrack(r: any): AudioTrack {
  return {
    trackId: r.track_id ?? r.trackId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    trackType: r.track_type ?? r.trackType ?? 'bgm',
    name: r.name ?? '',
    audioUrl: r.audio_url ?? r.audioUrl ?? null,
    durationMs: r.duration_ms ?? r.durationMs ?? null,
    startItemId: r.start_item_id ?? r.startItemId ?? null,
    endItemId: r.end_item_id ?? r.endItemId ?? null,
    generationParams: parseRecord(r.generation_params ?? r.generationParams),
  };
}

function normalizeEpisodeScript(r: any): EpisodeScript {
  return {
    scriptId: r.script_id ?? r.scriptId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    originalContent: r.original_content ?? r.originalContent ?? '',
    adaptedScript: r.adapted_script ?? r.adaptedScript ?? '',
    metadata: parseRecord(r.metadata),
  };
}

function normalizeCharacterVoice(r: any): CharacterVoice {
  return {
    voiceId: r.voice_id ?? r.voiceId ?? '',
    projectId: r.project_id ?? r.projectId ?? '',
    assetId: r.asset_id ?? r.assetId ?? null,
    characterName: r.character_name ?? r.characterName ?? '',
    voiceProvider: r.voice_provider ?? r.voiceProvider ?? null,
    voiceModelId: r.voice_model_id ?? r.voiceModelId ?? null,
    voiceName: r.voice_name ?? r.voiceName ?? null,
    voiceParams: parseRecord(r.voice_params ?? r.voiceParams),
    sampleAudioUrl: r.sample_audio_url ?? r.sampleAudioUrl ?? null,
    createdAt: r.created_at ?? r.createdAt ?? '',
    updatedAt: r.updated_at ?? r.updatedAt ?? '',
  };
}

export type DataSlice = 'script' | 'storyboardItems' | 'assets' | 'audioTracks' | 'videoSegments' | 'characterVoices';

interface EpisodeContextValue {
  episodeId: string;
  projectId: string;
  selectedScriptId: string | null;
  setSelectedScriptId: (id: string | null) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  script: EpisodeScript | null;
  storyboardItems: StoryboardItemDB[];
  storyboardTotalCount: number;
  assets: AssetItem[];
  audioTracks: AudioTrack[];
  videoSegments: VideoSegment[];
  characterVoices: CharacterVoice[];
  assetScopeMode: AssetScopeMode;
  setAssetScopeMode: (mode: AssetScopeMode) => void;
  loadSlices: (...slices: DataSlice[]) => Promise<void>;
  loadSlicesQuiet: (...slices: DataSlice[]) => Promise<void>;
  forceReloadSlices: (...slices: DataSlice[]) => Promise<void>;
  forceReloadSlicesQuiet: (...slices: DataSlice[]) => Promise<void>;
  loadStoryboardItemsPage: (options: { limit: number; offset?: number; includeTotal?: boolean }) => Promise<void>;
  reload: () => Promise<void>;
  updateStoryboardDuration: (itemId: string, durationMs: number) => Promise<void>;
  saveScript: (data: { original_content?: string; adapted_script?: string; metadata?: Record<string, any> }) => Promise<void>;
  saveStoryboardItem: (itemId: string, data: Record<string, any>) => Promise<void>;
  createStoryboardItems: (items: any[]) => Promise<void>;
  extractToAssets: (characters: any[], scenes: any[], props?: any[]) => Promise<void>;
}

const EpisodeContext = createContext<EpisodeContextValue>({
  episodeId: '',
  projectId: '',
  selectedScriptId: null,
  setSelectedScriptId: async () => {},
  isLoading: false,
  error: null,
  script: null,
  storyboardItems: [],
  storyboardTotalCount: 0,
  assets: [],
  audioTracks: [],
  videoSegments: [],
  characterVoices: [],
  assetScopeMode: 'episode',
  setAssetScopeMode: () => {},
  loadSlices: async () => {},
  loadSlicesQuiet: async () => {},
  forceReloadSlices: async () => {},
  forceReloadSlicesQuiet: async () => {},
  loadStoryboardItemsPage: async () => {},
  reload: async () => {},
  updateStoryboardDuration: async () => {},
  saveScript: async () => {},
  saveStoryboardItem: async () => {},
  createStoryboardItems: async () => {},
  extractToAssets: async () => {},
});

export const useEpisode = () => useContext(EpisodeContext);

interface EpisodeProviderProps {
  children: React.ReactNode;
  projectId?: string;
  episodeId?: string;
}

export const EpisodeProvider: React.FC<EpisodeProviderProps> = ({ children, projectId: propProjectId, episodeId: propEpisodeId }) => {
  const params = useParams<{ projectId: string; episodeId: string }>();
  const projectId = propProjectId || params.projectId || '';
  const episodeId = propEpisodeId || params.episodeId || '';

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedScriptId, setSelectedScriptIdState] = useState<string | null>(null);
  const [script, setScript] = useState<EpisodeScript | null>(null);
  const [storyboardItems, setStoryboardItems] = useState<StoryboardItemDB[]>([]);
  const [storyboardTotalCount, setStoryboardTotalCount] = useState(0);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [videoSegments, setVideoSegments] = useState<VideoSegment[]>([]);
  const [characterVoices, setCharacterVoices] = useState<CharacterVoice[]>([]);
  const [assetScopeMode, setAssetScopeModeState] = useState<AssetScopeMode>('episode');

  const loadedSlicesRef = useRef<Set<DataSlice>>(new Set());
  const selectedScriptIdRef = useRef<string | null>(null);
  const prevScriptIdRef = useRef<string | null>(null);
  const assetScopeModeRef = useRef<AssetScopeMode>('episode');
  selectedScriptIdRef.current = selectedScriptId;
  assetScopeModeRef.current = assetScopeMode;

  useEffect(() => {
    let cancelled = false;
    selectedScriptIdRef.current = null;
    setSelectedScriptIdState(null);
    if (!episodeId) return () => { cancelled = true; };

    void getWorkflowScript(episodeId)
      .then((res: any) => {
        if (cancelled || !res?.success) return;
        const scriptId = res.script_id ?? res.scriptId ?? null;
        selectedScriptIdRef.current = scriptId;
        setSelectedScriptIdState(scriptId);
      })
      .catch((err: any) => {
        if (!cancelled) console.warn('加载本集采用剧本失败:', err);
      });
    return () => { cancelled = true; };
  }, [episodeId]);

  const setSelectedScriptId = useCallback(async (id: string | null) => {
    if (!episodeId || !id || id === selectedScriptIdRef.current) return;
    const previousId = selectedScriptIdRef.current;
    selectedScriptIdRef.current = id;
    setSelectedScriptIdState(id);
    try {
      await selectWorkflowScript(episodeId, id);
    } catch (err) {
      selectedScriptIdRef.current = previousId;
      setSelectedScriptIdState(previousId);
      throw err;
    }
  }, [episodeId]);

  useEffect(() => {
    if (!episodeId) {
      setAssetScopeModeState('episode');
      return;
    }
    try {
      const saved = sessionStorage.getItem(`episodeAssetScope:${episodeId}`);
      setAssetScopeModeState(saved === 'project' ? 'project' : 'episode');
    } catch {
      setAssetScopeModeState('episode');
    }
  }, [episodeId]);

  const setAssetScopeMode = useCallback((mode: AssetScopeMode) => {
    setAssetScopeModeState(mode);
    if (episodeId) {
      try {
        sessionStorage.setItem(`episodeAssetScope:${episodeId}`, mode);
      } catch {}
    }
  }, [episodeId]);

  const fetchSlices = useCallback(async (optionsOrFirst?: DataSlice | { quiet?: boolean }, ...rest: DataSlice[]) => {
    const quiet = typeof optionsOrFirst === 'object';
    const slices = (quiet ? rest : [optionsOrFirst as DataSlice, ...rest]).filter(Boolean) as DataSlice[];
    if (!episodeId || slices.length === 0) return;
    if (!quiet) setIsLoading(true);
    setError(null);

    slices.forEach(s => loadedSlicesRef.current.add(s));

    const loaders: Record<DataSlice, () => Promise<void>> = {
      script: async () => {
        const sid = selectedScriptIdRef.current;
        const res: any = sid
          ? await listEpisodeScripts(episodeId).catch(() => ({ success: false, scripts: [] }))
          : await getEpisodeScript(episodeId).catch(() => ({ success: false, script: null }));
        if (selectedScriptIdRef.current !== sid || !res.success) return;
        const selectedScript = sid
          ? (res.scripts || []).find((item: any) => (item.script_id ?? item.scriptId) === sid)
          : res.script;
        setScript(selectedScript ? normalizeEpisodeScript(selectedScript) : null);
      },
      storyboardItems: async () => {
        const sid = selectedScriptIdRef.current || undefined;
        const res = await getStoryboardItems(episodeId, sid, {
          limit: EPISODE_CONTEXT_INITIAL_STORYBOARD_COUNT,
          includeTotal: true,
        }).catch(() => ({ success: false, items: [], total: 0 }));
        if (res.success) {
          const items = (res.items || []).map(normalizeStoryboardRecord);
          setStoryboardItems(items);
          setStoryboardTotalCount(typeof (res as any).total === 'number' ? (res as any).total : items.length);
        }
      },
      assets: async () => {
        const scopeMode = assetScopeModeRef.current;
        const queryEpisodeId = scopeMode === 'project' ? undefined : episodeId;
        const res = await getAssets(projectId, queryEpisodeId).catch(() => ({ success: false, assets: [] }));
        if (res.success) {
          const normalized = (res.assets || []).map(normalizeAsset);
          setAssets(filterAssetsForEpisodeScope(normalized, episodeId, scopeMode));
        }
      },
      audioTracks: async () => {
        const res = await getAudioTracks(episodeId).catch(() => ({ success: false, tracks: [] }));
        if (res.success) setAudioTracks((res.tracks || []).map(normalizeAudioTrack));
      },
      videoSegments: async () => {
        const res = await getVideoSegments(episodeId).catch(() => ({ success: false, segments: [] }));
        if (res.success) setVideoSegments((res.segments || []).map(normalizeVideoSegment));
      },
      characterVoices: async () => {
        const res = await getCharacterVoices(projectId).catch((e) => {
          console.warn('character_voices 加载失败:', e);
          return { success: false, voices: [] };
        });
        if (res.success && Array.isArray(res.voices)) {
          setCharacterVoices(res.voices.map(normalizeCharacterVoice));
        } else {
          setCharacterVoices([]);
        }
      },
    };

    try {
      await Promise.all(slices.map(s => loaders[s]()));
    } catch (e: any) {
      setError(e.message || '加载集数据失败');
    } finally {
      if (!quiet) setIsLoading(false);
    }
  }, [episodeId, projectId]);

  useEffect(() => {
    if (loadedSlicesRef.current.has('assets')) {
      void fetchSlices({ quiet: true }, 'assets');
    }
  }, [assetScopeMode, fetchSlices]);

  useEffect(() => {
    if (!episodeId || typeof window === 'undefined') return;
    const onEpisodeDataChanged = (event: Event) => {
      const detail = (event as CustomEvent<{
        episodeId?: string;
        entityType?: string;
        fileRole?: string;
        type?: string;
      }>).detail || {};
      if (detail.episodeId && detail.episodeId !== episodeId) return;

      const slices = new Set<DataSlice>();
      if (!detail.entityType || detail.entityType === 'asset' || detail.type === 'image' || detail.type === 'material') {
        slices.add('assets');
      }
      if (!detail.entityType || detail.entityType === 'storyboard_item') {
        slices.add('storyboardItems');
      }
      if (detail.type === 'video') {
        slices.add('videoSegments');
      }

      const loaded = Array.from(slices).filter(slice => loadedSlicesRef.current.has(slice));
      if (loaded.length > 0) {
        void fetchSlices({ quiet: true }, ...loaded);
      }
    };

    window.addEventListener('ostory:episode-data-changed', onEpisodeDataChanged);
    return () => window.removeEventListener('ostory:episode-data-changed', onEpisodeDataChanged);
  }, [episodeId, fetchSlices]);

  const loadSlices = useCallback(async (...slices: DataSlice[]) => {
    const newSlices = slices.filter(s => !loadedSlicesRef.current.has(s));
    if (newSlices.length === 0) return;
    await fetchSlices(...newSlices);
  }, [fetchSlices]);

  const loadSlicesQuiet = useCallback(async (...slices: DataSlice[]) => {
    const newSlices = slices.filter(s => !loadedSlicesRef.current.has(s));
    if (newSlices.length === 0) return;
    await fetchSlices({ quiet: true }, ...newSlices);
  }, [fetchSlices]);

  // Refresh already loaded data without replacing the active page with the
  // global loading screen.  Page-local selection and scroll state must survive
  // background refreshes that follow a successful generation or upload.
  const forceReloadSlicesQuiet = useCallback(async (...slices: DataSlice[]) => {
    await fetchSlices({ quiet: true }, ...slices);
  }, [fetchSlices]);

  const loadStoryboardItemsPage = useCallback(async (options: { limit: number; offset?: number; includeTotal?: boolean }) => {
    if (!episodeId) return;
    const sid = selectedScriptIdRef.current || undefined;
    const limit = Math.max(1, options.limit || 10);
    const offset = Math.max(0, options.offset || 0);
    const res = await getStoryboardItems(episodeId, sid, {
      limit,
      offset,
      includeTotal: options.includeTotal !== false,
    }).catch(() => ({ success: false, items: [], total: 0 }));
    if (!res.success) return;
    const nextItems = (res.items || []).map(normalizeStoryboardRecord);
    setStoryboardItems(prev => {
      if (offset <= 0) return nextItems;
      const byId = new Map(prev.map(item => [item.itemId, item]));
      for (const item of nextItems) byId.set(item.itemId, item);
      return Array.from(byId.values()).sort((a, b) => a.sortOrder - b.sortOrder);
    });
    const total = (res as any).total;
    setStoryboardTotalCount(prev =>
      typeof total === 'number' ? total : Math.max(prev, offset + nextItems.length),
    );
  }, [episodeId]);

  const reload = useCallback(async () => {
    const slices = Array.from(loadedSlicesRef.current) as DataSlice[];
    if (slices.length > 0) {
      await fetchSlices(...slices);
    }
  }, [fetchSlices]);

  useEffect(() => {
    loadedSlicesRef.current.clear();
    prevScriptIdRef.current = null;
    setSelectedScriptIdState(null);
    setScript(null);
    setStoryboardItems([]);
    setStoryboardTotalCount(0);
    setAssets([]);
    setAudioTracks([]);
    setVideoSegments([]);
    setCharacterVoices([]);
    setIsLoading(false);
  }, [episodeId]);

  useEffect(() => {
    const previousScriptId = prevScriptIdRef.current;
    if (previousScriptId === selectedScriptId) return;
    prevScriptIdRef.current = selectedScriptId;

    if (previousScriptId === null && !selectedScriptId) {
      return;
    }

    const slicesToReload: DataSlice[] = [];
    if (loadedSlicesRef.current.has('script')) slicesToReload.push('script');
    if (loadedSlicesRef.current.has('storyboardItems')) slicesToReload.push('storyboardItems');
    if (slicesToReload.length > 0) {
      void fetchSlices({ quiet: true }, ...slicesToReload);
    }
  }, [selectedScriptId, fetchSlices]);

  const updateStoryboardDuration = useCallback(async (itemId: string, durationMs: number) => {
    try {
      await apiUpdateStoryboardItem(itemId, { audio_duration_ms: durationMs });
      setStoryboardItems(prev =>
        prev.map(item =>
          item.itemId === itemId ? { ...item, audioDurationMs: durationMs } : item
        )
      );
    } catch (e: any) {
      console.error('Failed to update storyboard duration:', e);
    }
  }, []);

  const saveScript = useCallback(async (data: { original_content?: string; adapted_script?: string; metadata?: Record<string, any> }) => {
    try {
      const sid = selectedScriptIdRef.current;
      if (sid) {
        await updateEpisodeScriptById(episodeId, sid, data);
      } else {
        await apiUpdateEpisodeScript(episodeId, data);
      }
      await reload();
    } catch (e: any) {
      console.error('Failed to save script:', e);
    }
  }, [episodeId, reload]);

  const saveStoryboardItem = useCallback(async (itemId: string, data: Record<string, any>) => {
    try {
      await apiUpdateStoryboardItem(itemId, data);
      setStoryboardItems(prev =>
        prev.map(item => item.itemId === itemId ? { ...item, ...data } : item)
      );
    } catch (e: any) {
      console.error('Failed to save storyboard item:', e);
    }
  }, []);

  const createStoryboardItems = useCallback(async (items: any[]) => {
    try {
      await apiBatchCreateStoryboardItems(episodeId, items, selectedScriptIdRef.current || undefined);
      await reload();
    } catch (e: any) {
      console.error('Failed to batch create storyboard items:', e);
    }
  }, [episodeId, reload]);

  const extractToAssetsFn = useCallback(async (characters: any[], scenes: any[], props: any[] = []) => {
    try {
      await apiExtractToAssets(episodeId, characters, scenes, props, selectedScriptIdRef.current || undefined);
      await reload();
    } catch (e: any) {
      console.error('Failed to extract to assets:', e);
    }
  }, [episodeId, reload]);

  return (
    <EpisodeContext.Provider value={{
      episodeId,
      projectId,
      selectedScriptId,
      setSelectedScriptId,
      isLoading,
      error,
      script,
      storyboardItems,
      storyboardTotalCount,
      assets,
      audioTracks,
      videoSegments,
      characterVoices,
      assetScopeMode,
      setAssetScopeMode,
      loadSlices,
      loadSlicesQuiet,
      forceReloadSlices: fetchSlices,
      forceReloadSlicesQuiet,
      loadStoryboardItemsPage,
      reload,
      updateStoryboardDuration,
      saveScript,
      saveStoryboardItem,
      createStoryboardItems,
      extractToAssets: extractToAssetsFn,
    }}>
      {children}
    </EpisodeContext.Provider>
  );
};
