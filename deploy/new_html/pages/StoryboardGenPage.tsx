import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEpisode } from '../contexts/EpisodeContext';
import {
  scriptToProjectFile,
  assetsToMaterialLibrary,
  storyboardItemToDbUpdate,
} from '../utils/episodeAdapters';
import { normalizeStoryboardQualityReview } from '../services/storyboardQualityService';
import { storyboardImageSource } from '../utils/storyboardImageSource';
import { createStoryboardItem, deleteStoryboardItem } from '../services/storyboardMutationService';
import { updateStoryboardItem } from '../services/episodeDataService';
import { crmConfirm, crmMessage } from '../admin/crmUI';
import { fetchEntityFiles } from '../services/entityFileService';
import { useSelectFileMutation, useDeleteFileMutation } from '../hooks/useFilesMutation';
import { LayoutGrid, Loader, ChevronDown, ChevronUp, GripHorizontal } from 'lucide-react';
import { TimelineTrack, type TimelineClip } from '../components/TimelineTrack';
import { MusicModal } from '../components/audio/MusicModal';
import { SfxModal } from '../components/audio/SfxModal';
import { deleteAudioTrack } from '@runtime/audioGenerationService';
import type { StoryboardItem, FileVersion, GeneratedImage, MaterialLibrary, AudioTrack } from '../types';
import { usePersistedPageState } from '../hooks/usePersistedPageState';
import { runWhenIdle } from '../utils/idleScheduler';
import { getImageThumbnailUrl } from '../services/imageLoaderService';
import { applyConfiguredReferenceDrafts } from '../utils/storyboardConsistency';
import { resolveShotTargetDurationMs } from '../utils/durationMapping';
import {
  buildStoryboardVideoExportNavigationState,
  isDurableStoryboardImageUrl,
  normalizeStoryboardVideoExportPayload,
} from '../utils/storyboardVideoExport';

const STORYBOARD_INITIAL_SHOT_COUNT = 10;
const GenerationPage = React.lazy(() => import('../components/GenerationPage').then(m => ({ default: m.GenerationPage })));

function resolveMediaUrl(path: string): string {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('/')) return path;
  return `/${path}`;
}

const WorkflowChunkFallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="h-full min-h-[240px] flex items-center justify-center text-n300">
    <div className="flex items-center gap-2 text-sm">
      <Loader className="w-4 h-4 animate-spin text-primary" />
      <span>{label}</span>
    </div>
  </div>
);

function fmtTimeSimple(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const sec = ms / 1000;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export const StoryboardGenPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const notificationShotId = searchParams.get('shotId');
  const {
    episodeId, projectId, selectedScriptId,
    script, storyboardItems, assets, audioTracks,
    assetScopeMode, setAssetScopeMode,
    storyboardTotalCount,
    isLoading, error,
    loadSlicesQuiet, forceReloadSlices, forceReloadSlicesQuiet, loadStoryboardItemsPage,
  } = useEpisode();




  useEffect(() => {
    let active = true;
    let cancelIdle = () => {};
    setVisibleEntityShotCount(STORYBOARD_INITIAL_SHOT_COUNT);
    Promise.all([
      loadStoryboardItemsPage({ limit: STORYBOARD_INITIAL_SHOT_COUNT, includeTotal: true }),
      forceReloadSlices('script'),
    ]).then(() => {
      if (!active) return;
      const run = () => loadSlicesQuiet('assets', 'audioTracks');
      cancelIdle = runWhenIdle(run, { timeout: 1500 });
    });
    return () => {
      active = false;
      cancelIdle();
    };
  }, [forceReloadSlices, loadSlicesQuiet, loadStoryboardItemsPage, selectedScriptId]);

  const [visibleEntityShotCount, setVisibleEntityShotCount] = useState(STORYBOARD_INITIAL_SHOT_COUNT);
  const [showMusicModal, setShowMusicModal] = useState(false);
  const [showSfxModal, setShowSfxModal] = useState(false);
  const [deletingAudioTrackId, setDeletingAudioTrackId] = useState<string | null>(null);
  const handleVisibleShotCountChange = useCallback((count: number) => {
    setVisibleEntityShotCount(count);
    if (count > STORYBOARD_INITIAL_SHOT_COUNT && count > storyboardItems.length) {
      loadStoryboardItemsPage({ limit: count, includeTotal: true });
    }
  }, [loadStoryboardItemsPage, storyboardItems.length]);

  const handleLoadAllStoryboardItems = useCallback(async () => {
    const count = Math.max(
      storyboardTotalCount || 0,
      storyboardItems.length,
      visibleEntityShotCount,
      STORYBOARD_INITIAL_SHOT_COUNT,
    );
    setVisibleEntityShotCount(count);
    await loadStoryboardItemsPage({ limit: count, includeTotal: true });
  }, [loadStoryboardItemsPage, storyboardItems.length, storyboardTotalCount, visibleEntityShotCount]);

  useEffect(() => {
    if (!notificationShotId || storyboardItems.some(item => item.itemId === notificationShotId)) return;
    void handleLoadAllStoryboardItems();
  }, [handleLoadAllStoryboardItems, notificationShotId, storyboardItems]);

  const visibleStoryboardItems = useMemo(
    () => storyboardItems.slice(0, visibleEntityShotCount),
    [storyboardItems, visibleEntityShotCount],
  );

  const [configuredReferenceDrafts, setConfiguredReferenceDrafts] = useState<
    Record<string, NonNullable<StoryboardItem['configuredReferences']>>
  >({});

  useEffect(() => {
    setConfiguredReferenceDrafts({});
  }, [episodeId, selectedScriptId]);

  const serverPseudoFile = useMemo(
    () => scriptToProjectFile(script, visibleStoryboardItems, assets, episodeId),
    [script, visibleStoryboardItems, assets, episodeId]
  );

  const pseudoFile = useMemo(
    () => applyConfiguredReferenceDrafts(serverPseudoFile, configuredReferenceDrafts),
    [configuredReferenceDrafts, serverPseudoFile],
  );

  const materialLibrary = useMemo(
    () => assetsToMaterialLibrary(assets) as unknown as MaterialLibrary,
    [assets]
  );

  const queryClient = useQueryClient();
  const selectFile = useSelectFileMutation();
  const deleteFile = useDeleteFileMutation();

  const localImagesRef = useRef<Record<string, GeneratedImage[]>>({});
  const [localImagesTick, setLocalImagesTick] = React.useState(0);

  const entityImageQueries = useQueries({
    queries: visibleStoryboardItems.map(item => ({
      queryKey: ['entityFiles', 'storyboard_item', item.itemId, 'generated_image'],
      queryFn: () => fetchEntityFiles('storyboard_item', item.itemId, 'generated_image'),
      staleTime: 30_000,
    })),
  });

  const entityImages = useMemo<Record<string, GeneratedImage[]>>(() => {
    const result: Record<string, GeneratedImage[]> = {};
    visibleStoryboardItems.forEach((item, idx) => {
      const data = entityImageQueries[idx]?.data;
      if (data?.items?.length) {
        result[item.itemId] = data.items.map(ef => ({
          id: ef.fileId,
          url: ef.fileUrl,
          thumbnail: ef.fileUrl,
          timestamp: new Date(ef.createdAt).getTime(),
          fileId: ef.fileId,
          isSelected: ef.isSelected,
          qualityReview: ef.metadata?.storyboard_quality_review
            ? normalizeStoryboardQualityReview(ef.metadata.storyboard_quality_review)
            : undefined,
          ...storyboardImageSource(ef.metadata),
          generationAttempt: Number(ef.metadata?.storyboard_generation_attempt || 1),
        }));
      }
    });
    return result;
  }, [entityImageQueries, visibleStoryboardItems]);

  const handleUpdateStoryboardItem = useCallback(
    (shotId: string, updates: Partial<StoryboardItem> | ((item: StoryboardItem) => Partial<StoryboardItem>)) => {
      const currentShot = pseudoFile.storyboard?.items.find(i => i.id === shotId);
      if (!currentShot) return;

      const resolvedUpdates = typeof updates === 'function'
        ? updates(currentShot)
        : updates;


      if (resolvedUpdates.generatedImages) {
        localImagesRef.current[shotId] = resolvedUpdates.generatedImages;
        setLocalImagesTick(t => t + 1);
        queryClient.invalidateQueries({
          queryKey: ['entityFiles', 'storyboard_item', shotId, 'generated_image'],
        });
      }

      if (resolvedUpdates.configuredReferences !== undefined) {
        const nextReferences = [...(resolvedUpdates.configuredReferences || [])];
        setConfiguredReferenceDrafts(previous => ({
          ...previous,
          [shotId]: nextReferences,
        }));
      }


      const dbUpdates = storyboardItemToDbUpdate(resolvedUpdates);

      // Persistence invariant: generated_image_url accepts only durable HTTP or
      // application paths. data:/blob: values either overload the database or
      // expire when the browser session ends.
      const isPersistentUrl = (u: string | undefined | null): boolean => {
        if (!u) return false;
        if (u.startsWith('data:')) return false;
        if (u.startsWith('blob:')) return false;
        return u.startsWith('http') || u.startsWith('/');
      };

      let pickedUrl: string | undefined;
      let pickedSource: string = '';
      if (resolvedUpdates.selectedImageId) {
        const allImages = resolvedUpdates.generatedImages || entityImages[shotId] || [];
        const selected = allImages.find(img => img.id === resolvedUpdates.selectedImageId);
        if (selected) {
          pickedUrl = selected.url;
          pickedSource = `selected(id=${selected.id})`;
          if (selected.fileId) {
            selectFile.mutate({
              fileId: selected.fileId,
              entityType: 'storyboard_item',
              entityId: shotId,
              fileRole: 'generated_image',
            });
          }
        }
      } else if (resolvedUpdates.generatedImages?.length) {
        const last = resolvedUpdates.generatedImages[resolvedUpdates.generatedImages.length - 1];
        pickedUrl = last.url;
        pickedSource = `last(id=${last.id})`;
      }

      if (pickedUrl !== undefined) {
        if (isPersistentUrl(pickedUrl)) {
          dbUpdates.generated_image_url = pickedUrl;
        } else {
          console.warn(
            '[StoryboardGenPage] 拒绝把非持久化 URL 写入 generated_image_url',
            { shotId, source: pickedSource, sample: (pickedUrl || '').slice(0, 60) }
          );
        }
      }

      if (Object.keys(dbUpdates).length > 0) {
        updateStoryboardItem(shotId, dbUpdates).catch(err => {
          console.error('更新分镜失败:', err);
          if (resolvedUpdates.configuredReferences !== undefined) {
            crmMessage.error('参考图保存失败，已保留在当前页面，请重试');
          }
        });
      }
    },
    [pseudoFile, entityImages, queryClient, selectFile],
  );

  const handleExportNext = useCallback(
    async (data: unknown) => {
      const payload = normalizeStoryboardVideoExportPayload(data);
      if (!payload) {
        crmMessage.error('没有可导出的视频分镜，请重新选择');
        return;
      }

      // Entity files are the source used by the storyboard picker, while the
      // video API projection reads generated_image_url. Best-effort backfill
      // keeps both views consistent after a refresh; router state remains the
      // immediate handoff even if one persistence request fails.
      const durableImages = payload.items.filter(item => isDurableStoryboardImageUrl(item.finalImage));
      const persistenceResults = await Promise.allSettled(
        durableImages.map(item => updateStoryboardItem(item.shotId, {
          generated_image_url: item.finalImage,
        })),
      );
      const failedPersistenceCount = persistenceResults.filter(result => result.status === 'rejected').length;
      if (failedPersistenceCount > 0) {
        console.warn(
          `[StoryboardGenPage] ${failedPersistenceCount} 个分镜图地址回写失败，本次仍通过页面状态导入视频工作区`,
        );
      }

      navigate(`/projects/${projectId}/ep/${episodeId}/workflow/video`, {
        state: buildStoryboardVideoExportNavigationState(payload),
      });
    },
    [navigate, projectId, episodeId]
  );

  const handleForceSave = useCallback(() => {
    void Promise.all([
      loadStoryboardItemsPage({ limit: visibleEntityShotCount, includeTotal: true }),
      forceReloadSlicesQuiet('script'),
      loadSlicesQuiet('assets'),
    ]).catch(err => {
      console.warn('StoryboardGenPage visible refresh failed:', err);
    });
  }, [forceReloadSlicesQuiet, loadSlicesQuiet, loadStoryboardItemsPage, visibleEntityShotCount]);

  const reloadVisibleStoryboardPage = useCallback(async () => {
    await loadStoryboardItemsPage({ limit: visibleEntityShotCount, includeTotal: true });
  }, [loadStoryboardItemsPage, visibleEntityShotCount]);


  const handleDeleteStoryboardItem = useCallback(async (itemId: string) => {
    if (!await crmConfirm({ title: '删除镜头', message: '确认删除这个分镜镜头？此操作不可撤销。', type: 'danger', confirmText: '删除' })) return;
    try {
      await deleteStoryboardItem(itemId);
      crmMessage.success('已删除镜头');
      await reloadVisibleStoryboardPage();
    } catch (e: any) {
      crmMessage.error(`删除失败：${e?.message || e}`);
    }
  }, [reloadVisibleStoryboardPage]);


  const handleBatchDeleteStoryboardItems = useCallback(async (itemIds: string[]) => {
    if (!itemIds.length) return;
    if (!await crmConfirm({ title: '批量删除镜头', message: `确认删除选中的 ${itemIds.length} 个镜头？此操作不可撤销。`, type: 'danger', confirmText: '删除' })) return;
    let ok = 0;
    for (const id of itemIds) {
      try { await deleteStoryboardItem(id); ok++; } catch (e) { console.error('删除镜头失败', id, e); }
    }
    await reloadVisibleStoryboardPage();
    if (ok === itemIds.length) crmMessage.success(`已删除 ${ok} 个镜头`);
    else crmMessage.warning(`已删除 ${ok}/${itemIds.length}，部分失败`);
  }, [reloadVisibleStoryboardPage]);

  const noopSaveVersion = useCallback((_name: string) => {}, []);
  const noopRestoreVersion = useCallback((_v: FileVersion) => {}, []);
  const noopDeleteVersion = useCallback((_id: string) => {}, []);
  const noopImportProject = useCallback(() => {}, []);

  const enhancedFile = useMemo(() => {
    if (!pseudoFile.storyboard) return pseudoFile;
    const enhancedItems = pseudoFile.storyboard.items.map(item => {
      const dbImages = entityImages[item.id];
      const localImages = localImagesRef.current[item.id];

      if (dbImages && dbImages.length > 0 && localImages && dbImages.length >= localImages.length) {
        delete localImagesRef.current[item.id];
      }


      const urlSet = new Set<string>();
      const images: GeneratedImage[] = [];

      const addImage = (img: GeneratedImage) => {
        if (img.url && !urlSet.has(img.url)) {
          urlSet.add(img.url);
          images.push(img);
        }
      };


      if (dbImages) dbImages.forEach(addImage);

      if (localImages) localImages.forEach(addImage);

      if (item.generatedImage) {
        addImage({ id: `legacy_${item.id}`, url: item.generatedImage, timestamp: 0 });
      }

      if (images.length === 0) return item;
      const selected = images.find(img => (img as any).isSelected) || images[0];
      return {
        ...item,
        generatedImages: images,
        selectedImageId: selected.id,
        generatedImage: selected.url,
      };
    });
    return {
      ...pseudoFile,
      storyboard: { ...pseudoFile.storyboard, items: enhancedItems },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pseudoFile, entityImages, localImagesTick]);

  const timelineClips: TimelineClip[] = useMemo(() => {
    const sorted = [...storyboardItems].sort((a, b) => a.sortOrder - b.sortOrder);
    const visibleItems = sorted.slice(0, visibleEntityShotCount);
    const result: TimelineClip[] = [];
    const itemStartMs = new Map<string, number>();
    let cursorMs = 0;
    for (const item of visibleItems) {
      itemStartMs.set(item.itemId, cursorMs);
      const hasImage = !!item.generatedImageUrl;
      const hasAudio = !!(item.dialogueAudioUrl || item.narrationAudioUrl);
      const durMs = resolveShotTargetDurationMs({ audioDurationMs: item.audioDurationMs ?? undefined, plannedDurationMs: item.plannedDurationMs ?? undefined }, 3000);

      if (hasImage) {
        const imgUrl = item.generatedImageUrl!.startsWith('/') ? item.generatedImageUrl! : `/${item.generatedImageUrl}`;
        result.push({
          id: `img_${item.itemId}`,
          label: item.sceneHeading || `#${item.sortOrder}`,
          track: 'image',
          imageUrl: getImageThumbnailUrl(imgUrl, 320, 180),
          durationMs: durMs,
          startMs: cursorMs,
        });
      }
      if (item.dialogueAudioUrl) {
        const audioUrl = item.dialogueAudioUrl.startsWith('/') ? item.dialogueAudioUrl : `/${item.dialogueAudioUrl}`;
        result.push({
          id: `dlg_${item.itemId}`,
          label: (item.dialogue || '').slice(0, 20) || '台词',
          track: 'dialogue',
          audioUrl,
          durationMs: item.audioDurationMs || durMs,
          startMs: cursorMs,
        });
      }
      if (item.narrationAudioUrl) {
        const audioUrl = item.narrationAudioUrl.startsWith('/') ? item.narrationAudioUrl : `/${item.narrationAudioUrl}`;
        result.push({
          id: `nar_${item.itemId}`,
          label: (item.dialogue || '').slice(0, 20) || '旁白',
          track: 'narration',
          audioUrl,
          durationMs: item.audioDurationMs || durMs,
          startMs: cursorMs,
        });
      }
      cursorMs += durMs;
    }

    for (const rawTrack of audioTracks) {
      const track = rawTrack as AudioTrack & Record<string, unknown>;
      const trackType = String(track.trackType ?? track.track_type ?? '');
      if (trackType !== 'bgm' && trackType !== 'sfx_global') continue;
      const audioUrlRaw = String(track.audioUrl ?? track.audio_url ?? '');
      if (!audioUrlRaw) continue;
      const startItemId = String(track.startItemId ?? track.start_item_id ?? '');
      const startMs = startItemId ? (itemStartMs.get(startItemId) ?? 0) : 0;
      const durationMsRaw = Number(track.durationMs ?? track.duration_ms ?? 0);
      const durationMs = durationMsRaw > 0 ? durationMsRaw : Math.max(cursorMs - startMs, 1000);
      result.push({
        id: `track_${track.trackId ?? track.track_id}`,
        label: String(track.name || (trackType === 'bgm' ? 'BGM' : '音效')),
        track: trackType === 'bgm' ? 'bgm' : 'sfx',
        audioUrl: resolveMediaUrl(audioUrlRaw),
        durationMs,
        startMs,
      });
    }
    return result;
  }, [audioTracks, storyboardItems, visibleEntityShotCount]);

  const timelineStoryboardTotalMs = useMemo(
    () => [...storyboardItems]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, visibleEntityShotCount)
      .reduce((sum, item) => sum + resolveShotTargetDurationMs({ audioDurationMs: item.audioDurationMs ?? undefined, plannedDurationMs: item.plannedDurationMs ?? undefined }, 3000), 0),
    [storyboardItems, visibleEntityShotCount],
  );

  const timelineTotalMs = useMemo(
    () => Math.max(
      timelineStoryboardTotalMs,
      timelineClips.reduce((m, c) => Math.max(m, c.startMs + c.durationMs), 0),
    ),
    [timelineClips, timelineStoryboardTotalMs],
  );

  const handleDeleteTimelineAudioClip = useCallback(async (clip: TimelineClip) => {
    if (clip.track !== 'bgm' && clip.track !== 'sfx') return;
    const trackId = clip.id.startsWith('track_') ? clip.id.slice('track_'.length) : '';
    if (!trackId || deletingAudioTrackId) return;
    const ok = await crmConfirm({
      title: '删除音频',
      message: `确定删除「${clip.label || (clip.track === 'bgm' ? 'BGM' : '音效')}」吗？`,
      type: 'danger',
      confirmText: '删除',
    });
    if (!ok) return;
    setDeletingAudioTrackId(trackId);
    try {
      await deleteAudioTrack(trackId);
      crmMessage.success('音频已删除');
      await forceReloadSlices('audioTracks');
    } catch (error: any) {
      crmMessage.error(`删除失败：${error?.message || error}`);
    } finally {
      setDeletingAudioTrackId(null);
    }
  }, [deletingAudioTrackId, forceReloadSlices]);

  const showTimeline = storyboardItems.length > 0;
  const [timelinePanel, setTimelinePanel] = usePersistedPageState<{ collapsed: boolean; heightPx: number }>({
    page: 'StoryboardGenPage:timelinePanel',
    episodeId: 'global',
    version: 2,
    defaultValue: { collapsed: true, heightPx: 260 },
  });
  const timelineCollapsed = timelinePanel.collapsed;
  const timelineVisibleHeightPx = typeof window === 'undefined'
    ? timelinePanel.heightPx
    : Math.min(timelinePanel.heightPx, Math.round(window.innerHeight * 0.42));
  const setTimelineCollapsed = useCallback(
    (updater: boolean | ((c: boolean) => boolean)) =>
      setTimelinePanel(p => ({
        ...p,
        collapsed: typeof updater === 'function' ? (updater as (c: boolean) => boolean)(p.collapsed) : updater,
      })),
    [setTimelinePanel],
  );
  const [isTimelineResizing, setIsTimelineResizing] = React.useState(false);

  const startTimelineResize = useCallback(() => {
    setIsTimelineResizing(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    if (!isTimelineResizing) return;
    const onMove = (e: MouseEvent) => {

      const raw = Math.round(window.innerHeight - e.clientY);
      const clamped = Math.max(140, Math.min(raw, Math.round(window.innerHeight * 0.7)));
      setTimelinePanel(p => ({ ...p, heightPx: clamped }));
    };
    const onUp = () => {
      setIsTimelineResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isTimelineResizing, setTimelinePanel]);

  const durationWarnings = useMemo(() =>
    storyboardItems.filter(i => i.plannedDurationMs && i.audioDurationMs && i.audioDurationMs > i.plannedDurationMs),
    [storyboardItems],
  );

  if (isLoading && storyboardItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-n300">
        <div className="animate-pulse flex items-center gap-2">
          <Loader className="w-5 h-5 animate-spin" />
          <span>加载分镜数据...</span>
        </div>
      </div>
    );
  }

  if (error && storyboardItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-danger p-6">
        <p>{error}</p>
      </div>
    );
  }

  if (!pseudoFile.storyboard || pseudoFile.storyboard.items.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-n300">
        <div className="text-center space-y-3">
          <LayoutGrid className="w-12 h-12 mx-auto text-primary" />
          <p className="text-xl font-medium text-n700">分镜画面生成</p>
          <p className="text-sm text-n100">暂无分镜数据，请先在剧本页面创建分镜</p>
        </div>
      </div>
    );
  }

  return (
    <div className="layout-safe workflow-stage-layout flex-col">
      {durationWarnings.length > 0 && (
        <div className="shrink-0 px-4 py-2 bg-n30 border-b border-n40 text-warning text-sm flex items-center gap-2">
          <span>⚠ {durationWarnings.length} 个镜头的音频时长超过设计时长</span>
          <span className="text-xs text-warning ml-2">
            {durationWarnings.map(i => `#${i.sortOrder}: 音频${((i.audioDurationMs || 0) / 1000).toFixed(1)}s/设计${((i.plannedDurationMs || 0) / 1000).toFixed(1)}s`).join(' | ')}
          </span>
        </div>
      )}
      <div className={showTimeline ? 'layout-safe flex-1 min-h-0 overflow-hidden' : 'layout-safe h-full'}>
        <React.Suspense fallback={<WorkflowChunkFallback label="加载分镜工作台..." />}>
          <GenerationPage
            files={[enhancedFile]}
            selectedFileId={episodeId}
            episodeId={episodeId}
            projectId={projectId}
            focusShotId={notificationShotId}
            shotPageSize={STORYBOARD_INITIAL_SHOT_COUNT}
            totalShotCount={storyboardTotalCount || storyboardItems.length}
            onVisibleShotCountChange={handleVisibleShotCountChange}
            onLoadAllStoryboardItems={handleLoadAllStoryboardItems}
            materialLibrary={materialLibrary}
            onUpdateStoryboardItem={handleUpdateStoryboardItem}
            onDeleteStoryboardItem={handleDeleteStoryboardItem}
            onBatchDeleteStoryboardItems={handleBatchDeleteStoryboardItems}
            assetScopeMode={assetScopeMode}
            onAssetScopeModeChange={setAssetScopeMode}
            onSaveVersion={noopSaveVersion}
            onRestoreVersion={noopRestoreVersion}
            onDeleteVersion={noopDeleteVersion}
            onForceSave={handleForceSave}
            onExportNext={handleExportNext}
            onImportProject={noopImportProject}
          />
        </React.Suspense>
      </div>
      {showTimeline && (
        <div className="shrink-0 border-t border-n40 bg-n20 relative">

          {!timelineCollapsed && (
            <div
              onMouseDown={startTimelineResize}
              className="absolute -top-1.5 left-0 right-0 h-3 flex items-center justify-center cursor-row-resize group z-10"
              title="拖动调整时间轴高度"
            >
              <div className="w-12 h-1 rounded-full bg-n0 group-hover:bg-primary transition-colors flex items-center justify-center">
                <GripHorizontal className="w-3 h-3 text-n100 opacity-0 group-hover:opacity-100" />
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 px-4 py-2">
            <button
              type="button"
              aria-expanded={!timelineCollapsed}
              onClick={() => setTimelineCollapsed(c => !c)}
              title={timelineCollapsed ? '展开时间轴' : '折叠时间轴'}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-n40 bg-n0 px-2 text-[10px] font-semibold text-n700 hover:border-primary hover:text-primary"
            >
              {timelineCollapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {timelineCollapsed ? '展开' : '折叠'}
            </button>
            <h4 className="text-xs font-bold text-n100 uppercase tracking-wider">
              图 + 音联合时间轴
            </h4>
            <span className="flex-1" />
            <span className="text-[10px] text-n100">
              {fmtTimeSimple(timelineTotalMs)} | {Math.min(visibleEntityShotCount, storyboardItems.length)} 个镜头
            </span>
          </div>
          {!timelineCollapsed && (
            <div className="px-4 pb-4 overflow-y-auto" style={{ height: timelineVisibleHeightPx }}>
              <TimelineTrack
                mode="combined"
                clips={timelineClips}
                totalDurationMs={timelineTotalMs}
                showPreview
                onAddBgm={() => setShowMusicModal(true)}
                onGenerateBgm={() => setShowMusicModal(true)}
                onAddSfx={() => setShowSfxModal(true)}
                onGenerateSfx={() => setShowSfxModal(true)}
                onDeleteClip={handleDeleteTimelineAudioClip}
              />
            </div>
          )}
        </div>
      )}
      {showMusicModal && (
        <MusicModal
          episodeId={episodeId}
          projectId={projectId}
          script={script}
          onClose={() => setShowMusicModal(false)}
          onCreated={async () => {
            await forceReloadSlices('audioTracks');
            setShowMusicModal(false);
          }}
        />
      )}
      {showSfxModal && (
        <SfxModal
          episodeId={episodeId}
          projectId={projectId}
          script={script}
          onClose={() => setShowSfxModal(false)}
          onCreated={async () => {
            await forceReloadSlices('audioTracks');
            setShowSfxModal(false);
          }}
        />
      )}
    </div>
  );
};
