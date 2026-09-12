import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, ArrowRight, Music } from 'lucide-react';
import { useEpisode } from '../contexts/EpisodeContext';
import {
  getStoryboardItems,
  syncStoryboardItems,
} from '../services/episodeDataService';
import { updateStoryboardItem as apiUpdateStoryboardItem } from '../services/storyboardMutationService';
import { minimaxTTS } from '@runtime/audioGenerationService';
import { crmConfirm, crmMessage } from '../admin/crmUI';
import {
  applyStoryboardRecordPatch,
  normalizeStoryboardRecord,
  parseBoundAssetTags,
} from '../utils/episodeAdapters';
import { waitForIdle } from '../utils/idleScheduler';
import { resolveStoryboardPlannedDurationMs } from '../utils/audioTimeline';
import {
  audioSegmentsToClips,
  resolveStoryboardAudioSegments,
  serializeAudioSegmentsDialogue,
  sumPersistedAudioSegmentDurationMs,
} from '../utils/audioSegments';
import {
  resolveBoundCharacterVoice,
  resolveEffectiveSpeaker,
  resolveVoiceGenerationSettings,
} from '../utils/audioVoiceBinding';
import { VoiceSidebar } from '../components/audio/VoiceSidebar';
import { DubbingPanel, type DubbingPanelHandle } from '../components/audio/DubbingPanel';
import { MultiTrackTimeline } from '../components/audio/MultiTrackTimeline';
import { MusicModal } from '../components/audio/MusicModal';
import { MusicAssetSidebar } from '../components/audio/MusicAssetSidebar';
import type {
  AudioClipInfo,
  ClipOverride,
  CharacterVoice,
  AssetItem,
  StoryboardAudioSegment,
  StoryboardItemDB,
} from '../types';
import { usePersistedPageState } from '../hooks/usePersistedPageState';


import { taskRegistry } from '../services/taskRegistry';



import { pollTtsTaskUntilDone, TtsTimeoutError } from '../services/ttsTaskPoller';
import { safeBrowserResourceUrl } from '../services/httpClient';

function resolveUrl(path: string) {
  if (!path) return '';
  const normalized = path.startsWith('/') || /^(?:https?:|blob:|data:)/i.test(path) ? path : `/${path}`;
  return safeBrowserResourceUrl(normalized);
}

const AUDIO_STAGE_STORYBOARD_INITIAL_LOAD_LIMIT = 20;
const AUDIO_STAGE_STORYBOARD_BACKGROUND_PAGE_SIZE = 80;

function normalizeAudioStageStoryboardItem(record: Record<string, any>): StoryboardItemDB {
  const item = normalizeStoryboardRecord(record);
  return {
    ...item,
    plannedDurationMs: resolveStoryboardPlannedDurationMs(item),
  };
}

function sortAudioStageStoryboardItems(items: StoryboardItemDB[]): StoryboardItemDB[] {
  return [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function mergeAudioStageStoryboardItems(existing: StoryboardItemDB[], incoming: StoryboardItemDB[]): StoryboardItemDB[] {
  const byId = new Map(existing.map(item => [item.itemId, item]));
  for (const item of incoming) {
    if (!byId.has(item.itemId)) byId.set(item.itemId, item);
  }
  return sortAudioStageStoryboardItems(Array.from(byId.values()));
}

export const AudioStagePage: React.FC = () => {
  const navigate = useNavigate();
  const {
    assets, characterVoices, audioTracks,
    projectId, episodeId, selectedScriptId, script, isLoading, error, reload,
    loadSlices,
    forceReloadSlicesQuiet,
  } = useEpisode();
  const [storyboardItems, setStoryboardItems] = useState<StoryboardItemDB[]>([]);
  const [storyboardLoading, setStoryboardLoading] = useState(false);
  const [storyboardError, setStoryboardError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState<'dubbing' | 'music'>('dubbing');
  const storyboardItemsRef = useRef<StoryboardItemDB[]>([]);

  const reloadAudioTracks = useCallback(async () => {
    await forceReloadSlicesQuiet('audioTracks');
  }, [forceReloadSlicesQuiet]);

  useEffect(() => {
    storyboardItemsRef.current = storyboardItems;
  }, [storyboardItems]);

  useEffect(() => {
    setTimelineCollapsed(true);
  }, [episodeId]);



  const handleExportToStoryboard = useCallback(async () => {
    if (exporting) return;
    const items = [...storyboardItems].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    if (!items.length) {
      navigate(`/projects/${projectId}/ep/${episodeId}/workflow/storyboard`);
      return;
    }
    setExporting(true);
    try {
      const payload = items.map(it => ({
        item_id: it.itemId,
        sort_order: it.sortOrder ?? 0,
        dialogue: it.dialogue || '',
        dialogue_audio_url: it.dialogueAudioUrl || null,
        narration_audio_url: it.narrationAudioUrl || null,
        sfx_audio_url: it.sfxAudioUrl || null,
        audio_duration_ms: it.audioDurationMs ?? null,
        planned_duration_ms: it.plannedDurationMs ?? null,
        audio_segments: it.audioSegments || [],
        video_script_block: it.videoScriptBlock || '',
        bound_assets: Array.isArray(it.boundAssets) ? it.boundAssets : [],
      }));
      const res: any = await syncStoryboardItems(episodeId, payload, selectedScriptId || undefined);
      crmMessage.success(`已同步分镜：更新 ${res?.updated || 0}，新增 ${res?.created || 0}，未变化 ${res?.skipped || 0}`);
      navigate(`/projects/${projectId}/ep/${episodeId}/workflow/storyboard`);
    } catch (e: any) {
      crmMessage.error(`同步到分镜失败：${e?.message || e}`);
    } finally {
      setExporting(false);
    }
  }, [exporting, storyboardItems, episodeId, selectedScriptId, projectId, navigate]);

  const updateAudioStageStoryboardItem = useCallback(async (itemId: string, data: Record<string, any>) => {
    await apiUpdateStoryboardItem(itemId, data);
    // The next clip must see this patch before React commits the render.
    const next = storyboardItemsRef.current.map(item =>
      item.itemId === itemId ? applyStoryboardRecordPatch(item, data) : item
    );
    storyboardItemsRef.current = next;
    setStoryboardItems(next);
  }, []);

  const persistAudioSegments = useCallback(async (
    itemId: string,
    update: (segments: StoryboardAudioSegment[]) => StoryboardAudioSegment[],
    extraFields: Record<string, any> = {},
  ) => {
    const item = storyboardItemsRef.current.find(candidate => candidate.itemId === itemId);
    if (!item) throw new Error('未找到对应镜头');
    const { charNames } = parseBoundAssetTags(
      Array.isArray(item.boundAssets) ? item.boundAssets : [],
    );
    const updatedSegments = update(resolveStoryboardAudioSegments(item, charNames))
      .map((segment, sequenceIndex) => ({ ...segment, sequenceIndex }));
    const fields = {
      audio_segments: updatedSegments,
      dialogue: serializeAudioSegmentsDialogue(updatedSegments),
      audio_duration_ms: sumPersistedAudioSegmentDurationMs(updatedSegments) || null,
      ...extraFields,
    };
    await updateAudioStageStoryboardItem(itemId, fields);
    return updatedSegments;
  }, [updateAudioStageStoryboardItem]);



  useEffect(() => {
    void loadSlices('assets', 'characterVoices', 'script', 'audioTracks');
  }, [loadSlices]);

  useEffect(() => {
    let active = true;
    if (!episodeId) {
      setStoryboardItems([]);
      return () => { active = false; };
    }
    const currentEpisodeId = episodeId;
    const scriptId = selectedScriptId || undefined;

    const loadRemainingAudioStageStoryboardPages = async (offset: number, total: number) => {
      let nextOffset = offset;
      while (active && nextOffset < total) {
        await waitForIdle();
        if (!active) return;
        try {
          const res = await getStoryboardItems(currentEpisodeId, scriptId, {
            fields: 'audio_stage',
            limit: AUDIO_STAGE_STORYBOARD_BACKGROUND_PAGE_SIZE,
            offset: nextOffset,
          });
          if (!active) return;
          const pageItems = res.success
            ? (res.items || []).map(normalizeAudioStageStoryboardItem)
            : [];
          if (!pageItems.length) return;
          setStoryboardItems(prev => mergeAudioStageStoryboardItems(prev, pageItems));
          nextOffset += pageItems.length;
          if (pageItems.length < AUDIO_STAGE_STORYBOARD_BACKGROUND_PAGE_SIZE) return;
        } catch (err) {
          console.warn('storyboard audio-stage background fields load failed:', err);
          return;
        }
      }
    };

    setStoryboardLoading(true);
    setStoryboardError(null);
    getStoryboardItems(currentEpisodeId, scriptId, {
      fields: 'audio_stage',
      limit: AUDIO_STAGE_STORYBOARD_INITIAL_LOAD_LIMIT,
      includeTotal: true,
    })
      .then(res => {
        if (!active) return;
        const items = res.success ? (res.items || []).map(normalizeAudioStageStoryboardItem) : [];
        const sortedItems = sortAudioStageStoryboardItems(items);
        setStoryboardItems(sortedItems);
        const total = typeof res.total === 'number' ? res.total : sortedItems.length;
        if (total > sortedItems.length) {
          void loadRemainingAudioStageStoryboardPages(sortedItems.length, total);
        }
      })
      .catch(err => {
        console.warn('storyboard audio-stage fields load failed:', err);
        if (active) {
          setStoryboardItems([]);
          setStoryboardError(err?.message || '分镜配音数据加载失败');
        }
      })
      .finally(() => {
        if (active) setStoryboardLoading(false);
      });
    return () => { active = false; };
  }, [episodeId, selectedScriptId]);


  const sortedItems = useMemo(
    () => [...storyboardItems].sort((a, b) => a.sortOrder - b.sortOrder),
    [storyboardItems],
  );

  const voiceMap = useMemo(() => {
    const m = new Map<string, CharacterVoice>();
    characterVoices.forEach(v => m.set(v.characterName, v));
    return m;
  }, [characterVoices]);

  const charAssetMap = useMemo(() => {
    const m = new Map<string, AssetItem>();
    assets
      .filter(a => ((a as any).assetType || (a as any).asset_type) === 'character')
      .forEach(a => m.set((a as any).name, a));
    return m;
  }, [assets]);

  const allCharNames = useMemo(() => {
    const names = new Set<string>();
    for (const item of storyboardItems) {
      const { charNames } = parseBoundAssetTags(Array.isArray(item.boundAssets) ? item.boundAssets : []);
      charNames.forEach(n => names.add(n));
    }
    assets
      .filter(a => ((a as any).assetType || (a as any).asset_type) === 'character')
      .forEach(a => {
        const name = String((a as any).name || '').trim();
        if (name) names.add(name);
      });
    characterVoices.forEach(voice => {
      const name = voice.characterName.trim();
      if (name) names.add(name);
    });
    names.add('旁白');
    return Array.from(names);
  }, [storyboardItems, assets, characterVoices]);


  const resolvedItems = useMemo(
    () => sortedItems.map(item => {
      const { charNames } = parseBoundAssetTags(
        Array.isArray(item.boundAssets) ? item.boundAssets : [],
      );
      return {
        ...item,
        audioSegments: resolveStoryboardAudioSegments(item, charNames),
      };
    }),
    [sortedItems],
  );

  const clips: AudioClipInfo[] = useMemo(
    () => resolvedItems.flatMap(item => audioSegmentsToClips(
      item,
      item.audioSegments || [],
      speaker => voiceMap.get(speaker)?.voiceModelId || null,
    )),
    [resolvedItems, voiceMap],
  );

  const clipKey = useCallback((clip: AudioClipInfo) => clip.clipId, []);






  const [localOverrides, setLocalOverrides] = usePersistedPageState<Record<string, ClipOverride>>({
    page: 'AudioStagePage:localOverrides',
    episodeId,
    version: 1,
    defaultValue: {},
  });
  const [localAudio, setLocalAudio] = useState<Record<string, { url: string; durationMs?: number }>>({});
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [playingKey, setPlayingKey] = useState('');
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const dubbingRef = useRef<DubbingPanelHandle>(null);
  const batchRunningRef = useRef(false);
  const generationScopeRef = useRef(0);







  const ttsAbortControllers = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    batchRunningRef.current = false;
    setBatchRunning(false);
    setGeneratingIds(new Set());
    setLocalAudio({});
    setErrors({});
    return () => {
      generationScopeRef.current += 1;
      ttsAbortControllers.current.forEach(c => c.abort());
      ttsAbortControllers.current.clear();
    };
  }, [episodeId, selectedScriptId]);


  const runGenerate = useCallback(async (clip: AudioClipInfo) => {




    const key = clipKey(clip);
    if (ttsAbortControllers.current.has(key)) return;
    const override = localOverrides[key] || {};
    const speakerLabel = resolveEffectiveSpeaker(clip, override);
    const voice = resolveBoundCharacterVoice(voiceMap, speakerLabel);

    setErrors(p => { const n = { ...p }; delete n[key]; return n; });
    setGeneratingIds(p => new Set(p).add(key));



    const registryTaskId = `tts:${clip.clipId}`;

    const provider = 'minimax-tts';
    const isNarration = speakerLabel === '旁白';
    const fileRole = `${isNarration ? 'narration_audio' : 'dialogue_audio'}:${clip.clipId}`;
    try {
      taskRegistry.register({
        taskId: registryTaskId,
        kind: provider,
        title: `${isNarration ? '旁白' : '对白'} · ${speakerLabel}`,
        targetPage: 'audio',
        initialStatus: 'running',
        progress: 0,
        targetEntityType: 'storyboard_item',
        targetEntityId: clip.itemId,
        targetItemId: clip.itemId,
        targetProjectId: projectId || undefined,
        episodeId: episodeId || undefined,
        fileRole,
      });
    } catch {}



    const controller = new AbortController();
    ttsAbortControllers.current.set(key, controller);

    try {
      const textToSpeak = override.text ?? clip.text;
      // voice_params is discriminated by source: system, clone, or design.



      const {
        voiceId: minimaxVoiceId,
        emotion,
        speed,
        pitch,
      } = resolveVoiceGenerationSettings(voice, override);



      const ttsArgs = {
        text: textToSpeak, voice_id: minimaxVoiceId, speed, emotion, pitch,
        entity_type: 'storyboard_item', entity_id: clip.itemId,
        storyboard_lineage_id: clip.lineageId,
        file_role: fileRole,
        episode_id: episodeId,
      };


      let submitted: { task_id: string };
      try {
        submitted = await minimaxTTS(ttsArgs, controller.signal);
      } catch (enqErr: any) {
        const isNetErr = enqErr instanceof TypeError
          || /failed to fetch|networkerror|load failed|fetch/i.test(enqErr?.message || '');
        if (!isNetErr || controller.signal.aborted || enqErr?.name === 'AbortError') throw enqErr;
        await new Promise(r => setTimeout(r, 800));
        submitted = await minimaxTTS(ttsArgs, controller.signal);
      }

      if (controller.signal.aborted) return;



      const result = await pollTtsTaskUntilDone(submitted.task_id, {
        signal: controller.signal,
        intervalMs: 2000,
        timeoutMs: 10 * 60 * 1000,
      });
      if (controller.signal.aborted) return;

      if (!result.audio_url) {
        try { taskRegistry.fail(registryTaskId, '后端未返回 audio_url'); } catch { /* noop */ }
        throw new Error('后端未返回 audio_url');
      }

      const url = result.audio_url;
      const durationMs = result.duration_ms;
      setLocalAudio(p => ({ ...p, [key]: { url: resolveUrl(url), durationMs } }));




      try {
        await persistAudioSegments(
          clip.itemId,
          segments => segments.map(segment => (
            segment.segmentId === clip.clipId
              ? {
                ...segment,
                speaker: speakerLabel,
                text: textToSpeak,
                audioUrl: url,
                durationMs: durationMs != null && Number.isFinite(durationMs)
                  ? durationMs
                  : segment.durationMs,
                voiceId: minimaxVoiceId,
              }
              : segment
          )),
          isNarration
            ? { narration_audio_url: url }
            : { dialogue_audio_url: url },
        );

        try { taskRegistry.complete(registryTaskId, { resultUrls: [resolveUrl(url)], progress: 1 }); } catch { /* noop */ }
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error('[AudioStagePage] 配音持久化失败', clip.itemId, msg);
        setErrors(p => ({ ...p, [key]: `已生成但保存失败：${msg}（请点击重新生成）` }));
        try { taskRegistry.fail(registryTaskId, `已生成但保存失败：${msg}`); } catch { /* noop */ }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {


        try { taskRegistry.fail(registryTaskId, '已取消'); } catch { /* noop */ }
        return;
      }
      const taskTail = e?.task_id ? `（task_id: ${e.task_id}）` : '';
      const msg = e instanceof TtsTimeoutError
        ? `TTS 超时${taskTail}：可能 MiniMax 端排队中，请稍后重试`
        : `${e?.message || String(e)}${taskTail}`;
      setErrors(p => ({ ...p, [key]: msg }));

      try { taskRegistry.fail(registryTaskId, msg); } catch { /* noop */ }
    } finally {
      if (ttsAbortControllers.current.get(key) === controller) {
        setGeneratingIds(p => { const n = new Set(p); n.delete(key); return n; });
        ttsAbortControllers.current.delete(key);
      }
    }
  }, [voiceMap, localOverrides, clipKey, episodeId, projectId, persistAudioSegments]);

  const handleBatchGenerate = useCallback(async () => {
    if (batchRunningRef.current || batchRunning || clips.length === 0) return;
    const batchClips = clips.filter(clip => {
      const key = clipKey(clip);
      return !generatingIds.has(key) && !ttsAbortControllers.current.has(key)
        && (localOverrides[key]?.text ?? clip.text).trim().length > 0;
    });
    if (batchClips.length === 0) {
      crmMessage.warning('当前没有可生成的配音：请填写台词，或等待正在生成的片段完成。');
      return;
    }
    const scope = generationScopeRef.current;
    const existingCount = batchClips.filter(clip => localAudio[clipKey(clip)]?.url || clip.audioUrl).length;
    // Lock before awaiting confirmation so repeated clicks cannot duplicate paid work.
    batchRunningRef.current = true;
    setBatchRunning(true);
    try {
      if (existingCount > 0 && !await crmConfirm({
        title: '确认批量重新生成配音',
        message: `将生成 ${batchClips.length} 段配音，其中 ${existingCount} 段已有音频。将按当前台词和音色重新生成，成功后按规则再次扣除创作点数。是否继续？`,
        confirmText: '确认重新生成',
        cancelText: '取消',
        type: 'warning',
      })) return;
      for (const clip of batchClips) {
        if (generationScopeRef.current !== scope) break;
        await runGenerate(clip);
      }
    } finally {
      if (generationScopeRef.current === scope) {
        batchRunningRef.current = false;
        setBatchRunning(false);
      }
    }
  }, [clips, batchRunning, runGenerate, clipKey, generatingIds, localAudio, localOverrides]);

  const handleClipPersist = useCallback(async (
    clip: AudioClipInfo,
    patch: { speaker?: string; text?: string },
  ) => {
    try {
      await persistAudioSegments(clip.itemId, segments => segments.map(segment => (
        segment.segmentId === clip.clipId
          ? {
            ...segment,
            ...(patch.speaker !== undefined ? { speaker: patch.speaker } : {}),
            ...(patch.text !== undefined ? { text: patch.text } : {}),
          }
          : segment
      )));
    } catch (e) {
      console.error('持久化配音片段失败:', e);
    }
  }, [persistAudioSegments]);

  const createSegmentId = useCallback((itemId: string, kind: StoryboardAudioSegment['kind']) => {
    const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return `${itemId}:${kind}:${suffix}`;
  }, []);

  const handleAddSpeech = useCallback(async (itemId: string) => {
    const speaker = allCharNames.find(name => name !== '旁白') || '旁白';
    await persistAudioSegments(itemId, segments => [
      ...segments,
      {
        segmentId: createSegmentId(itemId, 'speech'),
        kind: 'speech',
        sequenceIndex: segments.length,
        speaker,
        text: '请输入台词',
        audioUrl: null,
        durationMs: null,
        voiceId: null,
      },
    ]);
  }, [allCharNames, createSegmentId, persistAudioSegments]);

  const handleAddSilence = useCallback(async (itemId: string) => {
    await persistAudioSegments(itemId, segments => [
      ...segments,
      {
        segmentId: createSegmentId(itemId, 'silence'),
        kind: 'silence',
        sequenceIndex: segments.length,
        label: '无声动作',
        durationMs: 1000,
      },
    ]);
  }, [createSegmentId, persistAudioSegments]);

  const handleUpdateSilence = useCallback(async (
    itemId: string,
    segmentId: string,
    patch: { label?: string; durationMs?: number },
  ) => {
    await persistAudioSegments(itemId, segments => segments.map(segment => (
      segment.segmentId === segmentId ? { ...segment, ...patch } : segment
    )));
  }, [persistAudioSegments]);

  const handleRemoveSegment = useCallback(async (itemId: string, segmentId: string) => {
    await persistAudioSegments(
      itemId,
      segments => segments.filter(segment => segment.segmentId !== segmentId),
    );
    setLocalOverrides(prev => {
      const next = { ...prev };
      delete next[segmentId];
      return next;
    });
    setLocalAudio(prev => {
      const next = { ...prev };
      delete next[segmentId];
      return next;
    });
  }, [persistAudioSegments, setLocalOverrides]);

  const handleMoveSegment = useCallback(async (
    itemId: string,
    segmentId: string,
    direction: 'up' | 'down',
  ) => {
    await persistAudioSegments(itemId, segments => {
      const ordered = [...segments].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
      const currentIndex = ordered.findIndex(segment => segment.segmentId === segmentId);
      if (currentIndex < 0) return ordered;
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= ordered.length) return ordered;
      [ordered[currentIndex], ordered[targetIndex]] = [ordered[targetIndex], ordered[currentIndex]];
      return ordered;
    });
  }, [persistAudioSegments]);


  const togglePlay = useCallback((key: string) => {
    const existing = audioRefs.current.get(key);
    if (existing && !existing.paused) {
      existing.pause();
      setPlayingKey('');
      return;
    }

    audioRefs.current.forEach((a, k) => { if (k !== key) a.pause(); });

    const audioUrl = localAudio[key]?.url || clips.find(c => clipKey(c) === key)?.audioUrl;
    if (!audioUrl) return;

    let el = audioRefs.current.get(key);
    if (!el) {
      el = new Audio(audioUrl);
      audioRefs.current.set(key, el);
      el.onended = () => setPlayingKey(prev => prev === key ? '' : prev);
    } else {
      el.src = audioUrl;
    }
    el.play().catch(() => {});
    setPlayingKey(key);
  }, [localAudio, clips, clipKey]);


  if (isLoading || storyboardLoading) {
    return (
      <div className="min-h-full bg-n20 flex items-center justify-center text-n100">
        加载中...
      </div>
    );
  }
  if (error || storyboardError) {
    return (
      <div className="min-h-full bg-n20 text-danger p-6">
        {error || storyboardError}
      </div>
    );
  }


  return (
    <div className="workflow-stage-layout h-full bg-n20 text-n800 flex flex-col">
      {/* Header */}
      <header className="workflow-stage-toolbar flex items-center gap-3 px-6 py-3 border-b border-n40 shrink-0">
        <Mic size={20} className="text-primary" />
        <h1 className="text-lg font-bold tracking-tight">声音工作台</h1>
        <div role="tablist" aria-label="声音工作台功能" className="ui-tabs ml-4">
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'dubbing'}
            onClick={() => setWorkspaceMode('dubbing')}
            className="ui-tab"
          >
            <Mic size={15} /> 配音制作
            <span className="ui-tab-count">台词</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'music'}
            onClick={() => setWorkspaceMode('music')}
            className="ui-tab"
          >
            <Music size={15} /> 音乐生成
            <span className="ui-tab-count">BGM / 主题曲</span>
          </button>
        </div>
        <span className="flex-1" />
        <button
          onClick={handleExportToStoryboard}
          disabled={exporting}
          title="把配音字段同步回现有分镜；缺失时才新增"
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-success hover:bg-success text-white text-sm font-semibold transition-all disabled:opacity-60"
        >
          {exporting ? '同步中…' : <>同步到分镜 <ArrowRight size={14} /></>}
        </button>
      </header>

      {/* Main: parallel dubbing and music workspaces */}
      {workspaceMode === 'dubbing' ? (
        <div className="workflow-stage-layout flex flex-1 min-h-0">
          <VoiceSidebar
            assets={assets}
            characterVoices={characterVoices}
            projectId={projectId}
            reload={reload}
          />
          <DubbingPanel
            ref={dubbingRef}
            storyboardItems={resolvedItems}
            clips={clips}
            voiceMap={voiceMap}
            charAssetMap={charAssetMap}
            localOverrides={localOverrides}
            setLocalOverrides={setLocalOverrides}
            localAudio={localAudio}
            generatingIds={generatingIds}
            errors={errors}
            playingKey={playingKey}
            onGenerate={runGenerate}
            onTogglePlay={togglePlay}
            onBatchGenerate={handleBatchGenerate}
            batchRunning={batchRunning}
            allCharNames={allCharNames}
            clipKeyFn={clipKey}
            onClipPersist={handleClipPersist}
            onAddSpeech={handleAddSpeech}
            onAddSilence={handleAddSilence}
            onUpdateSilence={handleUpdateSilence}
            onRemoveSegment={handleRemoveSegment}
            onMoveSegment={handleMoveSegment}
          />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-4 overflow-hidden bg-n20 p-5">
          <MusicAssetSidebar audioTracks={audioTracks} />
          <div className="min-w-0 flex-1 overflow-hidden">
            <MusicModal
              presentation="embedded"
              episodeId={episodeId}
              projectId={projectId}
              script={script}
              onCreated={reloadAudioTracks}
            />
          </div>
        </div>
      )}

      {/* Timeline */}
      <MultiTrackTimeline
        storyboardItems={resolvedItems}
        clips={clips}
        localAudio={localAudio}
        audioTracks={audioTracks}
        clipKeyFn={clipKey}
        onClickItem={(itemId) => dubbingRef.current?.scrollToItem(itemId)}
        episodeId={episodeId}
        projectId={projectId}
        script={script}
        reload={reloadAudioTracks}
        collapsed={timelineCollapsed}
        onCollapsedChange={setTimelineCollapsed}
      />
    </div>
  );
};
