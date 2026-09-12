import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Wand2, MonitorPlay, Zap, Mic2, Volume2, Film, Play, Pause,
  Scissors, Trash2, Music, ZoomIn, ZoomOut, GripHorizontal,
  Maximize, Loader, CheckCircle, Download, RefreshCw, Sparkles, AlignStartVertical,
  Undo2, Redo2, Copy, Magnet, Save, SkipBack, SkipForward, Lock, Unlock, Captions,
} from 'lucide-react';
import { useEpisode } from '../contexts/EpisodeContext';
import type { VideoSegment, StoryboardItemDB, AudioTrack } from '../types';

// All enhancement actions use real GPU tasks and report through videoTaskPoller.
import { submitInterpolateTaskQueued, submitUpscaleTaskQueued, submitVoiceTaskQueued } from '@runtime/videoTaskService';
import {
  DEFAULT_COMPOSE_AUDIO_MODE,
  startCompose,
  getComposeStatus,
  preflightCompose,
  updateVideoSegment,
  type ComposeAudioMode,
  type ComposeStatus,
} from '../services/videoWorkflowService';
import { getStoryboardItems } from '../services/episodeDataService';
import { fetchEpisodeEnhanceFiles, uploadEntityFile, type EntityFile } from '../services/entityFileService';
import { uploadAudio } from '@runtime/videoMediaService';
import { startVideoPoll, attachVideoPollCallbacks, getKnownVideoTaskIds } from '../services/videoTaskPoller';
import { apiFetch, secureApiUrl } from '../services/httpClient';
import { syncTimelineAudioPlayback } from '../utils/enhanceTimelineAudio';
import { resolveAudioTrackTimeline } from '../utils/audioTrackTimeline';
import { ComposeFailureNotice } from '../components/ComposeFailureNotice';
import { SubtitlePreview } from '../components/SubtitlePreview';
import { MusicModal } from '../components/audio/MusicModal';
import { SfxModal } from '../components/audio/SfxModal';
import { buildEnhanceSourceClips as buildCanonicalEnhanceSourceClips, withEntityFileVideoFallbacks, type EnhanceMediaClip } from '../utils/enhanceSourceClips';
import { AudioFadeControls } from '../components/audio/AudioFadeControls';
import { BlackClipControls } from '../components/BlackClipControls';
import { reanchorLinkedAudio } from '../utils/enhanceAudioAnchors';
import {
  DEFAULT_ENHANCE_SUBTITLE_STYLE,
  cloneEnhanceClips,
  composeSubtitleItems,
  composeSubtitleStyle,
  composeTimelineItems,
  deleteTimelineClip,
  duplicateTimelineClip,
  formatTimelineTime,
  layoutVideoClips,
  insertBlackClip,
  moveTimelineClip,
  moveSubtitleCue,
  normalizeEnhanceSubtitleStyle,
  resolveSubtitleCoordinates,
  resolveTimelineSnap,
  restoreEnhanceTimeline,
  restoreEnhanceSubtitles,
  restoreEnhanceSubtitleStyle,
  updateSubtitleCueStyle,
  serializeEnhanceTimeline,
  splitTimelineClip,
  trimTimelineClip,
  trimSubtitleCue,
  type EnhanceSubtitleCue,
  type EnhanceSubtitleStyle,
  type PersistedEnhanceTimelineItem,
} from '../utils/enhanceTimelineEditor';
import { createTimelineTrack, getTimelineTracks, updateTimelineTrack } from '../services/scriptTimelineService';
import {
  clusterNodePreferenceId,
  DEFAULT_GPU_NODE_NAME,
  fetchClusterNodes,
  getPreferredGpuNodeId,
  isClusterNodeUsable,
  setPreferredGpuNodeId,
  type ClusterNodeOption,
} from '@runtime/clusterNodeService';
import { sanitizeProcessingTerminology } from '../utils/processingTerminology';
import { InlineCreditEstimate } from '../components/InlineCreditEstimate';
import { SubtitleTranscriptionModal } from '../components/SubtitleTranscriptionModal';
import { mergeSubtitleResults, subtitleTimelineKey } from '../utils/subtitleTranscription';
import { frameCoalesced, overlapsTimelineWindow, useLatestCallback, useTimelineViewport } from '../hooks/useTimelineViewport';
import { registerEnhanceSave } from '../utils/enhanceTimelinePersistence';

type MediaClip = EnhanceMediaClip;

export const buildEnhanceVideoPosterUrl = enhanceVideoPosterUrl;

interface TimelineHistoryState {
  clips: MediaClip[];
  subtitles: EnhanceSubtitleCue[];
  subtitleStyle: EnhanceSubtitleStyle;
}

const ENHANCE_TIMELINE_TRACK_NAME = '优化合成时间线';

type EnhancementKind = 'dub' | 'upscale' | 'interpolate' | 'lipSync';

function secureMediaUrl(url: string): string {
  if (!url) return url;
  return secureApiUrl(url, { requireAuth: false });
}

export function enhanceVideoPosterUrl(videoUrl: string): string {
  videoUrl = String(videoUrl || '').trim();
  if (!videoUrl) return '';
  return secureMediaUrl(
    `/api/thumbnail?url=${encodeURIComponent(videoUrl)}&width=640&height=360`,
  );
}

const ENHANCE_OPTIONS: { kind: EnhancementKind; label: string; desc: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
  { kind: 'upscale', label: '高清放大', desc: '提升至 4K 画质', Icon: Maximize },
  { kind: 'interpolate', label: '智能补帧', desc: '提升至 60 FPS', Icon: Zap },
  { kind: 'lipSync', label: '对口型', desc: '与音频轨道对齐', Icon: Mic2 },
  { kind: 'dub', label: '配音', desc: '对白 / 旁白合成', Icon: Volume2 },
];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function cloneTimelineHistoryState(state: TimelineHistoryState): TimelineHistoryState {
  return {
    clips: cloneEnhanceClips(state.clips),
    subtitles: state.subtitles.map(cue => ({ ...cue })),
    subtitleStyle: { ...state.subtitleStyle },
  };
}

function normalizeStoryboardAudioItem(r: any): StoryboardItemDB {
  return {
    itemId: r.item_id ?? r.itemId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    sortOrder: typeof (r.sort_order ?? r.sortOrder) === 'number' ? (r.sort_order ?? r.sortOrder) : 0,
    sceneHeading: '',
    actionText: '',
    dialogue: r.dialogue ?? '',
    cameraMovement: '',
    imagePrompt: '',
    videoPrompt: '',
    generatedImageUrl: r.generated_image_url ?? r.generatedImageUrl ?? null,
    boundAssets: [],
    status: r.status ?? 'draft',
    dialogueAudioUrl: r.dialogue_audio_url ?? r.dialogueAudioUrl ?? null,
    narrationAudioUrl: r.narration_audio_url ?? r.narrationAudioUrl ?? null,
    sfxAudioUrl: r.sfx_audio_url ?? r.sfxAudioUrl ?? null,
    mixedAudioUrl: r.mixed_audio_url ?? r.mixedAudioUrl ?? null,
    audioDurationMs: r.audio_duration_ms ?? r.audioDurationMs ?? null,
    plannedDurationMs: r.planned_duration_ms ?? r.plannedDurationMs ?? null,
  } as StoryboardItemDB;
}

function itemSort(item: StoryboardItemDB & Record<string, any>): number {
  return Number(item.sortOrder ?? item.sort_order) || 0;
}

export function buildEnhanceSourceClips(
  videoSegments: VideoSegment[], storyboardAudioItems: StoryboardItemDB[], audioTracks: AudioTrack[],
  editorItems?: PersistedEnhanceTimelineItem[],
): MediaClip[] {
  return buildCanonicalEnhanceSourceClips(videoSegments, storyboardAudioItems, audioTracks, secureMediaUrl, editorItems)
    .map(clip => clip.type === 'video' ? { ...clip, thumbnailUrl: enhanceVideoPosterUrl(clip.url) } : clip);
}

function mergeSourceClips(prev: MediaClip[], source: MediaClip[]): MediaClip[] {
  if (prev.length === 0) return source;
  const prevById = new Map(prev.map(clip => [clip.id, clip]));
  const sourceIds = new Set(source.map(clip => clip.id));
  const merged = source.map(clip => {
    const existing = prevById.get(clip.id);
    if (!existing) return clip;
    return {
      ...clip,
      startTime: existing.startTime,
      sourceOffset: existing.sourceOffset,
      duration: existing.duration,
      volume: existing.volume,
      fadeIn: existing.fadeIn,
      fadeOut: existing.fadeOut,
      settings: existing.settings ?? clip.settings,
    };
  });
  const manualClips = prev.filter(clip => !sourceIds.has(clip.id) && (/^aud_\d+/.test(clip.id) || clip.id.startsWith('aud_actor_') || clip.id.includes('_s_')));
  return [...merged, ...manualClips];
}

export const EnhancePage: React.FC = () => {
  const { videoSegments, audioTracks, isLoading, error, reload, loadSlices, forceReloadSlicesQuiet, projectId, episodeId, selectedScriptId } = useEpisode();
  const [storyboardAudioItems, setStoryboardAudioItems] = useState<StoryboardItemDB[]>([]);
  const [segmentFiles, setSegmentFiles] = useState<EntityFile[]>([]);
  const [segmentFilesReady, setSegmentFilesReady] = useState(false);
  const [storyboardAudioLoaded, setStoryboardAudioLoaded] = useState(false);
  const [storyboardAudioReloadKey, setStoryboardAudioReloadKey] = useState(0);
  const segmentVideoFallbacks = useMemo(() => Object.fromEntries(
    segmentFiles.filter(file => file.fileRole === 'video' && file.entityId && file.fileUrl)
      .map(file => [file.entityId!, file.fileUrl]),
  ), [segmentFiles]);

  useEffect(() => {
    loadSlices('videoSegments', 'audioTracks');
  }, [loadSlices]);

  useEffect(() => {
    let active = true;
    if (videoSegments.length === 0) {
      setSegmentFiles([]);
      setSegmentFilesReady(true);
      return () => { active = false; };
    }
    setSegmentFilesReady(false);
    if (episodeId) void fetchEpisodeEnhanceFiles(episodeId).then(files => {
      if (active) {
        setSegmentFiles(files);
        setSegmentFilesReady(true);
      }
    }).catch(err => {
      console.warn('[EnhancePage] segment media load failed:', err);
      if (active) setEnhanceError('素材信息加载失败，请点击刷新重试。');
    });
    return () => { active = false; };
  }, [episodeId, videoSegments]);

  useEffect(() => {
    let active = true;
    setStoryboardAudioLoaded(false);
    if (!episodeId) {
      setStoryboardAudioItems([]);
      setStoryboardAudioLoaded(true);
      return () => { active = false; };
    }
    getStoryboardItems(episodeId, selectedScriptId || undefined, { fields: 'audio' })
      .then(res => {
        if (!active) return;
        setStoryboardAudioItems(res.success ? (res.items || []).map(normalizeStoryboardAudioItem) : []);
      })
      .catch(err => {
        console.warn('storyboard audio fields load failed:', err);
        if (active) setStoryboardAudioItems([]);
      })
      .finally(() => {
        if (active) setStoryboardAudioLoaded(true);
      });
    return () => { active = false; };
  }, [episodeId, selectedScriptId, storyboardAudioReloadKey]);

  const reloadEnhanceData = useCallback(() => {
    setStoryboardAudioReloadKey(key => key + 1);
    void forceReloadSlicesQuiet('videoSegments', 'audioTracks');
  }, [forceReloadSlicesQuiet]);

  const [scale, setScale] = useState(20);
  const [currentTime, setCurrentTime] = useState(0);
  const [clips, setClips] = useState<MediaClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<EnhanceSubtitleCue[]>([]);
  const [subtitleStyle, setSubtitleStyle] = useState<EnhanceSubtitleStyle>(DEFAULT_ENHANCE_SUBTITLE_STYLE);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapGuide, setSnapGuide] = useState<number | null>(null);
  const [timelineReady, setTimelineReady] = useState(false);
  const [timelineRevision, setTimelineRevision] = useState(0);
  const timelineRevisionRef = useRef(0);
  const [timelineSaveState, setTimelineSaveState] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [trackState, setTrackState] = useState<Record<'video' | 'voice' | 'bgm' | 'sfx', { locked: boolean }>>({
    video: { locked: false },
    voice: { locked: false },
    bgm: { locked: false },
    sfx: { locked: false },
  });
  const [showMusicModal, setShowMusicModal] = useState(false);
  const [showSfxModal, setShowSfxModal] = useState(false);
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);

  useEffect(() => {
    timelineRevisionRef.current = timelineRevision;
  }, [timelineRevision]);

  const [enhancementKind, setEnhancementKind] = useState<EnhancementKind>('upscale');
  const [targetResolution, setTargetResolution] = useState<'720p' | '1080p' | '4K'>('1080p');
  const [targetFps, setTargetFps] = useState<30 | 60 | 120>(60);
  const [dubVoiceStyle, setDubVoiceStyle] = useState<'neutral' | 'dramatic' | 'soft'>('neutral');
  const [composeAudioMode, setComposeAudioMode] = useState<ComposeAudioMode>(DEFAULT_COMPOSE_AUDIO_MODE);
  const [lipSyncAudioClipId, setLipSyncAudioClipId] = useState<string>('');
  const [audioUploading, setAudioUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [processStage, setProcessStage] = useState('处理集群正在执行，可能需要数分钟');
  const [enhanceError, setEnhanceError] = useState('');
  const [enhanceNotice, setEnhanceNotice] = useState('');
  // All enhancement modes are dispatched through a selected GPU Agent.
  const [clusterNodes, setClusterNodes] = useState<ClusterNodeOption[]>([]);
  const [clusterNodesLoading, setClusterNodesLoading] = useState(false);
  const [clusterNodeMessage, setClusterNodeMessage] = useState('');
  const [selectedClusterNodeId, setSelectedClusterNodeId] = useState(getPreferredGpuNodeId);
  const selectedClusterNode = useMemo(() => {
    const selectedKey = selectedClusterNodeId.trim().toLowerCase();
    return clusterNodes.find(node => (
      [node.id, node.nodeId, node.agentId, node.name, node.routingName]
        .filter(Boolean)
        .some(value => String(value).trim().toLowerCase() === selectedKey)
    ));
  }, [clusterNodes, selectedClusterNodeId]);
  const selectedClusterNodeUsable = Boolean(selectedClusterNode && isClusterNodeUsable(selectedClusterNode));
  const loadClusterNodes = useCallback(async () => {
    setClusterNodesLoading(true);
    try {
      const result = await fetchClusterNodes();
      setClusterNodes(result.nodes);
      setClusterNodeMessage(result.message);
      const usableNodes = result.nodes.filter(isClusterNodeUsable);
      const requested = getPreferredGpuNodeId().trim().toLowerCase();
      const requestedNode = result.nodes.find(node => (
        [node.id, node.nodeId, node.agentId, node.name, node.routingName]
          .filter(Boolean)
          .some(value => String(value).trim().toLowerCase() === requested)
      ));
      const fallback = usableNodes.find(node => (
        node.routingName === DEFAULT_GPU_NODE_NAME || node.name === DEFAULT_GPU_NODE_NAME
      )) || usableNodes[0];
      const nextNode = requestedNode || fallback;
      if (nextNode) {
        const stableId = clusterNodePreferenceId(nextNode);
        setSelectedClusterNodeId(stableId);
        setPreferredGpuNodeId(stableId);
      }
    } catch (error) {
      console.warn('[EnhancePage] cluster nodes unavailable:', error);
      setClusterNodes([]);
      setClusterNodeMessage('处理集群节点状态获取失败，请刷新重试。');
    } finally {
      setClusterNodesLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadClusterNodes();
  }, [loadClusterNodes]);


  const [compose, setCompose] = useState<ComposeStatus | null>(null);
  const composeTimerRef = useRef<number | null>(null);
  const composeScopeRef = useRef<string | null>(episodeId);
  useEffect(() => {
    composeScopeRef.current = episodeId;
    return () => {
      composeScopeRef.current = null;
      if (composeTimerRef.current) clearTimeout(composeTimerRef.current);
    };
  }, [episodeId]);
  const pollCompose = useCallback(() => {
    if (!episodeId) return;
    getComposeStatus(episodeId).then(s => {
      if (composeScopeRef.current !== episodeId) return;
      setCompose(s);
      if (s.status === 'running') composeTimerRef.current = window.setTimeout(pollCompose, 4000);
    }).catch(() => {});
  }, [episodeId]);
  useEffect(() => () => { if (composeTimerRef.current) clearTimeout(composeTimerRef.current); }, []);

  useEffect(() => {
    if (!episodeId) return;
    getComposeStatus(episodeId).then(s => {
      if (composeScopeRef.current !== episodeId) return;
      if (s.status && s.status !== 'idle') {
        setCompose(s);
        // A completed legacy job must not override the safer default for the next compose.
        // While a job is running, show the mode that job is actually using.
        if (s.status === 'running' && s.audio_mode) setComposeAudioMode(s.audio_mode);
        if (s.status === 'running') composeTimerRef.current = window.setTimeout(pollCompose, 3000);
      }
    }).catch(() => {});
  }, [episodeId]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [previewSourceSize, setPreviewSourceSize] = useState({ width: 1920, height: 1080 });
  const audioElementRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const playTimerRef = useRef<number | null>(null);
  const clipScopeRef = useRef('');
  const persistedTimelineItemsRef = useRef<PersistedEnhanceTimelineItem[] | null>(null);
  const timelineTrackIdRef = useRef<string | null>(null);
  const timelineSaveInFlightRef = useRef<Promise<void> | null>(null);
  const savedRevisionRef = useRef(0);
  const knownAudioSourcesRef = useRef<string[]>([]);
  const clipsRef = useRef<MediaClip[]>([]);
  const subtitlesRef = useRef<EnhanceSubtitleCue[]>([]);
  const subtitleStyleRef = useRef<EnhanceSubtitleStyle>(DEFAULT_ENHANCE_SUBTITLE_STYLE);
  const undoStackRef = useRef<TimelineHistoryState[]>([]);
  const redoStackRef = useRef<TimelineHistoryState[]>([]);

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  useEffect(() => {
    subtitlesRef.current = subtitles;
  }, [subtitles]);

  useEffect(() => {
    subtitleStyleRef.current = subtitleStyle;
  }, [subtitleStyle]);

  useEffect(() => {
    let active = true;
    setTimelineReady(false);
    let loaded = false;
    timelineTrackIdRef.current = null;
    setTimelineSaveState('saved');
    persistedTimelineItemsRef.current = null;
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoCount(0);
    setRedoCount(0);
    if (!episodeId) {
      setTimelineReady(true);
      return () => { active = false; };
    }
    getTimelineTracks(episodeId)
      .then(response => {
        if (!active) return;
        if (response?.success === false) throw new Error('时间线读取失败');
        const tracks = Array.isArray(response?.tracks) ? response.tracks : [];
        const track = tracks.find((item: any) => (
          (item.track_name ?? item.trackName) === ENHANCE_TIMELINE_TRACK_NAME
        ));
        if (track) {
          const trackId = String(track.track_id ?? track.trackId ?? '');
          timelineTrackIdRef.current = trackId;
          persistedTimelineItemsRef.current = Array.isArray(track.items)
            ? track.items as PersistedEnhanceTimelineItem[]
            : [];
        }
        loaded = true;
      })
      .catch(error => {
        console.warn('[EnhancePage] timeline load failed:', error);
        setTimelineSaveState('error');
      })
      .finally(() => {
        if (active && loaded) setTimelineReady(true);
      });
    return () => { active = false; };
  }, [episodeId]);

  const enhanceVideoSegments = useMemo(
    () => withEntityFileVideoFallbacks(videoSegments, segmentVideoFallbacks),
    [videoSegments, segmentVideoFallbacks],
  );

  useEffect(() => {
    if (!storyboardAudioLoaded || !timelineReady || !segmentFilesReady) return;
    const draft = persistedTimelineItemsRef.current;
    const sourceClips = buildEnhanceSourceClips(enhanceVideoSegments, storyboardAudioItems, audioTracks, draft || undefined);
    const activeCuts = (draft ? restoreEnhanceTimeline(sourceClips, draft) : sourceClips).filter(c => c.type === 'video' && !c.isBlack);
    for (const file of segmentFiles.filter(f => f.fileRole === 'actor_dubbing')) {
      activeCuts.filter(c => (c.sourceId || c.id) === file.entityId).forEach((cut, index) => {
        sourceClips.push({ id: `aud_actor_${file.fileId}${index ? `_cut_${cut.id}` : ''}`,
          anchorVideoClipId: cut.id, url: secureMediaUrl(file.fileUrl), startTime: cut.startTime,
          duration: cut.duration, sourceOffset: cut.sourceOffset, type: 'audio',
          sourceLabel: '演员录音', audioKind: 'voice', volume: 1 });
      });
    }
    knownAudioSourcesRef.current = sourceClips.filter(c => c.type === 'audio').map(c => c.sourceId || c.id);
    if (sourceClips.length === 0) {
      setClips([]);
      setSubtitles(draft ? restoreEnhanceSubtitles(draft) : []);
      setSubtitleStyle(draft ? restoreEnhanceSubtitleStyle(draft) : DEFAULT_ENHANCE_SUBTITLE_STYLE);
      return;
    }
    setClips(prev => {
      const merged = mergeSourceClips(prev, sourceClips);
      if (!draft) return merged;
      const manualAudio = merged.filter(clip => clip.type === 'audio' && !sourceClips.some(source => source.id === clip.id));
      return restoreEnhanceTimeline([...sourceClips, ...manualAudio], draft);
    });
    setSubtitles(draft ? restoreEnhanceSubtitles(draft) : []);
    setSubtitleStyle(draft ? restoreEnhanceSubtitleStyle(draft) : DEFAULT_ENHANCE_SUBTITLE_STYLE);
    setSelectedClipId(prev => {
      const availableIds = new Set([
        ...sourceClips.map(clip => clip.id),
        ...(persistedTimelineItemsRef.current || [])
          .filter(item => item.kind === 'video')
          .map(item => item.clipId)
          .filter(Boolean),
      ]);
      if (prev && availableIds.has(prev)) return prev;
      const draftFirstId = persistedTimelineItemsRef.current?.find(item => item.kind === 'video')?.clipId;
      return draftFirstId ?? sourceClips.find(c => c.type === 'video')?.id ?? sourceClips[0]?.id ?? null;
    });
  }, [enhanceVideoSegments, storyboardAudioItems, audioTracks, segmentFiles, storyboardAudioLoaded, timelineReady, segmentFilesReady, episodeId]);

  useEffect(() => {
    const scope = episodeId || '';
    if (clipScopeRef.current && clipScopeRef.current !== scope) {
      setClips([]);
      setSelectedClipId(null);
      setSubtitles([]);
      setSubtitleStyle(DEFAULT_ENHANCE_SUBTITLE_STYLE);
      setSelectedSubtitleId(null);
      setCurrentTime(0);
      setPlaying(false);
      persistedTimelineItemsRef.current = null;
    }
    clipScopeRef.current = scope;
  }, [episodeId]);

  const videoClips = useMemo(() => clips.filter(c => c.type === 'video'), [clips]);
  const orderedVideoClips = useMemo(
    () => videoClips.slice().sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id)),
    [videoClips],
  );
  const audioClips = useMemo(() => clips.filter(c => c.type === 'audio'), [clips]);
  const voiceClips = useMemo(() => audioClips.filter(c => (c.audioKind || 'voice') === 'voice'), [audioClips]);
  const bgmClips = useMemo(() => audioClips.filter(c => c.audioKind === 'bgm'), [audioClips]);
  const sfxClips = useMemo(() => audioClips.filter(c => c.audioKind === 'sfx'), [audioClips]);
  const selectedClip = clips.find(c => c.id === selectedClipId);
  const selectedVideoIndex = selectedClip?.type === 'video'
    ? orderedVideoClips.findIndex(clip => clip.id === selectedClip.id)
    : -1;
  const hasFollowingVideo = selectedVideoIndex >= 0 && selectedVideoIndex < orderedVideoClips.length - 1;
  const selectedTransitionMaxDuration = selectedClip?.type === 'video'
    ? Math.max(0.1, Math.min(
        3,
        selectedClip.transitionAfter === 'fade' ? selectedClip.duration / 2 : 3,
        selectedClip.transitionAfter === 'fade' && hasFollowingVideo
          ? orderedVideoClips[selectedVideoIndex + 1].duration / 2
          : 3,
      ))
    : 3;
  const selectedSubtitle = subtitles.find(cue => cue.id === selectedSubtitleId);
  const selectedSubtitleStyle = normalizeEnhanceSubtitleStyle(selectedSubtitle?.style);
  const activeSubtitles = useMemo(() => subtitles.filter(cue => (
    cue.text.trim()
      && currentTime >= cue.startTime
      && currentTime < cue.startTime + cue.duration
  )), [currentTime, subtitles]);
  const videoUnderPlayhead = orderedVideoClips.find(
    c => currentTime >= c.startTime && currentTime < c.startTime + c.duration
  );
  const blackTransitionUnderPlayhead = orderedVideoClips.some((clip, index) => (
    clip.transitionAfter === 'black'
      && index < orderedVideoClips.length - 1
      && currentTime >= clip.startTime + clip.duration
      && currentTime < orderedVideoClips[index + 1].startTime
  ));
  const videoTransitionOpacity = useMemo(() => {
    if (!videoUnderPlayhead) return 1;
    const index = orderedVideoClips.findIndex(clip => clip.id === videoUnderPlayhead.id);
    if (index < 0) return 1;
    const elapsed = currentTime - videoUnderPlayhead.startTime;
    const remaining = videoUnderPlayhead.duration - elapsed;
    let opacity = 1;
    const previous = index > 0 ? orderedVideoClips[index - 1] : undefined;
    if (previous?.transitionAfter === 'fade') {
      const duration = Math.max(0.1, Math.min(previous.transitionDuration || 0.5, videoUnderPlayhead.duration / 2));
      opacity = Math.min(opacity, elapsed / duration);
    }
    if (videoUnderPlayhead.transitionAfter === 'fade' && index < orderedVideoClips.length - 1) {
      const duration = Math.max(0.1, Math.min(videoUnderPlayhead.transitionDuration || 0.5, videoUnderPlayhead.duration / 2));
      opacity = Math.min(opacity, remaining / duration);
    }
    return Math.max(0, Math.min(1, opacity));
  }, [currentTime, orderedVideoClips, videoUnderPlayhead]);

  useEffect(() => {
    if (lipSyncAudioClipId && audioClips.some(clip => clip.id === lipSyncAudioClipId)) return;
    const activeAudio = audioClips.find(
      clip => currentTime >= clip.startTime && currentTime <= clip.startTime + clip.duration,
    ) || audioClips[0];
    setLipSyncAudioClipId(activeAudio?.id || '');
  }, [audioClips, currentTime, lipSyncAudioClipId]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !videoUnderPlayhead?.url) return;
    const target = Math.max(0, currentTime - videoUnderPlayhead.startTime + videoUnderPlayhead.sourceOffset);
    if (!playing || Math.abs(video.currentTime - target) > 0.75) {
      try { video.currentTime = Number.isFinite(video.duration)
        ? Math.min(target, Math.max(0, video.duration - 0.05)) : target; } catch {}
    }
    if (playing) void video.play().catch(() => setPlaying(false));
    else video.pause();
  }, [playing, currentTime, videoUnderPlayhead?.id, videoUnderPlayhead?.url, videoUnderPlayhead?.startTime, videoUnderPlayhead?.duration, videoUnderPlayhead?.sourceOffset]);

  useEffect(() => {
    void syncTimelineAudioPlayback({
      clips: audioClips.map(clip => ({
        id: clip.id,
        startTime: clip.startTime,
        duration: clip.duration,
        sourceOffset: clip.sourceOffset,
        volume: clip.volume,
        fadeIn: clip.fadeIn,
        fadeOut: clip.fadeOut,
        enabled: composeAudioMode === 'reference_dubbing' || clip.audioKind !== 'voice',
      })),
      audioElements: audioElementRefs.current,
      currentTime,
      playing,
    }).catch(() => {});
  }, [audioClips, currentTime, playing, composeAudioMode]);

  const videoDuration = useMemo(
    () => Math.max(0, ...videoClips.map(c => c.startTime + c.duration)),
    [videoClips],
  );
  const totalDuration = useMemo(
    () => Math.max(
      10,
      videoDuration,
      ...clips.map(c => c.startTime + c.duration),
      ...subtitles.map(cue => cue.startTime + cue.duration),
    ),
    [clips, subtitles, videoDuration]
  );

  useEffect(() => {
    if (!playing) {
      if (playTimerRef.current !== null) clearInterval(playTimerRef.current);
      playTimerRef.current = null;
      previewVideoRef.current?.pause();
      return;
    }
    let previousTick = performance.now();
    playTimerRef.current = window.setInterval(() => {
      const now = performance.now();
      const elapsed = (now - previousTick) / 1000;
      previousTick = now;
      setCurrentTime(prev => {
        const next = prev + elapsed;
        if (next >= totalDuration) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
    }, 100);
    return () => {
      if (playTimerRef.current !== null) clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    };
  }, [playing, totalDuration]);
  const knownVideoSourceIds = useMemo(
    () => enhanceVideoSegments
      .filter(segment => Boolean(segment.segmentId && segment.videoUrl))
      .map(segment => segment.segmentId),
    [enhanceVideoSegments],
  );

  const markTimelineChanged = useCallback((next: TimelineHistoryState) => {
    const normalizedStyle = normalizeEnhanceSubtitleStyle(next.subtitleStyle);
    clipsRef.current = next.clips;
    subtitlesRef.current = next.subtitles;
    subtitleStyleRef.current = normalizedStyle;
    persistedTimelineItemsRef.current = serializeEnhanceTimeline(
      next.clips,
      knownVideoSourceIds,
      next.subtitles,
      normalizedStyle,
      knownAudioSourcesRef.current,
    );
    setClips(next.clips);
    setSubtitles(next.subtitles);
    setSubtitleStyle(normalizedStyle);
    setTimelineSaveState('unsaved');
    timelineRevisionRef.current += 1;
    setTimelineRevision(timelineRevisionRef.current);
  }, [knownVideoSourceIds]);

  const commitTimeline = useCallback((update: (current: MediaClip[]) => MediaClip[]) => {
    const current: TimelineHistoryState = {
      clips: cloneEnhanceClips(clipsRef.current),
      subtitles: subtitlesRef.current.map(cue => ({ ...cue })),
      subtitleStyle: { ...subtitleStyleRef.current },
    };
    const nextClips = reanchorLinkedAudio(current.clips, update(cloneEnhanceClips(current.clips)));
    if (JSON.stringify(nextClips) === JSON.stringify(current.clips)) return false;
    undoStackRef.current = [...undoStackRef.current.slice(-79), current];
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
    markTimelineChanged({ ...current, clips: nextClips });
    return true;
  }, [markTimelineChanged]);

  const commitSubtitleTimeline = useCallback((
    update: (current: Pick<TimelineHistoryState, 'subtitles' | 'subtitleStyle'>) => Pick<TimelineHistoryState, 'subtitles' | 'subtitleStyle'>,
  ) => {
    const current: TimelineHistoryState = {
      clips: cloneEnhanceClips(clipsRef.current),
      subtitles: subtitlesRef.current.map(cue => ({ ...cue })),
      subtitleStyle: { ...subtitleStyleRef.current },
    };
    const nextSubtitleState = update({
      subtitles: current.subtitles.map(cue => ({ ...cue })),
      subtitleStyle: { ...current.subtitleStyle },
    });
    const next = { ...current, ...nextSubtitleState };
    if (JSON.stringify(nextSubtitleState) === JSON.stringify({
      subtitles: current.subtitles,
      subtitleStyle: current.subtitleStyle,
    })) return false;
    undoStackRef.current = [...undoStackRef.current.slice(-79), current];
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
    markTimelineChanged(next);
    return true;
  }, [markTimelineChanged]);

  const commitPreviewTimeline = useCallback((before: MediaClip[]) => {
    const current = reanchorLinkedAudio(before, clipsRef.current);
    if (JSON.stringify(before) === JSON.stringify(current)) return;
    undoStackRef.current = [...undoStackRef.current.slice(-79), {
      clips: cloneEnhanceClips(before),
      subtitles: subtitlesRef.current.map(cue => ({ ...cue })),
      subtitleStyle: { ...subtitleStyleRef.current },
    }];
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
    markTimelineChanged({
      clips: current,
      subtitles: subtitlesRef.current,
      subtitleStyle: subtitleStyleRef.current,
    });
  }, [markTimelineChanged]);

  const commitPreviewSubtitles = useCallback((before: EnhanceSubtitleCue[]) => {
    const current = subtitlesRef.current;
    if (JSON.stringify(before) === JSON.stringify(current)) return;
    undoStackRef.current = [...undoStackRef.current.slice(-79), {
      clips: cloneEnhanceClips(clipsRef.current),
      subtitles: before.map(cue => ({ ...cue })),
      subtitleStyle: { ...subtitleStyleRef.current },
    }];
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
    markTimelineChanged({
      clips: clipsRef.current,
      subtitles: current,
      subtitleStyle: subtitleStyleRef.current,
    });
  }, [markTimelineChanged]);

  const undoTimeline = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(cloneTimelineHistoryState({
      clips: clipsRef.current,
      subtitles: subtitlesRef.current,
      subtitleStyle: subtitleStyleRef.current,
    }));
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    markTimelineChanged(cloneTimelineHistoryState(previous));
  }, [markTimelineChanged]);

  const redoTimeline = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(cloneTimelineHistoryState({
      clips: clipsRef.current,
      subtitles: subtitlesRef.current,
      subtitleStyle: subtitleStyleRef.current,
    }));
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    markTimelineChanged(cloneTimelineHistoryState(next));
  }, [markTimelineChanged]);

  const saveTimelineNow = useCallback(async () => {
    if (!episodeId || !timelineReady) return;
    const revision = timelineRevisionRef.current;
    const items = serializeEnhanceTimeline(
      clipsRef.current,
      knownVideoSourceIds,
      subtitlesRef.current,
      subtitleStyleRef.current,
      knownAudioSourcesRef.current,
    );
    persistedTimelineItemsRef.current = items;
    setTimelineSaveState('saving');
    const saveTask = (timelineSaveInFlightRef.current || Promise.resolve()).catch(() => {}).then(async () => {
      if (timelineTrackIdRef.current) {
        const response = await updateTimelineTrack(timelineTrackIdRef.current, { items });
        if (response?.success === false) throw new Error('时间线保存失败，请重试');
        return;
      }
      const response = await createTimelineTrack(episodeId, {
        track_type: 'video',
        track_name: ENHANCE_TIMELINE_TRACK_NAME,
        sort_order: 0,
        items,
      });
      const createdId = String(response?.track?.track_id ?? response?.track?.trackId ?? '');
      if (createdId) {
        timelineTrackIdRef.current = createdId;
      } else throw new Error('服务器未返回时间线记录，请重试保存');
    });
    timelineSaveInFlightRef.current = saveTask;
    registerEnhanceSave(episodeId, saveTask);
    try {
      await saveTask;
      savedRevisionRef.current = revision;
      setTimelineSaveState(revision === timelineRevisionRef.current ? 'saved' : 'unsaved');
    } catch (saveError) {
      console.warn('[EnhancePage] timeline save failed:', saveError);
      setTimelineSaveState('error');
      throw saveError;
    } finally {
      if (timelineSaveInFlightRef.current === saveTask) {
        timelineSaveInFlightRef.current = null;
      }
    }
  }, [episodeId, knownVideoSourceIds, timelineReady]);

  const flushTimelineRef = useRef(saveTimelineNow);
  flushTimelineRef.current = saveTimelineNow;
  useEffect(() => () => {
    if (timelineRevisionRef.current > savedRevisionRef.current) void flushTimelineRef.current().catch(() => {});
  }, []);

  useEffect(() => {
    if (timelineRevision <= 0 || !episodeId || !timelineReady) return;
    const timer = window.setTimeout(() => {
      void saveTimelineNow().catch(() => {});
    }, 800);
    return () => window.clearTimeout(timer);
  }, [episodeId, saveTimelineNow, timelineReady, timelineRevision]);

  const handleCompose = useCallback(async () => {
    if (!episodeId) { alert('未找到当前集'); return; }
    const timeline = composeTimelineItems(clipsRef.current);
    if (timeline.length === 0) { alert('时间线上没有可合成的视频片段'); return; }
    const subtitleItems = composeSubtitleItems(subtitlesRef.current);
    try {
      const preflight = await preflightCompose(episodeId, timeline);
      const validatedTimeline = preflight.timeline;
      if (preflight.corrected) {
        const byId = new Map(validatedTimeline.map(item => [item.clip_id, item]));
        const correctedClips = layoutVideoClips(clipsRef.current.map(clip => {
          if (clip.type !== 'video') return clip;
          const validated = byId.get(clip.id);
          return validated ? {
            ...clip,
            duration: validated.duration_ms / 1000,
            sourceDuration: (validated.source_duration_ms || validated.duration_ms) / 1000,
          } : clip;
        }));
        markTimelineChanged({
          clips: correctedClips,
          subtitles: subtitlesRef.current,
          subtitleStyle: subtitleStyleRef.current,
        });
      }
      await saveTimelineNow();
      const s = await startCompose(
        episodeId,
        undefined,
        composeAudioMode,
        validatedTimeline,
        subtitleItems,
        composeSubtitleStyle(subtitleStyleRef.current),
      );
      setCompose({ ...s, status: (s.status as any) || 'running' });
      if (composeTimerRef.current) clearTimeout(composeTimerRef.current);
      composeTimerRef.current = window.setTimeout(pollCompose, 3000);
    } catch (e: any) {
      setCompose({ status: 'failed', total: 0, done: 0, error: e?.message || '启动失败' });
    }
  }, [episodeId, pollCompose, composeAudioMode, saveTimelineNow, markTimelineChanged]);

  const modalScript = useMemo(() => ({
    adaptedScript: storyboardAudioItems
      .slice()
      .sort((a, b) => itemSort(a as StoryboardItemDB & Record<string, any>) - itemSort(b as StoryboardItemDB & Record<string, any>))
      .map(item => item.dialogue || '')
      .filter(Boolean)
      .join('\n'),
  }), [storyboardAudioItems]);

  const togglePlay = useCallback(() => {
    setPlaying(value => !value);
  }, []);

  const handleAudioUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    setAudioUploading(true);
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const audio = new Audio(previewUrl);
        audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 5);
        audio.onerror = () => reject(new Error('无法读取录音时长'));
      });
      const targetVideo = videoClips.find(clip => clip.id === selectedClipId) || videoUnderPlayhead || videoClips[0];
      const entityId = targetVideo?.id || episodeId || '';
      if (!entityId) throw new Error('请先选择一个视频片段');

      const [saved, uploaded] = await Promise.all([
        uploadEntityFile(
          file,
          targetVideo ? 'video_segment' : 'episode',
          entityId,
          'actor_dubbing',
          episodeId || undefined,
        ),
        uploadAudio(file, 0, Math.max(1, Math.ceil(duration))),
      ]);
      const newClip: MediaClip = {
        id: `aud_actor_${saved.fileId || Date.now()}`,
        url: secureMediaUrl(saved.fileUrl),
        startTime: targetVideo?.startTime ?? currentTime,
        duration,
        sourceOffset: 0,
        type: 'audio',
        comfyFilename: uploaded.filename,
        sourceLabel: '演员录音',
        audioKind: 'voice',
        volume: 1,
      };
      setClips(prev => [...prev, newClip]);
      setLipSyncAudioClipId(newClip.id);
      setEnhancementKind(current => current === 'dub' ? 'dub' : 'lipSync');
    } catch (uploadError: any) {
      alert(`上传演员录音失败：${uploadError?.message || uploadError}`);
    } finally {
      URL.revokeObjectURL(previewUrl);
      setAudioUploading(false);
    }
  }, [currentTime, episodeId, selectedClipId, videoClips, videoUnderPlayhead]);

  const ensureGpuAudioFilename = useCallback(async (clip: MediaClip): Promise<string> => {
    if (clip.comfyFilename) return clip.comfyFilename;
    const response = await apiFetch(clip.url, { credentials: 'include' }, {
      apiName: 'loadLipSyncAudio',
      requireAuth: false,
      includeContentType: false,
    });
    if (!response.ok) throw new Error(`无法读取所选音频（HTTP ${response.status}）`);
    const blob = await response.blob();
    const extension = blob.type.includes('wav') ? 'wav' : blob.type.includes('mpeg') ? 'mp3' : 'audio';
    const file = new File([blob], `lip-sync-${Date.now()}.${extension}`, {
      type: blob.type || 'audio/mpeg',
    });
    const uploaded = await uploadAudio(file, 0, Math.max(1, Math.ceil(clip.duration)));
    setClips(prev => prev.map(item => item.id === clip.id ? { ...item, comfyFilename: uploaded.filename } : item));
    return uploaded.filename;
  }, []);

  const handleSplit = useCallback(() => {
    if (!selectedClipId) return;
    const clip = clipsRef.current.find(item => item.id === selectedClipId);
    if (!clip) return;
    const trackKey = clip.type === 'video' ? 'video' : (clip.audioKind || 'voice');
    if (trackState[trackKey].locked) return;
    const nextId = `${clip.sourceId || clip.id}_cut_${Date.now()}`;
    if (commitTimeline(current => splitTimelineClip(current, selectedClipId, currentTime, nextId))) {
      setSelectedClipId(nextId);
    }
  }, [commitTimeline, currentTime, selectedClipId, trackState]);

  const handleDelete = useCallback(() => {
    if (selectedSubtitleId) {
      commitSubtitleTimeline(current => ({
        ...current,
        subtitles: current.subtitles.filter(cue => cue.id !== selectedSubtitleId),
      }));
      setSelectedSubtitleId(null);
      return;
    }
    if (!selectedClipId) return;
    const clip = clipsRef.current.find(item => item.id === selectedClipId);
    if (!clip) return;
    const trackKey = clip.type === 'video' ? 'video' : (clip.audioKind || 'voice');
    if (trackState[trackKey].locked) return;
    commitTimeline(current => deleteTimelineClip(current, selectedClipId, clip.type === 'video'));
    setSelectedClipId(null);
  }, [commitSubtitleTimeline, commitTimeline, selectedClipId, selectedSubtitleId, trackState]);

  const handleDuplicate = useCallback(() => {
    if (!selectedClipId) return;
    const clip = clipsRef.current.find(item => item.id === selectedClipId);
    if (!clip) return;
    const trackKey = clip.type === 'video' ? 'video' : (clip.audioKind || 'voice');
    if (trackState[trackKey].locked) return;
    const nextId = `${clip.sourceId || clip.id}_copy_${Date.now()}`;
    if (commitTimeline(current => duplicateTimelineClip(current, selectedClipId, nextId))) {
      setSelectedClipId(nextId);
    }
  }, [commitTimeline, selectedClipId, trackState]);

  const handleAddSubtitle = useCallback(() => {
    if (videoDuration <= 0) {
      alert('请先加入视频片段');
      return;
    }
    const startTime = Math.min(currentTime, Math.max(0, videoDuration - 0.2));
    const cue: EnhanceSubtitleCue = {
      id: `subtitle_${Date.now()}`,
      text: '请输入字幕',
      startTime,
      duration: Math.max(0.2, Math.min(3, videoDuration - startTime)),
    };
    commitSubtitleTimeline(current => ({
      ...current,
      subtitles: [...current.subtitles, cue],
    }));
    setSelectedClipId(null);
    setSelectedSubtitleId(cue.id);
  }, [commitSubtitleTimeline, currentTime, videoDuration]);

  const updateSelectedSubtitle = useCallback((updates: Partial<EnhanceSubtitleCue>) => {
    if (!selectedSubtitleId) return;
    commitSubtitleTimeline(current => ({
      ...current,
      subtitles: current.subtitles.map(cue => cue.id === selectedSubtitleId ? {
        ...cue,
        ...updates,
        text: updates.text === undefined ? cue.text : updates.text.slice(0, 500),
        startTime: updates.startTime === undefined
          ? cue.startTime
          : Math.max(0, Math.min(updates.startTime, Math.max(0, videoDuration - cue.duration))),
        duration: updates.duration === undefined
          ? cue.duration
          : Math.max(0.2, Math.min(updates.duration, Math.max(0.2, videoDuration - cue.startTime))),
      } : cue),
    }));
  }, [commitSubtitleTimeline, selectedSubtitleId, videoDuration]);

  const updateSubtitleStyle = useCallback((updates: Partial<EnhanceSubtitleStyle>, cueId = selectedSubtitleId) => {
    if (!cueId) return;
    commitSubtitleTimeline(current => ({
      ...current,
      subtitles: updateSubtitleCueStyle(current.subtitles, cueId, updates),
    }));
  }, [commitSubtitleTimeline, selectedSubtitleId]);

  const persistAudioClip = useCallback(async (clip: MediaClip) => {
    // All audio edits share the same serialized save queue as video and subtitles.
    // Read the current snapshot, not the potentially stale pointer-up closure.
    if (timelineRevisionRef.current <= savedRevisionRef.current && !timelineSaveInFlightRef.current) return;
    try { await saveTimelineNow(); }
    catch (error) { console.warn('[EnhancePage] audio timeline save failed:', error); }
  }, [saveTimelineNow]);

  const updateSelectedAudioClip = useCallback((updates: Partial<MediaClip>, persist = false) => {
    if (!selectedClipId) return;
    const current = clipsRef.current.find(clip => clip.id === selectedClipId && clip.type === 'audio');
    if (!current) return;
    const updated = { ...current, ...updates };
    commitTimeline(prev => prev.map(clip => clip.id === selectedClipId ? updated : clip));
    if (persist) void persistAudioClip(updated).catch(error => {
      console.warn('[EnhancePage] audio timeline update failed:', error);
      alert(`保存音频剪辑位置失败：${error instanceof Error ? error.message : error}`);
    });
  }, [commitTimeline, persistAudioClip, selectedClipId]);

  const alignSelectedAudioToVideo = useCallback(() => {
    if (!selectedClip || selectedClip.type !== 'audio') return;
    const target = videoClips.find(clip => (
      currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration
    )) || videoClips.find(clip => Math.abs(clip.startTime - selectedClip.startTime) < 0.5) || videoClips[0];
    if (!target) return;
    const duration = Math.min(selectedClip.sourceDuration || selectedClip.duration, target.duration);
    updateSelectedAudioClip({ startTime: target.startTime, sourceOffset: 0, duration }, true);
  }, [currentTime, selectedClip, updateSelectedAudioClip, videoClips]);

  const handleDragStart = useCallback((e: React.MouseEvent, clip: MediaClip) => {
    e.stopPropagation();
    const trackKey = clip.type === 'video' ? 'video' : (clip.audioKind || 'voice');
    if (trackState[trackKey].locked) return;
    setSelectedClipId(clip.id);
    setSelectedSubtitleId(null);
    const startX = e.clientX;
    const initialStart = clip.startTime;
    const before = cloneEnhanceClips(clipsRef.current);
    let finalStart = initialStart;
    const onMove = frameCoalesced((me: MouseEvent) => {
      const delta = (me.clientX - startX) / scale;
      const rawStart = Math.max(0, initialStart + delta);
      const result = moveTimelineClip(before, clip.id, rawStart, {
        ripple: clip.type === 'video',
        snap: snapEnabled && !me.shiftKey,
        playhead: currentTime,
        snapThreshold: Math.max(0.05, 8 / scale),
      });
      finalStart = result.clips.find(item => item.id === clip.id)?.startTime ?? initialStart;
      setSnapGuide(result.guide);
      clipsRef.current = result.clips;
      setClips(result.clips);
    });
    const onUp = () => {
      onMove.flush();
      document.removeEventListener('mousemove', onMove.schedule);
      document.removeEventListener('mouseup', onUp);
      setSnapGuide(null);
      commitPreviewTimeline(before);
      if (clip.type === 'audio' && clip.audioTrackId) {
        void persistAudioClip({ ...clip, startTime: finalStart }).catch(error => {
          console.warn('[EnhancePage] audio drag persist failed:', error);
        });
      }
    };
    document.addEventListener('mousemove', onMove.schedule);
    document.addEventListener('mouseup', onUp);
  }, [commitPreviewTimeline, currentTime, persistAudioClip, scale, snapEnabled, trackState]);

  const handleSubtitleDragStart = useCallback((event: React.MouseEvent, cue: EnhanceSubtitleCue) => {
    event.stopPropagation();
    setSelectedClipId(null);
    setSelectedSubtitleId(cue.id);
    const startX = event.clientX;
    const initialStart = cue.startTime;
    const before = subtitlesRef.current.map(item => ({ ...item }));
    const boundaries = [
      0,
      videoDuration,
      currentTime,
      ...clipsRef.current.flatMap(item => [item.startTime, item.startTime + item.duration]),
      ...before.filter(item => item.id !== cue.id).flatMap(item => [item.startTime, item.startTime + item.duration]),
    ];
    const onMove = frameCoalesced((moveEvent: MouseEvent) => {
      const rawStart = initialStart + (moveEvent.clientX - startX) / scale;
      const snapped = snapEnabled && !moveEvent.shiftKey
        ? resolveTimelineSnap(rawStart, boundaries, Math.max(0.05, 8 / scale))
        : { time: rawStart, guide: null };
      const next = moveSubtitleCue(before, cue.id, snapped.time, videoDuration);
      subtitlesRef.current = next;
      setSubtitles(next);
      setSnapGuide(snapped.guide);
    });
    const onUp = () => {
      onMove.flush();
      document.removeEventListener('mousemove', onMove.schedule);
      document.removeEventListener('mouseup', onUp);
      setSnapGuide(null);
      commitPreviewSubtitles(before);
    };
    document.addEventListener('mousemove', onMove.schedule);
    document.addEventListener('mouseup', onUp);
  }, [commitPreviewSubtitles, currentTime, scale, snapEnabled, videoDuration]);

  const handleSubtitleTrimStart = useCallback((
    event: React.MouseEvent,
    cue: EnhanceSubtitleCue,
    side: 'left' | 'right',
  ) => {
    event.stopPropagation();
    event.preventDefault();
    setSelectedClipId(null);
    setSelectedSubtitleId(cue.id);
    const startX = event.clientX;
    const before = subtitlesRef.current.map(item => ({ ...item }));
    const onMove = frameCoalesced((moveEvent: MouseEvent) => {
      const delta = (moveEvent.clientX - startX) / scale;
      const next = trimSubtitleCue(before, cue.id, side, delta, videoDuration);
      subtitlesRef.current = next;
      setSubtitles(next);
    });
    const onUp = () => {
      onMove.flush();
      document.removeEventListener('mousemove', onMove.schedule);
      document.removeEventListener('mouseup', onUp);
      commitPreviewSubtitles(before);
    };
    document.addEventListener('mousemove', onMove.schedule);
    document.addEventListener('mouseup', onUp);
  }, [commitPreviewSubtitles, scale, videoDuration]);

  const handleTrimStart = useCallback((e: React.MouseEvent, clip: MediaClip, side: 'left' | 'right') => {
    e.stopPropagation();
    e.preventDefault();
    const trackKey = clip.type === 'video' ? 'video' : (clip.audioKind || 'voice');
    if (trackState[trackKey].locked) return;
    setSelectedClipId(clip.id);
    setSelectedSubtitleId(null);
    const startX = e.clientX;
    const before = cloneEnhanceClips(clipsRef.current);
    const onMove = frameCoalesced((event: MouseEvent) => {
      const delta = (event.clientX - startX) / scale;
      const next = trimTimelineClip(before, clip.id, side, delta, clip.type === 'video');
      clipsRef.current = next;
      setClips(next);
    });
    const onUp = () => {
      onMove.flush();
      document.removeEventListener('mousemove', onMove.schedule);
      document.removeEventListener('mouseup', onUp);
      commitPreviewTimeline(before);
      const updated = clipsRef.current.find(item => item.id === clip.id);
      if (updated?.type === 'audio' && updated.audioTrackId) {
        void persistAudioClip(updated).catch(error => console.warn('[EnhancePage] audio trim persist failed:', error));
      }
    };
    document.addEventListener('mousemove', onMove.schedule);
    document.addEventListener('mouseup', onUp);
  }, [commitPreviewTimeline, persistAudioClip, scale, trackState]);

  const timelineSeekCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => timelineSeekCleanupRef.current?.(), [episodeId, scale, totalDuration]);

  const handleTimelineSeekStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = timelineContainerRef.current;
    if (e.button !== 0 || !container) return;
    e.preventDefault();
    timelineSeekCleanupRef.current?.();
    setPlaying(false);
    let frame = 0;
    let latestX = e.clientX;
    const seek = (clientX: number) => {
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left + container.scrollLeft;
      setCurrentTime(Math.min(totalDuration, Math.max(0, x / scale)));
    };
    const cleanup = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', cleanup);
      timelineSeekCleanupRef.current = null;
    };
    const onMove = (event: MouseEvent) => {
      // A missed mouseup must never leave the playhead attached to the mouse.
      if (!(event.buttons & 1)) { cleanup(); return; }
      latestX = event.clientX;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        seek(latestX);
      });
    };
    const onUp = (event: MouseEvent) => {
      if (event.button !== 0) return;
      seek(event.clientX);
      cleanup();
    };
    timelineSeekCleanupRef.current = cleanup;
    seek(e.clientX);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', cleanup);
  }, [scale, totalDuration]);

  const updateClipSettings = useCallback((updates: Partial<NonNullable<MediaClip['settings']>>) => {
    if (!selectedClipId) return;
    commitTimeline(prev => prev.map(c =>
      c.id === selectedClipId && c.type === 'video'
        ? { ...c, settings: { ...c.settings!, ...updates } }
        : c
    ));
  }, [commitTimeline, selectedClipId]);

  const updateSelectedVideoTransition = useCallback((
    transitionAfter: NonNullable<MediaClip['transitionAfter']>,
    transitionDuration = 0.5,
  ) => {
    if (!selectedClipId) return;
    commitTimeline(current => layoutVideoClips(current.map(clip => (
      clip.id === selectedClipId && clip.type === 'video'
        ? {
            ...clip,
            transitionAfter,
            transitionDuration: transitionAfter === 'cut'
              ? undefined
              : Math.max(0.1, Math.min(3, transitionDuration)),
          }
        : clip
    ))));
  }, [commitTimeline, selectedClipId]);

  const seekToEdit = useCallback((direction: 'previous' | 'next') => {
    const points = [...new Set(videoClips.flatMap(clip => [clip.startTime, clip.startTime + clip.duration]))]
      .sort((a, b) => a - b);
    if (direction === 'previous') {
      const target = points.filter(point => point < currentTime - 0.01).pop() ?? 0;
      setCurrentTime(target);
    } else {
      const target = points.find(point => point > currentTime + 0.01) ?? videoDuration;
      setCurrentTime(target);
    }
  }, [currentTime, videoClips, videoDuration]);

  const fitTimeline = useCallback(() => {
    const width = timelineContainerRef.current?.clientWidth || 800;
    setScale(Math.max(5, Math.min(100, Math.floor((width - 32) / Math.max(1, totalDuration)))));
    if (timelineContainerRef.current) timelineContainerRef.current.scrollLeft = 0;
  }, [totalDuration]);

  const toggleTrackState = useCallback((key: 'video' | 'voice' | 'bgm' | 'sfx') => {
    setTrackState(current => ({
      ...current,
      [key]: { locked: !current[key].locked },
    }));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoTimeline(); else undoTimeline();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redoTimeline();
        return;
      }
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveTimelineNow().catch(() => {});
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        togglePlay();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSplit();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        handleDelete();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setCurrentTime(value => Math.max(0, value - (event.shiftKey ? 1 : 1 / 30)));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setCurrentTime(value => Math.min(totalDuration, value + (event.shiftKey ? 1 : 1 / 30)));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setCurrentTime(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setCurrentTime(videoDuration);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDelete, handleSplit, redoTimeline, saveTimelineNow, togglePlay, totalDuration, undoTimeline, videoDuration]);
  // Reattach pending enhancement jobs after navigation.
  useEffect(() => {
    const enhancePolls = getKnownVideoTaskIds().filter(uuid =>
      uuid.startsWith('enhance-upscale:')
        || uuid.startsWith('enhance-interpolate:')
        || uuid.startsWith('enhance-lipsync:')
        || uuid.startsWith('enhance-dub:'),
    );
    for (const uuid of enhancePolls) {
      const failureLabel = uuid.startsWith('enhance-interpolate:')
        ? '智能补帧'
        : uuid.startsWith('enhance-upscale:')
          ? '视频放大'
          : uuid.startsWith('enhance-dub:')
            ? '视频配音'
            : '配音对嘴';
      attachVideoPollCallbacks(uuid, {
        onProgress: (progress, status) => {
          setProcessing(true);
          setProcessStage(status === 'queued' ? '排队中' : '处理集群正在执行，可能需要数分钟');
          setProcessProgress(progress > 1 ? Math.floor(progress) : Math.floor(progress * 100));
        },
        onComplete: () => {
          setProcessProgress(100);
          setEnhanceNotice(`${failureLabel}处理完成，结果已更新。`);
          window.setTimeout(() => { setProcessing(false); setProcessProgress(0); setProcessStage('处理中'); }, 800);
          reload();
        },
        onFail: (err) => {
          setProcessing(false);
          setProcessProgress(0);
          setProcessStage('处理中');
          setEnhanceError(`${failureLabel}失败：${err}`);
        },
      });
      setProcessing(true);
    }
  }, [reload]);

  const applyEnhancement = useCallback(async () => {
    setEnhanceError('');
    setEnhanceNotice('');
    // GPU enhancement actions require an online ComfyUI Agent.

    if (!selectedClusterNodeUsable) {
      setEnhanceError('该功能需要处理集群节点。当前没有可用节点，请刷新节点状态或稍后重试。');
      return;
    }
    const targetClip = videoClips.find(c => c.id === selectedClipId) || videoUnderPlayhead || videoClips[0];
    if (!targetClip || !targetClip.url) {
      setEnhanceError('请先在时间线上选择一个视频片段。');
      return;
    }
    const targetEntityId = targetClip.sourceId || targetClip.id;

    if (enhancementKind === 'lipSync' || enhancementKind === 'dub') {
      const audioClip = audioClips.find(clip => clip.id === lipSyncAudioClipId);
      if (!audioClip) {
        setEnhanceError('请选择参考配音或上传配音演员录音。');
        return;
      }
      const referenceImage = targetClip.referenceImageUrl || targetClip.thumbnailUrl;
      if (!referenceImage) {
        setEnhanceError('当前视频片段缺少首帧图片，无法发起对嘴任务。请先为对应分镜生成图片。');
        return;
      }

      setProcessing(true);
      setProcessProgress(0);
      setProcessStage('正在提交');
      try {
        const audioFilename = await ensureGpuAudioFilename(audioClip);
        const isDub = enhancementKind === 'dub';
        const dubPrompt = {
          neutral: '保持人物身份、构图和自然表情，使用中性自然的表演让嘴型与最终音频同步',
          dramatic: '保持人物身份和构图，使用更有张力的表演让嘴型与最终音频同步',
          soft: '保持人物身份和构图，使用柔和克制的表演让嘴型与最终音频同步',
        }[dubVoiceStyle];
        const result = await submitVoiceTaskQueued(
          referenceImage,
          targetClip.url,
          audioFilename,
          isDub ? dubPrompt : '保持人物身份、情绪和表情，自然地让嘴型与最终对白音频同步',
          'Wan2',
          {
            entity_type: 'video_segment',
            entity_id: targetEntityId,
            file_role: 'video',
            project_id: projectId || undefined,
            episode_id: episodeId || undefined,
            preferred_agent_id: selectedClusterNode?.agentId,
            preferred_node_id: selectedClusterNode?.nodeId || selectedClusterNode?.id,
          },
          { duration: targetClip.duration },
        );
        const pollerUuid = `enhance-${isDub ? 'dub' : 'lipsync'}:${targetEntityId}`;
        setProcessStage('排队中');
        setEnhanceNotice(`${isDub ? '视频配音' : '配音对嘴'}任务已进入处理队列。`);
        startVideoPoll(pollerUuid, {
          taskId: result.task_id,
          title: `${isDub ? '视频配音' : '配音对嘴'} · ${audioClip.sourceLabel || '音频轨道'}`,
          kind: 'video-voice',
          targetPage: 'enhance',
          targetEntityType: 'video_segment',
          targetEntityId,
          episodeId: episodeId || undefined,
          projectId: projectId || undefined,
          callbacks: {
            onProgress: (progress, status) => {
              setProcessing(true);
              setProcessStage(status === 'queued' ? '排队中' : '处理集群正在执行，可能需要数分钟');
              setProcessProgress(progress > 1 ? Math.floor(progress) : Math.floor(progress * 100));
            },
            onComplete: ({ status }) => {
              const outputUrl = status.result?.videos?.[0]?.url;
              if (outputUrl) {
                void updateVideoSegment(targetEntityId, {
                  video_url: outputUrl,
                  task_id: status.task_id,
                  status: 'completed',
                }).catch(() => {});
              }
              setProcessProgress(100);
              setEnhanceNotice(`${isDub ? '视频配音' : '配音对嘴'}处理完成，结果已更新。`);
              window.setTimeout(() => { setProcessing(false); setProcessProgress(0); setProcessStage('处理中'); }, 800);
              reloadEnhanceData();
            },
            onFail: (err) => {
              setProcessing(false);
              setProcessProgress(0);
              setProcessStage('处理中');
              setEnhanceError(`${isDub ? '视频配音' : '配音对嘴'}失败：${err}`);
            },
          },
        });
      } catch (error: any) {
        setProcessing(false);
        setProcessProgress(0);
        setProcessStage('处理中');
        setEnhanceError(`提交${enhancementKind === 'dub' ? '视频配音' : '配音对嘴'}任务失败：${error?.message || error}`);
      }
      return;
    }

    if (enhancementKind === 'interpolate') {
      setProcessing(true);
      setProcessProgress(0);
      setProcessStage('正在提交');
      try {
        const result = await submitInterpolateTaskQueued(targetClip.url, targetFps, {
          entity_type: 'video_segment',
          entity_id: targetEntityId,
          file_role: 'video',
          project_id: projectId || undefined,
          episode_id: episodeId || undefined,
          preferred_agent_id: selectedClusterNode?.agentId,
          preferred_node_id: selectedClusterNode?.nodeId || selectedClusterNode?.id,
        });
        const pollerUuid = `enhance-interpolate:${targetEntityId}`;
        setProcessStage('排队中');
        setEnhanceNotice('智能补帧任务已进入处理队列。');
        startVideoPoll(pollerUuid, {
          taskId: result.task_id,
          title: `智能补帧 · ${targetFps} FPS`,
          kind: 'video-enhance',
          targetPage: 'enhance',
          targetEntityType: 'video_segment',
          targetEntityId,
          episodeId: episodeId || undefined,
          projectId: projectId || undefined,
          callbacks: {
            onProgress: (progress, status) => {
              setProcessing(true);
              setProcessStage(status === 'queued' ? '排队中' : '处理集群正在执行，可能需要数分钟');
              setProcessProgress(progress > 1 ? Math.floor(progress) : Math.floor(progress * 100));
            },
            onComplete: ({ status }) => {
              const outputUrl = status.result?.videos?.[0]?.url;
              if (outputUrl) {
                void updateVideoSegment(targetEntityId, {
                  video_url: outputUrl,
                  task_id: status.task_id,
                  status: 'completed',
                }).catch(() => {});
              }
              setProcessProgress(100);
              setEnhanceNotice('智能补帧处理完成，结果已更新。');
              window.setTimeout(() => { setProcessing(false); setProcessProgress(0); setProcessStage('处理中'); }, 800);
              reloadEnhanceData();
            },
            onFail: (err) => {
              setProcessing(false);
              setProcessProgress(0);
              setProcessStage('处理中');
              setEnhanceError(`智能补帧失败：${err}`);
            },
          },
        });
      } catch (error: any) {
        setProcessing(false);
        setProcessProgress(0);
        setProcessStage('处理中');
        setEnhanceError(`提交智能补帧任务失败：${error?.message || error}`);
      }
      return;
    }


    const filename = targetClip.url;
    if (!filename) {
      setEnhanceError('无法从视频 URL 解析文件名，无法发起放大任务。');
      return;
    }

    setProcessing(true);
    setProcessProgress(0);
    setProcessStage('正在提交');
    try {
      const result = await submitUpscaleTaskQueued(filename, {
        entity_type: 'video_segment',
        entity_id: targetEntityId,
        file_role: 'video',
        project_id: projectId || undefined,
        episode_id: episodeId || undefined,
        resolution: targetResolution,
        preferred_agent_id: selectedClusterNode?.agentId,
        preferred_node_id: selectedClusterNode?.nodeId || selectedClusterNode?.id,
      });
      const backendTaskId = result.task_id;
      const pollerUuid = `enhance-upscale:${targetEntityId}`;
      setProcessStage('排队中');
      setEnhanceNotice('视频放大任务已进入处理队列。');
      startVideoPoll(pollerUuid, {
        taskId: backendTaskId,
        title: `视频放大 · ${targetResolution}`,
        kind: 'video-upscale',
        targetPage: 'enhance',
        targetEntityType: 'video_segment',
        targetEntityId,
        episodeId: episodeId || undefined,
        projectId: projectId || undefined,
        callbacks: {
          onProgress: (progress, status) => {
            setProcessing(true);
            setProcessStage(status === 'queued' ? '排队中' : '处理集群正在执行，可能需要数分钟');
            setProcessProgress(progress > 1 ? Math.floor(progress) : Math.floor(progress * 100));
          },
          onComplete: () => {
            setProcessProgress(100);
            setEnhanceNotice('视频放大处理完成，结果已更新。');
            window.setTimeout(() => { setProcessing(false); setProcessProgress(0); setProcessStage('处理中'); }, 800);

            reload();
          },
          onFail: (err) => {
            setProcessing(false);
            setProcessProgress(0);
            setProcessStage('处理中');
            setEnhanceError(`视频放大失败：${err}`);
          },
        },
      });
    } catch (e: any) {
      setProcessing(false);
      setProcessProgress(0);
      setProcessStage('处理中');
      setEnhanceError(`提交放大任务失败：${e?.message || e}`);
    }
  }, [
    enhancementKind,
    videoUnderPlayhead,
    videoClips,
    selectedClipId,
    audioClips,
    lipSyncAudioClipId,
    dubVoiceStyle,
    targetResolution,
    targetFps,
    projectId,
    episodeId,
    reload,
    reloadEnhanceData,
    selectedClusterNode,
    selectedClusterNodeUsable,
    ensureGpuAudioFilename,
  ]);

  const viewport = useTimelineViewport(timelineContainerRef, scale, !isLoading);
  const timelineRuler = useMemo(() => Array.from({
    length: Math.max(0, Math.ceil(Math.min(totalDuration, viewport.end)) - Math.floor(viewport.start)),
  }, (_, index) => index + Math.floor(viewport.start)).map(i => (
    <div key={i} className="absolute top-0 bottom-0 border-l border-n40" style={{ left: `${i * scale}px` }}>
      {i % 5 === 0 && <span className="absolute top-0.5 left-1 text-[9px] text-n100 select-none">{formatTime(i)}</span>}
    </div>
  )), [totalDuration, viewport, scale]);
  const audioMediaElements = useMemo(() => audioClips.map(clip => (
    <audio key={clip.id} src={clip.url} preload="none" ref={element => {
      if (element) audioElementRefs.current.set(clip.id, element);
      else audioElementRefs.current.delete(clip.id);
    }} />
  )), [audioClips]);
  const visibleTimeline = useMemo(() => ({
    video: videoClips.filter(clip => overlapsTimelineWindow(clip, viewport)),
    voice: voiceClips.filter(clip => overlapsTimelineWindow(clip, viewport)),
    bgm: bgmClips.filter(clip => overlapsTimelineWindow(clip, viewport)),
    sfx: sfxClips.filter(clip => overlapsTimelineWindow(clip, viewport)),
    subtitles: subtitles.filter(cue => overlapsTimelineWindow(cue, viewport)),
  }), [videoClips, voiceClips, bgmClips, sfxClips, subtitles, viewport]);
  const handleDragStartStable = useLatestCallback(handleDragStart);
  const handleTrimStartStable = useLatestCallback(handleTrimStart);
  const handleSubtitleDragStartStable = useLatestCallback(handleSubtitleDragStart);
  const handleSubtitleTrimStartStable = useLatestCallback(handleSubtitleTrimStart);
  const timelineMediaLayers = useMemo(() => (<>
              {/* Video track */}
              <div data-testid="enhance-track-video" className="h-16 border-b border-n40 relative bg-n0">
                {visibleTimeline.video.map(clip => (
                  <div
                    key={clip.id}
                    onMouseDown={e => handleDragStartStable(e, clip)}
                    className={`absolute top-1.5 bottom-1.5 rounded border-2 overflow-hidden transition-colors ${trackState.video.locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'} ${
                      selectedClipId === clip.id
                        ? 'border-primary z-20 bg-n0'
                        : 'border-n40 z-10 hover:border-primary bg-n0'
                    }`}
                    style={{ left: `${clip.startTime * scale}px`, width: `${Math.max(18, clip.duration * scale)}px` }}
                  >
                    <div
                      className="absolute inset-y-0 left-0 z-30 w-2 cursor-ew-resize bg-white/0 hover:bg-primary/60"
                      onMouseDown={event => handleTrimStartStable(event, clip, 'left')}
                      title="拖动裁剪入点"
                    />
                    <div
                      className="absolute inset-y-0 right-0 z-30 w-2 cursor-ew-resize bg-white/0 hover:bg-primary/60"
                      onMouseDown={event => handleTrimStartStable(event, clip, 'right')}
                      title="拖动裁剪出点"
                    />
                    <div className="absolute inset-0 bg-black">
                      {clip.url ? (
                        <img
                          src={enhanceVideoPosterUrl(clip.url)}
                          alt="视频片段预览"
                          loading="lazy"
                          className="w-full h-full object-cover pointer-events-none"
                        />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center text-n100 ${clip.isBlack ? 'bg-black text-white' : 'bg-n20'}`}>
                          {clip.isBlack ? <span className="text-[10px]">黑幕</span> : <Film size={14} />}
                        </div>
                      )}
                    </div>
                    <div className="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
                    <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
                    <div className="absolute top-1 left-1 right-10 text-[9px] text-white font-mono z-10 truncate pointer-events-none drop-shadow">
                      {clip.isBlack ? '黑幕' : clip.id.slice(0, 12)}
                    </div>
                    <div className="absolute top-0.5 right-1 px-1 rounded bg-black/50 text-[9px] text-white/90 font-mono z-10 pointer-events-none">
                      {clip.duration.toFixed(1)}s
                    </div>
                    <div className="absolute bottom-0.5 left-1 flex gap-0.5 z-10">
                      {clip.settings?.upscale && <MonitorPlay size={10} className="text-primary" />}
                      {clip.settings?.interpolate && <Zap size={10} className="text-warning" />}
                      {clip.settings?.lipSync && <Mic2 size={10} className="text-success" />}
                      {clip.transitionAfter === 'fade' && <span className="rounded bg-black/60 px-1 text-[8px] text-white">淡变</span>}
                      {clip.transitionAfter === 'black' && <span className="rounded bg-black px-1 text-[8px] text-white">黑幕</span>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Audio tracks */}
              {[
                { key: 'voice', clips: visibleTimeline.voice },
                { key: 'bgm', clips: visibleTimeline.bgm },
                { key: 'sfx', clips: visibleTimeline.sfx },
              ].map(group => (
              <div key={group.key} data-testid={`enhance-track-${group.key}`} className="h-10 border-b border-n40 relative bg-n0">
                {group.clips.map(clip => (
                  <div
                    key={clip.id}
                    data-testid={`enhance-audio-${clip.id}`}
                    onMouseDown={e => handleDragStartStable(e, clip)}
                    className={`absolute top-1 bottom-1 rounded border overflow-hidden ${trackState[group.key as 'voice' | 'bgm' | 'sfx'].locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'} ${
                      selectedClipId === clip.id
                        ? 'border-primary z-20 bg-primary-light shadow-sm'
                        : group.key === 'bgm'
                          ? 'border-success/40 z-10 hover:border-success bg-success/10'
                          : group.key === 'sfx'
                            ? 'border-warning/40 z-10 hover:border-warning bg-warning/10'
                            : 'border-primary/40 z-10 hover:border-primary bg-primary-light'
                    }`}
                    style={{ left: `${clip.startTime * scale}px`, width: `${Math.max(16, clip.duration * scale)}px` }}
                  >
                    <div
                      className="absolute inset-y-0 left-0 z-30 w-2 cursor-ew-resize bg-white/20 hover:bg-primary/60"
                      onMouseDown={event => handleTrimStartStable(event, clip, 'left')}
                      title="拖动裁剪入点"
                    />
                    <div
                      className="absolute inset-y-0 right-0 z-30 w-2 cursor-ew-resize bg-white/20 hover:bg-primary/60"
                      onMouseDown={event => handleTrimStartStable(event, clip, 'right')}
                      title="拖动裁剪出点"
                    />
                    <GripHorizontal size={10} className="text-primary absolute left-1 top-1/2 -translate-y-1/2 opacity-50" />
                    <div className="w-full h-full flex items-center justify-center overflow-hidden opacity-60">
                      <svg className="w-full h-6 text-primary" preserveAspectRatio="none" viewBox="0 0 100 100">
                        <path d="M0,50 Q5,10 10,50 T20,50 T30,50 T40,50 T50,50 T60,50 T70,50 T80,50 T90,50 T100,50" stroke="currentColor" fill="none" strokeWidth="2" />
                      </svg>
                    </div>
                    <div className="absolute top-0.5 right-1 text-[9px] text-primary font-mono z-10 pointer-events-none">
                      {clip.duration.toFixed(1)}s
                    </div>
                    <div className="absolute bottom-0.5 left-4 right-1 text-[9px] text-primary z-10 truncate pointer-events-none">
                      {clip.sourceLabel || '音频轨道'}
                    </div>
                  </div>
                ))}
              </div>
              ))}

              {/* Subtitle track */}
              <div data-testid="enhance-track-subtitles" className="h-10 border-b border-n40 relative bg-n0">
                {subtitles.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] text-n100 pointer-events-none">
                    点击工具栏“字幕”在播放头处添加
                  </div>
                )}
                {visibleTimeline.subtitles.map(cue => (
                  <div
                    key={cue.id}
                    onMouseDown={event => handleSubtitleDragStartStable(event, cue)}
                    className={`absolute top-1 bottom-1 rounded border overflow-hidden cursor-grab active:cursor-grabbing ${
                      selectedSubtitleId === cue.id
                        ? 'border-primary bg-primary-light z-20 shadow-sm'
                        : 'border-violet-300 bg-violet-50 hover:border-primary z-10'
                    }`}
                    style={{ left: `${cue.startTime * scale}px`, width: `${Math.max(16, cue.duration * scale)}px` }}
                    title={cue.text || '空字幕'}
                  >
                    <div
                      className="absolute inset-y-0 left-0 z-30 w-2 cursor-ew-resize bg-violet-300/50 hover:bg-primary"
                      onMouseDown={event => handleSubtitleTrimStartStable(event, cue, 'left')}
                      title="拖动调整字幕开始时间"
                    />
                    <div
                      className="absolute inset-y-0 right-0 z-30 w-2 cursor-ew-resize bg-violet-300/50 hover:bg-primary"
                      onMouseDown={event => handleSubtitleTrimStartStable(event, cue, 'right')}
                      title="拖动调整字幕结束时间"
                    />
                    <div className="flex h-full items-center gap-1 overflow-hidden px-2 text-[9px] font-medium text-violet-700 pointer-events-none">
                      <Captions size={10} className="shrink-0" />
                      <span className="truncate">{cue.text || '空字幕'}</span>
                    </div>
                  </div>
                ))}
              </div>
  </>), [visibleTimeline, scale, trackState, selectedClipId, selectedSubtitleId,
    handleDragStartStable, handleTrimStartStable, handleSubtitleDragStartStable, handleSubtitleTrimStartStable]);

  return (
    <div className="layout-safe workflow-stage-layout flex-col text-n800">
      {/* Top section: preview + settings */}
      <div className="responsive-split workflow-stage-layout lg:flex-row-reverse">
        {/* Preview area */}
        <div className="responsive-pane workflow-stage-canvas">
          <div className="responsive-toolbar workflow-stage-toolbar px-4 flex items-center justify-between">
            <div className="toolbar-group">
              <Wand2 size={16} className="text-primary" />
              <div>
                <h2 className="text-sm font-semibold">剪辑与优化合成</h2>
                <p className="text-[10px] text-n100">按当前时间线剪辑、配音并输出成片</p>
              </div>
            </div>
            <div className="toolbar-actions">
              <span className="text-xs font-mono tabular-nums text-n300" title="时:分:秒:帧（30 FPS）">{formatTimelineTime(currentTime)}</span>
              <span className="text-[10px] text-n100">{videoClips.length}V · {audioClips.length}A · {subtitles.length}S</span>
              <button
                type="button"
                onClick={() => void saveTimelineNow().catch(() => {})}
                disabled={!episodeId || timelineSaveState === 'saving'}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${timelineSaveState === 'error' ? 'text-danger' : 'text-n300 hover:bg-n20'}`}
                title={timelineSaveState === 'error' ? '保存失败，点击重试' : '保存时间线（Ctrl+S）'}
              >
                {timelineSaveState === 'saving' ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
                {timelineSaveState === 'saving' ? '保存中' : timelineSaveState === 'unsaved' ? '未保存' : timelineSaveState === 'error' ? '重试保存' : '已保存'}
              </button>
              <div className="inline-flex h-7 rounded border border-n40 overflow-hidden" aria-label="成片音频来源">
                <button
                  type="button"
                  onClick={() => setComposeAudioMode('video_original')}
                  className={`px-2 text-[11px] transition-colors ${composeAudioMode === 'video_original' ? 'bg-primary text-white' : 'bg-n0 text-n300 hover:text-n700'}`}
                  title="使用源视频原声；时间线配音不参与合成，背景音乐和音效仍会叠加"
                >
                  视频原声
                </button>
                <button
                  type="button"
                  onClick={() => setComposeAudioMode('reference_dubbing')}
                  className={`px-2 text-[11px] border-l border-n40 transition-colors ${composeAudioMode === 'reference_dubbing' ? 'bg-primary text-white' : 'bg-n0 text-n300 hover:text-n700'}`}
                  title="使用分镜阶段生成的参考配音替换视频原声"
                >
                  参考配音
                </button>
              </div>
              {voiceClips.length > 0 && composeAudioMode === 'video_original' && (
                <span className="text-[10px] text-amber-600" title="切换到参考配音后，时间线对白和旁白才会进入成品">
                  仅忽略时间线配音
                </span>
              )}
              {isLoading && <Loader size={14} className="animate-spin text-primary" />}
              <button
                onClick={reloadEnhanceData}
                className="text-xs text-n100 hover:text-n700 transition-colors"
              >
                刷新
              </button>

              {compose?.status === 'running' ? (
                <span className="flex items-center gap-1 px-2.5 py-1 bg-primary-light text-primary text-xs rounded-lg border border-primary/20">
                  <Loader size={12} className="animate-spin" />
                  合成中 {compose.done}/{compose.total || '…'}
                </span>
              ) : compose?.status === 'done' ? (
                <span className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs rounded-lg border border-emerald-200">
                  <CheckCircle size={12} /> 成片已生成（在「成品」页查看）
                  <button onClick={handleCompose} className="ml-1 underline opacity-70 hover:opacity-100">重新合成</button>
                </span>
              ) : (
                <button
                  className="flex items-center gap-1 px-2.5 py-1 bg-primary hover:bg-primary-hover text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                  title="按当前时间线拼接视频、对齐音频并烧录字幕，合成一个完整成片（约数分钟，可离开页面）"
                  onClick={handleCompose}
                  disabled={!episodeId || videoClips.length === 0}
                >
                  <Film size={12} /> 合成成品
                </button>
              )}
              {compose?.status === 'failed' && (
                <ComposeFailureNotice error={compose.error} />
              )}
              <button
                className="flex items-center gap-1 px-2.5 py-1 bg-primary hover:bg-primary-hover text-white text-xs rounded-lg transition-colors"
                title="导出时间线配置"
                onClick={() => {
                  const data = JSON.stringify(
                    serializeEnhanceTimeline(clips, knownVideoSourceIds, subtitles, subtitleStyle),
                    null,
                    2,
                  );
                  const blob = new Blob([data], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = 'timeline-export.json'; a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={12} /> 导出
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center bg-black/30 p-4">
            {error && (
              <div className="absolute top-14 left-4 right-4 z-10 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-danger text-xs">
                {error}
              </div>
            )}
            <div className="w-full max-w-3xl aspect-video bg-black rounded-md border border-n40 shadow-2xl overflow-hidden relative">
              {videoUnderPlayhead?.url ? (
                <video
                  key={videoUnderPlayhead.id}
                  ref={previewVideoRef}
                  src={videoUnderPlayhead.url}
                  poster={enhanceVideoPosterUrl(videoUnderPlayhead.url)}
                  preload="metadata"
                  controls={false}
                  muted={composeAudioMode === 'reference_dubbing'}
                  aria-label="当前时间线视频预览"
                  onLoadedMetadata={event => {
                    const video = event.currentTarget;
                    setPreviewSourceSize({ width: video.videoWidth, height: video.videoHeight });
                    const target = Math.max(
                      0,
                      currentTime - videoUnderPlayhead.startTime + videoUnderPlayhead.sourceOffset,
                    );
                    try {
                      video.currentTime = Math.min(
                        target,
                        Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : target,
                      );
                    } catch {}
                    if (playing) void video.play().catch(() => setPlaying(false));
                  }}
                  className="w-full h-full object-contain"
                  style={{ opacity: videoTransitionOpacity }}
                />
              ) : blackTransitionUnderPlayhead || videoUnderPlayhead?.isBlack ? (
                <div className="absolute inset-0 bg-black" aria-label="黑幕转场预览" />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-n100 gap-2">
                  <Film size={40} strokeWidth={1.2} />
                  <span className="text-sm">
                    {clips.length === 0 ? '暂无视频片段，请先在「视频」中生成' : '当前时间点无视频'}
                  </span>
                </div>
              )}
              <SubtitlePreview
                cues={activeSubtitles}
                sourceWidth={previewSourceSize.width}
                sourceHeight={previewSourceSize.height}
                onSelect={id => {
                  setSelectedSubtitleId(id);
                  setSelectedClipId(null);
                  if (playTimerRef.current !== null) clearInterval(playTimerRef.current);
                  playTimerRef.current = null;
                  setPlaying(false);
                }}
                onChange={(id, updates) => updateSubtitleStyle(updates, id)}
              />
            </div>
          </div>
        </div>

        {/* Right settings panel */}
        <div className="responsive-pane workflow-stage-sidebar w-72 lg:border-r lg:border-l-0 flex flex-col shrink-0">
          <div className="workflow-stage-toolbar px-4 flex items-center">
            <h2 className="text-sm font-semibold">片段美化选项</h2>
          </div>
          <div className="workflow-stage-scroll flex-1 p-4 space-y-4">
            {selectedSubtitle ? (
              <div className="space-y-4">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <Captions size={16} className="text-primary" />
                    <h3 className="text-sm font-semibold text-n800">字幕编辑</h3>
                  </div>
                  <p className="text-[11px] leading-4 text-n100">字幕会随时间线自动保存，并烧录到最终合成视频。</p>
                </div>
                <label className="block space-y-1">
                  <span className="text-[11px] text-n300">字幕内容</span>
                  <textarea
                    value={selectedSubtitle.text}
                    maxLength={500}
                    rows={4}
                    onChange={event => updateSelectedSubtitle({ text: event.target.value })}
                    className="w-full resize-y rounded border border-n40 bg-n0 px-2.5 py-2 text-xs leading-5 focus:border-primary focus:outline-none"
                    placeholder="输入字幕内容"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-n300">开始时间（秒）</span>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, videoDuration - 0.2)}
                      step={0.1}
                      value={selectedSubtitle.startTime.toFixed(1)}
                      onChange={event => updateSelectedSubtitle({ startTime: Number(event.target.value) || 0 })}
                      className="w-full rounded border border-n40 bg-n0 px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-n300">持续时间（秒）</span>
                    <input
                      type="number"
                      min={0.2}
                      max={Math.max(0.2, videoDuration - selectedSubtitle.startTime)}
                      step={0.1}
                      value={selectedSubtitle.duration.toFixed(1)}
                      onChange={event => updateSelectedSubtitle({ duration: Number(event.target.value) || 0.2 })}
                      className="w-full rounded border border-n40 bg-n0 px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => updateSelectedSubtitle({ startTime: currentTime })}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded border border-primary/30 bg-primary-light text-xs font-medium text-primary"
                >
                  <Play size={12} /> 移到播放头
                </button>
                <div className="rounded-lg border border-n40 bg-n10 p-3 space-y-3">
                  <div className="text-xs font-medium text-n500">字幕样式</div>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-n300">位置</span>
                    <select
                      value={selectedSubtitleStyle.position}
                      onChange={event => updateSubtitleStyle({ position: event.target.value as EnhanceSubtitleStyle['position'], positionX: undefined, positionY: undefined })}
                      className="w-full rounded border border-n40 bg-n0 px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
                    >
                      <option value="top">上</option>
                      <option value="center">中</option>
                      <option value="bottom">下</option>
                    </select>
                  </label>
                  <p className="text-[11px] leading-4 text-n100">拖动或修改样式只影响当前字幕；其他字幕和新增字幕保持各自设置。</p>
                  {(['x', 'y'] as const).map(axis => (
                    <label key={axis} className="block space-y-1">
                      <span className="flex items-center justify-between text-[11px] text-n300">
                        <span>{axis === 'x' ? '水平位置' : '垂直位置'}</span>
                        <span className="flex items-center gap-1">
                          <input type="number" min={0} max={100} step={0.1}
                            aria-label={axis === 'x' ? '字幕水平位置百分比' : '字幕垂直位置百分比'}
                            value={resolveSubtitleCoordinates(selectedSubtitleStyle)[axis]}
                            onChange={event => updateSubtitleStyle({ [axis === 'x' ? 'positionX' : 'positionY']: Number(event.target.value) })}
                            className="w-16 rounded border border-n40 bg-n0 px-1 py-1 text-right" />%
                        </span>
                      </span>
                      <input type="range" min={0} max={100} step={0.1}
                        aria-label={axis === 'x' ? '调整字幕水平位置' : '调整字幕垂直位置'}
                        value={resolveSubtitleCoordinates(selectedSubtitleStyle)[axis]}
                        onChange={event => updateSubtitleStyle({ [axis === 'x' ? 'positionX' : 'positionY']: Number(event.target.value) })}
                        className="w-full accent-primary" />
                    </label>
                  ))}
                  <button type="button" onClick={() => updateSubtitleStyle({ position: 'bottom', positionX: undefined, positionY: undefined, fontSize: DEFAULT_ENHANCE_SUBTITLE_STYLE.fontSize })}
                    className="text-xs font-medium text-primary hover:underline">恢复默认位置和字号</button>
                  <label className="block space-y-1">
                    <span className="flex justify-between text-[11px] text-n300">
                      <span>字号</span><span>{selectedSubtitleStyle.fontSize}px</span>
                    </span>
                    <input
                      type="range"
                      min={16}
                      max={96}
                      step={1}
                      value={selectedSubtitleStyle.fontSize}
                      onChange={event => updateSubtitleStyle({ fontSize: Number(event.target.value) })}
                      className="w-full accent-primary"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[11px] text-n300">文字颜色</span>
                      <input
                        type="color"
                        value={selectedSubtitleStyle.textColor}
                        onChange={event => updateSubtitleStyle({ textColor: event.target.value })}
                        className="h-8 w-full rounded border border-n40 bg-n0 p-1"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-n300">背景颜色</span>
                      <input
                        type="color"
                        value={selectedSubtitleStyle.backgroundColor}
                        onChange={event => updateSubtitleStyle({ backgroundColor: event.target.value })}
                        className="h-8 w-full rounded border border-n40 bg-n0 p-1"
                      />
                    </label>
                  </div>
                  <label className="block space-y-1">
                    <span className="flex justify-between text-[11px] text-n300">
                      <span>背景透明度</span><span>{Math.round(selectedSubtitleStyle.backgroundOpacity * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={selectedSubtitleStyle.backgroundOpacity}
                      onChange={event => updateSubtitleStyle({ backgroundOpacity: Number(event.target.value) })}
                      className="w-full accent-primary"
                    />
                  </label>
                </div>
                <p className="text-[11px] leading-5 text-n100">可直接拖动下方字幕块调整开始时间，拖动两端调整持续时间；Delete 可删除。</p>
              </div>
            ) : selectedClip?.isBlack ? (
              <BlackClipControls key={selectedClip.id} duration={selectedClip.duration}
                onChange={duration => {
                  commitTimeline(current => layoutVideoClips(current.map(c => c.id === selectedClip.id ? { ...c, duration } : c)));
                  void saveTimelineNow().catch(() => {});
                }} onDelete={handleDelete} />
            ) : selectedClip && selectedClip.type === 'video' ? (
              <>
                <div className="text-[11px] text-n100 truncate">
                  选中: {selectedClip.id.slice(0, 20)}{selectedClip.id.length > 20 ? '...' : ''}
                </div>
                <div className="rounded-lg border border-primary/20 bg-primary-light/40 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-n700">视频剪辑</span>
                    <span className="font-mono text-[10px] tabular-nums text-n300">{formatTimelineTime(selectedClip.startTime)} → {formatTimelineTime(selectedClip.startTime + selectedClip.duration)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[11px] text-n300">源片入点（秒）</span>
                      <input
                        type="number"
                        min={0}
                        max={Math.max(0, (selectedClip.sourceDuration || selectedClip.duration) - 0.1)}
                        step={0.1}
                        value={selectedClip.sourceOffset.toFixed(1)}
                        onChange={event => {
                          const target = Math.max(0, Number(event.target.value) || 0);
                          const delta = target - selectedClip.sourceOffset;
                          commitTimeline(current => trimTimelineClip(current, selectedClip.id, 'left', delta, true));
                        }}
                        className="w-full rounded border border-n40 bg-n0 px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-n300">片段时长（秒）</span>
                      <input
                        type="number"
                        min={0.1}
                        max={Math.max(0.1, (selectedClip.sourceDuration || selectedClip.duration) - selectedClip.sourceOffset)}
                        step={0.1}
                        value={selectedClip.duration.toFixed(1)}
                        onChange={event => {
                          const target = Math.max(0.1, Number(event.target.value) || 0.1);
                          commitTimeline(current => trimTimelineClip(current, selectedClip.id, 'right', target - selectedClip.duration, true));
                        }}
                        className="w-full rounded border border-n40 bg-n0 px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
                      />
                    </label>
                  </div>
                  <div className="rounded-lg border border-n40 bg-n0 p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-medium text-n500">与下一片段的转场</div>
                        <div className="text-[10px] leading-4 text-n100">淡入淡出会经过黑场；黑幕会插入一段纯黑画面。</div>
                      </div>
                      {!hasFollowingVideo && <span className="shrink-0 text-[10px] text-n100">末片段</span>}
                    </div>
                    <select
                      aria-label="视频转场效果"
                      value={hasFollowingVideo ? (selectedClip.transitionAfter || 'cut') : 'cut'}
                      disabled={!hasFollowingVideo}
                      onChange={event => updateSelectedVideoTransition(
                        event.target.value as NonNullable<MediaClip['transitionAfter']>,
                        selectedClip.transitionDuration || 0.5,
                      )}
                      className="w-full rounded border border-n40 bg-n0 px-2 py-1.5 text-xs focus:border-primary focus:outline-none disabled:bg-n20 disabled:text-n100"
                    >
                      <option value="cut">直接切换</option>
                      <option value="fade">淡入淡出</option>
                      <option value="black">黑幕</option>
                    </select>
                    {hasFollowingVideo && (selectedClip.transitionAfter === 'fade' || selectedClip.transitionAfter === 'black') && (
                      <label className="block space-y-1">
                        <span className="flex justify-between text-[11px] text-n300">
                          <span>{selectedClip.transitionAfter === 'fade' ? '淡出/淡入时长' : '黑幕时长'}</span>
                          <span>{Math.min(selectedClip.transitionDuration || 0.5, selectedTransitionMaxDuration).toFixed(1)} 秒</span>
                        </span>
                        <input
                          aria-label="视频转场时长"
                          type="range"
                          min={0.1}
                          max={selectedTransitionMaxDuration}
                          step={0.1}
                          value={Math.min(selectedClip.transitionDuration || 0.5, selectedTransitionMaxDuration)}
                          onChange={event => updateSelectedVideoTransition(
                            selectedClip.transitionAfter || 'cut',
                            Number(event.target.value),
                          )}
                          className="w-full accent-primary"
                        />
                      </label>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={handleDuplicate} className="flex-1 h-8 rounded border border-n40 bg-n0 text-[11px] text-n500 hover:border-primary hover:text-primary">
                      复制片段
                    </button>
                    <button type="button" onClick={handleSplit} className="flex-1 h-8 rounded border border-n40 bg-n0 text-[11px] text-n500 hover:border-primary hover:text-primary">
                      在播放头切分
                    </button>
                  </div>
                </div>
                <div className="rounded border border-n40 bg-n10 p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-n500">处理节点</span>
                    <button
                      type="button"
                      onClick={() => void loadClusterNodes()}
                      disabled={clusterNodesLoading || processing}
                      className="inline-flex items-center gap-1 text-[11px] text-primary disabled:opacity-50"
                      title="刷新处理节点状态"
                    >
                      <RefreshCw size={12} className={clusterNodesLoading ? 'animate-spin' : ''} />
                      刷新
                    </button>
                  </div>
                  <select
                    value={selectedClusterNodeId}
                    onChange={event => {
                      setSelectedClusterNodeId(event.target.value);
                      setPreferredGpuNodeId(event.target.value);
                    }}
                    disabled={clusterNodesLoading || processing || clusterNodes.length === 0}
                    className="w-full px-2.5 py-2 rounded bg-n0 border border-n40 text-xs text-n700 focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-n20"
                  >
                    {clusterNodes.length === 0 && (
                      <option value={selectedClusterNodeId}>{selectedClusterNodeId} · offline</option>
                    )}
                    {clusterNodes.map(node => (
                      <option key={node.id} value={clusterNodePreferenceId(node)}>
                        {node.name} · {node.status}{node.tasks != null && node.maxConcurrent != null ? ` · ${node.tasks}/${node.maxConcurrent}` : ''}
                      </option>
                    ))}
                  </select>
                  <p className={`text-[10px] leading-4 ${selectedClusterNodeUsable ? 'text-g400' : 'text-amber-600'}`}>
                    {selectedClusterNodeUsable
                      ? `${selectedClusterNode?.name} 可用；繁忙时任务自动排队。`
                      : `节点 ${selectedClusterNodeId} 当前不可用。`}
                    {clusterNodeMessage ? ` ${clusterNodeMessage}` : ''}
                  </p>
                </div>
                <div className="space-y-2.5">
                  {ENHANCE_OPTIONS.map(opt => {
                    const settingsKey = opt.kind === 'dub' ? null
                      : opt.kind === 'lipSync' ? 'lipSync' as const
                      : opt.kind as 'upscale' | 'interpolate';
                    const checked = settingsKey ? (selectedClip.settings?.[settingsKey] ?? false) : false;

                    const gpuLocked = !selectedClusterNodeUsable;

                    return (
                      <label
                        key={opt.kind}
                        className={`flex items-center justify-between p-3 bg-n0 rounded-lg border border-n40 transition-all ${gpuLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary'}`}
                        title={gpuLocked ? '需要处理集群节点，当前无可用节点' : ''}
                      >
                        <div className="flex items-center gap-2.5">
                          <opt.Icon size={16} className="text-primary" />
                          <div>
                            <div className="text-sm font-medium">{opt.label}{gpuLocked && <span className="ml-1 text-[10px] text-amber-600">需要处理节点</span>}</div>
                            <div className="text-[11px] text-n100">{opt.desc}</div>
                          </div>
                        </div>
                        {settingsKey ? (
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={gpuLocked}
                            onChange={e => {
                              updateClipSettings({ [settingsKey]: e.target.checked });
                              if (e.target.checked) setEnhancementKind(opt.kind);
                            }}
                            className="rounded bg-n0 border-n40 text-primary w-4 h-4 disabled:cursor-not-allowed"
                          />
                        ) : (
                          <button
                            onClick={(e) => { e.preventDefault(); setEnhancementKind('dub'); }}
                            className={`text-xs px-2 py-1 rounded ${enhancementKind === 'dub' ? 'bg-primary-light text-primary' : 'bg-n0 text-n300'}`}
                          >
                            设置
                          </button>
                        )}
                      </label>
                    );
                  })}
                </div>

                {enhancementKind === 'upscale' && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-n100">目标分辨率</span>
                    <select value={targetResolution} onChange={e => setTargetResolution(e.target.value as any)}
                      className="px-3 py-2 rounded-lg bg-n0 border border-n40 text-n700 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                      <option value="4K">4K</option>
                    </select>
                  </label>
                )}
                {enhancementKind === 'interpolate' && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-n100">目标帧率</span>
                    <select value={targetFps} onChange={e => setTargetFps(Number(e.target.value) as any)}
                      className="px-3 py-2 rounded-lg bg-n0 border border-n40 text-n700 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                      <option value={30}>30 FPS</option>
                      <option value={60}>60 FPS</option>
                      <option value={120}>120 FPS</option>
                    </select>
                  </label>
                )}
                {enhancementKind === 'dub' && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-n100">配音风格</span>
                    <select value={dubVoiceStyle} onChange={e => setDubVoiceStyle(e.target.value as any)}
                      className="px-3 py-2 rounded-lg bg-n0 border border-n40 text-n700 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                      <option value="neutral">自然 / 中性</option>
                      <option value="dramatic">戏剧 / 张力</option>
                      <option value="soft">柔和 / 叙述</option>
                    </select>
                  </label>
                )}
                {(enhancementKind === 'lipSync' || enhancementKind === 'dub') && (
                  <div className="space-y-2">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs text-n100">
                        {enhancementKind === 'dub' ? '配音音轨' : '最终对白音频'}
                      </span>
                      <select
                        value={lipSyncAudioClipId}
                        onChange={e => setLipSyncAudioClipId(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-n0 border border-n40 text-n700 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="">请选择音频</option>
                        {audioClips.map(clip => (
                          <option key={clip.id} value={clip.id}>
                            {clip.sourceLabel || '音频轨道'} · {clip.duration.toFixed(1)}s
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={audioUploading}
                      className="w-full h-9 rounded border border-n40 bg-n0 text-xs text-n500 hover:border-primary hover:text-primary disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {audioUploading ? <Loader size={13} className="animate-spin" /> : <Mic2 size={13} />}
                      {audioUploading ? '正在上传录音' : '上传配音演员录音'}
                    </button>
                    <p className="text-[11px] leading-4 text-n100">
                      {enhancementKind === 'dub'
                        ? '选择现有音轨或上传录音，处理集群将生成带该配音且嘴型同步的新视频。'
                        : '演员录音作为最终对白，提交后由处理集群让当前镜头嘴型匹配该音频。'}
                    </p>
                  </div>
                )}

                <InlineCreditEstimate
                  featureKey="video_enhancement"
                  params={{
                    operation: enhancementKind,
                    target_fps: targetFps,
                    resolution: targetResolution,
                  }}
                  fallbackCost={5}
                  className="mb-2 justify-center"
                />
                {enhanceError && (
                  <div role="alert" className="mb-2 rounded-lg border border-danger/20 bg-danger-light px-3 py-2 text-xs leading-5 text-danger">
                    {enhanceError}
                  </div>
                )}
                {enhanceNotice && !enhanceError && (
                  <div role="status" aria-live="polite" className="mb-2 rounded-lg border border-success/20 bg-success-light px-3 py-2 text-xs leading-5 text-success">
                    {enhanceNotice}
                  </div>
                )}
                <button
                  onClick={() => void applyEnhancement()}
                  disabled={processing || !selectedClusterNodeUsable || ((enhancementKind === 'lipSync' || enhancementKind === 'dub') && !lipSyncAudioClipId)}
                  className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-sm transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {processing ? (
                    <><Loader size={14} className="animate-spin" /> {processStage}{processProgress > 0 ? ` ${processProgress}%` : ''}</>
                  ) : (
                    <><Wand2 size={14} /> 提交处理任务</>
                  )}
                </button>
                {!selectedClusterNodeUsable && (
                  <div className="text-[11px] text-amber-600 text-center mt-1.5 leading-snug">
                    「{ENHANCE_OPTIONS.find(o => o.kind === enhancementKind)?.label}」需要处理集群节点，
                    当前无可用节点，暂不可用。
                  </div>
                )}
              </>
            ) : selectedClip?.type === 'audio' ? (
              <div className="space-y-4">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <Music size={15} className="text-primary" />
                    <h3 className="text-sm font-semibold text-n800">音频剪辑</h3>
                  </div>
                  <p className="truncate text-[11px] text-n100">{selectedClip.sourceLabel || '音频轨道'}</p>
                </div>

                <div className="rounded-lg border border-n40 bg-n0 p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[11px] text-n300">开始时间（秒）</span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={selectedClip.startTime.toFixed(1)}
                        onChange={event => updateSelectedAudioClip({ startTime: Math.max(0, Number(event.target.value) || 0) })}
                        onBlur={() => void persistAudioClip(selectedClip)}
                        className="w-full rounded border border-n40 px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-n300">使用时长（秒）</span>
                      <input
                        type="number"
                        min={0.1}
                        max={selectedClip.sourceDuration || undefined}
                        step={0.1}
                        value={selectedClip.duration.toFixed(1)}
                        onChange={event => updateSelectedAudioClip({
                          duration: Math.max(0.1, Math.min(selectedClip.sourceDuration || Number.POSITIVE_INFINITY, Number(event.target.value) || 0.1)),
                        })}
                        onBlur={() => void persistAudioClip(selectedClip)}
                        className="w-full rounded border border-n40 px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[11px] text-n300">源音频入点（秒）</span>
                      <input
                        type="number"
                        min={0}
                        max={Math.max(0, (selectedClip.sourceDuration || selectedClip.duration) - 0.1)}
                        step={0.1}
                        value={selectedClip.sourceOffset.toFixed(1)}
                        onChange={event => updateSelectedAudioClip({ sourceOffset: Math.max(0, Number(event.target.value) || 0) })}
                        onBlur={() => {
                          const current = clipsRef.current.find(clip => clip.id === selectedClip.id);
                          if (current) void persistAudioClip(current);
                        }}
                        className="w-full rounded border border-n40 px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
                      />
                    </label>
                    <div className="flex items-end pb-1 text-[10px] leading-4 text-n100">
                      拖动片段两侧也可裁剪；按住 Shift 临时关闭吸附。
                    </div>
                  </div>
                  <label className="block space-y-1">
                    <span className="flex justify-between text-[11px] text-n300">
                      <span>音量</span><span>{Math.round((selectedClip.volume ?? 1) * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      aria-label="音频音量"
                      step={0.01}
                      value={Math.min(1, selectedClip.volume ?? 1)}
                      onChange={event => updateSelectedAudioClip({ volume: Number(event.target.value) })}
                      onPointerUp={() => void persistAudioClip(selectedClip)}
                      onKeyUp={() => void persistAudioClip(selectedClip)}
                      onBlur={() => void persistAudioClip(selectedClip)}
                      className="w-full accent-primary"
                    />
                  </label>
                  {(selectedClip.audioKind === 'bgm' || (selectedClip.audioKind === 'sfx' && selectedClip.audioTrackId)) && (
                    <AudioFadeControls key={selectedClip.id} duration={selectedClip.duration}
                      fadeIn={selectedClip.fadeIn} fadeOut={selectedClip.fadeOut}
                      onChange={fades => updateSelectedAudioClip(fades, true)} />
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={alignSelectedAudioToVideo}
                    disabled={videoClips.length === 0}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded border border-primary/30 bg-primary-light text-xs font-medium text-primary disabled:opacity-50"
                  >
                    <AlignStartVertical size={13} /> 对齐当前视频片段
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSelectedAudioClip({ startTime: currentTime }, true)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded border border-n40 bg-n0 text-xs text-n500 hover:border-primary hover:text-primary"
                  >
                    <Play size={12} /> 移到播放头
                  </button>
                </div>
                <p className="text-[11px] leading-5 text-n100">
                  可直接拖动下方音频块；靠近视频起止点时会自动吸附。背景音乐和特效音的位置会保存并用于后续合成。
                </p>
              </div>
            ) : (
              <div className="text-sm text-n100 text-center py-10">
                请在下方时间轴选择一个视频片段
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Timeline */}
      <div className="h-80 bg-n0 border-t border-n40 flex flex-col shrink-0 z-20" aria-label="优化合成时间线编辑器">
        <div className="hidden" aria-hidden="true">
          {audioMediaElements}
        </div>
        {/* Toolbar */}
        <div className="responsive-toolbar px-4 py-1.5 border-b border-n40 flex justify-between items-center shrink-0 bg-n0">
          <div className="toolbar-group">
            <button
              type="button"
              onClick={undoTimeline}
              disabled={undoCount === 0}
              className="p-1.5 hover:bg-n20 rounded text-n300 hover:text-n800 transition-colors disabled:opacity-30"
              title="撤销（Ctrl+Z）"
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              onClick={redoTimeline}
              disabled={redoCount === 0}
              className="p-1.5 hover:bg-n20 rounded text-n300 hover:text-n800 transition-colors disabled:opacity-30"
              title="重做（Ctrl+Y / Ctrl+Shift+Z）"
            >
              <Redo2 size={14} />
            </button>
            <div className="w-px h-4 bg-n40 mx-1" />
            <button type="button" onClick={() => seekToEdit('previous')} className="p-1.5 hover:bg-n20 rounded text-n300" title="上一个剪辑点">
              <SkipBack size={14} />
            </button>
            <button
              onClick={togglePlay}
              className="p-1.5 hover:bg-n20 rounded text-n300 hover:text-n800 transition-colors"
              title={playing ? '暂停' : '播放'}
            >
              {playing ? <Pause size={14} className="fill-current" /> : <Play size={14} className="fill-current" />}
            </button>
            <button type="button" onClick={() => seekToEdit('next')} className="p-1.5 hover:bg-n20 rounded text-n300" title="下一个剪辑点">
              <SkipForward size={14} />
            </button>
            <div className="w-px h-4 bg-n40 mx-1" />
            <button
              onClick={handleSplit}
              disabled={!selectedClipId}
              className={`p-1.5 rounded transition-colors ${selectedClipId ? 'hover:bg-n20 text-n300 hover:text-n800' : 'text-n100 cursor-not-allowed'}`}
              title="在播放头处切分"
            >
              <Scissors size={14} />
            </button>
            <button
              onClick={handleDelete}
              disabled={!selectedClipId && !selectedSubtitleId}
              className={`p-1.5 rounded transition-colors ${selectedClipId || selectedSubtitleId ? 'hover:bg-n20 text-n300 hover:text-danger' : 'text-n100 cursor-not-allowed'}`}
              title="删除选中片段"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={handleDuplicate}
              disabled={!selectedClipId}
              className="p-1.5 rounded text-n300 hover:bg-n20 hover:text-n800 disabled:opacity-30"
              title="复制选中片段"
            >
              <Copy size={14} />
            </button>
            <div className="w-px h-4 bg-n40 mx-1" />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={audioUploading}
              className="flex items-center gap-1 px-2 py-1.5 hover:bg-n20 rounded text-xs text-n300 hover:text-n700 transition-colors disabled:opacity-50"
            >
              {audioUploading ? <Loader size={12} className="animate-spin" /> : <Mic2 size={12} />}
              {audioUploading ? '正在上传' : '加入配音'}
            </button>
            <button
              type="button"
              onClick={() => setShowMusicModal(true)}
              disabled={!episodeId}
              className="flex items-center gap-1 px-2 py-1.5 hover:bg-n20 rounded text-xs text-n300 hover:text-success transition-colors disabled:opacity-50"
            >
              <Music size={12} /> 背景音乐
            </button>
            <button
              type="button"
              onClick={() => setShowSfxModal(true)}
              disabled={!episodeId}
              className="flex items-center gap-1 px-2 py-1.5 hover:bg-n20 rounded text-xs text-n300 hover:text-primary transition-colors disabled:opacity-50"
            >
              <Sparkles size={12} /> 特效音
            </button>
            <button
              type="button"
              onClick={handleAddSubtitle}
              disabled={videoClips.length === 0}
              className="flex items-center gap-1 px-2 py-1.5 hover:bg-n20 rounded text-xs text-n300 hover:text-primary transition-colors disabled:opacity-50"
              title="在播放头位置添加字幕"
            >
              <Captions size={13} /> 字幕
            </button>
            <button type="button" disabled={!timelineReady || trackState.video.locked}
              onClick={() => {
                const id = `black_${crypto.randomUUID()}`;
                commitTimeline(current => insertBlackClip(current, id, currentTime));
                setSelectedSubtitleId(null); setSelectedClipId(id);
              }}
              className="flex items-center gap-1 rounded px-2 py-1.5 text-xs text-n300 hover:bg-n20 hover:text-primary disabled:opacity-50"
              title="在播放头附近的视频边界插入独立黑幕，可拖动和调整时长">
              <Film size={13} /> 插入黑幕
            </button>
            <button type="button" onClick={() => setShowSubtitleModal(true)}
              disabled={!episodeId || videoClips.length === 0}
              className="flex items-center gap-1 rounded px-2 py-1.5 text-xs text-primary hover:bg-primary/5 disabled:opacity-50"
              title="识别视频原声或配音，预览后加入字幕轨道">
              <Wand2 size={13} /> AI 字幕
            </button>
            {showSubtitleModal && <SubtitleTranscriptionModal
              key={episodeId}
              episodeId={episodeId} projectId={projectId || undefined}
              clips={clips} subtitles={subtitles} defaultSource={composeAudioMode}
              onClose={() => setShowSubtitleModal(false)}
              onApply={(generated, mode, expectedTimeline) => {
                if (subtitleTimelineKey(clipsRef.current) !== expectedTimeline) throw new Error('识别期间时间线已变化，请重新识别');
                const merged = mergeSubtitleResults(subtitlesRef.current, generated, mode);
                if (!merged.added) throw new Error('没有可加入的字幕，请检查加入方式');
                commitSubtitleTimeline(current => ({ ...current, subtitles: merged.subtitles }));
                setEnhanceNotice(`已加入 ${merged.added} 条 AI 字幕，可编辑或撤销。`);
              }}
            />}
            <input type="file" accept="audio/*" className="hidden" ref={fileInputRef} onChange={handleAudioUpload} />
          </div>

          <div className="toolbar-actions">
            <button
              type="button"
              onClick={() => setSnapEnabled(value => !value)}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${snapEnabled ? 'bg-primary-light text-primary' : 'text-n300 hover:bg-n20'}`}
              title="磁吸到播放头和片段边缘；拖动时按 Shift 可临时关闭"
            >
              <Magnet size={13} /> 磁吸
            </button>
            <button type="button" onClick={fitTimeline} className="px-2 py-1 rounded text-[11px] text-n300 hover:bg-n20" title="缩放到适合窗口">
              适合窗口
            </button>
            <button
              onClick={() => setScale(Math.max(5, scale - 5))}
              className="p-1.5 hover:bg-n20 rounded text-n300 hover:text-n800 transition-colors"
            >
              <ZoomOut size={14} />
            </button>
            <span className="text-[11px] text-n100 font-mono w-14 text-center">{scale}px/s</span>
            <button
              onClick={() => setScale(Math.min(100, scale + 5))}
              className="p-1.5 hover:bg-n20 rounded text-n300 hover:text-n800 transition-colors"
            >
              <ZoomIn size={14} />
            </button>
          </div>
        </div>

        {/* Tracks */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Track headers */}
          <div className="w-28 shrink-0 border-r border-n40 bg-n0 flex flex-col z-10">
            <div className="h-5 border-b border-n40 px-2 flex items-center text-[9px] text-n100">轨道</div>
            {([
              { key: 'video' as const, label: '视频', Icon: MonitorPlay, height: 'h-16' },
              { key: 'voice' as const, label: '配音', Icon: Mic2, height: 'h-10' },
              { key: 'bgm' as const, label: '音乐', Icon: Music, height: 'h-10' },
              { key: 'sfx' as const, label: '音效', Icon: Sparkles, height: 'h-10' },
            ]).map(({ key, label, Icon, height }) => (
              <div key={key} className={`${height} border-b border-n40 flex items-center justify-between px-2 text-[11px] text-n300 gap-1`}>
                <span className="flex items-center gap-1 min-w-0"><Icon size={12} /><span className="truncate">{label}</span></span>
                <span className="flex items-center">
                  <button
                    type="button"
                    onClick={() => toggleTrackState(key)}
                    className={`p-1 rounded hover:bg-n20 ${trackState[key].locked ? 'text-primary' : 'text-n100'}`}
                    title={trackState[key].locked ? `解锁${label}轨` : `锁定${label}轨`}
                  >
                    {trackState[key].locked ? <Lock size={11} /> : <Unlock size={11} />}
                  </button>
                </span>
              </div>
            ))}
            <div className="h-10 border-b border-n40 flex items-center px-2 text-[11px] text-n300 gap-1">
              <Captions size={12} /><span className="truncate">字幕</span>
            </div>
          </div>

          {/* Track content */}
          <div data-testid="enhance-timeline-viewport" className="flex-1 overflow-auto relative" ref={timelineContainerRef}>
            <div data-testid="enhance-timeline-seek-surface" onMouseDown={handleTimelineSeekStart}
              style={{ width: `${totalDuration * scale}px`, minWidth: '100%' }} className="relative min-h-full cursor-crosshair">
              {/* Ruler */}
              <div data-testid="enhance-timeline-ruler" className="h-5 border-b border-n40 relative">
                {timelineRuler}
              </div>

              {/* Playhead */}
              <div
                data-testid="enhance-timeline-playhead"
                className="absolute top-0 bottom-0 w-px bg-red-500 z-50 pointer-events-none"
                style={{ left: `${currentTime * scale}px` }}
              >
                <div className="absolute top-0 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-b-md" />
              </div>
              {snapGuide != null && (
                <div
                  className="absolute top-5 bottom-0 w-px bg-primary z-40 pointer-events-none"
                  style={{ left: `${snapGuide * scale}px` }}
                  aria-hidden="true"
                />
              )}

              {timelineMediaLayers}
            </div>
          </div>
        </div>
      </div>
      {showMusicModal && episodeId && (
        <MusicModal
          episodeId={episodeId}
          projectId={projectId || undefined}
          script={modalScript}
          onClose={() => setShowMusicModal(false)}
          onCreated={async () => {
            reloadEnhanceData();
            setShowMusicModal(false);
          }}
        />
      )}
      {showSfxModal && episodeId && (
        <SfxModal
          episodeId={episodeId}
          projectId={projectId || undefined}
          script={modalScript}
          onClose={() => setShowSfxModal(false)}
          onCreated={async () => {
            reloadEnhanceData();
            setShowSfxModal(false);
          }}
        />
      )}
    </div>
  );
};
