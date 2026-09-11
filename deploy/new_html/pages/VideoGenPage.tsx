import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEpisode } from '../contexts/EpisodeContext';
import { useProject } from '../contexts/ProjectContext';
import { ArrowRight, Film, Loader, Image as ImageIcon, Upload, RefreshCw } from 'lucide-react';
import type { SeedanceParams, ShotType, VideoModel } from '../services/videoModelService';
import type { TaskGroup, UploadedImage } from '../services/videoTaskTypes';
import {
  generateUUID,
  mixStoryboardAudio,
  runWithConcurrency,
} from '@runtime/videoTaskService';
import {
  computeReactiveDurationFromMeta,
  loadWorkspaceSession,
  mergeWorkspaceSessions,
  importStoryboardIntoWorkspace,
  patchWorkspaceSession,
  saveWorkspaceSession,
  type StoryboardMeta,
} from '../services/videoWorkspaceService';
import { listEpisodeScripts } from '../services/scriptTimelineService';
import { estimateDurationMs } from '../utils/durationMapping';
import { getStoryboardItems, updateStoryboardItem as apiUpdateStoryboardItem } from '../services/episodeDataService';
import { secureApiUrl } from '../services/httpClient';
import { runWhenIdle } from '../utils/idleScheduler';
import { buildStoryboardVideoPrompt } from '../utils/storyboardVideoPrompt';
import { buildVideoStoryboardShotLookup } from '../utils/videoTaskMerge';
import { projectDefaultAspectRatio } from '../utils/projectCreationPreferences';
import { assetsToMaterialLibrary } from '../utils/episodeAdapters';
import type { MaterialLibrary } from '../types';
import {
  buildStoryboardImageSyncPatch,
  countOutdatedStoryboardImages,
} from '../utils/videoStoryboardImageSync';
import {
  buildStoryboardVideoExportImageMap,
  readStoryboardVideoExportNavigationState,
  selectStoryboardItemsForVideoExport,
} from '../utils/storyboardVideoExport';

const VIDEO_INITIAL_STORYBOARD_COUNT = 10;
const VideoPage = React.lazy(() => import('../components/VideoPage').then(m => ({ default: m.VideoPage })));

function hasImportedWorkspaceContent(session: any): boolean {
  return Boolean(
    session
    && (((session.task_groups || []).length > 0) || ((session.uploaded_images || []).length > 0))
  );
}

const WorkflowChunkFallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="h-full min-h-[240px] flex items-center justify-center text-n300">
    <div className="flex items-center gap-2 text-sm">
      <Loader size={16} className="animate-spin text-primary" />
      <span>{label}</span>
    </div>
  </div>
);

function secureMediaUrl(url: string | null): string | null {
  if (!url) return null;
  return secureApiUrl(url, { absolute: true, requireAuth: false });
}

function getStoryboardItemId(item: any): string {
  return (item?.item_id ?? item?.itemId ?? item?.id ?? '').toString();
}

function looksLikeStoryboardId(value: any): boolean {
  return typeof value === 'string' && value.startsWith('sb_');
}

function getWorkspaceImageStoryboardId(image: any): string {
  const explicit = image?.storyboardItemId;
  if (explicit) return explicit.toString();
  const id = image?.id;
  return looksLikeStoryboardId(id) ? id.toString() : '';
}

function collectWorkspaceStoryboardIds(session: any): Set<string> {
  const ids = new Set<string>();
  for (const image of session?.uploaded_images || []) {
    const id = getWorkspaceImageStoryboardId(image);
    if (id) ids.add(id);
  }
  for (const group of session?.task_groups || []) {
    for (const id of group?.ids || []) {
      if (looksLikeStoryboardId(id)) ids.add(id.toString());
    }
  }
  return ids;
}

function isWorkspaceForDifferentStoryboard(session: any, storyboardItems: any[]): boolean {
  const currentIds = new Set(storyboardItems.map(getStoryboardItemId).filter(Boolean));
  const workspaceIds = collectWorkspaceStoryboardIds(session);
  if (currentIds.size === 0 || workspaceIds.size === 0) return false;
  for (const id of workspaceIds) {
    if (currentIds.has(id)) return false;
  }
  return true;
}

export const VideoGenPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [storyboardVideoExport] = useState(() =>
    readStoryboardVideoExportNavigationState(location.state)
  );
  const storyboardVideoExportImages = useMemo(
    () => buildStoryboardVideoExportImageMap(storyboardVideoExport),
    [storyboardVideoExport],
  );
  const explicitExportCount = storyboardVideoExport?.items.length || 0;
  const importTargetLabel = explicitExportCount > 0
    ? `本次选定的 ${explicitExportCount} 个分镜`
    : '全部分镜';
  const { project } = useProject();
  const projectAspectRatio = projectDefaultAspectRatio(project?.settings, '16:9');
  const {
    episodeId,
    projectId,
    selectedScriptId,
    storyboardItems,
    storyboardTotalCount,
    assets,
    isLoading,
    loadSlicesQuiet,
    forceReloadSlicesQuiet,
    loadStoryboardItemsPage,
  } = useEpisode();
  const materialLibrary = useMemo(() => assetsToMaterialLibrary(assets) as unknown as MaterialLibrary, [assets]);
  const refreshProjectMaterials = useCallback(() => forceReloadSlicesQuiet('assets'), [forceReloadSlicesQuiet]);

  // Router state is a one-time transfer envelope. Keep the normalized payload
  // in component state for this import, then remove it from browser history so
  // refreshing the video page cannot overwrite an edited workspace again.
  useEffect(() => {
    if (!storyboardVideoExport || !readStoryboardVideoExportNavigationState(location.state)) return;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: null,
    });
  }, [location.hash, location.pathname, location.search, location.state, navigate, storyboardVideoExport]);

  useEffect(() => {
    loadStoryboardItemsPage({ limit: VIDEO_INITIAL_STORYBOARD_COUNT, includeTotal: true });
    const loadSupportSlices = () => {
      void loadSlicesQuiet('audioTracks', 'characterVoices', 'assets');
    };
    return runWhenIdle(loadSupportSlices, { timeout: 1500 });
  }, [loadStoryboardItemsPage, loadSlicesQuiet, selectedScriptId]);
  const [showImportPanel, setShowImportPanel] = useState(true);
  const [importing, setImporting] = useState(false);
  const flushWorkspaceRef = useRef<(() => Promise<{ success: boolean }>) | null>(null);
  const registerWorkspaceSave = useCallback((save: (() => Promise<{ success: boolean }>) | null) => { flushWorkspaceRef.current = save; }, []);
  const [importDone, setImportDone] = useState(false);
  const [workspaceChecked, setWorkspaceChecked] = useState(false);
  const [hasWorkspaceImport, setHasWorkspaceImport] = useState(false);
  const [importMsg, setImportMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const autoImported = useRef(false);


  const [syncNonce, setSyncNonce] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [changedCount, setChangedCount] = useState(0);

  const sessionScope = episodeId || '';
  const [workspaceScopeReady, setWorkspaceScopeReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setWorkspaceScopeReady(false);
    if (!episodeId) return () => { alive = false; };

    void (async () => {
      try {
        const scriptsRes = await listEpisodeScripts(episodeId);
        const scriptIds = (scriptsRes?.scripts || [])
          .map((item: any) => item.script_id ?? item.scriptId)
          .filter(Boolean);
        const [episodeSession, ...legacySessions] = await Promise.all([
          loadWorkspaceSession(episodeId),
          ...scriptIds.map((scriptId: string) => loadWorkspaceSession(`${episodeId}:${scriptId}`)),
        ]);
        const sessions = [
          ...legacySessions.filter(result => result?.success && result.session).map(result => result.session!),
          ...(episodeSession?.success && episodeSession.session ? [episodeSession.session] : []),
        ];
        if (sessions.length > 0 && legacySessions.some(result => result?.success && result.session)) {
          await saveWorkspaceSession(mergeWorkspaceSessions(sessions), episodeId);
        }
      } catch (err) {
        console.warn('[VideoGenPage] 合并旧视频工作区失败:', err);
      } finally {
        if (alive) setWorkspaceScopeReady(true);
      }
    })();
    return () => { alive = false; };
  }, [episodeId]);

  const itemsWithImages = useMemo(
    () =>
      selectStoryboardItemsForVideoExport([...storyboardItems], storyboardVideoExport)
        .filter(i => {
          const itemId = getStoryboardItemId(i);
          const url = storyboardVideoExportImages.get(itemId)
            ?? (i as any).generated_image_url
            ?? (i as any).generatedImageUrl;
          return !!url;
        })
        .sort((a, b) => ((a as any).sort_order ?? (a as any).sortOrder ?? 0) - ((b as any).sort_order ?? (b as any).sortOrder ?? 0)),
    [storyboardItems, storyboardVideoExport, storyboardVideoExportImages]
  );

  const allStoryboardItems = useMemo(
    () =>
      [...(storyboardItems || [])].sort((a, b) =>
        ((a as any).sort_order ?? (a as any).sortOrder ?? 0) -
        ((b as any).sort_order ?? (b as any).sortOrder ?? 0)
      ),
    [storyboardItems]
  );

  const totalStoryboardCount = Math.max(storyboardTotalCount || 0, allStoryboardItems.length);
  const isStoryboardPagePartial = totalStoryboardCount > allStoryboardItems.length;

  // Shot labels and segment-start markers require the complete ordered list,
  // including when an existing workspace is opened without re-importing it.
  useEffect(() => {
    if (!isStoryboardPagePartial || totalStoryboardCount <= 0) return;
    void loadStoryboardItemsPage({ limit: totalStoryboardCount, includeTotal: false });
  }, [isStoryboardPagePartial, loadStoryboardItemsPage, totalStoryboardCount]);

  const ensureAllStoryboardItemsForImport = useCallback(async () => {
    if (!episodeId || !isStoryboardPagePartial) return allStoryboardItems;
    const res = await getStoryboardItems(episodeId, selectedScriptId || undefined, { fields: 'video' });
    if (!res?.success) throw new Error('加载全部分镜失败');
    return [...(res.items || [])].sort((a, b) =>
      ((a as any).sort_order ?? (a as any).sortOrder ?? 0) -
      ((b as any).sort_order ?? (b as any).sortOrder ?? 0)
    );
  }, [allStoryboardItems, episodeId, isStoryboardPagePartial, selectedScriptId]);

  const handleImportAll = useCallback(async () => {
    if (importing || totalStoryboardCount === 0) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const allStoryboardItemsForImport = await ensureAllStoryboardItemsForImport();
      if (flushWorkspaceRef.current && !(await flushWorkspaceRef.current()).success) throw new Error('现有卡片保存失败，请重试导入');
      const storyboardItemsForImport = selectStoryboardItemsForVideoExport(
        allStoryboardItemsForImport,
        storyboardVideoExport,
      );
      if (storyboardItemsForImport.length === 0) {
        setImportMsg({
          kind: 'error',
          text: storyboardVideoExport
            ? '本次选定的分镜已不存在，请返回画面分镜页重新选择'
            : '没有可导入的分镜',
        });
        return;
      }
      const images: UploadedImage[] = [];
      const prompts: Record<string, string> = {};
      const meta: Record<string, StoryboardMeta> = {};
      const seedanceParams: Record<string, SeedanceParams> = {};
      const groups: TaskGroup[] = [];
      const skipped: { id: string; reason: string; sample?: string }[] = [];
      // Labels must be calculated from the complete list; calculating from a

      const shotLookup = buildVideoStoryboardShotLookup(allStoryboardItemsForImport);

      for (const item of storyboardItemsForImport) {
        const itemId = getStoryboardItemId(item);
        const rawUrl = storyboardVideoExportImages.get(itemId)
          ?? (item as any).generated_image_url
          ?? (item as any).generatedImageUrl;

        const prompt = buildStoryboardVideoPrompt(item as any);
        const sortOrder = (item as any).sort_order ?? (item as any).sortOrder ?? 0;
        const shotInfo = shotLookup.get(itemId);
        if (!itemId) {
          skipped.push({ id: '(no itemId)', reason: 'missing itemId' });
          continue;
        }


        const urlRaw = (rawUrl || '').toString();
        const url = urlRaw.split('?')[0];
        let imgUrl = '';
        let isPlaceholder = true;
        if (url) {
          if (url.startsWith('data:')) {
            skipped.push({ id: itemId, reason: 'data: URL（已跳过画面，仍占空位）', sample: url.slice(0, 60) + '...' });
          } else if (url.startsWith('blob:')) {
            skipped.push({ id: itemId, reason: 'blob: URL（已跳过画面，仍占空位）', sample: url.slice(0, 60) });
          } else if (!url.startsWith('http') && !url.startsWith('/')) {
            skipped.push({ id: itemId, reason: '未识别 URL 协议（已跳过画面）', sample: url.slice(0, 60) });
          } else {
            imgUrl = url;
            isPlaceholder = false;
          }
        }

        const upImg: UploadedImage = {
          id: itemId,
          url: imgUrl,
          filename: imgUrl ? `storyboard_${sortOrder + 1}.png` : `placeholder_${sortOrder + 1}`,
          storageUrl: imgUrl || undefined,
          uploadTime: Date.now(),
          isPlaceholder,
          storyboardItemId: itemId,
          sortOrder,
          storyboardSegmentKey: shotInfo?.segmentKey,
          storyboardSegmentNo: shotInfo?.segmentNo,
          storyboardLocalShotNo: shotInfo?.localShotNo,
          storyboardShotLabel: shotInfo?.label,
          isStoryboardSegmentStart: shotInfo?.isFirstInSegment,
          tags: [],
          linkedGroupUuids: [],
        };
        images.push(upImg);
        if (prompt) prompts[itemId] = prompt;


        const audioUrls = {
          dialogue:  (item as any).dialogue_audio_url ?? (item as any).dialogueAudioUrl ?? undefined,
          narration: (item as any).narration_audio_url ?? (item as any).narrationAudioUrl ?? undefined,
          sfx:       (item as any).sfx_audio_url ?? (item as any).sfxAudioUrl ?? undefined,
        };


        let plannedDurationMs: number | undefined =
          (item as any).planned_duration_ms ?? (item as any).plannedDurationMs ?? undefined;
        if (plannedDurationMs == null || plannedDurationMs <= 0) {
          plannedDurationMs = estimateDurationMs({
            dialogueText: (item as any).dialogue || '',
          });

          apiUpdateStoryboardItem(itemId, { planned_duration_ms: plannedDurationMs })
            .catch(e => console.warn('[VideoGenPage] backfill planned_duration_ms 失败:', itemId, e?.message || e));
        }
        meta[itemId] = {
          plannedDurationMs,
          audioDurationMs:   (item as any).audio_duration_ms ?? (item as any).audioDurationMs ?? undefined,
          audioUrls: (audioUrls.dialogue || audioUrls.narration || audioUrls.sfx) ? audioUrls : undefined,
          mixedAudioUrl:  (item as any).mixed_audio_url ?? (item as any).mixedAudioUrl ?? undefined,
          mixedAudioHash: (item as any).mixed_audio_hash ?? (item as any).mixedAudioHash ?? undefined,
          sceneHeading: (item as any).scene_heading ?? (item as any).sceneHeading ?? undefined,
          actionText:   (item as any).action_text ?? (item as any).actionText ?? undefined,
          dialogue:     (item as any).dialogue ?? undefined,
          lastSyncedAt: Date.now(),
        };

        const initialDuration = computeReactiveDurationFromMeta(meta[itemId]);


        const groupUuid = generateUUID();
        const group: TaskGroup = {
          uuid: groupUuid,
          ids: [itemId],
          model: 'Seedance15' as VideoModel,
          shotType: 'single' as ShotType,
          duration: initialDuration,
          durationUserOverride: false,
        };
        groups.push(group);
        upImg.linkedGroupUuids = [groupUuid];


        const sp: SeedanceParams = {
          sub_model: 'agent_plan',
          prompt: prompt || (isPlaceholder ? '@' : ''),

          // The panel owns reference-mode switching.
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



        const m = meta[itemId];
        const refAudio =
          m.mixedAudioUrl
          || m.audioUrls?.dialogue
          || m.audioUrls?.narration
          || m.audioUrls?.sfx
          || null;
        if (refAudio) {
          sp.media_inputs.push({
            kind: 'audio',
            url: refAudio,
            role: 'reference_audio',
          });
        }
        seedanceParams[groupUuid] = sp;
      }

      if (images.length === 0) {
        const msg = `没有可导入的分镜（共 ${storyboardItemsForImport.length} 个，全部被跳过）`;
        setImportMsg({ kind: 'error', text: msg });
        return;
      }
      if (skipped.length > 0) {
        console.warn('[VideoGenPage] 跳过 %d 个画面（占位仍导入）', skipped.length, skipped);
      }

      console.log('[VideoGenPage] 导入分镜 → workspace', {
        scope: sessionScope,
        images: images.length,
        groups: groups.length,
        skipped: skipped.length,
        placeholders: images.filter(i => i.isPlaceholder).length,
      });


      const previous = await loadWorkspaceSession(sessionScope);
      if (previous.error) throw new Error('读取现有工作区失败，未覆盖卡片');
      const saveRes = await saveWorkspaceSession(importStoryboardIntoWorkspace(previous.session, {
        uploaded_images: images,
        task_groups: groups,
        image_prompts: prompts,
        tasks_status: {},
        seedance_params: seedanceParams,
        storyboard_meta: meta,
      }), sessionScope);
      if (!saveRes?.success) {
        setImportMsg({ kind: 'error', text: '保存工作区会话失败，请稍后重试' });
        return;
      }
      setImportDone(true);
      setWorkspaceChecked(true);
      setHasWorkspaceImport(true);
      setShowImportPanel(false);
      setSyncNonce(n => n + 1);


      const itemsToMix = Object.entries(meta).filter(([, m]) =>
        !m.mixedAudioUrl && m.audioUrls && (m.audioUrls.dialogue || m.audioUrls.narration || m.audioUrls.sfx)
      );
      if (itemsToMix.length > 0) {
        setImportMsg({ kind: 'info', text: `正在后台混音 ${itemsToMix.length} 条音频...` });
        await runWithConcurrency(itemsToMix, 3, async ([itemId, m]) => {
          try {
            const r = await mixStoryboardAudio({
              item_id: itemId,
              dialogue_url:  m.audioUrls?.dialogue,
              narration_url: m.audioUrls?.narration,
              sfx_url:       m.audioUrls?.sfx,
            });
            await patchWorkspaceSession(sessionScope, (cur) => {
              const newMeta = {
                ...(cur.storyboard_meta || {}),
                [itemId]: {
                  ...(cur.storyboard_meta?.[itemId] || {}),
                  mixedAudioUrl: r.mixed_audio_url,
                  mixedAudioHash: undefined,
                },
              };
              const groupForItem = (cur.task_groups || []).find(g => g.ids.includes(itemId));
              const newSP = { ...(cur.seedance_params || {}) };
              if (groupForItem) {
                const existing = newSP[groupForItem.uuid];
                if (existing) {
                  const others = existing.media_inputs.filter(mi => mi.role !== 'reference_audio');
                  newSP[groupForItem.uuid] = {
                    ...existing,
                    media_inputs: [...others, { kind: 'audio', url: r.mixed_audio_url, role: 'reference_audio' }],
                  };
                }
              }
              return { storyboard_meta: newMeta, seedance_params: newSP };
            });
          } catch (e) {
            console.warn('[VideoGenPage] mix-audio failed for', itemId, e);
          }
        });
        setImportMsg({ kind: 'info', text: `导入完成（${images.length} 个分镜，混音 ${itemsToMix.length} 条）` });
      } else {
        setImportMsg({ kind: 'info', text: `导入完成（${images.length} 个分镜）` });
      }
    } catch (err: any) {
      console.error('[VideoGenPage] 导入失败:', err);
      setImportMsg({ kind: 'error', text: `导入失败：${err?.message || String(err)}` });
    } finally {
      setImporting(false);
    }
  }, [
    ensureAllStoryboardItemsForImport,
    importing,
    sessionScope,
    storyboardVideoExport,
    storyboardVideoExportImages,
    totalStoryboardCount,
  ]);

  const handleReimportAll = useCallback(() => {
    if (importing) return;
    const confirmed = window.confirm(
      `将更新已有分镜画面并补充新分镜，保留手动空卡、模型参数和视频结果。确定导入${importTargetLabel}吗？`
    );
    if (!confirmed) return;
    handleImportAll();
  }, [handleImportAll, importing, importTargetLabel]);

  useEffect(() => {
    autoImported.current = false;
    setImportDone(false);
    setWorkspaceChecked(false);
    setHasWorkspaceImport(false);
    setShowImportPanel(true);
  }, [sessionScope]);

  useEffect(() => {
    if (!workspaceScopeReady || autoImported.current || importing || importDone || isLoading) return;
    if (allStoryboardItems.length === 0) return;
    let alive = true;
    (async () => {
      try {
        const existing = await loadWorkspaceSession(sessionScope);
        const sess: any = existing.session;
        const hasImported = existing.success && hasImportedWorkspaceContent(sess);
        if (!alive) return;
        setWorkspaceChecked(true);
        setHasWorkspaceImport(hasImported);

        if (storyboardVideoExport) {
          autoImported.current = true;
          setImportDone(false);
          setHasWorkspaceImport(false);
          setShowImportPanel(false);
          setImportMsg({ kind: 'info', text: `正在导入${importTargetLabel}及其已选画面。` });
          handleImportAll();
          return;
        }

        if (hasImported) {
          if (isWorkspaceForDifferentStoryboard(sess, allStoryboardItems)) {
            autoImported.current = true;
            setImportDone(false);
            setHasWorkspaceImport(false);
            setShowImportPanel(false);
            setImportMsg({ kind: 'info', text: '检测到视频工作区仍是旧分镜，正在重新导入当前分镜。' });
            handleImportAll();
            return;
          }
          autoImported.current = true;
          setImportDone(true);
          setShowImportPanel(false);
          return;
        }

        if (!existing.success || !hasImported) {
          if (isStoryboardPagePartial) {
            setImportMsg({
              kind: 'info',
              text: `已先加载 ${allStoryboardItems.length}/${totalStoryboardCount} 个分镜预览，需要时点击导入全部。`,
            });
            return;
          }
          autoImported.current = true;
          handleImportAll();
        }
      } catch {
        if (alive) setWorkspaceChecked(true);
      }
    })();
    return () => { alive = false; };
  }, [
    isLoading,
    workspaceScopeReady,
    allStoryboardItems,
    importing,
    importDone,
    handleImportAll,
    sessionScope,
    isStoryboardPagePartial,
    totalStoryboardCount,
    storyboardVideoExport,
    importTargetLabel,
  ]);


  const latestImageById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const item of allStoryboardItems) {
      const id = getStoryboardItemId(item);
      const raw = (
        (item as any).generated_image_url
        ?? (item as any).generatedImageUrl
        ?? ''
      ).toString().split('?')[0];
      if (id && raw && !raw.startsWith('data:') && !raw.startsWith('blob:')) m[id] = raw;
    }
    return m;
  }, [allStoryboardItems]);


  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await loadWorkspaceSession(sessionScope);
        if (!alive || !r.success || !r.session) { if (alive) setChangedCount(0); return; }
        if (alive) setChangedCount(countOutdatedStoryboardImages(r.session, latestImageById));
      } catch { if (alive) setChangedCount(0); }
    })();
    return () => { alive = false; };
  }, [sessionScope, latestImageById, importDone, syncNonce]);


  const handleSyncImages = useCallback(async () => {
    setSyncing(true);
    setImportMsg(null);
    try {
      if (flushWorkspaceRef.current && !(await flushWorkspaceRef.current()).success) throw new Error('现有卡片保存失败');
      const r = await loadWorkspaceSession(sessionScope);
      if (r.error) throw new Error('工作区读取失败');
      if (!r.success || !r.session || !(r.session.task_groups?.length)) {
        await handleImportAll();
        return;
      }
      const sess = r.session;
      if (isWorkspaceForDifferentStoryboard(sess, allStoryboardItems)) {
        setImportMsg({ kind: 'info', text: '检测到视频工作区仍是旧分镜，正在重新导入当前分镜。' });
        await handleImportAll();
        return;
      }
      const saveResult = await patchWorkspaceSession(
        sessionScope,
        current => buildStoryboardImageSyncPatch(current, latestImageById),
      );
      if (!saveResult.success) throw new Error('workspace save failed');

      const verified = await loadWorkspaceSession(sessionScope);
      if (!verified.success || !verified.session) throw new Error('workspace verification failed');
      const remainingChanges = countOutdatedStoryboardImages(verified.session, latestImageById);
      if (remainingChanges > 0) throw new Error('workspace verification mismatch');

      setChangedCount(0);
      setHasWorkspaceImport(true);
      setSyncNonce(n => n + 1);
      setImportMsg({ kind: 'info', text: '已同步最新分镜图（保留已生成的视频）' });
    } catch {
      setImportMsg({ kind: 'error', text: '同步失败，请重试' });
    } finally {
      setSyncing(false);
    }
  }, [sessionScope, latestImageById, handleImportAll, allStoryboardItems]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-n300">
        <Loader className="w-5 h-5 animate-spin mr-2" /> 加载视频数据...
      </div>
    );
  }

  return (
    <div className="layout-safe workflow-stage-layout flex-col">
      {/* Import panel */}
      {workspaceChecked && showImportPanel && !importDone && (
        <div className="shrink-0 border-b border-n40 bg-n0 px-4 py-3">
          {importMsg && (
            <div
              className={`mb-2 flex items-center justify-between gap-2 rounded px-3 py-1.5 text-xs ${
                importMsg.kind === 'error'
                  ? 'bg-r50 border border-r75 text-danger'
                  : 'bg-n30 border border-n40 text-success'
              }`}
            >
              <span>{importMsg.text}</span>
              <button
                onClick={() => setImportMsg(null)}
                className="text-[10px] opacity-60 hover:opacity-100"
              >
                关闭
              </button>
            </div>
          )}
          <div className="responsive-toolbar flex items-center justify-between">
            <div className="toolbar-group text-xs text-n100">
              <Film size={14} className="text-primary" />
              <span>已预览 {allStoryboardItems.length}/{totalStoryboardCount} 个分镜</span>
              <span className="text-n100">|</span>
              <span>{itemsWithImages.length} 个预览分镜已有画面</span>
            </div>
            <div className="toolbar-actions">
              <button
                onClick={handleImportAll}
                disabled={importing || totalStoryboardCount === 0}
                className="flex items-center gap-2 px-4 py-1.5 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                {importing ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
                导入{importTargetLabel}到视频工作区
              </button>
              <button
                onClick={() => setShowImportPanel(false)}
                className="text-xs text-n100 hover:text-n300 px-2 py-1"
              >
                跳过
              </button>
            </div>
          </div>

          {/* Preview thumbnails */}
          {itemsWithImages.length > 0 && (
            <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
              {itemsWithImages.slice(0, 12).map((item, idx) => {
                const itemId = getStoryboardItemId(item);
                const url = storyboardVideoExportImages.get(itemId)
                  ?? (item as any).generated_image_url
                  ?? (item as any).generatedImageUrl;
                return (
                  <div key={(item as any).item_id ?? (item as any).itemId ?? idx} className="shrink-0 w-16 h-10 rounded overflow-hidden border border-n40">
                    <img
                      src={secureMediaUrl(url)!}
                      alt={`分镜 ${idx + 1}`}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  </div>
                );
              })}
              {itemsWithImages.length > 12 && (
                <div className="shrink-0 w-16 h-10 rounded border border-n40 flex items-center justify-center text-[10px] text-n100">
                  +{itemsWithImages.length - 12}
                </div>
              )}
            </div>
          )}
        </div>
      )}


      <div className="responsive-toolbar workflow-stage-toolbar shrink-0 flex justify-between items-center px-4 py-1.5">
        <div className="toolbar-group">
          {hasWorkspaceImport && (
            <button
              onClick={handleReimportAll}
              disabled={importing || totalStoryboardCount === 0}
              title={`导入${importTargetLabel}，保留手动空卡、模型参数和任务结果`}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-n40 bg-n0 text-n300 hover:text-n700 transition-colors disabled:opacity-50"
            >
              {importing ? <Loader size={12} className="animate-spin" /> : <Upload size={12} />}
              再次导入{importTargetLabel}到视频工作区
            </button>
          )}
          {(changedCount > 0 || syncing) && (
            <>
              <span className="text-[11px] text-amber-600">⚠ {changedCount} 个分镜图已在分镜页更新</span>
              <button
                onClick={handleSyncImages}
                disabled={syncing}
                title="把分镜页改过的最新画面同步到视频工作区（保留已生成的视频，不会清空）"
                className="flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
              >
                {syncing ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {syncing ? '同步中…' : '同步最新分镜图'}
              </button>
            </>
          )}
          {importMsg && (importDone || !showImportPanel) && (
            <span
              role="status"
              className={`text-[11px] ${importMsg.kind === 'error' ? 'text-danger' : 'text-success'}`}
            >
              {importMsg.text}
            </span>
          )}
        </div>
        <button
          onClick={() => navigate(`/projects/${projectId}/ep/${episodeId}/workflow/enhance`)}
          className="flex items-center gap-2 px-3 py-1 bg-success hover:bg-success text-white text-xs rounded-lg transition-colors"
        >
          导出到美化 <ArrowRight size={12} />
        </button>
      </div>

      {/* Embedded old VideoPage */}
      <div className="layout-safe workflow-stage-canvas">
        <React.Suspense fallback={<WorkflowChunkFallback label="加载视频工作台..." />}>
          {workspaceScopeReady ? <VideoPage
            isActive={true}
            sessionScope={sessionScope}
            projectId={projectId || ''}
            episodeId={episodeId || ''}
            storyboardItems={allStoryboardItems}
            materialLibrary={materialLibrary}
            onRefreshProjectMaterials={refreshProjectMaterials}
            onRegisterSessionSave={registerWorkspaceSave}
            suspendSessionSave={importing || syncing}
            defaultAspectRatio={projectAspectRatio}
            onRequestReimport={handleImportAll}
            key={`${sessionScope}-${importDone}-${syncNonce}`}
          /> : <WorkflowChunkFallback label="合并本集视频工作区..." />}
        </React.Suspense>
      </div>
    </div>
  );
};
