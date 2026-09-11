import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Upload, Video, Play, RefreshCw, Trash2, Link, Unlink,
    GripVertical, CheckSquare, Square, Clock, Film, AlertCircle,
    Image as ImageIcon, ChevronDown, Download, Maximize, Mic, Scissors,
    LayoutGrid, List, X, Loader2, Check, Music, Eye, Volume2, Plus,
    History, Database, ImageOff, RotateCw, Settings, Library,
    Combine, Split, SkipBack, SkipForward
} from 'lucide-react';
import {
    ALL_MODELS,
    SELECTABLE_MODELS,
    buildVideoModelOptions,
    formatVideoModelOptionLabel,
    getVideoModelRuntimeOptions,
    getModelDisplayName,
    getVideoCreditFallbackCost,
    getVideoCreditEstimateParams,
    inferDashScopeTaskType,
    inferSeedanceTaskType,
    isDashScopeVideoModel,
    isMiniMaxH3Model,
    isRetiredLocalVideoModel,
    isMiniMaxHailuoDailyLimitError,
    isMiniMaxHailuoHiddenToday,
    isSeedanceAgentPlanModel,
    isSeedanceVideoModel,
    makeDefaultDashScopeParams,
    MINIMAX_HAILUO_LIMIT_EVENT,
    normalizeMiniMaxVideoParams,
    seedanceSubModelForVideoModel,
    supportsSeedanceMultimodalModel,
    withCurrentVideoModelOption,
    type DashScopeVideoModel,
    type DashScopeVideoParams,
    type MiniMaxVideoParams,
    type SeedanceMediaInput,
    type SeedanceParams,
    type ShotType,
    type VideoModel,
    validateSeedanceMediaInputs,
    getSeedanceOutputError,
    normalizeSeedanceOutputResolution,
} from '../services/videoModelService';
import {
    clearProjectVideoTasks,
    cropVideo,
    getProjectVideoTasks,
    secureMediaUrl,
    uploadAudio,
    uploadImage,
} from '@runtime/videoMediaService';
import {
    formatUploadTime,
    generateUUID,
    getTasks,
    submitDashScopeVideoTask,
    submitSeedanceTask,
    submitTaskQueued,
    submitUpscaleTaskQueued,
    submitVoiceTaskQueued,
} from '@runtime/videoTaskService';
import type {
    MergedCardSnapshot,
    TaskGroup,
    TaskStatus,
    UploadedImage,
    VideoTask,
} from '../services/videoTaskTypes';
import {
    computeReactiveDurationFromMeta,
    loadWorkspaceSession,
    saveWorkspaceSession,
    type StoryboardMeta,
    type WorkspaceSession,
} from '../services/videoWorkspaceService';
import { AppView, TaskNotification } from '../types';
import type { VideoVoiceReference, MaterialLibrary } from '../types';
import { ProjectMaterialPicker, useProjectMaterialPicker, type ProjectMaterialPickerItem } from './ProjectMaterialPicker';
import { applyVideoProjectMaterial } from '../utils/videoProjectMaterial';
import {
    getCardHeightClass,
    CARD_MEDIA_HEIGHT_CLASS,
    CARD_BODY_SCROLL_CLASS,
    PLACEHOLDER_PROMPT_TEXTAREA_CLASS,
    RESULT_PROMPT_READONLY_CLASS,
    getVideoResultPlaceholderCount,
} from '../utils/videoCardLayout';
import {
    DurationFieldForGroup,
    AudioBadgesRow,
} from './video/VideoCard';
import { MiniMaxVideoPanel } from './video/MiniMaxVideoPanel';
import { CapabilityVideoPanel } from './video/CapabilityVideoPanel';
import { MediaBadges } from './video/MediaBadges';
import { VideoModelPicker } from './video/VideoModelPicker';
import { VideoUploadModal } from './video/VideoUploadModal';
import { appendUploadedVideo, importVideoResult, readVideoResultDuration, type VideoImportDraft } from '../services/videoUploadService';




import {
    createVideoSegment,
    fetchVideoCapabilities,
    getVideoCapability,
    updateVideoSegment,
    type VideoCapabilityManifest,
} from '../services/videoWorkflowService';
import { getVideoSegments } from '../services/episodeDataService';
import { buildVideoTaskImport } from '../utils/videoTaskImport';
import { buildEmptyTaskGroup } from '../utils/videoTaskInsert';
import { extractFileId, resolveVideoImageIdentifier } from '../utils/videoImageIdentifier';
import { deleteEntityFile } from '../services/entityFileService';
import { getVideoTaskModel, reconcileActiveVideoTasks } from '../services/videoTaskReconciliation';
import { hasStoredVideoResult, mergeStoredVideoResult } from '../utils/videoResultPresentation';
import {
    buildDownwardMergePlan,
    buildVideoStoryboardShotLookup,
    canCreateFirstLastPair,
    getTaskStatusHistoryDelta,
    mergeTaskStatusHistories,
    partitionMergedSnapshots,
    type VideoStoryboardShotInfo,
} from '../utils/videoTaskMerge';
import { useSeedanceCandidates } from '../hooks/useSeedanceCandidates';
import type { SyncMode } from './video/StoryboardSyncModal';
import { applySyncStrategy } from '../utils/storyboardSync';
import { usePersistedPageState } from '../hooks/usePersistedPageState';
import { LazyVideo } from './LazyVideo';
import { GpuNodeSelector, type GpuNodeSelection } from '@runtime/GpuNodeSelector';
import { InlineCreditEstimate } from './InlineCreditEstimate';
import { extractSpokenDialogue } from '../utils/scriptPipelineParsers';
import { clampSec, DURATION_MAX_SEC, SEEDANCE_AGENT_PLAN_MAX_DURATION_SEC } from '../utils/durationMapping';
import {
    upgradeLegacyStoryboardVideoPrompt,
    type StoryboardVideoPromptSource,
} from '../utils/storyboardVideoPrompt';
import {
    getVideoFrameLabel,
    resolveVideoFrameTime,
    type VideoFramePosition,
} from '../utils/videoFrameExtraction';
import {
    createVideoVoiceReference,
    extractVideoReferenceAudio,
    getVideoVoiceReferences,
    normalizeVideoVoiceReference,
} from '../services/videoVoiceReferenceService';






import {
    startVideoPoll,
    detachVideoPollCallbacks,
    attachVideoPollCallbacks,
    stopVideoPoll,
    getKnownVideoTaskIds,
    getVideoPollTaskId,
    isVideoPollActive,
} from '../services/videoTaskPoller';

const SeedancePanelWithCandidates = React.lazy(() =>
    import('./video/SeedancePanelWithCandidates').then(module => ({
        default: module.SeedancePanelWithCandidates,
    }))
);

const DashScopeCardWithCandidates = React.lazy(() =>
    import('./video/DashScopeCardWithCandidates').then(module => ({
        default: module.DashScopeCardWithCandidates,
    }))
);

const SeedanceDetailModal = React.lazy(() =>
    import('./video/SeedanceDetailModal').then(module => ({
        default: module.SeedanceDetailModal,
    }))
);

const StoryboardSyncModal = React.lazy(() =>
    import('./video/StoryboardSyncModal').then(module => ({
        default: module.StoryboardSyncModal,
    }))
);

const VideoProviderPanelFallback: React.FC<{ label: string }> = ({ label }) => (
    <div className="min-h-[144px] rounded-md border border-n40 bg-n20 animate-pulse flex items-center justify-center text-xs text-n100">
        {label}
    </div>
);

const VideoModalFallback: React.FC<{ label: string }> = ({ label }) => (
    <div className="fixed inset-0 z-50 bg-n900/50 flex items-center justify-center p-4">
        <div className="w-[480px] max-w-full rounded-md border border-n40 bg-n0 p-6 text-center text-sm text-n300 shadow-bottom">
            {label}
        </div>
    </div>
);



interface VideoPageProps {
    materialLibrary?: MaterialLibrary;
    onRefreshProjectMaterials?: () => Promise<void>;
    onRegisterSessionSave?: (save: (() => Promise<{ success: boolean }>) | null) => void;
    suspendSessionSave?: boolean;
    onAddNotification?: (notification: Omit<TaskNotification, 'id' | 'timestamp'>) => string;
    onUpdateNotification?: (id: string, updates: Partial<TaskNotification>) => void;
    isActive?: boolean;
    sessionScope?: string;
    projectId?: string;


    episodeId?: string;

    storyboardItems?: any[];

    onRequestReimport?: () => void | Promise<void>;

    defaultAspectRatio?: '16:9' | '9:16';
}







const INSERT_EMPTY_BTN_BASE_CLASSES =
    'w-full my-1 py-1.5 border border-dashed rounded text-[10px] flex items-center justify-center gap-1 transition-colors';
const InsertEmptyCardButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className={`${INSERT_EMPTY_BTN_BASE_CLASSES} border-n40 hover:border-primary hover:bg-primary-light text-n100 hover:text-primary`}
        title="在此处插入一张空白卡片"
    >
        <Plus className="w-3 h-3" /> 插入空卡
    </button>
);



const InsertEmptyCardSpacer: React.FC = () => (
    <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className={`${INSERT_EMPTY_BTN_BASE_CLASSES} border-transparent text-transparent pointer-events-none select-none`}
    >
        <Plus className="w-3 h-3" /> 插入空卡
    </button>
);



const normVideoKey = (u: any): any =>
    typeof u === 'string' ? u.split('?')[0].replace(/^https?:\/\/[^/]+/, '') : u;

const toPersistedVideoUrl = (url: string): string => {
    const clean = (url || '').split('?')[0];
    if (!clean) return clean;
    try {
        const parsed = new URL(clean, window.location.origin);
        if (parsed.pathname.startsWith('/storage/')) return parsed.pathname;
    } catch {
        // Keep custom/proxy URLs as-is after removing transient query params.
    }
    return clean;
};

const securePersistedTaskStatus = (status: TaskStatus | undefined): TaskStatus | undefined => (
    status ? {
        ...status,
        videos: (status.videos || []).map(url => secureMediaUrl(url, { absolute: true })),
        result: status.result ? secureMediaUrl(status.result, { absolute: true }) : '',
    } : undefined
);



function dedupVideosWithTimes(
    videos: any[],
    times: any[],
    models: Array<VideoModel | undefined> = [],
): { videos: any[]; times: any[]; models: Array<VideoModel | undefined> } {
    const seen = new Set<any>();
    const v: any[] = [];
    const t: any[] = [];
    const m: Array<VideoModel | undefined> = [];
    for (let i = 0; i < (videos || []).length; i++) {
        const k = normVideoKey(videos[i]);
        if (seen.has(k)) continue;
        seen.add(k);
        v.push(videos[i]);
        t.push(times ? times[i] : undefined);
        m.push(models[i]);
    }
    return { videos: v, times: t, models: m };
}

const VIDEO_GROUP_PAGE_SIZE = 10;
const VIDEO_BATCH_WAIT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const VIDEO_LIBRARY_CANDIDATE_PARAMS: SeedanceParams = {
    sub_model: 'standard',
    prompt: '',
    media_inputs: [],
};

type VideoBatchWaitResult = 'done' | 'failed' | 'timeout';



const EMPTY_MATERIAL_LIBRARY: MaterialLibrary = {};

export const VideoPage: React.FC<VideoPageProps> = ({
    materialLibrary = EMPTY_MATERIAL_LIBRARY,
    onRefreshProjectMaterials,
    onRegisterSessionSave,
    suspendSessionSave = false,
    onAddNotification,
    onUpdateNotification,
    isActive = true,
    sessionScope,
    projectId,
    episodeId,
    storyboardItems = [],
    onRequestReimport,
    defaultAspectRatio = '16:9',
}) => {

    const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
    const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
    const {
        candidates: videoLibraryCandidates,
        isLoading: videoLibraryLoading,
    } = useSeedanceCandidates({ currentParams: VIDEO_LIBRARY_CANDIDATE_PARAMS });
    const [imagePrompts, setImagePrompts] = useState<Record<string, string>>({});
    const [tasksStatus, setTasksStatus] = useState<Record<string, TaskStatus>>({});
    const projectMaterialPicker = useProjectMaterialPicker(materialLibrary, undefined, undefined, undefined, 'all');
    const [projectMaterialTarget, setProjectMaterialTarget] = useState<{ groupUuid: string; imageId: string } | null>(null);
    const [projectMaterialLoading, setProjectMaterialLoading] = useState(false);
    const [projectMaterialBusy, setProjectMaterialBusy] = useState(false);
    const [projectMaterialError, setProjectMaterialError] = useState<string | null>(null);
    const projectMaterialLock = useRef(false);
    const refreshProjectMaterials = async () => {
        setProjectMaterialLoading(true);
        setProjectMaterialError(null);
        try { await onRefreshProjectMaterials?.(); }
        catch { setProjectMaterialError('项目素材加载失败，请点击“刷新素材”重试。'); }
        finally { setProjectMaterialLoading(false); }
    };
    const openProjectMaterials = (groupUuid: string, imageId: string) => {
        projectMaterialPicker.setMaterialPickerFilter('all');
        projectMaterialPicker.setMaterialPickerSearch('');
        setProjectMaterialTarget({ groupUuid, imageId });
        void refreshProjectMaterials();
    };
    const [taskStartTimes, setTaskStartTimes] = useState<Record<string, number>>({});




    const [viewMode, setViewMode] = usePersistedPageState<'card' | 'list'>({
        page: 'VideoPage:viewMode',
        episodeId: sessionScope ?? null,
        version: 1,
        defaultValue: 'card',
    });
    const [isLoading, setIsLoading] = useState(true);
    const [videoCapabilities, setVideoCapabilities] = useState<VideoCapabilityManifest | null>(null);
    const [miniMaxHailuoLimited, setMiniMaxHailuoLimited] = useState(isMiniMaxHailuoHiddenToday);
    useEffect(() => {
        const refreshLimit = () => setMiniMaxHailuoLimited(isMiniMaxHailuoHiddenToday());
        window.addEventListener(MINIMAX_HAILUO_LIMIT_EVENT, refreshLimit);
        window.addEventListener('focus', refreshLimit);
        const timer = window.setInterval(refreshLimit, 60_000);
        return () => {
            window.removeEventListener(MINIMAX_HAILUO_LIMIT_EVENT, refreshLimit);
            window.removeEventListener('focus', refreshLimit);
            window.clearInterval(timer);
        };
    }, []);
    useEffect(() => {
        let cancelled = false;
        const refresh = () => {
            void fetchVideoCapabilities('workflow', { force: true }).then((manifest) => {
                if (!cancelled) setVideoCapabilities(manifest);
            });
        };
        refresh();
        const refreshTimer = window.setInterval(refresh, 15_000);
        window.addEventListener('focus', refresh);
        return () => {
            cancelled = true;
            window.clearInterval(refreshTimer);
            window.removeEventListener('focus', refresh);
        };
    }, []);
    const videoCapabilityModels = useMemo(() => {
        const models = videoCapabilities?.models ?? null;
        if (!models || !miniMaxHailuoLimited) return models;
        return models.map(model => model.key === 'MINI'
            ? {
                ...model,
                available: false,
                unavailable_reason: '今日 3 次调用额度已用完，明日 00:00 后自动恢复',
            }
            : model);
    }, [miniMaxHailuoLimited, videoCapabilities]);
    const selectableVideoModelOptions = useMemo(
        () => buildVideoModelOptions(videoCapabilityModels, SELECTABLE_MODELS),
        [videoCapabilityModels],
    );
    const allVideoModelOptions = useMemo(
        () => buildVideoModelOptions(videoCapabilityModels, SELECTABLE_MODELS),
        [videoCapabilityModels],
    );
    const videoCapabilityReady = Boolean(
        videoCapabilities
        && videoCapabilities.manifest_version !== 'unavailable'
        && (videoCapabilities.models?.length || 0) > 0,
    );
    const availableVideoModelSet = useMemo(
        () => new Set(
            allVideoModelOptions
                .filter(option => option.available)
                .map(option => option.value),
        ),
        [allVideoModelOptions],
    );
    const getModelSelectOptions = useCallback(
        (currentModel: VideoModel, options = selectableVideoModelOptions) => (
            withCurrentVideoModelOption(options, currentModel, videoCapabilityModels)
        ),
        [selectableVideoModelOptions, videoCapabilityModels],
    );
    const isVideoModelAvailable = useCallback((model: VideoModel): boolean => (
        !isRetiredLocalVideoModel(model) && (!videoCapabilityReady || availableVideoModelSet.has(model))
    ), [availableVideoModelSet, videoCapabilityReady]);
    const getVideoModelUnavailableReason = useCallback((model: VideoModel): string => (
        (isRetiredLocalVideoModel(model) ? '该本地模型已停用，请手动选择可用模型' : allVideoModelOptions.find(option => option.value === model)?.unavailableReason)
        || '后台未配置可用通道，或模型服务暂不可用'
    ), [allVideoModelOptions]);
    const seedanceSupportsMultimodal = useCallback(
        (model: VideoModel): boolean => supportsSeedanceMultimodalModel(model),
        [],
    );
    const getSeedanceMaxDuration = useCallback((model?: VideoModel): number => (
        model && isSeedanceAgentPlanModel(model)
            ? SEEDANCE_AGENT_PLAN_MAX_DURATION_SEC
            : DURATION_MAX_SEC
    ), []);
    const getSeedanceAudioReferenceNotice = useCallback((model: VideoModel): string | undefined => (
        seedanceSupportsMultimodal(model)
            ? undefined
            : 'Seedance 1.5 Pro 当前不接收参考音频；参考配音会保留在卡片中，提交时不发送。'
    ), [seedanceSupportsMultimodal]);
    const miniMaxCapability = videoCapabilityModels?.find(model => model.key === 'MINI');
    const miniMaxModelOptions = useMemo(() => (
        getVideoModelRuntimeOptions(miniMaxCapability)
    ), [miniMaxCapability]);
    const defaultMiniMaxVideoModel = miniMaxModelOptions[0]?.value;
    const [globalModel, setGlobalModel] = usePersistedPageState<VideoModel>({
        page: 'VideoPage:globalModel',
        episodeId: sessionScope ?? null,



        version: 3,
        defaultValue: 'Seedance15',
    });
    useEffect(() => {
        if (!videoCapabilityReady) return;
        const availableOptions = selectableVideoModelOptions.filter(option => option.available);
        if (availableOptions.length === 0) return;
        if (availableOptions.some(option => option.value === globalModel)) return;
        setGlobalModel(availableOptions[0].value);
    }, [globalModel, selectableVideoModelOptions, setGlobalModel, videoCapabilityReady]);


    const [dragSrcIndex, setDragSrcIndex] = useState<number | null>(null);


    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [lightboxType, setLightboxType] = useState<'image' | 'video'>('image');


    const [upscaleModalUuid, setUpscaleModalUuid] = useState<string | null>(null);
    const [upscaleNodeSelection, setUpscaleNodeSelection] = useState<GpuNodeSelection | null>(null);
    const [voiceModalUuid, setVoiceModalUuid] = useState<string | null>(null);
    const [voiceReferenceModalUuid, setVoiceReferenceModalUuid] = useState<string | null>(null);
    const [voiceReferenceVideoIndex, setVoiceReferenceVideoIndex] = useState(0);
    const [voiceReferenceCharacter, setVoiceReferenceCharacter] = useState('');
    const [voiceReferenceSaving, setVoiceReferenceSaving] = useState(false);
    const [referenceAudioExtractingUuid, setReferenceAudioExtractingUuid] = useState<string | null>(null);
    const [videoVoiceReferences, setVideoVoiceReferences] = useState<VideoVoiceReference[]>([]);
    const [editModalUuid, setEditModalUuid] = useState<string | null>(null);
    const [mergeDialog, setMergeDialog] = useState<{
        groupUuid: string;
        selectedEndIndex: number;
    } | null>(null);
    const [mergedCardDialogUuid, setMergedCardDialogUuid] = useState<string | null>(null);
    const [seedanceDetailUuid, setSeedanceDetailUuid] = useState<string | null>(null);
    const [selectedVideoIndex, setSelectedVideoIndex] = useState(0);
    const [voiceAudioFile, setVoiceAudioFile] = useState<File | null>(null);
    const [voiceStartTime, setVoiceStartTime] = useState(0);
    const [voicePrompt, setVoicePrompt] = useState('');
    const [cropStartTime, setCropStartTime] = useState(0);
    const [cropEndTime, setCropEndTime] = useState(5);
    const [isExtractingFrame, setIsExtractingFrame] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isBatchRunning, setIsBatchRunning] = useState(false);
    const [beautifyApplyingKey, setBeautifyApplyingKey] = useState<string | null>(null);


    const [toast, setToast] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const [videoUploadTarget, setVideoUploadTarget] = useState<string | null>(null);
    const videoUploadLock = useRef<string | null>(null);
    const videoUploadCards = useRef(new WeakMap<VideoImportDraft, ReturnType<typeof buildEmptyTaskGroup>>());
    const videoUploadMounted = useRef(true);
    const videoUploadState = useRef({ taskGroups, uploadedImages, tasksStatus });
    videoUploadState.current = { taskGroups, uploadedImages, tasksStatus };
    useEffect(() => {
        videoUploadMounted.current = true;
        return () => { videoUploadMounted.current = false; };
    }, []);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const leftPanelRef = useRef<HTMLDivElement>(null);
    const rightPanelRef = useRef<HTMLDivElement>(null);
    const editVideoRef = useRef<HTMLVideoElement>(null);
    const pollingIntervals = useRef<Record<string, NodeJS.Timeout>>({});
    const batchWaitersRef = useRef<Record<string, {
        timeoutId: ReturnType<typeof setTimeout>;
        resolve: (result: VideoBatchWaitResult) => void;
    }>>({});
    const isScrollSyncing = useRef(false);
    const initialVideoTaskCheckDoneRef = useRef(false);

    useEffect(() => () => {
        Object.values(batchWaitersRef.current).forEach(waiter => {
            clearTimeout(waiter.timeoutId);
            waiter.resolve('failed');
        });
        batchWaitersRef.current = {};
    }, []);


    const [seedanceParamsByUuid, setSeedanceParamsByUuid] = useState<Record<string, SeedanceParams>>({});


    const [dashScopeParamsByUuid, setDashScopeParamsByUuid] = useState<Record<string, DashScopeVideoParams>>({});


    const [dashScopePicker, setDashScopePicker] = useState<{
        groupUuid: string;
        callback: (m: SeedanceMediaInput) => void;
    } | null>(null);


    const [storyboardMetaByItemId, setStoryboardMetaByItemId] = useState<Record<string, StoryboardMeta>>({});

    const refreshVideoVoiceReferences = useCallback(async () => {
        if (!projectId) {
            setVideoVoiceReferences([]);
            return;
        }
        try {
            const response = await getVideoVoiceReferences(projectId);
            setVideoVoiceReferences((response.references || []).map(normalizeVideoVoiceReference));
        } catch (error) {
            console.warn('Failed to load video voice references:', error);
        }
    }, [projectId]);

    useEffect(() => {
        void refreshVideoVoiceReferences();
    }, [refreshVideoVoiceReferences]);


    const [syncModalOpen, setSyncModalOpen] = useState(false);

    // Imported storyboard images retain their item id and linked card id for reverse lookup.
    const getStoryboardItemId = useCallback((uuid: string): string | undefined => {
        const group = taskGroups.find(g => g.uuid === uuid);
        if (!group) return undefined;
        const firstId = group.ids?.[0];
        if (!firstId) return undefined;
        const img = uploadedImages.find(i => i.id === firstId || i.linkedGroupUuids?.includes(uuid));
        return img?.storyboardItemId ?? undefined;
    }, [taskGroups, uploadedImages]);

    const storyboardItemById = useMemo(() => {
        const result = new Map<string, StoryboardVideoPromptSource>();
        storyboardItems.forEach((item: any) => {
            const itemId = String(item?.item_id ?? item?.itemId ?? item?.id ?? '').trim();
            if (itemId) result.set(itemId, item);
        });
        return result;
    }, [storyboardItems]);

    const storyboardShotInfoByItemId = useMemo(
        () => buildVideoStoryboardShotLookup(storyboardItems),
        [storyboardItems],
    );

    const getImageShotInfo = useCallback((imageId: string): VideoStoryboardShotInfo | null => {
        const image = uploadedImages.find(candidate => candidate.id === imageId);
        const itemId = String(image?.storyboardItemId || imageId || '').trim();
        const persistedLabel = String(image?.storyboardShotLabel || '').trim();
        if (persistedLabel && image?.storyboardSegmentNo && image?.storyboardLocalShotNo) {
            return {
                itemId,
                segmentKey: image.storyboardSegmentKey || `storyboard-segment-${image.storyboardSegmentNo}`,
                segmentNo: image.storyboardSegmentNo,
                localShotNo: image.storyboardLocalShotNo,
                label: persistedLabel,
                isFirstInSegment: Boolean(image.isStoryboardSegmentStart),
            };
        }
        const current = storyboardShotInfoByItemId.get(itemId);
        if (current) return current;
        if (image?.storyboardItemId && image.sortOrder != null) {
            return {
                itemId,
                segmentKey: 'storyboard-segment-unassigned',
                segmentNo: 1,
                localShotNo: image.sortOrder + 1,
                label: `镜头1-${image.sortOrder + 1}`,
                isFirstInSegment: image.sortOrder === 0,
            };
        }
        return null;
    }, [storyboardShotInfoByItemId, uploadedImages]);

    const getGroupShotRange = useCallback((group: TaskGroup, index: number) => {
        const start = getImageShotInfo(group.ids?.[0] || '');
        const end = getImageShotInfo(group.ids?.[group.ids.length - 1] || '');
        const label = start && end
            ? (start.itemId === end.itemId ? start.label : `${start.label} 至 ${end.label}`)
            : (start?.label || end?.label || `#${index + 1}`);
        return {
            start,
            end,
            label,
            isSegmentStart: Boolean(start?.isFirstInSegment),
            crossesSegment: Boolean(start && end && start.segmentKey !== end.segmentKey),
        };
    }, [getImageShotInfo]);

    const getStoryboardPromptSourcesForGroup = useCallback((group: TaskGroup | undefined) => {
        if (!group) return [];
        return (group.ids || []).map(imageId => {
            const image = uploadedImages.find(candidate => candidate.id === imageId);
            const itemId = String(image?.storyboardItemId || imageId || '').trim();
            return storyboardItemById.get(itemId);
        }).filter((item): item is StoryboardVideoPromptSource => Boolean(item));
    }, [storyboardItemById, uploadedImages]);

    const getEffectiveGroupPrompt = useCallback((group: TaskGroup | undefined): string => {
        if (!group?.ids?.[0]) return '';
        const current = imagePrompts[group.ids[0]] || '';
        return upgradeLegacyStoryboardVideoPrompt(
            current,
            getStoryboardPromptSourcesForGroup(group),
        );
    }, [getStoryboardPromptSourcesForGroup, imagePrompts]);

    const getCharacterNameForGroup = useCallback((group: TaskGroup): string => {
        const itemId = group.ids?.[0];
        if (!itemId) return '';
        const item = storyboardItems.find((candidate: any) =>
            (candidate.item_id ?? candidate.itemId ?? candidate.id) === itemId
        );
        const dialogue = String(item?.dialogue ?? storyboardMetaByItemId[itemId]?.dialogue ?? '').trim();
        if (!dialogue) return '';
        const knownCharacters = videoVoiceReferences.map(reference => reference.characterName);
        return extractSpokenDialogue(dialogue.split(/\r?\n/)[0], knownCharacters).speaker.trim();
    }, [storyboardItems, storyboardMetaByItemId, videoVoiceReferences]);

    const getVideoVoiceReferenceForGroup = useCallback((group: TaskGroup): VideoVoiceReference | undefined => {
        const characterName = getCharacterNameForGroup(group);
        if (!characterName) return undefined;
        return videoVoiceReferences.find(reference => reference.characterName === characterName);
    }, [getCharacterNameForGroup, videoVoiceReferences]);

    const applyPreferredReferenceAudio = useCallback((
        group: TaskGroup,
        params: SeedanceParams,
    ): SeedanceParams => {
        const hasManualOrStoryboardAudio = (params.media_inputs || []).some(media => media.kind === 'audio');
        if (hasManualOrStoryboardAudio) return params;
        const reference = getVideoVoiceReferenceForGroup(group);
        if (!reference?.referenceAudioUrl) return params;
        return {
            ...params,
            media_inputs: [
                ...(params.media_inputs || []),
                {
                    kind: 'audio',
                    url: reference.referenceAudioUrl,
                    role: 'reference_audio',
                },
            ],
        };
    }, [getVideoVoiceReferenceForGroup]);

    const prepareSeedanceParamsForCapability = useCallback((model: VideoModel, params: SeedanceParams): SeedanceParams => {
        if (seedanceSupportsMultimodal(model)) return params;
        return {
            ...params,
            media_inputs: (params.media_inputs || []).filter(media => media.kind !== 'audio'),
            resolution: normalizeSeedanceOutputResolution(params.resolution) === '1080p' ? '1080p' : '720p',
            ratio: params.ratio && params.ratio !== 'adaptive' ? params.ratio : '16:9',
        };
    }, [seedanceSupportsMultimodal]);

    const resolveSeedanceDurationForGroup = useCallback((group: TaskGroup | undefined): number => {
        const itemId = group?.ids?.[0];
        const meta = itemId ? storyboardMetaByItemId[itemId] : undefined;
        const reactiveDur = meta ? computeReactiveDurationFromMeta(meta) : undefined;
        return clampSec(
            group?.duration ?? reactiveDur ?? 3,
            3,
            getSeedanceMaxDuration(group?.model),
        );
    }, [getSeedanceMaxDuration, storyboardMetaByItemId]);

    const syncSeedanceDuration = useCallback((group: TaskGroup | undefined, params: SeedanceParams): SeedanceParams => {
        if (!group) return params;
        const duration = resolveSeedanceDurationForGroup(group);
        return params.duration === duration ? params : { ...params, duration };
    }, [resolveSeedanceDurationForGroup]);

    const getLatestVideoUrl = useCallback((videos?: string[]) => {
        if (!videos || videos.length === 0) return '';
        return videos[videos.length - 1];
    }, []);

    const getVideoByIndexOrLatest = useCallback((videos?: string[], index = -1) => {
        if (!videos || videos.length === 0) return '';
        if (index < 0) return videos[videos.length - 1];
        const safeIndex = Math.max(0, Math.min(index, videos.length - 1));
        return videos[safeIndex];
    }, []);

    const getSeedanceParams = useCallback((uuid: string, model: VideoModel): SeedanceParams => {
        const group = taskGroups.find(g => g.uuid === uuid);
        const existing = seedanceParamsByUuid[uuid];
        if (existing && group) {
            const prompt = upgradeLegacyStoryboardVideoPrompt(
                existing.prompt,
                getStoryboardPromptSourcesForGroup(group),
            );
            return applyPreferredReferenceAudio(
                group,
                syncSeedanceDuration(group, prompt === existing.prompt ? existing : { ...existing, prompt }),
            );
        }
        if (existing) return existing;

        // Seedance cards must persist the visible storyboard image as a reference input.
        const linkedImages = uploadedImages.filter(img =>
            img.url
            && !img.isPlaceholder
            && (
                img.linkedGroupUuids?.includes(uuid)
                || group?.ids?.includes(img.id)
            )
        );
        const agentPlan = isSeedanceAgentPlanModel(model);
        const selectedLinkedImages = agentPlan ? linkedImages.slice(0, 2) : linkedImages;
        const seedMedia: SeedanceMediaInput[] = selectedLinkedImages.map((img, index) => ({
            kind: 'image',
            url: img.url,
            role: agentPlan
                ? (index === 0 ? 'first_frame' : 'last_frame')
                : 'reference_image',
        }));

        // Duration precedence is audio, planned duration, then the model default.


        const itemId = group?.ids?.[0];
        const meta = itemId ? storyboardMetaByItemId[itemId] : undefined;
        const dur = resolveSeedanceDurationForGroup(group);



        const refAudio =
            meta?.mixedAudioUrl
            || meta?.audioUrls?.dialogue
            || meta?.audioUrls?.narration
            || meta?.audioUrls?.sfx
            || null;
        if (refAudio) {
            seedMedia.push({ kind: 'audio', url: refAudio, role: 'reference_audio' });
        }

        const legacyPrompt = imagePrompts[itemId || ''] || '';
        const promptSources = getStoryboardPromptSourcesForGroup(group);
        const nextParams: SeedanceParams = {
            sub_model: seedanceSubModelForVideoModel(model),
            prompt: promptSources.length > 0
                ? upgradeLegacyStoryboardVideoPrompt(legacyPrompt, promptSources)
                : legacyPrompt,
            media_inputs: seedMedia,
            resolution: '720p',
            ratio: defaultAspectRatio,
            duration: dur,
            seed: -1,
            watermark: false,
            generate_audio: true,
            camera_fixed: false,
        };
        return group ? applyPreferredReferenceAudio(group, nextParams) : nextParams;
    }, [seedanceParamsByUuid, taskGroups, uploadedImages, imagePrompts, storyboardMetaByItemId, applyPreferredReferenceAudio, defaultAspectRatio, getStoryboardPromptSourcesForGroup, resolveSeedanceDurationForGroup, syncSeedanceDuration]);

    const setSeedanceParams = useCallback((uuid: string, next: SeedanceParams) => {
        const group = taskGroups.find(g => g.uuid === uuid);
        setSeedanceParamsByUuid(prev => ({ ...prev, [uuid]: syncSeedanceDuration(group, next) }));
    }, [taskGroups, syncSeedanceDuration]);








    const getDashScopeParams = useCallback((
        uuid: string,
        model: DashScopeVideoModel,
    ): DashScopeVideoParams => {
        const existing = dashScopeParamsByUuid[uuid];
        const group = taskGroups.find(g => g.uuid === uuid);
        if (existing && existing.model === model) {
            const prompt = upgradeLegacyStoryboardVideoPrompt(
                existing.prompt,
                getStoryboardPromptSourcesForGroup(group),
            );
            return prompt === existing.prompt ? existing : { ...existing, prompt };
        }
        const isPair = (group?.ids?.length || 0) === 2 && !group?.mergedFrom?.length;
        const linkedImages = uploadedImages.filter(img =>
            img.url
            && !img.isPlaceholder
            && (
                img.linkedGroupUuids?.includes(uuid)
                || group?.ids?.includes(img.id)
            )
        );



        const orderedImgs = (group?.ids || [])
            .map(id => linkedImages.find(i => i.id === id))
            .filter((x): x is typeof linkedImages[number] => !!x);



        const fileIdOf = (img: UploadedImage): string | undefined =>
            img.fileId || (img.id && !img.id.startsWith('sb_') && !img.id.startsWith('ref_') ? img.id : undefined);

        let seedMedia: SeedanceMediaInput[];
        if (model === 'HappyHorse') {

            const orderedReferences = [
                ...orderedImgs,
                ...linkedImages.filter(img => !(group?.ids || []).includes(img.id)),
            ];
            seedMedia = orderedReferences.map(img => ({
                kind: 'image' as const,
                url: img.url,
                file_id: fileIdOf(img),
                role: 'reference_image' as const,
            }));
        } else if (isPair && orderedImgs.length >= 2) {
            seedMedia = [
                { kind: 'image', url: orderedImgs[0].url, file_id: fileIdOf(orderedImgs[0]), role: 'first_frame' },
                { kind: 'image', url: orderedImgs[1].url, file_id: fileIdOf(orderedImgs[1]), role: 'last_frame' },
            ];
        } else if (orderedImgs.length >= 1) {
            seedMedia = [
                { kind: 'image', url: orderedImgs[0].url, file_id: fileIdOf(orderedImgs[0]), role: 'first_frame' },
            ];
        } else {
            seedMedia = [];
        }

        const seedPrompt = getEffectiveGroupPrompt(group);
        return makeDefaultDashScopeParams(model, seedPrompt, seedMedia, defaultAspectRatio);
    }, [dashScopeParamsByUuid, taskGroups, uploadedImages, defaultAspectRatio, getEffectiveGroupPrompt, getStoryboardPromptSourcesForGroup]);

    const setDashScopeParams = useCallback((uuid: string, next: DashScopeVideoParams) => {
        setDashScopeParamsByUuid(prev => ({ ...prev, [uuid]: next }));
    }, []);

    const getGroupVideoCreditEstimateParams = useCallback((group: TaskGroup): Record<string, unknown> => {
        if (isSeedanceVideoModel(group.model)) {
            const params = getSeedanceParams(group.uuid, group.model);
            const referenceVideos = (params.media_inputs || []).filter(item => item.kind === 'video');
            return getVideoCreditEstimateParams(group.model, {
                task_type: inferSeedanceTaskType(params.media_inputs || []),
                duration_seconds: params.duration,
                resolution: params.resolution,
                sub_model: params.sub_model,
                audio: params.generate_audio === true,
                has_reference_video: referenceVideos.length > 0,
                reference_video_count: referenceVideos.length,
                reference_video_durations: referenceVideos.map(item => item.duration_seconds ?? null),
            });
        }

        if (isDashScopeVideoModel(group.model)) {
            const params = getDashScopeParams(group.uuid, group.model);
            return getVideoCreditEstimateParams(group.model, {
                task_type: inferDashScopeTaskType(group.model, params.media_inputs || []),
                duration_seconds: params.hh_duration ?? params.duration,
                resolution: params.hh_resolution ?? params.vidu_resolution ?? params.resolution,
                hh_resolution: params.hh_resolution,
                vidu_resolution: params.vidu_resolution,
                sub_model: group.model === 'Vidu'
                    ? params.sub_model_vidu
                    : params.sub_model_kling,
                audio: group.model === 'Vidu' ? params.vidu_audio === true : params.audio === true,
                has_reference_video: (params.media_inputs || []).some(item => item.kind === 'video'),
            });
        }

        const capabilityParams = group.videoParams || {};
        const capabilityDuration = Number(capabilityParams.duration);
        const minimaxParams = group.model === 'MINI'
            ? normalizeMiniMaxVideoParams(group.minimaxParams, defaultMiniMaxVideoModel)
            : undefined;
        return getVideoCreditEstimateParams(group.model, {
            duration_seconds: minimaxParams?.duration
                ?? (Number.isFinite(capabilityDuration) ? capabilityDuration : group.duration),
            resolution: capabilityParams.resolution,
            minimax_model: minimaxParams?.model,
            minimax_resolution: minimaxParams?.resolution,
            h3_upscale_720p: isMiniMaxH3Model(group.model) && group.h3Upscale720p === true,
        });
    }, [defaultMiniMaxVideoModel, getDashScopeParams, getSeedanceParams]);

    const getGroupVideoCreditFallbackCost = useCallback((group: TaskGroup): number => {
        return getVideoCreditFallbackCost(group.model, {
            h3_upscale_720p: isMiniMaxH3Model(group.model) && group.h3Upscale720p === true,
        });
    }, []);


    const openDashScopePicker = useCallback((
        uuid: string,
        callback: (m: SeedanceMediaInput) => void,
    ) => {
        setDashScopePicker({ groupUuid: uuid, callback });
    }, []);


    const patchTaskGroup = useCallback((uuid: string, patch: Partial<TaskGroup>) => {
        setTaskGroups(prev => prev.map(g => (g.uuid === uuid ? { ...g, ...patch } : g)));
        if (Object.prototype.hasOwnProperty.call(patch, 'duration')) {
            setSeedanceParamsByUuid(prev => {
                const current = prev[uuid];
                if (!current || current.duration === patch.duration) return prev;
                return { ...prev, [uuid]: { ...current, duration: patch.duration } };
            });
        }
    }, []);



    const showToast = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 3000);
    }, []);








    const sortedTaskGroups = useMemo(() => {
        return taskGroups.map((group, originalIndex) => ({ group, originalIndex }));
    }, [taskGroups]);
    const [visibleGroupCount, setVisibleGroupCount] = useState(VIDEO_GROUP_PAGE_SIZE);
    const visibleTaskGroups = useMemo(
        () => sortedTaskGroups.slice(0, visibleGroupCount),
        [sortedTaskGroups, visibleGroupCount],
    );

    useEffect(() => {
        setVisibleGroupCount(VIDEO_GROUP_PAGE_SIZE);
        leftPanelRef.current?.scrollTo({ top: 0 });
        rightPanelRef.current?.scrollTo({ top: 0 });
    }, [sessionScope]);

    const renderMoreGroupsControls = () => {
        if (sortedTaskGroups.length <= VIDEO_GROUP_PAGE_SIZE) return null;
        const remaining = Math.max(0, sortedTaskGroups.length - visibleGroupCount);
        return (
            <div className="space-y-2 py-2">
                {remaining > 0 && (
                    <button
                        type="button"
                        onClick={() => setVisibleGroupCount(c => Math.min(c + VIDEO_GROUP_PAGE_SIZE, sortedTaskGroups.length))}
                        className="w-full py-2 text-xs font-medium text-primary bg-primary-light/50 hover:bg-primary-light rounded-lg border border-primary/20 transition-colors"
                    >
                        展开更多（还有 {remaining} 个视频任务）
                    </button>
                )}
                {visibleGroupCount > VIDEO_GROUP_PAGE_SIZE && (
                    <button
                        type="button"
                        onClick={() => setVisibleGroupCount(VIDEO_GROUP_PAGE_SIZE)}
                        className="w-full py-1.5 text-[11px] text-n300 hover:text-n800 hover:bg-n20 rounded-lg transition-colors"
                    >
                        收起（只看前 {VIDEO_GROUP_PAGE_SIZE} 个）
                    </button>
                )}
            </div>
        );
    };



    useEffect(() => {
        const leftPanel = leftPanelRef.current;
        const rightPanel = rightPanelRef.current;

        if (!leftPanel || !rightPanel) return;

        const syncScroll = (source: HTMLDivElement, target: HTMLDivElement) => {
            if (isScrollSyncing.current) return;
            isScrollSyncing.current = true;

            const maxScroll = source.scrollHeight - source.clientHeight;
            if (maxScroll <= 0) {
                isScrollSyncing.current = false;
                return;
            }

            const scrollPercentage = source.scrollTop / maxScroll;
            const targetMaxScroll = target.scrollHeight - target.clientHeight;
            if (targetMaxScroll > 0) {
                target.scrollTop = scrollPercentage * targetMaxScroll;
            }

            requestAnimationFrame(() => {
                isScrollSyncing.current = false;
            });
        };

        const handleLeftScroll = () => syncScroll(leftPanel, rightPanel);
        const handleRightScroll = () => syncScroll(rightPanel, leftPanel);

        leftPanel.addEventListener('scroll', handleLeftScroll);
        rightPanel.addEventListener('scroll', handleRightScroll);

        return () => {
            leftPanel.removeEventListener('scroll', handleLeftScroll);
            rightPanel.removeEventListener('scroll', handleRightScroll);
        };
    }, [taskGroups.length]);



    useEffect(() => {
        initialVideoTaskCheckDoneRef.current = false;
        loadSession();



        return () => {
            Object.values(pollingIntervals.current).forEach(clearInterval);
            for (const uuid of getKnownVideoTaskIds()) {
                detachVideoPollCallbacks(uuid);
            }
        };
    }, []);













    useEffect(() => {
        if (!episodeId || taskGroups.length === 0) return;
        let cancelled = false;
        (async () => {
            try {
                const res: any = await getVideoSegments(episodeId);
                const byItem: Record<string, { url: string; model?: VideoModel }> = {};
                for (const sg of (res?.segments || [])) {
                    const item = sg.storyboard_item_id ?? sg.storyboardItemId;
                    const url = sg.video_url ?? sg.videoUrl;
                    const rawModel = String(sg.model || '').trim() as VideoModel;
                    const model = ALL_MODELS.includes(rawModel) ? rawModel : undefined;
                    if (item && url) byItem[item] = { url, model };
                }
                if (cancelled || Object.keys(byItem).length === 0) return;
                setTasksStatus(prev => {
                    const next = { ...prev };
                    let changed = false;
                    for (const g of taskGroups) {
                        const item = g.ids && g.ids[0];
                        const stored = item ? byItem[item] : undefined;
                        if (!stored) continue;

                        const url = secureMediaUrl(stored.url, { absolute: true });
                        const cur: TaskStatus = next[g.uuid] || {};
                        const merged = mergeStoredVideoResult(cur, url, stored.model);
                        if (merged !== cur) {
                            next[g.uuid] = merged;
                            changed = true;
                        }
                    }
                    return changed ? next : prev;
                });
            } catch (e) {
                console.warn('DB 兜底重载 video_segments 失败（不致命）:', e);
            }
        })();
        return () => { cancelled = true; };
    }, [episodeId, taskGroups]);


    useEffect(() => {
        if (isActive && initialVideoTaskCheckDoneRef.current) {
            checkAndLoadVideoTasks();
        }
    }, [isActive]);


    const checkAndLoadVideoTasks = async () => {
        const username = localStorage.getItem('username') || 'guest';
        const storageKey = `anime-current-project-id-${username}`;
        const projectId = localStorage.getItem(storageKey);

        if (!projectId) return;

        try {
            console.log('🔄 页面激活，检查新导出的 video_tasks:', projectId);
            const videoTasks = await getProjectVideoTasks(projectId);

            console.log('📋 检查结果:', { videoTasksCount: videoTasks.length });

            if (videoTasks.length > 0) {
                console.log(`📦 发现 ${videoTasks.length} 个新导出的镜头，追加到现有数据`);

                const imported = buildVideoTaskImport(videoTasks, {
                    normalizeUrl: url => secureMediaUrl(url),
                });
                imported.skipped.forEach(item => {
                    console.warn(`⚠️ 镜头 ${item.storyboardId || 'unknown'} 没有图片，跳过`);
                });


                if (imported.images.length > 0) {
                    setUploadedImages(prev => [...prev, ...imported.images]);
                    setTaskGroups(prev => [...prev, ...imported.groups]);
                    setImagePrompts(prev => ({...prev, ...imported.prompts}));
                }

                console.log(`✅ 已追加 ${imported.images.length} 个新导出的镜头`);


                try {
                    await clearProjectVideoTasks(projectId);
                    console.log('✅ 已清空项目的 video_tasks');
                } catch (err) {
                    console.warn('清空 video_tasks 失败:', err);
                }
            }
        } catch (err) {
            console.warn('检查 video_tasks 失败:', err);
        }
    };

    const sessionReadFailed = useRef(false);
    const loadSession = async () => {
        setIsLoading(true);
        try {

            const result = await loadWorkspaceSession(sessionScope);
            sessionReadFailed.current = !!result.error;
            if (result.error) {
                showToast('工作区读取失败，已暂停保存以保护现有卡片，请刷新重试');
                return;
            }
            let existingImages: UploadedImage[] = [];
            let existingGroups: TaskGroup[] = [];
            let existingPrompts: Record<string, string> = {};
            let existingStatus: Record<string, TaskStatus> = {};

            if (result.success && result.session) {

                const session = result.session;
                const hasData = (session.task_groups?.length > 0) || (session.uploaded_images?.length > 0);
                if (!hasData && (uploadedImages.length > 0 || taskGroups.length > 0)) {
                    console.warn('⚠️ 服务器返回空session但内存中有数据，保留当前状态');
                    setIsLoading(false);
                    return;
                }






                const rawImages = session.uploaded_images || [];
                const dropped: { id: string; reason: string; sample: string }[] = [];
                existingImages = rawImages.reduce<UploadedImage[]>((acc, img) => {
                    if (!img.url) {
                        if (img.isPlaceholder) {
                            acc.push(img);
                        } else {
                            dropped.push({ id: img.id, reason: 'empty url', sample: '' });
                        }
                        return acc;
                    }
                    const url = img.url;
                    if (url.startsWith('data:')) {
                        dropped.push({ id: img.id, reason: 'data: URL（base64 内联图）', sample: url.slice(0, 60) + '...' });
                        return acc;
                    }
                    if (url.startsWith('blob:')) {
                        dropped.push({ id: img.id, reason: 'blob: URL（已失效）', sample: url.slice(0, 60) });
                        return acc;
                    }
                    if (!url.startsWith('http') && !url.startsWith('/')) {
                        dropped.push({ id: img.id, reason: '未识别协议', sample: url.slice(0, 60) });
                        return acc;
                    }
                    acc.push(img);
                    return acc;
                }, []);
                if (dropped.length > 0) {
                    console.warn('[VideoPage] loadSession 丢弃 %d 张图片:', dropped.length, dropped.slice(0, 5));
                }
                if (rawImages.length > 0 && existingImages.length === 0) {
                    console.error('[VideoPage] loadSession 收到 %d 张图但全部被过滤！scope=%s sample=%o', rawImages.length, sessionScope, rawImages.slice(0, 2));
                }



                existingImages = existingImages.map(img => (
                    img.url ? { ...img, url: secureMediaUrl(img.url) } : img
                ));


                const sessSP = (session as any).seedance_params as Record<string, SeedanceParams> | undefined;
                if (sessSP && typeof sessSP === 'object') {
                    setSeedanceParamsByUuid(sessSP);
                } else {
                    setSeedanceParamsByUuid({});
                }
                const sessMeta = (session as any).storyboard_meta as Record<string, StoryboardMeta> | undefined;
                if (sessMeta && typeof sessMeta === 'object') {
                    setStoryboardMetaByItemId(sessMeta);
                } else {
                    setStoryboardMetaByItemId({});
                }


                const sessDS = (session as any).dashscope_params as Record<string, DashScopeVideoParams> | undefined;
                if (sessDS && typeof sessDS === 'object') {
                    setDashScopeParamsByUuid(sessDS);
                } else {
                    setDashScopeParamsByUuid({});
                }

                const validImageIds = new Set(existingImages.map(img => img.id));


                existingGroups = (session.task_groups || []).filter(group => {
                    if (Array.isArray(group.ids) && group.ids.length > 0) {
                        return group.ids.some(id => validImageIds.has(id));
                    }
                    return validImageIds.has((group as any).imageId);
                });

                const validGroupUuids = new Set(existingGroups.map(g => g.uuid));


                existingPrompts = {};
                Object.entries(session.image_prompts || {}).forEach(([key, value]) => {
                    if (validImageIds.has(key) || validGroupUuids.has(key)) {
                        existingPrompts[key] = value;
                    }
                });


                const statusWithToken: Record<string, TaskStatus> = {};
                const pendingTaskIds: { uuid: string; taskId: string }[] = [];

                Object.entries(session.tasks_status || {}).forEach(([uuid, status]) => {
                    if (!validGroupUuids.has(uuid)) return;

                    const videosRaw = (status.videos || []).map(url => {
                        return typeof url === 'string' ? secureMediaUrl(url) : url;
                    });

                    const dd = dedupVideosWithTimes(
                        videosRaw,
                        status.videoGenerateTimes || [],
                        status.videoModels || [],
                    );
                    const videos = dd.videos;
                    let result = status.result || '';
                    if (result) result = secureMediaUrl(result);
                    statusWithToken[uuid] = {
                        ...status,
                        videos,
                        videoGenerateTimes: dd.times,
                        videoModels: dd.models,
                        result,
                    };

                    if (['pending', 'running', 'processing'].includes(String(status.state)) && status.taskId) {
                        pendingTaskIds.push({ uuid, taskId: status.taskId });
                    }
                });
                existingStatus = statusWithToken;

                console.log(`✅ 会话恢复: ${existingImages.length}张图片, ${existingGroups.length}个任务组`);


                if (pendingTaskIds.length > 0) {
                    setTimeout(() => {
                        if (!videoUploadMounted.current) return;
                        pendingTaskIds.forEach(({ uuid, taskId }) => {
                            const current = videoUploadState.current.tasksStatus[uuid];
                            // History reconciliation may already have settled
                            // this saved attempt while the restore timer waited.
                            if (!current || current.taskId !== taskId || ['done', 'failed'].includes(current.state || '')) return;
                            setTasksStatus(prev => ({
                                ...prev,
                                [uuid]: { ...prev[uuid], state: 'running', taskId }
                            }));
                            startPolling(uuid, taskId);
                        });
                    }, 500);
                }
            }


            const username = localStorage.getItem('username') || 'guest';
            const storageKey = `anime-current-project-id-${username}`;
            const projectId = localStorage.getItem(storageKey);

            if (projectId) {
                try {
                    console.log('🔍 检查项目 video_tasks:', projectId);
                    const videoTasks = await getProjectVideoTasks(projectId);


                    console.log('📋 API返回的 projectData:', {
                        success: true,
                        hasProject: true,
                        videoTasksCount: videoTasks.length,
                        videoTasks: videoTasks
                    });

                    if (videoTasks.length > 0) {
                        console.log(`📦 从项目发现 ${videoTasks.length} 个新导出的镜头，追加到现有数据`);

                        const imported = buildVideoTaskImport(videoTasks, {
                            normalizeUrl: url => secureMediaUrl(url),
                        });
                        imported.skipped.forEach(item => {
                            console.warn(`⚠️ 镜头 ${item.storyboardId || 'unknown'} 没有图片，跳过`);
                        });


                        setUploadedImages([...existingImages, ...imported.images]);
                        setTaskGroups([...existingGroups, ...imported.groups]);
                        setImagePrompts({...existingPrompts, ...imported.prompts});
                        setTasksStatus(existingStatus);

                        console.log(`✅ 已追加 ${imported.images.length} 个新导出的镜头`);
                        console.log(`📊 当前总计: ${existingImages.length + imported.images.length}张图片, ${existingGroups.length + imported.groups.length}个任务组`);


                        try {
                            await clearProjectVideoTasks(projectId);
                            console.log('✅ 已清空项目的 video_tasks');
                        } catch (err) {
                            console.warn('清空 video_tasks 失败:', err);
                        }
                    } else {

                        setUploadedImages(existingImages);
                        setTaskGroups(existingGroups);
                        setImagePrompts(existingPrompts);
                        setTasksStatus(existingStatus);
                    }
                } catch (err) {
                    console.warn('加载项目 video_tasks 失败:', err);

                    setUploadedImages(existingImages);
                    setTaskGroups(existingGroups);
                    setImagePrompts(existingPrompts);
                    setTasksStatus(existingStatus);
                }
            } else {

                setUploadedImages(existingImages);
                setTaskGroups(existingGroups);
                setImagePrompts(existingPrompts);
                setTasksStatus(existingStatus);
            }

        } catch (error) {
            sessionReadFailed.current = true;
            console.error('加载会话失败:', error);
        } finally {
            initialVideoTaskCheckDoneRef.current = true;
            setIsLoading(false);
        }
    };

    const seedanceParamsForSession = useMemo(() => {
        let changed = false;
        const next = { ...seedanceParamsByUuid };
        taskGroups.forEach(group => {
            const current = next[group.uuid];
            if (!current) return;
            const duration = resolveSeedanceDurationForGroup(group);
            const prompt = upgradeLegacyStoryboardVideoPrompt(
                current.prompt,
                getStoryboardPromptSourcesForGroup(group),
            );
            if (current.duration !== duration || current.prompt !== prompt) {
                next[group.uuid] = { ...current, duration, prompt };
                changed = true;
            }
        });
        return changed ? next : seedanceParamsByUuid;
    }, [seedanceParamsByUuid, taskGroups, getStoryboardPromptSourcesForGroup, resolveSeedanceDurationForGroup]);

    const saveSession = useCallback(async (patch?: Partial<WorkspaceSession>) => {
        if (sessionReadFailed.current) return { success: false };
        const cleanedStatus: Record<string, TaskStatus> = {};
        Object.entries(patch?.tasks_status ?? tasksStatus).forEach(([uuid, status]) => {

            const savedState = (status.state === 'running' || status.state === 'processing')
                ? 'pending'
                : status.state;

            cleanedStatus[uuid] = {
                ...status,
                state: savedState,
                taskId: status.taskId,
                videos: (status.videos || []).map(url => typeof url === 'string' ? url.split('?')[0] : url),
                videoGenerateTimes: status.videoGenerateTimes || [],
                videoModels: status.videoModels || [],
                pendingVideoModel: status.pendingVideoModel,
                result: status.result ? status.result.split('?')[0] : '',
                isUpscaled: status.isUpscaled,
                selected: status.selected
            };
        });


        const validImages = (patch?.uploaded_images ?? uploadedImages).filter(img => {
            if (img.isUploading || img.uploadFailed) return false;
            if (!img.url) return !!img.isPlaceholder;
            if (img.url.startsWith('blob:')) return false;
            return true;
        });

        return await saveWorkspaceSession({
            task_groups: patch?.task_groups ?? taskGroups,
            uploaded_images: validImages,
            image_prompts: imagePrompts,
            tasks_status: cleanedStatus,
            seedance_params: patch?.seedance_params ?? seedanceParamsForSession,
            storyboard_meta: storyboardMetaByItemId,

            dashscope_params: patch?.dashscope_params ?? dashScopeParamsByUuid as any,
        } as any, sessionScope);
    }, [taskGroups, uploadedImages, imagePrompts, tasksStatus, sessionScope, seedanceParamsForSession, storyboardMetaByItemId, dashScopeParamsByUuid]);



    const saveSessionRef = useRef(saveSession);
    saveSessionRef.current = saveSession;
    useEffect(() => {
        onRegisterSessionSave?.(() => saveSessionRef.current());
        return () => onRegisterSessionSave?.(null);
    }, [onRegisterSessionSave]);

    const selectProjectMaterial = async (item: ProjectMaterialPickerItem) => {
        if (!projectMaterialTarget || projectMaterialLock.current) return;
        const { groupUuid, imageId } = projectMaterialTarget;
        const group = taskGroups.find(candidate => candidate.uuid === groupUuid && candidate.ids.includes(imageId));
        const currentImage = uploadedImages.find(candidate => candidate.id === imageId);
        if (!group || !currentImage) {
            setProjectMaterialError('目标卡片已不存在，请关闭弹窗后重新选择。');
            return;
        }
        if (['pending', 'running', 'processing'].includes(tasksStatus[groupUuid]?.state || '')) {
            setProjectMaterialError('当前卡片正在生成，请等待任务结束后再选择素材。');
            return;
        }
        projectMaterialLock.current = true;
        setProjectMaterialBusy(true);
        setProjectMaterialError(null);
        let applied = false;
        try {
            const image = applyVideoProjectMaterial(currentImage, item.material);
            const images = uploadedImages.map(candidate => candidate.id === imageId ? image : candidate);
            const seedanceParams = { ...seedanceParamsForSession };
            const dashscopeParams = { ...dashScopeParamsByUuid };
            if (isSeedanceVideoModel(group.model)) {
                const current = getSeedanceParams(groupUuid, group.model);
                const role = isSeedanceAgentPlanModel(group.model)
                    ? (group.ids.indexOf(imageId) === 0 ? 'first_frame' : 'last_frame')
                    : 'reference_image';
                seedanceParams[groupUuid] = { ...current, media_inputs: [
                    ...current.media_inputs.filter(media => !(media.kind === 'image' && (media.url === image.url || (role !== 'reference_image' && media.role === role)))),
                    { kind: 'image', role, url: image.url },
                ] };
                setSeedanceParamsByUuid(seedanceParams);
            }
            if (isDashScopeVideoModel(group.model)) {
                const current = getDashScopeParams(groupUuid, group.model);
                const role = group.model === 'HappyHorse'
                    ? 'reference_image'
                    : (group.ids.indexOf(imageId) === 0 ? 'first_frame' : 'last_frame');
                dashscopeParams[groupUuid] = { ...current, media_inputs: [
                    ...current.media_inputs.filter(media => !(media.kind === 'image' && (media.url === image.url || (role !== 'reference_image' && media.role === role)))),
                    { kind: 'image', role, url: image.url, file_id: image.fileId },
                ] };
                setDashScopeParamsByUuid(dashscopeParams);
            }
            setUploadedImages(images);
            applied = true;
            const result = await saveSession({ uploaded_images: images, seedance_params: seedanceParams, dashscope_params: dashscopeParams });
            if (!result.success) throw new Error('工作区保存失败');
            setProjectMaterialTarget(null);
            showToast('项目素材已填入当前卡片并保存');
        } catch (error) {
            setProjectMaterialError(applied
                ? '素材已填入，但工作区保存失败。请再次点击同一素材重试保存。'
                : error instanceof Error ? error.message : '添加项目素材失败');
        } finally {
            projectMaterialLock.current = false;
            setProjectMaterialBusy(false);
        }
    };

    useEffect(() => {


        if (suspendSessionSave || isLoading) return;
        const timer = setTimeout(() => {
            void saveSession();
        }, 500);
        return () => clearTimeout(timer);
    }, [taskGroups, uploadedImages, imagePrompts, tasksStatus, seedanceParamsByUuid, storyboardMetaByItemId, dashScopeParamsByUuid, saveSession, suspendSessionSave, isLoading]);


    useEffect(() => {
        const handleVisibilityChange = () => {
            if (!suspendSessionSave && !isLoading && document.visibilityState === 'hidden' && (taskGroups.length > 0 || uploadedImages.length > 0)) {
                saveSession();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [taskGroups, uploadedImages, saveSession, suspendSessionSave, isLoading]);



    const handleFiles = useCallback(async (files: FileList | File[]) => {
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));

        const items = imageFiles.map(file => {
            const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const tempUrl = URL.createObjectURL(file);
            return { file, id, tempUrl };
        });

        for (const { id, tempUrl, file } of items) {
            const newImage: UploadedImage = {
                id,
                url: tempUrl,
                filename: file.name,
                uploadTime: Date.now(),
                isUploading: true
            };
            setUploadedImages(prev => [...prev, newImage]);
            setImagePrompts(prev => ({ ...prev, [id]: '' }));
            setTaskGroups(prev => [...prev, {
                uuid: generateUUID(),
                ids: [id],
                model: globalModel,
                shotType: 'multi'
            }]);
        }

        const CONCURRENCY = 3;
        const queue = [...items];
        const uploadOne = async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                if (!item) break;
                const { file, id, tempUrl } = item;
                try {
                    const result = await uploadImage(file, {
                        onProgress: (p) => {
                            setUploadedImages(prev => prev.map(img =>
                                img.id === id ? { ...img, uploadProgress: p.percent } : img
                            ));
                        }
                    });
                    setUploadedImages(prev => prev.map(img =>
                        img.id === id ? {
                            ...img,
                            url: result.url,
                            storageUrl: result.storage_url || result.url,
                            filename: result.filename,
                            isUploading: false,
                            uploadProgress: undefined
                        } : img
                    ));
                    URL.revokeObjectURL(tempUrl);
                } catch (error: any) {
                    if (error?.name === 'AbortError') return;
                    console.error('上传失败:', error);
                    setUploadedImages(prev => prev.map(img =>
                        img.id === id ? { ...img, isUploading: false, uploadFailed: true, uploadProgress: undefined } : img
                    ));
                }
            }
        };
        await Promise.all(Array(Math.min(CONCURRENCY, items.length)).fill(null).map(() => uploadOne()));
    }, [globalModel]);



    const clearTaskImage = useCallback((uuid: string) => {
        const group = taskGroups.find(g => g.uuid === uuid);
        if (!group) return;

        group.ids.forEach(imgId => {
            const img = uploadedImages.find(i => i.id === imgId);
            if (img?.url?.startsWith('blob:')) URL.revokeObjectURL(img.url);
        });
        setUploadedImages(prev => prev.map(img =>
            group.ids.includes(img.id)
                ? { ...img, url: '', storageUrl: undefined, filename: '', isPlaceholder: true, isUploading: false, uploadProgress: undefined, uploadFailed: false }
                : img
        ));

        setSeedanceParamsByUuid(prev => {
            if (!prev[uuid]) return prev;
            return { ...prev, [uuid]: { ...prev[uuid], media_inputs: [] } };
        });

        setDashScopeParamsByUuid(prev => {
            if (!prev[uuid]) return prev;
            return { ...prev, [uuid]: { ...prev[uuid], media_inputs: [] } };
        });
    }, [taskGroups, uploadedImages, saveSession]);


    const handlePlaceholderUpload = useCallback(async (imageId: string, file: File) => {
        if (!file.type.startsWith('image/')) {
            showToast('请选择图片文件');
            return;
        }
        const tempUrl = URL.createObjectURL(file);
        setUploadedImages(prev => prev.map(img =>
            img.id === imageId
                ? { ...img, url: tempUrl, filename: file.name, isPlaceholder: false, isUploading: true, uploadProgress: 0 }
                : img
        ));

        try {
            const result = await uploadImage(file, {
                onProgress: (p) => setUploadedImages(prev => prev.map(img =>
                    img.id === imageId ? { ...img, uploadProgress: p.percent } : img
                ))
            });
            setUploadedImages(prev => prev.map(img =>
                img.id === imageId
                    ? {
                        ...img,
                        url: result.url,
                        storageUrl: result.storage_url || result.url,
                        filename: result.filename,
                        isUploading: false,
                        uploadProgress: undefined,
                    }
                    : img
            ));
            URL.revokeObjectURL(tempUrl);
        } catch (err: any) {
            if (err?.name === 'AbortError') return;
            console.error('占位卡上传失败:', err);
            setUploadedImages(prev => prev.map(img =>
                img.id === imageId
                    ? { ...img, isUploading: false, uploadFailed: true, uploadProgress: undefined }
                    : img
            ));
            showToast(`上传失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }, [saveSession, showToast]);

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            handleFiles(e.target.files);
        }
    };



    const handleVideoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !file.type.startsWith('video/')) {
            showToast('请选择视频文件');
            return;
        }

        showToast('正在从视频抽取帧...');

        try {

            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;

            const videoUrl = URL.createObjectURL(file);
            video.src = videoUrl;

            await new Promise<void>((resolve, reject) => {
                video.onloadeddata = () => resolve();
                video.onerror = () => reject(new Error('视频加载失败'));
                setTimeout(() => reject(new Error('视频加载超时')), 10000);
            });

            video.currentTime = 0.1;

            await new Promise<void>(resolve => {
                video.onseeked = () => resolve();
                setTimeout(resolve, 2000);
            });


            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('无法创建canvas');

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('转换失败')), 'image/jpeg', 0.95);
            });

            const imageFile = new File([blob], `frame_${Date.now()}.jpg`, { type: 'image/jpeg' });


            handleFiles([imageFile]);

            URL.revokeObjectURL(videoUrl);
            showToast('✅ 视频帧已提取并添加');

        } catch (error: any) {
            console.error('视频抽帧失败:', error);
            showToast('视频抽帧失败: ' + error.message);
        }


        e.target.value = '';
    }, [handleFiles, showToast]);

    const handlePaste = useCallback((e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const imageFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                const file = items[i].getAsFile();
                if (file) imageFiles.push(file);
            }
        }
        if (imageFiles.length > 0) {
            handleFiles(imageFiles);
        }
    }, [handleFiles]);

    useEffect(() => {
        document.addEventListener('paste', handlePaste);
        return () => document.removeEventListener('paste', handlePaste);
    }, [handlePaste]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        handleFiles(files);
    }, [handleFiles]);



    const removeTask = useCallback((uuid: string) => {
        const group = taskGroups.find(g => g.uuid === uuid);
        if (!group) return;

        group.ids.forEach(imgId => {
            const img = uploadedImages.find(i => i.id === imgId);
            if (img?.url?.startsWith('blob:')) {
                URL.revokeObjectURL(img.url);
            }
        });

        setUploadedImages(prev => prev.filter(i => !group.ids.includes(i.id)));
        setImagePrompts(prev => {
            const next = { ...prev };
            group.ids.forEach(id => delete next[id]);
            return next;
        });
        setTaskGroups(prev => prev.filter(g => g.uuid !== uuid));
        setTasksStatus(prev => {
            const next = { ...prev };
            delete next[uuid];
            return next;
        });

        if (pollingIntervals.current[uuid]) {
            clearInterval(pollingIntervals.current[uuid]);
            delete pollingIntervals.current[uuid];
        }


    }, [taskGroups, uploadedImages, saveSession]);

    const updatePrompt = useCallback((imgId: string, value: string) => {
        setImagePrompts(prev => ({ ...prev, [imgId]: value }));
    }, []);

    const updateTaskModel = useCallback((uuid: string, model: VideoModel) => {
        if (!isVideoModelAvailable(model)) {
            showToast(getVideoModelUnavailableReason(model));
            return;
        }
        setTaskGroups(prev => prev.map(g => {
            if (g.uuid !== uuid) return g;
            return model === 'MINI'
                ? { ...g, model, minimaxParams: normalizeMiniMaxVideoParams(g.minimaxParams, defaultMiniMaxVideoModel) }
                : { ...g, model };
        }));
        if (isSeedanceVideoModel(model)) {
            const subModel: SeedanceParams['sub_model'] = seedanceSubModelForVideoModel(model);
            setSeedanceParamsByUuid(prev => {
                const current = prev[uuid];
                if (!current || current.sub_model === subModel) return prev;
                return {
                    ...prev,
                    [uuid]: {
                        ...current,
                        sub_model: subModel,
                        resolution: (subModel === 'fast' || subModel === 'mini') && normalizeSeedanceOutputResolution(current.resolution) === '1080p'
                            ? '720p' : normalizeSeedanceOutputResolution(current.resolution) as SeedanceParams['resolution'],
                    },
                };
            });
        }
    }, [defaultMiniMaxVideoModel, getVideoModelUnavailableReason, isVideoModelAvailable, showToast]);

    const linkGroups = useCallback((index: number) => {
        if (!canCreateFirstLastPair(taskGroups, index)) {
            showToast('首尾帧需要相邻的两张单图卡片，且模型必须相同');
            return;
        }

        const groupA = taskGroups[index];
        const groupB = taskGroups[index + 1];

        const newGroup: TaskGroup = {
            uuid: generateUUID(),
            ids: [groupA.ids[0], groupB.ids[0]],
            model: groupA.model,
            duration: groupA.duration,
            durationUserOverride: groupA.durationUserOverride,
            shotType: groupA.shotType,
            h3SageAttention: groupA.h3SageAttention,
        };

        setTaskGroups(prev => {
            const next = [...prev];
            next.splice(index, 2, newGroup);
            return next;
        });

        setTasksStatus(prev => {
            const next = { ...prev };
            delete next[groupA.uuid];
            delete next[groupB.uuid];
            return next;
        });
        showToast('已合并为首尾帧任务');
    }, [taskGroups, showToast]);

    const unlinkGroup = useCallback((index: number) => {
        const group = taskGroups[index];
        if (group.ids.length !== 2) return;

        const newA: TaskGroup = { uuid: generateUUID(), ids: [group.ids[0]], model: group.model, h3SageAttention: group.h3SageAttention };
        const newB: TaskGroup = { uuid: generateUUID(), ids: [group.ids[1]], model: group.model, h3SageAttention: group.h3SageAttention };

        setTaskGroups(prev => {
            const next = [...prev];
            next.splice(index, 1, newA, newB);
            return next;
        });

        setTasksStatus(prev => {
            const next = { ...prev };
            if (next[group.uuid]) {
                next[newA.uuid] = { ...next[group.uuid] };
            }
            delete next[group.uuid];
            return next;
        });
    }, [taskGroups]);




    const isSeedanceModel = useCallback(
        (m: VideoModel) => isSeedanceVideoModel(m),
        [],
    );
    const storyboardSegmentKeyByItemId = useMemo(() => {
        const map = new Map<string, string>();
        storyboardShotInfoByItemId.forEach((info, itemId) => {
            map.set(itemId, info.segmentKey);
        });
        return map;
    }, [storyboardShotInfoByItemId]);

    const getStoryboardItemIdForImageId = useCallback((imageId: string): string => {
        const img = uploadedImages.find(candidate => candidate.id === imageId);
        return String(img?.storyboardItemId || imageId || '').trim();
    }, [uploadedImages]);

    const getGroupSegmentKey = useCallback((group: TaskGroup): string | null => {
        const firstImageId = group.ids?.[0] || '';
        const image = uploadedImages.find(candidate => candidate.id === firstImageId);
        if (image?.storyboardSegmentKey) return image.storyboardSegmentKey;
        const itemId = getStoryboardItemIdForImageId(firstImageId);
        const segmentKey = storyboardSegmentKeyByItemId.get(itemId);
        if (segmentKey) return segmentKey;

        const looksLikeStoryboardCard = Boolean(
            image?.storyboardItemId
            || storyboardMetaByItemId[itemId]
            || /^sb[_-]/i.test(itemId),
        );
        // If a card clearly came from storyboard/script but the segment map is
        // not available yet, keep it isolated instead of allowing no-key cards
        // to merge across script segment boundaries.
        return looksLikeStoryboardCard ? `storyboard-item:${itemId}` : null;
    }, [getStoryboardItemIdForImageId, storyboardSegmentKeyByItemId, uploadedImages, storyboardMetaByItemId]);

    const getMetaDurationSecondsForImageId = useCallback((imageId: string): number | null => {
        const itemId = getStoryboardItemIdForImageId(imageId);
        const meta = itemId ? storyboardMetaByItemId[itemId] : undefined;
        if (!meta) return null;
        const duration = computeReactiveDurationFromMeta(meta);
        return Number.isFinite(duration) && duration > 0 ? duration : null;
    }, [getStoryboardItemIdForImageId, storyboardMetaByItemId]);

    const getGroupMergeDuration = useCallback((group: TaskGroup): number => {
        const fromSnapshots = (group.mergedFrom || [])
            .map(child => Number(child.duration))
            .filter(duration => Number.isFinite(duration) && duration > 0);
        if (group.mergedFrom?.length && fromSnapshots.length === group.mergedFrom.length) {
            return fromSnapshots.reduce((sum, duration) => sum + duration, 0);
        }

        if (group.mergedFrom?.length) {
            const fromIds = (group.ids || [])
                .map(id => getMetaDurationSecondsForImageId(id))
                .filter((duration): duration is number => duration != null);
            if (fromIds.length > 0) {
                return fromIds.reduce((sum, duration) => sum + duration, 0);
            }
        }

        const ownDuration = Number(group.duration);
        if (Number.isFinite(ownDuration) && ownDuration > 0) return ownDuration;

        if ((group.ids || []).length === 1) {
            const fromMeta = getMetaDurationSecondsForImageId(group.ids[0]);
            if (fromMeta != null) return fromMeta;
        }

        return 5;
    }, [getMetaDurationSecondsForImageId]);

    const getDownwardMergePlan = useCallback((index: number, selectedEndIndex?: number) => {
        const group = taskGroups[index];
        const maxDurationSeconds = group && isSeedanceAgentPlanModel(group.model)
            ? SEEDANCE_AGENT_PLAN_MAX_DURATION_SEC
            : DURATION_MAX_SEC;
        return buildDownwardMergePlan(taskGroups, index, {
            getSegmentKey: getGroupSegmentKey,
            getDurationSeconds: getGroupMergeDuration,
            maxDurationSeconds,
            maxImages: 9,
            selectedEndIndex,
        });
    }, [taskGroups, getGroupSegmentKey, getGroupMergeDuration]);


    const canMergeWithNext = useCallback((index: number): boolean => {
        return getDownwardMergePlan(index).hasDownwardTarget;
    }, [getDownwardMergePlan]);

    const openMergeDialog = useCallback((index: number) => {
        const group = taskGroups[index];
        if (!group) return;
        const plan = getDownwardMergePlan(index);
        if (!plan.hasDownwardTarget) {
            if (plan.blockedReason === 'image_limit') {
                showToast('当前卡片已达到 9 张图上限，不能继续向下合并');
            } else {
                showToast('当前卡片下方没有可合并的连续镜头');
            }
            return;
        }
        setMergeDialog({
            groupUuid: group.uuid,
            selectedEndIndex: plan.recommendedEndIndex,
        });
    }, [getDownwardMergePlan, showToast, taskGroups]);

    const mergeWithNext = useCallback((index: number, selectedEndIndex: number) => {
        if (index < 0 || index >= taskGroups.length - 1) return;
        const plan = getDownwardMergePlan(index, selectedEndIndex);
        const A = plan.groups[0];
        if (!A) return;
        if (!plan.hasDownwardTarget) {
            showToast('当前卡片下方没有可合并的连续镜头');
            return;
        }
        if (!plan.canMerge || plan.groups.length < 2) return;

        const groupsToMerge = plan.groups;
        const isDS = isDashScopeVideoModel(A.model);
        const snapshotDuration = (snapshot: MergedCardSnapshot): number | undefined => {
            const ownDuration = Number(snapshot.duration);
            if (Number.isFinite(ownDuration) && ownDuration > 0) return ownDuration;
            const fromIds = (snapshot.ids || [])
                .map(id => getMetaDurationSecondsForImageId(id))
                .filter((duration): duration is number => duration != null);
            return fromIds.length > 0
                ? fromIds.reduce((sum, duration) => sum + duration, 0)
                : undefined;
        };

        const persistTaskStatus = (status: TaskStatus | undefined): TaskStatus | undefined => (
            status ? {
                ...status,
                videos: (status.videos || []).map(toPersistedVideoUrl),
                result: status.result ? toPersistedVideoUrl(status.result) : '',
            } : undefined
        );
        const snap = (g: TaskGroup): MergedCardSnapshot => {
            const ds = isDashScopeVideoModel(g.model);
            const seed = isSeedanceModel(g.model) ? getSeedanceParams(g.uuid, g.model) : undefined;
            const dash = ds ? getDashScopeParams(g.uuid, g.model as DashScopeVideoModel) : undefined;
            const fallbackMedia = (g.ids || []).flatMap<SeedanceMediaInput>((imageId) => {
                const image = uploadedImages.find(candidate => candidate.id === imageId);
                const url = String(image?.storageUrl || image?.url || '').split('?')[0];
                return url ? [{
                    kind: 'image' as const,
                    role: 'reference_image' as const,
                    url,
                    file_id: imageId,
                }] : [];
            });
            const mediaInputs = seed?.media_inputs?.length
                ? seed.media_inputs
                : (dash?.media_inputs?.length ? dash.media_inputs : fallbackMedia);
            return {
                uuid: g.uuid,
                ids: [...g.ids],
                model: g.model,
                shotType: g.shotType,
                duration: getGroupMergeDuration(g),
                durationUserOverride: g.durationUserOverride,
                h3SageAttention: g.h3SageAttention,
                prompt: dash?.prompt || seed?.prompt || getEffectiveGroupPrompt(g),
                mediaInputs,
                seedanceParams: seed,
                dashScopeParams: dash,
                taskStatus: persistTaskStatus(tasksStatus[g.uuid]),
            };
        };

        const childrenOf = (g: TaskGroup): MergedCardSnapshot[] => {
            if (!g.mergedFrom?.length) return [snap(g)];
            const children = g.mergedFrom.map(child => ({
                ...child,
                duration: child.duration ?? snapshotDuration(child),
            }));
            const extraHistory = getTaskStatusHistoryDelta(
                persistTaskStatus(tasksStatus[g.uuid]),
                children.map(child => child.taskStatus),
            );
            if (extraHistory && children[0]) {
                children[0] = {
                    ...children[0],
                    taskStatus: mergeTaskStatusHistories([children[0].taskStatus, extraHistory]),
                };
            }
            return children;
        };
        const mergedFrom = groupsToMerge.flatMap(childrenOf);
        const mergedIds = groupsToMerge.flatMap(g => g.ids || []);
        const mergedPrompt = mergedFrom
            .map(snapshot => snapshot.seedanceParams?.prompt || snapshot.dashScopeParams?.prompt || snapshot.prompt)
            .filter(Boolean)
            .join('\n');
        const mergedMedia = mergedFrom.flatMap(snapshot => (
            snapshot.mediaInputs
            || snapshot.seedanceParams?.media_inputs
            || snapshot.dashScopeParams?.media_inputs
            || []
        ));

        if (isDS) {
            const firstParams = getDashScopeParams(A.uuid, A.model as DashScopeVideoModel);
            setDashScopeParamsByUuid(prev => {
                const next = {
                    ...prev,
                    [A.uuid]: {
                        ...firstParams,
                        prompt: mergedPrompt,
                        media_inputs: mergedMedia,
                        duration: plan.totalDuration,
                        hh_duration: plan.totalDuration,
                    },
                };
                groupsToMerge.slice(1).forEach(g => { delete next[g.uuid]; });
                return next;
            });
        } else if (isSeedanceModel(A.model)) {
            const firstParams = getSeedanceParams(A.uuid, A.model);
            setSeedanceParamsByUuid(prev => {
                const next = {
                    ...prev,
                    [A.uuid]: {
                        ...firstParams,
                        prompt: mergedPrompt,
                        media_inputs: mergedMedia,
                        duration: plan.totalDuration,
                    },
                };
                groupsToMerge.slice(1).forEach(g => { delete next[g.uuid]; });
                return next;
            });
        }

        setTaskGroups(prev => {
            const next = [...prev];
            const current = next[index];
            if (!current || current.uuid !== A.uuid) return prev; // stale guard
            const stale = groupsToMerge.some((g, offset) => next[index + offset]?.uuid !== g.uuid);
            if (stale) return prev;
            next.splice(index, groupsToMerge.length, {
                ...current,
                ids: mergedIds,
                duration: plan.totalDuration,
                durationUserOverride: true,
                mergedFrom,
                h3LongVideo: mergedFrom.length <= 8 ? current.h3LongVideo : false,
                h3Upscale720p: current.h3Upscale720p,
            });
            return next;
        });
        setTasksStatus(prev => {
            const n = { ...prev };
            const mergedStatus = mergeTaskStatusHistories(groupsToMerge.map(group => prev[group.uuid]));
            if (mergedStatus) n[A.uuid] = mergedStatus;
            else delete n[A.uuid];
            groupsToMerge.slice(1).forEach(g => { delete n[g.uuid]; });
            return n;
        });
        showToast(`已合并 ${mergedFrom.length} 个镜头，共 ${plan.imageCount} 张图，约 ${plan.totalDuration} 秒`);
        setMergeDialog(null);
    }, [
        taskGroups,
        getDownwardMergePlan,
        getMetaDurationSecondsForImageId,
        getGroupMergeDuration,
        getEffectiveGroupPrompt,
        getSeedanceParams,
        getDashScopeParams,
        isSeedanceModel,
        tasksStatus,
        uploadedImages,
        showToast,
        saveSession,
    ]);

    const splitMergedCard = useCallback((index: number) => {
        const g = taskGroups[index];
        if (!g || !g.mergedFrom || !g.mergedFrom.length) return;
        const children = g.mergedFrom;
        const generatedAfterMerge = getTaskStatusHistoryDelta(
            tasksStatus[g.uuid],
            children.map(child => child.taskStatus),
        );
        const restoredStatuses = children.map(child => child.taskStatus);
        if (generatedAfterMerge && restoredStatuses.length > 0) {
            restoredStatuses[0] = mergeTaskStatusHistories([
                restoredStatuses[0],
                generatedAfterMerge,
            ]);
        }
        const restored: TaskGroup[] = children.map(c => ({
            uuid: c.uuid,
            ids: [...c.ids],
            model: c.model,
            shotType: c.shotType,
            duration: c.duration,
            durationUserOverride: c.durationUserOverride,
            h3SageAttention: c.h3SageAttention,
        }));

        setSeedanceParamsByUuid(prev => {
            const next = { ...prev };
            delete next[g.uuid];
            children.forEach(c => { if (c.seedanceParams) next[c.uuid] = c.seedanceParams; });
            return next;
        });
        setDashScopeParamsByUuid(prev => {
            const next = { ...prev };
            delete next[g.uuid];
            children.forEach(c => { if (c.dashScopeParams) next[c.uuid] = c.dashScopeParams; });
            return next;
        });
        setTaskGroups(prev => {
            const next = [...prev];
            const cur = next[index];
            if (!cur || cur.uuid !== g.uuid) return prev; // stale guard
            next.splice(index, 1, ...restored);
            return next;
        });
        setTasksStatus(prev => {
            const next = { ...prev };
            delete next[g.uuid];
            children.forEach((child, childIndex) => {
                const restoredStatus = securePersistedTaskStatus(restoredStatuses[childIndex]);
                if (restoredStatus) next[child.uuid] = restoredStatus;
                else delete next[child.uuid];
            });
            return next;
        });
        setMergedCardDialogUuid(null);
    }, [taskGroups, tasksStatus, saveSession]);

    const removeShotFromMergedCard = useCallback((groupUuid: string, childIndex: number) => {
        const index = taskGroups.findIndex(group => group.uuid === groupUuid);
        const current = taskGroups[index];
        if (!current?.mergedFrom?.length) return;
        const snapshots = current.mergedFrom.map(snapshot => ({ ...snapshot }));
        const generatedAfterMerge = getTaskStatusHistoryDelta(
            tasksStatus[current.uuid],
            snapshots.map(snapshot => snapshot.taskStatus),
        );
        if (generatedAfterMerge && snapshots[0]) {
            snapshots[0].taskStatus = mergeTaskStatusHistories([
                snapshots[0].taskStatus,
                generatedAfterMerge,
            ]);
        }
        const partition = partitionMergedSnapshots(snapshots, childIndex);
        if (!partition) return;

        const ranges = [
            partition.before,
            [partition.removed],
            partition.after,
        ].filter((range): range is MergedCardSnapshot[][][number] => range.length > 0);
        const durationOf = (snapshot: MergedCardSnapshot): number => {
            const duration = Number(snapshot.duration);
            return Number.isFinite(duration) && duration > 0 ? duration : 5;
        };
        const rangeDuration = (range: MergedCardSnapshot[]): number => (
            range.reduce((sum, snapshot) => sum + durationOf(snapshot), 0)
        );
        const rebuilt = ranges.map((range) => {
            const first = range[0];
            const duration = rangeDuration(range);
            const group: TaskGroup = {
                uuid: first.uuid,
                ids: range.flatMap(snapshot => snapshot.ids || []),
                model: first.model,
                shotType: first.shotType,
                duration,
                durationUserOverride: range.length > 1 ? true : first.durationUserOverride,
                h3SageAttention: first.h3SageAttention,
                mergedFrom: range.length > 1 ? range.map(snapshot => ({ ...snapshot })) : undefined,
            };
            return {
                group,
                range,
                duration,
                taskStatus: mergeTaskStatusHistories(range.map(snapshot => snapshot.taskStatus)),
            };
        });

        setSeedanceParamsByUuid(prev => {
            const next = { ...prev };
            delete next[current.uuid];
            rebuilt.forEach(({ group, range, duration }) => {
                if (isDashScopeVideoModel(group.model)) return;
                if (range.length === 1 && range[0].seedanceParams) {
                    next[group.uuid] = range[0].seedanceParams;
                    return;
                }
                const base = range.find(snapshot => snapshot.seedanceParams)?.seedanceParams;
                if (!base) return;
                next[group.uuid] = {
                    ...base,
                    prompt: range.map(snapshot => snapshot.seedanceParams?.prompt || snapshot.prompt).filter(Boolean).join('\n'),
                    media_inputs: range.flatMap(snapshot => snapshot.seedanceParams?.media_inputs || []),
                    duration,
                };
            });
            return next;
        });
        setDashScopeParamsByUuid(prev => {
            const next = { ...prev };
            delete next[current.uuid];
            rebuilt.forEach(({ group, range, duration }) => {
                if (!isDashScopeVideoModel(group.model)) return;
                if (range.length === 1 && range[0].dashScopeParams) {
                    next[group.uuid] = range[0].dashScopeParams;
                    return;
                }
                const base = range.find(snapshot => snapshot.dashScopeParams)?.dashScopeParams;
                if (!base) return;
                next[group.uuid] = {
                    ...base,
                    prompt: range.map(snapshot => snapshot.dashScopeParams?.prompt || snapshot.prompt).filter(Boolean).join('\n'),
                    media_inputs: range.flatMap(snapshot => snapshot.dashScopeParams?.media_inputs || []),
                    duration,
                    hh_duration: duration,
                };
            });
            return next;
        });
        setTaskGroups(prev => {
            const next = [...prev];
            if (next[index]?.uuid !== current.uuid) return prev;
            next.splice(index, 1, ...rebuilt.map(item => item.group));
            return next;
        });
        setTasksStatus(prev => {
            const next = { ...prev };
            delete next[current.uuid];
            rebuilt.forEach(({ group, taskStatus }) => {
                const restoredStatus = securePersistedTaskStatus(taskStatus);
                if (restoredStatus) next[group.uuid] = restoredStatus;
            });
            return next;
        });
        setMergedCardDialogUuid(null);
        showToast('已移出所选镜头，并按原顺序保留前后连续合并组');
    }, [saveSession, showToast, taskGroups, tasksStatus]);


    const insertEmptyTaskGroup = useCallback((insertIndex: number) => {
        const { image, group } = buildEmptyTaskGroup();
        setUploadedImages(prev => [...prev, image]);
        setImagePrompts(prev => ({ ...prev, [image.id]: '' }));
        setTaskGroups(prev => {
            const next = [...prev];
            next.splice(insertIndex + 1, 0, group);
            return next;
        });

    }, [globalModel, saveSession]);


    const deleteVideo = useCallback(async (uuid: string, videoIndex: number) => {
        if (!confirm('确定把这个视频移入回收站吗？')) return;
        const deletedUrl = tasksStatus[uuid]?.videos?.[videoIndex];
        const fileId = extractFileId(deletedUrl);
        if (!fileId) {
            showToast('该视频缺少可恢复的存储记录，未执行删除');
            return;
        }
        try {
            await deleteEntityFile(fileId);
        } catch (error: any) {
            showToast(`移入回收站失败: ${error?.message || '未知错误'}`);
            return;
        }
        const wasBeautifyVideo = !!deletedUrl
            && !!tasksStatus[uuid]?.result
            && normVideoKey(tasksStatus[uuid]?.result) === normVideoKey(deletedUrl);

        setTasksStatus(prev => {
            const status = prev[uuid];
            if (!status || !status.videos) return prev;

            const newVideos = status.videos.filter((_, idx) => idx !== videoIndex);
            const newTimes = (status.videoGenerateTimes || []).filter((_, idx) => idx !== videoIndex);
            const newModels = (status.videoModels || []).filter((_, idx) => idx !== videoIndex);


            if (newVideos.length === 0) {
                return {
                    ...prev,
                    [uuid]: {
                        ...status,
                        state: 'idle',
                        videos: [],
                        videoGenerateTimes: [],
                        videoModels: [],
                        result: ''
                    }
                };
            }

            return {
                ...prev,
                [uuid]: {
                    ...status,
                    videos: newVideos,
                    videoGenerateTimes: newTimes,
                    videoModels: newModels,
                    result: wasBeautifyVideo
                        ? ''
                        : (newVideos.some(url => normVideoKey(url) === normVideoKey(status.result))
                            ? status.result
                            : '')
                }
            };
        });

        showToast(wasBeautifyVideo ? '视频已移入回收站，请重新选择美化使用' : '视频已移入回收站');


    }, [tasksStatus, showToast, saveSession]);

    const clearAll = useCallback(() => {
        if (!confirm('确定要清空所有任务吗？')) return;

        uploadedImages.forEach(img => {
            if (img.url?.startsWith('blob:')) {
                URL.revokeObjectURL(img.url);
            }
        });

        Object.values(pollingIntervals.current).forEach(clearInterval);
        pollingIntervals.current = {};

        setUploadedImages([]);
        setImagePrompts({});
        setTaskGroups([]);
        setTasksStatus({});
        setTaskStartTimes({});


    }, [uploadedImages, saveSession]);




    const getImageIdentifier = (img: UploadedImage, isExternalAPI: boolean): string => {
        const identifier = resolveVideoImageIdentifier(img, isExternalAPI);
        if (isExternalAPI && identifier.startsWith('file_')) {
            console.log('🌐 外部API使用file_id:', identifier);
        }
        if (!identifier) {
            console.warn('⚠️ 无法获取图片真实引用:', img);
        }
        return identifier;
    };


    const segmentIdByGroupRef = useRef<Record<string, string>>({});




    const ensureVideoSegmentId = useCallback(async (group: TaskGroup): Promise<string | null> => {
        if (!episodeId) return null;
        if (group.videoSegmentId) return group.videoSegmentId;
        if (segmentIdByGroupRef.current[group.uuid]) return segmentIdByGroupRef.current[group.uuid];
        // Workspace image ids (including blank cards) are not storyboard ids.
        const firstId = group.ids?.[0];
        const image = uploadedImages.find(item => item.id === firstId);
        const sbItemId = image?.storyboardItemId
            || (firstId && storyboardItemById.has(firstId) ? firstId : '');
        const sortOrder = Math.max(0, taskGroups.findIndex(g => g.uuid === group.uuid));
        try {

            if (sbItemId) {
                const res: any = await getVideoSegments(episodeId);
                const hit = (res?.segments || []).find((s: any) => (s.storyboard_item_id ?? s.storyboardItemId) === sbItemId);
                const sid = hit?.segment_id ?? hit?.segmentId;
                if (sid) { segmentIdByGroupRef.current[group.uuid] = sid; return sid; }
            }
            const created: any = await createVideoSegment(episodeId, {
                storyboard_item_id: sbItemId || null,
                sort_order: sortOrder,
                generation_mode: 'i2v',
                model: group.model,
            });
            const sid = created?.segment?.segment_id ?? created?.segment?.segmentId;
            if (sid) { segmentIdByGroupRef.current[group.uuid] = sid; return sid; }
        } catch (e) {
            console.warn('创建视频记录失败，未提交生成:', e);
        }
        return null;
    }, [episodeId, taskGroups, uploadedImages, storyboardItemById]);

    const handleExternalVideoImport = useCallback(async (
        file: File, durationMs: number, target: string, selectForEnhance: boolean, draft: VideoImportDraft,
    ) => {
        if (!episodeId) throw new Error('请先进入一个分集后再上传视频');
        if (videoUploadLock.current) throw new Error('已有视频正在上传，请稍候');
        const before = videoUploadState.current;
        let newCard = videoUploadCards.current.get(draft);
        if (!target && !newCard) {
            newCard = buildEmptyTaskGroup();
            newCard.image.filename = file.name;
            videoUploadCards.current.set(draft, newCard);
        }
        const group = target ? before.taskGroups.find(item => item.uuid === target) : newCard?.group;
        if (!group) throw new Error('目标镜头已移除，请重新选择');
        const currentStatus = before.tasksStatus[group.uuid];
        if (['pending', 'running', 'processing'].includes(currentStatus?.state || '')) {
            throw new Error('目标镜头正在处理，请等待任务结束或选择其他位置');
        }
        const shouldSelect = selectForEnhance || !currentStatus?.result;
        const image = before.uploadedImages.find(item => item.id === group.ids[0]);
        const storyboardItemId = image?.storyboardItemId
            || (group.ids[0]?.startsWith('sb_') ? group.ids[0] : undefined);
        videoUploadLock.current = group.uuid;
        try {
            const uploaded = await importVideoResult({
                episodeId, workspaceGroupId: group.uuid, storyboardItemId,
                segmentId: group.videoSegmentId || segmentIdByGroupRef.current[group.uuid],
                sortOrder: target ? before.taskGroups.indexOf(group) : before.taskGroups.length,
                file, durationMs, selectForEnhance: shouldSelect,
            }, draft);
            segmentIdByGroupRef.current[group.uuid] = uploaded.segmentId;
            const latest = videoUploadState.current;
            const exists = latest.taskGroups.some(item => item.uuid === group.uuid);
            const nextGroups = exists
                ? latest.taskGroups.map(item => item.uuid === group.uuid ? { ...item, videoSegmentId: uploaded.segmentId } : item)
                : [...latest.taskGroups, { ...group, videoSegmentId: uploaded.segmentId }];
            const nextImages = !exists && newCard ? [...latest.uploadedImages, newCard.image] : latest.uploadedImages;
            const nextStatuses = { ...latest.tasksStatus, [group.uuid]: appendUploadedVideo(
                latest.tasksStatus[group.uuid], uploaded, shouldSelect,
            ) };
            videoUploadState.current = { taskGroups: nextGroups, uploadedImages: nextImages, tasksStatus: nextStatuses };
            if (videoUploadMounted.current) {
                setTaskGroups(nextGroups);
                setUploadedImages(nextImages);
                setTasksStatus(nextStatuses);
            }
            const saved = await saveSessionRef.current({
                task_groups: nextGroups, uploaded_images: nextImages, tasks_status: nextStatuses,
            });
            if (!saved.success) throw new Error('视频已保存，但工作区同步失败。请点击上传并导入重试，不会重复上传文件');
            if (videoUploadMounted.current) showToast(shouldSelect ? '视频已导入，可进入优化合成' : '视频已追加到候选结果，原视频保留');
        } finally {
            videoUploadLock.current = null;
        }
    }, [episodeId, globalModel, showToast]);

    const setVideoForBeautify = useCallback(async (group: TaskGroup, videoUrl: string, videoIndex: number) => {
        const applyKey = `${group.uuid}:${videoIndex}`;
        const persistedUrl = toPersistedVideoUrl(videoUrl);
        if (!persistedUrl) {
            showToast('视频地址无效，无法设为美化使用');
            return;
        }

        setBeautifyApplyingKey(applyKey);
        try {
            const segmentId = await ensureVideoSegmentId(group);
            if (!segmentId) {
                throw new Error('没有找到当前分镜的视频片段，请先确认分集已绑定');
            }
            const upload = tasksStatus[group.uuid]?.uploadedVideos?.[String(normVideoKey(videoUrl))];
            const durationMs = upload?.durationMs ?? (tasksStatus[group.uuid]?.uploadedVideos
                ? await readVideoResultDuration(videoUrl) : undefined);
            await updateVideoSegment(segmentId, {
                video_url: persistedUrl,
                model: upload ? 'upload' : (tasksStatus[group.uuid]?.videoModels?.[videoIndex] || group.model),
                ...(durationMs ? { duration_ms: durationMs } : {}),
                status: 'completed',
            });
            segmentIdByGroupRef.current[group.uuid] = segmentId;
            setTasksStatus(prev => ({
                ...prev,
                [group.uuid]: {
                    ...(prev[group.uuid] || {}),
                    state: 'done',
                    progress: 100,
                    result: videoUrl,
                    keepResult: true,
                },
            }));
            showToast('已设为美化使用');
        } catch (error: any) {
            console.error('设为美化使用失败:', error);
            showToast('设为美化使用失败: ' + (error?.message || '未知错误'));
        } finally {
            setBeautifyApplyingKey(current => (current === applyKey ? null : current));
        }
    }, [ensureVideoSegmentId, showToast, tasksStatus]);

    const openVideoVoiceReferenceModal = useCallback((uuid: string) => {
        const group = taskGroups.find(candidate => candidate.uuid === uuid);
        const videos = tasksStatus[uuid]?.videos || [];
        if (!group || videos.length === 0) {
            showToast('请先生成一个带声音的视频');
            return;
        }
        setVoiceReferenceCharacter(getCharacterNameForGroup(group));
        setVoiceReferenceVideoIndex(0);
        setVoiceReferenceModalUuid(uuid);
    }, [taskGroups, tasksStatus, getCharacterNameForGroup, showToast]);

    const saveVideoVoiceReference = useCallback(async () => {
        if (!voiceReferenceModalUuid || !projectId || !episodeId) return;
        const group = taskGroups.find(candidate => candidate.uuid === voiceReferenceModalUuid);
        const videoUrl = tasksStatus[voiceReferenceModalUuid]?.videos?.[voiceReferenceVideoIndex];
        const characterName = voiceReferenceCharacter.trim();
        if (!group || !videoUrl) {
            showToast('请选择一个已生成的视频');
            return;
        }
        if (!characterName) {
            showToast('请输入要绑定的角色');
            return;
        }

        setVoiceReferenceSaving(true);
        try {
            const segmentId = await ensureVideoSegmentId(group);
            const response = await createVideoVoiceReference({
                project_id: projectId,
                episode_id: episodeId,
                character_name: characterName,
                source_video_url: toPersistedVideoUrl(videoUrl),
                storyboard_item_id: getStoryboardItemId(group.uuid),
                video_segment_id: segmentId || undefined,
                video_model: group.model,
            });
            const savedReference = normalizeVideoVoiceReference(response.reference);
            setVideoVoiceReferences(previous => [
                ...previous.filter(reference => reference.characterName !== savedReference.characterName),
                savedReference,
            ]);
            setVoiceReferenceModalUuid(null);
            showToast(`已抽离声音并设为 ${characterName} 的人物参考`);
        } catch (error: any) {
            const message = String(error?.message || error || '未知错误');
            showToast(message.includes('no audio track')
                ? '该视频没有音轨，无法抽离人物声音'
                : `人物声音抽离失败: ${message}`);
        } finally {
            setVoiceReferenceSaving(false);
        }
    }, [voiceReferenceModalUuid, projectId, episodeId, taskGroups, tasksStatus, voiceReferenceVideoIndex, voiceReferenceCharacter, ensureVideoSegmentId, getStoryboardItemId, showToast]);

    const usePreviousVideoAudioAsReference = useCallback(async (uuid: string) => {
        if (!projectId || !episodeId) {
            showToast('缺少项目或分集信息，无法提取参考配音');
            return;
        }
        const groupIndex = taskGroups.findIndex(candidate => candidate.uuid === uuid);
        const group = taskGroups[groupIndex];
        if (!group || groupIndex < 0) {
            showToast('没有找到当前视频卡片');
            return;
        }

        let sourceGroup: TaskGroup | null = null;
        let sourceVideoUrl = '';
        for (let index = groupIndex - 1; index >= 0; index -= 1) {
            const previousGroup = taskGroups[index];
            const previousStatus = tasksStatus[previousGroup.uuid];
            const candidates = [
                previousStatus?.result,
                ...(previousStatus?.videos || []),
            ].filter(Boolean) as string[];
            if (candidates.length > 0) {
                sourceGroup = previousGroup;
                sourceVideoUrl = candidates[0];
                break;
            }
        }
        if (!sourceGroup || !sourceVideoUrl) {
            showToast('前面还没有可作为参考配音的视频');
            return;
        }

        setReferenceAudioExtractingUuid(uuid);
        try {
            const response = await extractVideoReferenceAudio({
                project_id: projectId,
                episode_id: episodeId,
                source_video_url: toPersistedVideoUrl(sourceVideoUrl),
                storyboard_item_id: getStoryboardItemId(uuid),
                video_segment_id: await ensureVideoSegmentId(group) || undefined,
                video_model: sourceGroup.model,
            });
            if (!response.audio_url) {
                throw new Error('提取完成但未返回音频地址');
            }
            const current = getSeedanceParams(uuid, group.model);
            const nextMedia = [
                ...(current.media_inputs || []).filter(media => media.kind !== 'audio'),
                {
                    kind: 'audio' as const,
                    url: response.audio_url,
                    role: 'reference_audio' as const,
                },
            ];
            setSeedanceParams(uuid, { ...current, media_inputs: nextMedia });
            showToast(seedanceSupportsMultimodal(group.model)
                ? '已把上一条视频原声设为当前参考配音'
                : '已保存参考配音；Seedance 1.5 Pro 提交时不会发送该音频');
        } catch (error: any) {
            const message = String(error?.message || error || '未知错误');
            showToast(message.includes('no audio track')
                ? '上一条视频没有音轨，无法作为参考配音'
                : `提取参考配音失败: ${message}`);
        } finally {
            setReferenceAudioExtractingUuid(current => (current === uuid ? null : current));
        }
    }, [projectId, episodeId, taskGroups, tasksStatus, showToast, getStoryboardItemId, ensureVideoSegmentId, getSeedanceParams, setSeedanceParams, seedanceSupportsMultimodal]);

    const pendingSubmissions = useRef(new Map<string, Promise<string | null>>());
    const executeTask = useCallback(async (uuid: string): Promise<string | null> => {
        if (videoUploadLock.current === uuid) {
            showToast('该镜头正在导入视频，请稍后再生成');
            return null;
        }
        const group = taskGroups.find(g => g.uuid === uuid);
        if (!group) return null;
        if (!isVideoModelAvailable(group.model)) {
            showToast(getVideoModelUnavailableReason(group.model));
            return null;
        }


        if (isSeedanceModel(group.model)) {
            const params = getSeedanceParams(group.uuid, group.model);
            const outputError = getSeedanceOutputError(params.sub_model, params.resolution);
            if (outputError) {
                showToast(outputError);
                return null;
            }
        }
        const segmentId = await ensureVideoSegmentId(group);
        if (episodeId && !segmentId) {
            showToast('视频记录保存失败，本次未提交生成，请稍后重试');
            return null;
        }
        const entityId = segmentId || undefined;
        const persistedGroups = taskGroups.map(item => item.uuid === uuid && segmentId ? { ...item, videoSegmentId: segmentId } : item);
        setTaskGroups(persistedGroups);
        const saved = await saveSessionRef.current({ task_groups: persistedGroups });
        if (!saved.success) {
            showToast('视频参数保存失败，本次未提交生成，请重试');
            return null;
        }



        if (isSeedanceModel(group.model)) {
            const rawParams = getSeedanceParams(group.uuid, group.model);
            const supportsMultimodal = seedanceSupportsMultimodal(group.model);
            const capabilityParams = prepareSeedanceParamsForCapability(group.model, rawParams);


            const seedanceBlock = validateSeedanceMediaInputs(
                capabilityParams.media_inputs,
                supportsMultimodal,
            );
            if (seedanceBlock) {
                showToast(seedanceBlock);
                return null;
            }

            // First/last-frame mode submits images only.
            const isFirstLastMode = capabilityParams.reference_mode === 'first_last' || capabilityParams.media_inputs.some(
                m => m.kind === 'image' && (m.role === 'first_frame' || m.role === 'last_frame')
            );
            const params = isFirstLastMode
                ? {
                    ...capabilityParams,
                    media_inputs: capabilityParams.media_inputs.filter(m =>
                        m.kind === 'image' || (supportsMultimodal && m.kind === 'audio')
                    ),
                }
                : capabilityParams;
            setTasksStatus(prev => {
                const oldStatus: TaskStatus = prev[uuid] || {};
                return {
                    ...prev,
                    [uuid]: {
                        state: 'running',
                        progress: 0,
                        keepResult: true,
                        videos: oldStatus.videos || [],
                        videoGenerateTimes: oldStatus.videoGenerateTimes || [],
                        videoModels: oldStatus.videoModels || [],
                        pendingVideoModel: group.model,
                        selected: oldStatus.selected,
                        isUpscaled: oldStatus.isUpscaled,
                    },
                };
            });
            setTaskStartTimes(prev => ({ ...prev, [uuid]: Date.now() }));
            try {
                console.log('Seedance 提交:', { uuid, model: getModelDisplayName(group.model), sub_model: params.sub_model, media: params.media_inputs.length, prompt: params.prompt.substring(0, 40) });
                const characterName = getCharacterNameForGroup(group);
                const videoVoiceReference = getVideoVoiceReferenceForGroup(group);
                console.log('Seedance 音频参考:', {
                    characterName,
                    referenceId: videoVoiceReference?.referenceId || null,
                    mode: videoVoiceReference
                        ? (supportsMultimodal ? 'character_video_voice' : 'unsupported_ignored')
                        : ((rawParams.media_inputs || []).some(media => media.kind === 'audio')
                            ? (supportsMultimodal ? 'storyboard_reference' : 'storyboard_reference_ignored')
                            : 'free_generation'),
                });
                const result = await submitSeedanceTask(params, {
                    entity_type: entityId ? 'video_segment' : undefined,
                    entity_id: entityId,
                    file_role: 'video',
                    episode_id: episodeId,
                    workspace_group_id: uuid,
                }, undefined, isSeedanceAgentPlanModel(group.model));
                console.log('Seedance 任务提交成功:', result.task_id);
                showToast('任务已提交');
                startPolling(uuid, result.task_id);
                return result.task_id;
            } catch (error: any) {
                console.error('Seedance 任务提交失败:', error);
                showToast('任务提交失败: ' + error.message);
                setTasksStatus(prev => ({
                    ...prev,
                    [uuid]: { ...prev[uuid], state: 'failed', error: error.message },
                }));
                return null;
            }
            return null;
        }


        if (isDashScopeVideoModel(group.model)) {
            const params = getDashScopeParams(group.uuid, group.model);

            const images = (params.media_inputs || []).filter(m => m.kind === 'image');
            if (group.model === 'Vidu' && images.length === 0) {
                showToast(`${getModelDisplayName('Vidu')}至少需要 1 张图，参考生 或 首尾帧`);
                return null;
            }
            if (group.model === 'HappyHorse' && images.length === 0) {
                showToast(`${getModelDisplayName('HappyHorse')}至少需要 1 张参考图`);
                return null;
            }
            setTasksStatus(prev => {
                const oldStatus: TaskStatus = prev[uuid] || {};
                return {
                    ...prev,
                    [uuid]: {
                        state: 'running',
                        progress: 0,
                        keepResult: true,
                        videos: oldStatus.videos || [],
                        videoGenerateTimes: oldStatus.videoGenerateTimes || [],
                        videoModels: oldStatus.videoModels || [],
                        pendingVideoModel: group.model,
                        selected: oldStatus.selected,
                        isUpscaled: oldStatus.isUpscaled,
                    },
                };
            });
            setTaskStartTimes(prev => ({ ...prev, [uuid]: Date.now() }));
            try {
                console.log('DashScope 视频任务提交:', { uuid, model: group.model, media: images.length, prompt: (params.prompt || '').substring(0, 40) });
                const result = await submitDashScopeVideoTask(params, {
                    entity_type: entityId ? 'video_segment' : undefined,
                    entity_id: entityId,
                    file_role: 'video',
                    episode_id: episodeId,
                    workspace_group_id: uuid,
                });
                console.log('DashScope 任务提交成功:', result.task_id);
                showToast('任务已提交');
                startPolling(uuid, result.task_id);
                return result.task_id;
            } catch (error: any) {
                console.error('DashScope 任务提交失败:', error);
                showToast('任务提交失败: ' + error.message);
                setTasksStatus(prev => ({
                    ...prev,
                    [uuid]: { ...prev[uuid], state: 'failed', error: error.message },
                }));
                return null;
            }
            return null;
        }



        const img1 = uploadedImages.find(i => i.id === group.ids[0]);
        const img2 = group.ids.length === 2 ? uploadedImages.find(i => i.id === group.ids[1]) : null;

        if (!img1) {
            console.error('找不到图片');
            showToast('找不到图片，请重新上传');
            return null;
        }


        const isExternalAPI = ['Sora2', 'Veo', 'MINI', 'MINIFast', '大能'].includes(group.model);

        console.log('📋 任务执行信息:', {
            uuid,
            model: group.model,
            isExternalAPI,
            img1: { id: img1.id, filename: img1.filename, url: img1.url?.substring(0, 80), storageUrl: img1.storageUrl?.substring(0, 80) },
            img2: img2 ? { id: img2.id, filename: img2.filename } : null
        });


        setTasksStatus(prev => {
            const oldStatus: TaskStatus = prev[uuid] || {};
            return {
                ...prev,
                [uuid]: {
                    state: 'running',
                    progress: 0,
                    keepResult: true,
                    videos: oldStatus.videos || [],
                    videoGenerateTimes: oldStatus.videoGenerateTimes || [],
                    videoModels: oldStatus.videoModels || [],
                    pendingVideoModel: group.model,
                    selected: oldStatus.selected,
                    isUpscaled: oldStatus.isUpscaled
                }
            };
        });
        setTaskStartTimes(prev => ({ ...prev, [uuid]: Date.now() }));

        try {

            const filename1 = getImageIdentifier(img1, isExternalAPI);
            const filename2 = img2 ? getImageIdentifier(img2, isExternalAPI) : null;
            if (!filename1 || (img2 && !filename2)) {
                throw new Error('图片缺少真实存储地址，请重新同步分镜或重新上传图片');
            }

            const prompt = getEffectiveGroupPrompt(group);
            const minimaxParams = group.model === 'MINI'
                ? normalizeMiniMaxVideoParams(group.minimaxParams, defaultMiniMaxVideoModel)
                : undefined;
            const modelCapability = getVideoCapability(videoCapabilities, group.model);
            const capabilityParams = group.videoParams || {};
            const capabilityDuration = Number(capabilityParams.duration);
            const capabilitySeed = Number(capabilityParams.seed);
            const h3LongVideoSegments = isMiniMaxH3Model(group.model) && group.h3LongVideo === true
                ? (group.mergedFrom || []).map((snapshot, segmentIndex) => {
                    const segmentImages = (snapshot.ids || [])
                        .map(id => uploadedImages.find(candidate => candidate.id === id))
                        .filter((candidate): candidate is UploadedImage => Boolean(candidate));
                    const firstFrame = segmentImages[0]
                        ? getImageIdentifier(segmentImages[0], false)
                        : '';
                    const lastFrame = segmentImages[1]
                        ? getImageIdentifier(segmentImages[1], false)
                        : '';
                    const duration = Number(snapshot.duration || 5);
                    if (!firstFrame) {
                        throw new Error(`H3 长视频第 ${segmentIndex + 1} 个镜头缺少首帧图片`);
                    }
                    if (!Number.isFinite(duration) || duration < 4 || duration > 15) {
                        throw new Error(`H3 长视频第 ${segmentIndex + 1} 个镜头时长必须在 4–15 秒之间`);
                    }
                    return {
                        prompt: String(snapshot.prompt || '').trim(),
                        duration,
                        image_path: firstFrame,
                        ...(lastFrame ? { image_path_end: lastFrame } : {}),
                    };
                })
                : undefined;

            console.log('📤 提交任务:', { filename1, filename2, prompt: prompt.substring(0, 50), model: group.model });


            const result = await submitTaskQueued(
                filename1,
                filename2,
                prompt,
                group.model,
                undefined,
                undefined,
                (capabilityParams.shot_type as ShotType | undefined) || group.shotType || 'multi',
                {
                    entity_type: entityId ? 'video_segment' : undefined,
                    entity_id: entityId,
                    file_role: 'video',
                    episode_id: episodeId,
                    workspace_group_id: uuid,
                    preferred_agent_id: modelCapability?.preferred_agent_id || undefined,
                    preferred_node_id: modelCapability?.preferred_node_id || undefined,
                    preferred_comfyui_port: modelCapability?.preferred_comfyui_port || undefined,
                    strict_preferred_routing: modelCapability?.strict_preferred_routing,
                },
                {
                    duration: minimaxParams?.duration
                        ?? (Number.isFinite(capabilityDuration) ? capabilityDuration : group.duration),
                    resolution: typeof capabilityParams.resolution === 'string'
                        ? capabilityParams.resolution
                        : undefined,
                    seed: Number.isFinite(capabilitySeed) ? capabilitySeed : undefined,
                    negative_prompt: typeof capabilityParams.negative_prompt === 'string'
                        ? capabilityParams.negative_prompt
                        : undefined,
                    shot_type: typeof capabilityParams.shot_type === 'string'
                        ? capabilityParams.shot_type as ShotType
                        : undefined,
                    minimax_model: minimaxParams?.model,
                    minimax_resolution: minimaxParams?.resolution,
                    minimax_prompt_optimizer: minimaxParams?.promptOptimizer,
                    h3_long_video: isMiniMaxH3Model(group.model) && group.h3LongVideo === true,
                    h3_long_video_segments: h3LongVideoSegments,
                    h3_upscale_720p: isMiniMaxH3Model(group.model) && group.h3Upscale720p === true,
                }
            );

            console.log('✅ 任务提交成功:', result.task_id);
            showToast('任务已提交');
            startPolling(uuid, result.task_id);
            return result.task_id;

        } catch (error: any) {
            console.error('任务提交失败:', error);
            showToast(isMiniMaxHailuoDailyLimitError(error)
                ? 'MiniMax Hailuo 今日 3 次调用额度已用完，明日 00:00 后自动恢复；模型已保留并置灰。'
                : '任务提交失败: ' + error.message);
            setTasksStatus(prev => ({
                ...prev,
                [uuid]: { ...prev[uuid], state: 'failed', error: error.message }
            }));
            return null;
        }
    }, [taskGroups, uploadedImages, imagePrompts, showToast, getSeedanceParams, getDashScopeParams, getEffectiveGroupPrompt, ensureVideoSegmentId, episodeId, prepareSeedanceParamsForCapability, getCharacterNameForGroup, getVideoVoiceReferenceForGroup, seedanceSupportsMultimodal, getVideoModelUnavailableReason, isVideoModelAvailable, defaultMiniMaxVideoModel, isSeedanceModel, videoCapabilities]);

    const runTask = useCallback((uuid: string): Promise<string | null> => {
        const pending = pendingSubmissions.current.get(uuid);
        if (pending) return pending;
        const request = executeTask(uuid);
        pendingSubmissions.current.set(uuid, request);
        return request.finally(() => { pendingSubmissions.current.delete(uuid); });
    }, [executeTask]);

    const waitForBatchVideoTask = useCallback((uuid: string): Promise<VideoBatchWaitResult> => {
        const existing = batchWaitersRef.current[uuid];
        if (existing) {
            clearTimeout(existing.timeoutId);
            existing.resolve('failed');
        }

        return new Promise(resolve => {
            const timeoutId = setTimeout(() => {
                delete batchWaitersRef.current[uuid];
                resolve('timeout');
            }, VIDEO_BATCH_WAIT_TIMEOUT_MS);

            batchWaitersRef.current[uuid] = { timeoutId, resolve };
        });
    }, []);

    const resolveBatchVideoTask = useCallback((uuid: string, result: VideoBatchWaitResult) => {
        const waiter = batchWaitersRef.current[uuid];
        if (!waiter) return;
        clearTimeout(waiter.timeoutId);
        delete batchWaitersRef.current[uuid];
        waiter.resolve(result);
    }, []);

    const runTaskAndWait = useCallback(async (uuid: string): Promise<VideoBatchWaitResult> => {
        const waitPromise = waitForBatchVideoTask(uuid);
        let taskId: string | null = null;
        try {
            taskId = await runTask(uuid);
        } catch (error) {
            console.error('批量视频任务提交异常:', error);
            resolveBatchVideoTask(uuid, 'failed');
            return 'failed';
        }
        if (!taskId) {
            resolveBatchVideoTask(uuid, 'failed');
            return 'failed';
        }
        return waitPromise;
    }, [runTask, waitForBatchVideoTask, resolveBatchVideoTask]);







    const buildPollCallbacks = useCallback((uuid: string) => ({
        onComplete: ({ status }: { status: VideoTask }) => {
            const videos = status.result?.videos?.map(v => {
                return secureMediaUrl(v.url, { absolute: true });
            }) || [];

            const videoTimes = status.result?.videos?.map(v => v.generateTime || 0) || [];

            setTasksStatus(prev => {
                const oldStatus: TaskStatus = prev[uuid] || {};
                const oldVideos = oldStatus.videos || [];
                const oldTimes = oldStatus.videoGenerateTimes || [];
                const oldModels = oldVideos.map((_, index) => oldStatus.videoModels?.[index]);
                const generatedModel = getVideoTaskModel(status)
                    || oldStatus.pendingVideoModel
                    || taskGroups.find(group => group.uuid === uuid)?.model;
                const generatedModels = videos.map(() => generatedModel);

                const deduped = dedupVideosWithTimes(
                    [...oldVideos, ...videos],
                    [...oldTimes, ...videoTimes],
                    [...oldModels, ...generatedModels],
                );
                const allVideos = deduped.videos.slice(-12);
                const allTimes = deduped.times.slice(-12);
                const allModels = deduped.models.slice(-12);

                return {
                    ...prev,
                    [uuid]: {
                        ...oldStatus,
                        state: 'done',
                        progress: 100,
                        result: allVideos[allVideos.length - 1] || '',
                        videos: allVideos,
                        videoGenerateTimes: allTimes,
                        videoModels: allModels,
                        pendingVideoModel: undefined,
                        keepResult: true,
                    },
                };
            });






            if (onAddNotification) {
                onAddNotification({
                    type: 'video',
                    status: 'completed',
                    message: `视频生成完成 (${videos.length}个视频)`,
                    targetView: AppView.Video,
                    taskId: uuid,
                });
            }
            resolveBatchVideoTask(uuid, 'done');
        },
        onFail: (error: string) => {
            setTasksStatus(prev => ({
                ...prev,
                [uuid]: { ...prev[uuid], state: 'failed', error },
            }));
            if (onAddNotification) {
                onAddNotification({
                    type: 'video',
                    status: 'failed',
                    message: `视频生成失败: ${error}`,
                    targetView: AppView.Video,
                    taskId: uuid,
                });
            }
            resolveBatchVideoTask(uuid, 'failed');
        },
        onProgress: (progress: number, status: 'queued' | 'running' | 'processing' | 'completed' | 'failed' | 'cancelled') => {
            setTasksStatus(prev => ({
                ...prev,
                [uuid]: {
                    ...prev[uuid],
                    state: status === 'queued' ? 'pending' : 'processing',
                    progress,
                },
            }));
        },
    }), [onAddNotification, resolveBatchVideoTask, taskGroups]);

    // Attach persisted polls only after their callback factory is initialized.
    useEffect(() => {
        for (const uuid of getKnownVideoTaskIds()) {
            const ok = attachVideoPollCallbacks(uuid, buildPollCallbacks(uuid));
            if (ok) {
                const backendId = getVideoPollTaskId(uuid);
                if (backendId) {
                    setTasksStatus(prev => ({
                        ...prev,
                        [uuid]: { ...(prev[uuid] || {}), taskId: backendId, state: 'processing' },
                    }));
                }
            }
        }
    }, [buildPollCallbacks]);

    const startPolling = useCallback((uuid: string, taskId: string) => {

        setTasksStatus(prev => ({
            ...prev,
            [uuid]: {
                ...prev[uuid],
                state: 'running',
                taskId,
            },
        }));
        const projectId = (() => {
            try { return localStorage.getItem('current_project_id') || undefined; } catch { return undefined; }
        })();
        const groupRef = taskGroups.find(g => g.uuid === uuid);
        const promptText = getEffectiveGroupPrompt(groupRef);
        const titleText = groupRef
            ? `视频 · ${groupRef.model} · ${promptText.slice(0, 24) || `#${uuid.slice(0, 6)}`}`
            : `视频 · #${uuid.slice(0, 6)}`;

        startVideoPoll(uuid, {
            taskId,
            title: titleText,
            kind: groupRef?.model === 'Seedance2' ? 'seedance'
                : groupRef?.model === 'Seedance2Fast' ? 'seedance-fast'
                : groupRef?.model === 'Seedance2Mini' ? 'seedance-mini'
                : groupRef?.model === 'Seedance15' ? 'seedance-1.5'
                : groupRef?.model === 'Wan2' || groupRef?.model === 'LTXNode1' || groupRef?.model === 'WanNode2' ? 'wan2'
                : groupRef?.model === 'Kling' ? 'kling'
                : groupRef?.model === 'Vidu' ? 'vidu'
                : groupRef?.model === 'HappyHorse' ? 'happyhorse'
                : 'video-i2v',
            targetPage: 'video',
            episodeId: sessionScope ?? null,
            projectId: projectId ?? null,
            targetEntityId: uuid,
            targetEntityType: 'video_segment',
            callbacks: buildPollCallbacks(uuid),
        });
    }, [taskGroups, imagePrompts, sessionScope, buildPollCallbacks, getEffectiveGroupPrompt]);

    const startPollingRef = useRef(startPolling);
    startPollingRef.current = startPolling;

    // Reconcile durable server-side live tasks after restoring the workspace.
    // This also recovers tasks submitted by older clients that did not persist
    // workspace_group_id by matching their video_segment entity_id.
    useEffect(() => {
        if (taskGroups.length === 0) return;
        let cancelled = false;

        (async () => {
            try {
                const [taskResponse, segmentResponse] = await Promise.all([
                    getTasks(100),
                    episodeId ? getVideoSegments(episodeId).catch(() => ({ segments: [] })) : Promise.resolve({ segments: [] }),
                ]);
                if (cancelled) return;

                const groupByStoryboardItem = new Map<string, string>();
                taskGroups.forEach(group => {
                    const itemId = String(group.ids?.[0] || '').trim();
                    if (itemId) groupByStoryboardItem.set(itemId, group.uuid);
                });
                const segmentIdByGroup: Record<string, string> = {};
                for (const segment of ((segmentResponse as any)?.segments || [])) {
                    const itemId = String(segment.storyboard_item_id ?? segment.storyboardItemId ?? '').trim();
                    const segmentId = String(segment.segment_id ?? segment.segmentId ?? '').trim();
                    const uuid = groupByStoryboardItem.get(itemId);
                    if (uuid && segmentId) segmentIdByGroup[uuid] = segmentId;
                }

                const recovered = reconcileActiveVideoTasks(
                    taskGroups,
                    videoUploadState.current.tasksStatus,
                    taskResponse.tasks || [],
                    segmentIdByGroup,
                    episodeId,
                    url => secureMediaUrl(url, { absolute: true }),
                );
                if (Object.keys(recovered.statuses).length === 0) return;

                setTasksStatus(prev => reconcileActiveVideoTasks(
                    taskGroups,
                    prev,
                    taskResponse.tasks || [],
                    segmentIdByGroup,
                    episodeId,
                    url => secureMediaUrl(url, { absolute: true }),
                ).statuses);
                recovered.resumable.forEach(({ uuid, taskId }) => {
                    if (!isVideoPollActive(uuid) || getVideoPollTaskId(uuid) !== taskId) {
                        startPollingRef.current(uuid, taskId);
                    }
                });
                const settledTaskIds = new Set((taskResponse.tasks || [])
                    .filter(task => ['completed', 'failed', 'cancelled'].includes(task.status))
                    .map(task => task.task_id));
                Object.entries(recovered.statuses).forEach(([uuid, status]) => {
                    if (status.taskId && settledTaskIds.has(status.taskId) && getVideoPollTaskId(uuid) === status.taskId) {
                        stopVideoPoll(uuid);
                        resolveBatchVideoTask(uuid, status.state === 'done' ? 'done' : 'failed');
                    }
                });
                console.info(`[VideoPage] 已恢复 ${recovered.resumable.length} 个后台视频任务的实时状态`);
            } catch (error) {
                console.warn('[VideoPage] 后台视频任务状态恢复失败（不影响手动生成）:', error);
            }
        })();

        return () => { cancelled = true; };
    // Prompt/callback changes are not new workspaces. Depending on startPolling
    // here can repeatedly fetch history after every recovered status render.
    }, [episodeId, taskGroups, resolveBatchVideoTask]);

    const runAllSelected = useCallback(async () => {
        if (isBatchRunning) return;
        const selected = taskGroups.filter(g => tasksStatus[g.uuid]?.selected);
        if (selected.length === 0) return;

        setIsBatchRunning(true);
        try {
            for (let index = 0; index < selected.length; index++) {
                const group = selected[index];
                showToast(`正在执行 ${index + 1}/${selected.length}，完成后自动继续下一个`);
                const result = await runTaskAndWait(group.uuid);
                if (result === 'timeout') {
                    showToast('当前视频等待超时，已暂停批量执行');
                    break;
                }
                await new Promise(r => setTimeout(r, 500));
            }
        } finally {
            setIsBatchRunning(false);
        }
    }, [isBatchRunning, taskGroups, tasksStatus, runTaskAndWait, showToast]);


    const runAllPending = useCallback(async () => {
        if (isBatchRunning) return;
        const pending = taskGroups.filter(g => {
            const status = tasksStatus[g.uuid];
            return !status || status.state === 'idle' || status.state === 'failed';
        });

        if (pending.length === 0) {
            showToast('没有待处理的任务');
            return;
        }

        if (!confirm(`确定要执行 ${pending.length} 个任务吗？`)) return;

        showToast(`开始执行 ${pending.length} 个任务...`);

        setIsBatchRunning(true);
        try {
            for (let index = 0; index < pending.length; index++) {
                const group = pending[index];
                showToast(`正在执行 ${index + 1}/${pending.length}，完成后自动继续下一个`);
                const result = await runTaskAndWait(group.uuid);
                if (result === 'timeout') {
                    showToast('当前视频等待超时，已暂停批量执行');
                    break;
                }
                await new Promise(r => setTimeout(r, 500));
            }
        } finally {
            setIsBatchRunning(false);
        }
    }, [isBatchRunning, taskGroups, tasksStatus, runTaskAndWait, showToast]);


    const batchUpscale = useCallback(async () => {

        let toUpscale = taskGroups.filter(g => {
            const status = tasksStatus[g.uuid];
            return status?.selected && !status.isUpscaled && hasStoredVideoResult(status);
        });


        if (toUpscale.length === 0) {
            toUpscale = taskGroups.filter(g => {
                const status = tasksStatus[g.uuid];
                return !status?.isUpscaled && hasStoredVideoResult(status);
            });
        }

        if (toUpscale.length === 0) {
            showToast('没有可放大的视频');
            return;
        }

        if (!confirm(`确定要放大 ${toUpscale.length} 个视频吗？`)) return;

        showToast(`开始放大 ${toUpscale.length} 个视频...`);

        let successCount = 0;
        for (const group of toUpscale) {
            const status = tasksStatus[group.uuid];
            const videoUrl = status?.videos?.[0];
            if (!videoUrl) continue;

            const filename = videoUrl;
            if (!filename) continue;

            try {

                await submitUpscaleTaskQueued(filename);
                setTasksStatus(prev => ({
                    ...prev,
                    [group.uuid]: { ...prev[group.uuid], isUpscaled: true }
                }));
                successCount++;
                await new Promise(r => setTimeout(r, 1000));
            } catch (error) {
                console.error('放大任务提交失败:', error);
            }
        }

        showToast(`✅ 已提交 ${successCount} 个放大任务`);
    }, [taskGroups, tasksStatus, showToast]);



    const openUpscaleModal = useCallback((uuid: string) => {
        const status = tasksStatus[uuid];
        if (!status || !status.videos || status.videos.length === 0) {
            showToast('没有可放大的视频');
            return;
        }
        setUpscaleNodeSelection(null);
        setUpscaleModalUuid(uuid);
        setSelectedVideoIndex(status.videos.length - 1);
    }, [tasksStatus, showToast]);

    const submitUpscale = useCallback(async () => {
        if (!upscaleModalUuid) return;

        const status = tasksStatus[upscaleModalUuid];
        if (!status || !status.videos || status.videos.length === 0) {
            showToast('没有可放大的视频');
            return;
        }

        const videoUrl = getVideoByIndexOrLatest(status.videos, selectedVideoIndex);
        const filename = videoUrl;

        if (!filename) {
            showToast('无法获取视频文件名');
            return;
        }

        setIsSubmitting(true);
        try {
            console.log('🔍 开始放大视频:', filename);

            const result = await submitUpscaleTaskQueued(filename, {
                preferred_agent_id: upscaleNodeSelection?.preferredAgentId,
                preferred_node_id: upscaleNodeSelection?.preferredNodeId,
            });
            console.log('✅ 放大任务提交成功:', result.task_id);

            setTasksStatus(prev => ({
                ...prev,
                [upscaleModalUuid]: { ...prev[upscaleModalUuid], isUpscaled: true }
            }));

            showToast('放大任务已提交');
            setUpscaleModalUuid(null);
        } catch (error: any) {
            console.error('放大任务提交失败:', error);
            showToast('放大任务提交失败: ' + error.message);
        } finally {
            setIsSubmitting(false);
        }
    }, [upscaleModalUuid, upscaleNodeSelection, tasksStatus, selectedVideoIndex, showToast]);



    const openVoiceModal = useCallback((uuid: string) => {
        const status = tasksStatus[uuid];
        if (!status || !status.videos || status.videos.length === 0) {
            showToast('没有可配音的视频');
            return;
        }
        setVoiceModalUuid(uuid);
        setSelectedVideoIndex(status.videos.length - 1);
        setVoiceAudioFile(null);
        setVoiceStartTime(0);
        setVoicePrompt('');
    }, [tasksStatus, showToast]);

    const handleVoiceAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setVoiceAudioFile(file);
        }
    };

    const submitVoice = useCallback(async () => {
        if (!voiceModalUuid || !voiceAudioFile) {
            showToast('请先上传音频文件');
            return;
        }

        const status = tasksStatus[voiceModalUuid];
        if (!status || !status.videos || status.videos.length === 0) {
            showToast('没有可用的视频');
            return;
        }

        const group = taskGroups.find(g => g.uuid === voiceModalUuid);
        if (!group) return;

        const videoUrl = getVideoByIndexOrLatest(status.videos, selectedVideoIndex);
        const videoFilename = videoUrl;
        const img = uploadedImages.find(i => i.id === group.ids[0]);
        const imageFilename = img ? resolveVideoImageIdentifier(img, false) : '';
        if (!imageFilename) {
            showToast('图片缺少真实存储地址，请重新同步分镜或重新上传图片');
            return;
        }
        const prompt = voicePrompt || '生动的表情、自然的口型同步';

        setIsSubmitting(true);
        try {

            const audioResult = await uploadAudio(voiceAudioFile, voiceStartTime, 5);
            const audioFilename = audioResult.filename;


            const result = await submitVoiceTaskQueued(
                imageFilename,
                videoFilename,
                audioFilename,
                prompt,
                group.model
            );

            console.log('✅ 配音任务提交成功:', result.task_id);
            showToast('配音任务已提交');
            setVoiceModalUuid(null);
        } catch (error: any) {
            console.error('配音任务提交失败:', error);
            showToast('配音任务提交失败: ' + error.message);
        } finally {
            setIsSubmitting(false);
        }
    }, [voiceModalUuid, voiceAudioFile, tasksStatus, selectedVideoIndex, taskGroups, uploadedImages, voicePrompt, voiceStartTime, showToast]);



    const openEditModal = useCallback((uuid: string) => {
        const status = tasksStatus[uuid];
        if (!status || !status.videos || status.videos.length === 0) {
            showToast('没有可编辑的视频');
            return;
        }
        setEditModalUuid(uuid);
        setSelectedVideoIndex(status.videos.length - 1);
        setCropStartTime(0);
        setCropEndTime(5);
    }, [tasksStatus, showToast]);

    const getCurrentEditVideoUrl = () => {
        if (!editModalUuid) return '';
        const status = tasksStatus[editModalUuid];
        if (!status || !status.videos) return '';
        return getVideoByIndexOrLatest(status.videos, selectedVideoIndex);
    };

    const extractVideoFrame = useCallback(async (position: VideoFramePosition) => {
        const videoElement = editVideoRef.current;
        if (!videoElement || !editModalUuid) {
            showToast('没有视频');
            return;
        }

        try {
            setIsExtractingFrame(true);
            const label = getVideoFrameLabel(position);
            showToast(`正在抽取${label}...`);

            const targetTime = resolveVideoFrameTime(
                position,
                videoElement.currentTime,
                videoElement.duration,
            );
            if (Math.abs(videoElement.currentTime - targetTime) > 0.01) {
                await new Promise<void>((resolve, reject) => {
                    const timeoutId = window.setTimeout(() => {
                        cleanup();
                        reject(new Error('定位视频帧超时'));
                    }, 5000);
                    const cleanup = () => {
                        window.clearTimeout(timeoutId);
                        videoElement.removeEventListener('seeked', handleSeeked);
                        videoElement.removeEventListener('error', handleError);
                    };
                    const handleSeeked = () => {
                        cleanup();
                        resolve();
                    };
                    const handleError = () => {
                        cleanup();
                        reject(new Error('定位视频帧失败'));
                    };
                    videoElement.addEventListener('seeked', handleSeeked, { once: true });
                    videoElement.addEventListener('error', handleError, { once: true });
                    videoElement.currentTime = targetTime;
                });
            }

            const canvas = document.createElement('canvas');
            canvas.width = videoElement.videoWidth;
            canvas.height = videoElement.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('无法创建canvas上下文');

            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob((b) => b ? resolve(b) : reject(new Error('转换失败')), 'image/jpeg', 0.95);
            });

            const imageFile = new File([blob], `${position}_frame_${Date.now()}.jpg`, { type: 'image/jpeg' });
            const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;


            const uploadResult = await uploadImage(imageFile);

            setUploadedImages(prev => [...prev, {
                id,
                url: uploadResult.url,
                storageUrl: uploadResult.storage_url || uploadResult.url,
                filename: uploadResult.filename,
                uploadTime: Date.now(),
                isUploading: false
            }]);

            setImagePrompts(prev => ({ ...prev, [id]: `${label}抽取 · ${targetTime.toFixed(2)}s` }));
            setTaskGroups(prev => [...prev, {
                uuid: generateUUID(),
                ids: [id],
                model: globalModel,
                shotType: 'multi'
            }]);

            showToast(`✅ ${label}已抽取并添加到左侧`);
        } catch (error: any) {
            console.error('抽帧失败:', error);
            showToast('抽帧失败: ' + error.message);
        } finally {
            setIsExtractingFrame(false);
        }
    }, [editModalUuid, globalModel, showToast]);

    const submitCrop = useCallback(async () => {
        if (!editModalUuid) return;

        if (cropEndTime <= cropStartTime) {
            showToast('结束时间必须大于开始时间');
            return;
        }

        const videoUrl = getCurrentEditVideoUrl();
        if (!videoUrl) {
            showToast('无法获取视频URL');
            return;
        }

        const filename = videoUrl;

        setIsSubmitting(true);
        try {
            const result = await cropVideo(filename, cropStartTime, cropEndTime);


            const croppedUrl = secureMediaUrl(
                result.url || `/storage/videos/${result.filename}`,
                { absolute: true },
            );

            setTasksStatus(prev => {
                const status = prev[editModalUuid];
                if (!status) return prev;

                const newVideos = [...(status.videos || []), croppedUrl];
                const sourceModel = status.videoModels?.[selectedVideoIndex]
                    || taskGroups.find(group => group.uuid === editModalUuid)?.model;
                return {
                    ...prev,
                    [editModalUuid]: {
                        ...status,
                        videos: newVideos,
                        videoModels: [
                            ...(status.videos || []).map((_, index) => status.videoModels?.[index]),
                            sourceModel,
                        ],
                    }
                };
            });

            showToast('✅ 视频裁剪成功');
            setEditModalUuid(null);
        } catch (error: any) {
            console.error('视频裁剪失败:', error);
            showToast('视频裁剪失败: ' + error.message);
        } finally {
            setIsSubmitting(false);
        }
    }, [editModalUuid, cropStartTime, cropEndTime, selectedVideoIndex, taskGroups, showToast]);

    const seekToTime = (seconds: number) => {
        if (editVideoRef.current) {
            editVideoRef.current.currentTime = seconds;
        }
    };

    const setCurrentTimeAsStart = () => {
        if (editVideoRef.current) {
            setCropStartTime(parseFloat(editVideoRef.current.currentTime.toFixed(1)));
        }
    };

    const setCurrentTimeAsEnd = () => {
        if (editVideoRef.current) {
            setCropEndTime(parseFloat(editVideoRef.current.currentTime.toFixed(1)));
        }
    };



    const toggleTaskSelection = useCallback((uuid: string) => {
        setTasksStatus(prev => ({
            ...prev,
            [uuid]: { ...prev[uuid], selected: !prev[uuid]?.selected }
        }));
    }, []);

    const selectAll = useCallback(() => {
        const allSelected = taskGroups.every(g => tasksStatus[g.uuid]?.selected);
        setTasksStatus(prev => {
            const next = { ...prev };
            taskGroups.forEach(g => {
                next[g.uuid] = { ...next[g.uuid], selected: !allSelected };
            });
            return next;
        });
    }, [taskGroups, tasksStatus]);



    const getElapsedTimeStr = useCallback((uuid: string) => {
        const startTime = taskStartTimes[uuid];
        if (!startTime) return '0s';
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        return minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;
    }, [taskStartTimes]);

    const [, forceUpdate] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => forceUpdate(v => v + 1), 1000);
        return () => clearInterval(timer);
    }, []);



    const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
        setDragSrcIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }, []);

    const handleDragDrop = useCallback((e: React.DragEvent, destIndex: number) => {
        e.preventDefault();
        if (dragSrcIndex === null || dragSrcIndex === destIndex) return;

        setTaskGroups(prev => {
            const next = [...prev];
            const [item] = next.splice(dragSrcIndex, 1);
            next.splice(destIndex, 0, item);
            return next;
        });

        setDragSrcIndex(null);
    }, [dragSrcIndex]);




    const renderListResultCard = (group: TaskGroup, index: number) => {
        if (!group.ids) return null;
        const isPair = group.ids.length === 2 && !group.mergedFrom?.length;
        const status = tasksStatus[group.uuid] || { state: 'idle' };
        const promptText = getEffectiveGroupPrompt(group);
        const videos = status.videos || [];
        const latestVideoModel = status.videoModels?.[Math.max(0, videos.length - 1)];
        const latestVideoModelLabel = status.uploadedVideos?.[String(normVideoKey(videos[videos.length - 1]))]
            ? '外部上传'
            : latestVideoModel
            ? formatVideoModelOptionLabel(latestVideoModel, getVideoCapability(videoCapabilities, latestVideoModel))
            : '历史模型未记录';
        const shotRange = getGroupShotRange(group, index);

        return (
            <div
                key={group.uuid}
                className={`bg-n0 rounded-lg border px-3 flex items-center gap-3 transition-all hover:border-n40 mb-2 h-16 ${
                    status.selected ? 'border-primary ring-1 ring-primary/30' : 'border-n40'
                }`}
            >

                <div className="w-4 shrink-0" />


                <div className="flex items-center gap-2 w-32 shrink-0">
                    <input
                        type="checkbox"
                        checked={status.selected || false}
                        onChange={() => toggleTaskSelection(group.uuid)}
                        className="w-4 h-4 rounded bg-n0 border-n40 text-primary cursor-pointer"
                    />
                    <div className="min-w-0" title={shotRange.label}>
                        <div className="truncate text-xs font-bold text-n300">{shotRange.label}</div>
                        {shotRange.isSegmentStart && shotRange.start && (
                            <div className="text-[9px] font-semibold text-warning">分段 {String(shotRange.start.segmentNo).padStart(2, '0')}</div>
                        )}
                    </div>
                </div>


                <div className="w-20 h-14 shrink-0 bg-n800 rounded overflow-hidden border border-n40">
                {hasStoredVideoResult(status) ? (
                    <LazyVideo
                        src={getLatestVideoUrl(videos)}
                        preload="none"
                        className="w-full h-full object-cover cursor-pointer"
                        onClick={() => { setLightboxUrl(getLatestVideoUrl(videos)); setLightboxType('video'); }}
                    />
                ) : status.state === 'running' || status.state === 'processing' ? (
                        <div className="w-full h-full flex items-center justify-center bg-n20">
                            <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        </div>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-n20/50">
                            <Film className="w-5 h-5 text-n100" />
                        </div>
                    )}
                </div>


                <div className="flex flex-col gap-1 w-40 shrink-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase text-center ${
                        isPair ? 'bg-p50 text-p400' : 'bg-b50 text-b400'
                    }`}>
                        {isPair ? 'Morph' : 'I2V'}
                    </span>
                    <span
                        className="text-[10px] text-n100 text-center truncate"
                        title={latestVideoModelLabel}
                    >
                        {latestVideoModelLabel}
                    </span>
                </div>


                <div className="flex-1 min-w-0 text-xs text-n300 truncate px-2">
                    {promptText || <span className="italic opacity-50">无描述...</span>}
                </div>


                <div className="w-20 shrink-0 text-center">
                    {status.state === 'done' ? (
                        <span className="text-xs text-success flex items-center justify-center gap-1">
                            <Check className="w-3 h-3" /> 完成
                        </span>
                    ) : status.state === 'running' || status.state === 'processing' ? (
                        <span className="text-xs text-primary flex items-center justify-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> {getElapsedTimeStr(group.uuid)}
                        </span>
                    ) : status.state === 'failed' ? (
                        <span className="text-xs text-danger flex items-center justify-center gap-1">
                            <AlertCircle className="w-3 h-3" /> {hasStoredVideoResult(status) ? '本次失败' : '失败'}
                        </span>
                    ) : (
                        <span className="text-xs text-n100">等待</span>
                    )}
                </div>


                <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => setVideoUploadTarget(group.uuid)}
                        disabled={!episodeId || ['pending', 'running', 'processing'].includes(status.state || '')}
                        className="p-1.5 rounded text-primary hover:bg-primary-light disabled:opacity-40" title="上传外部视频到此镜头">
                        <Upload className="w-3 h-3" />
                    </button>

                    {(() => {
                        const seedanceBlock = isSeedanceModel(group.model)
                            ? validateSeedanceMediaInputs(
                                prepareSeedanceParamsForCapability(group.model, getSeedanceParams(group.uuid, group.model)).media_inputs,
                                seedanceSupportsMultimodal(group.model),
                            )
                            : null;
                        const running = status.state === 'running' || status.state === 'processing';
                        const unavailable = !isVideoModelAvailable(group.model);
                        return (
                            <button
                                onClick={() => runTask(group.uuid)}
                                disabled={running || !!seedanceBlock || unavailable}
                                className="p-1.5 bg-n0 hover:bg-primary-hover text-n700 hover:text-white rounded transition-colors disabled:opacity-50"
                                title={unavailable ? getVideoModelUnavailableReason(group.model) : (seedanceBlock || (status.state === 'done' ? '重做' : '生成'))}
                            >
                                {status.state === 'done' ? <RefreshCw className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                            </button>
                        );
                    })()}

                    {hasStoredVideoResult(status) && (
                        <>
                            <button
                                onClick={() => openUpscaleModal(group.uuid)}
                                className="p-1.5 bg-primary hover:bg-primary-hover text-white rounded transition-colors"
                                title="放大"
                            >
                                <Maximize className="w-3 h-3" />
                            </button>
                            <button
                                onClick={() => openVoiceModal(group.uuid)}
                                className="p-1.5 bg-warning hover:bg-warning text-white rounded transition-colors"
                                title="配音"
                            >
                                <Mic className="w-3 h-3" />
                            </button>
                            <button
                                onClick={() => openEditModal(group.uuid)}
                                className="p-1.5 bg-primary hover:bg-primary-hover text-white rounded transition-colors"
                                title="编辑"
                            >
                                <Scissors className="w-3 h-3" />
                            </button>
                            <button
                                onClick={() => openVideoVoiceReferenceModal(group.uuid)}
                                className="p-1.5 bg-success hover:bg-success text-white rounded transition-colors"
                                title="抽离人物声音并供后续分镜参考"
                            >
                                <Volume2 className="w-3 h-3" />
                            </button>
                        </>
                    )}
                </div>
            </div>
        );
    };

    const ListSeedanceRow: React.FC<{
        group: TaskGroup;
        params: SeedanceParams;
        onChangeParams: (next: SeedanceParams) => void;
        onOpenDetail: () => void;
        isPlaceholder: boolean;
    }> = ({ group, params, onChangeParams, onOpenDetail, isPlaceholder }) => {
        return (
            <>
                <div className="flex-1 min-w-0">
                    <textarea
                        value={params.prompt}
                        onChange={(e) => onChangeParams({ ...params, prompt: e.target.value })}
                        placeholder={isPlaceholder ? '@ 选首帧...' : '描述动作、镜头...'}
                        rows={1}
                        className="w-full bg-n20 border border-n40 rounded px-2 py-1 text-xs text-n700 focus:border-primary focus:outline-none resize-none h-10 leading-tight"
                    />
                </div>
                <MediaBadges params={params} />
                <button
                    type="button"
                    onClick={onOpenDetail}
                    className="p-1 text-n300 hover:text-primary transition-colors"
                    title="完整参数 / @-mention / 模式切换"
                    aria-label={`Seedance 详情 ${group.uuid}`}
                >
                    <Settings className="w-3.5 h-3.5" />
                </button>
            </>
        );
    };

    // The candidate hook must run inside a component rather than the parent render callback.
    const SeedanceDetailModalWithCandidates: React.FC<{
        groupUuid: string;
        title: string;
        value: SeedanceParams;
        onChange: (next: SeedanceParams) => void;
        onClose: () => void;
        storyboardItemId?: string;
    }> = ({ groupUuid, title, value, onChange, onClose, storyboardItemId }) => {
        const { candidates } = useSeedanceCandidates({
            currentParams: value,
            currentStoryboardItemId: storyboardItemId,
        });
        const group = taskGroups.find(candidate => candidate.uuid === groupUuid);
        const model = group?.model ?? 'Seedance15';
        const supportsMultimodal = seedanceSupportsMultimodal(model);
        return (
            <React.Suspense fallback={<VideoModalFallback label="加载 Seedance 详情..." />}>
                <SeedanceDetailModal
                    open={true}
                    title={title}
                    value={value}
                    onChange={onChange}
                    candidates={candidates}
                    onClose={onClose}
                    onUsePreviousVideoAudio={() => void usePreviousVideoAudioAsReference(groupUuid)}
                    previousVideoAudioBusy={referenceAudioExtractingUuid === groupUuid}
                    audioReferenceNotice={getSeedanceAudioReferenceNotice(model)}
                    supportsMultimodal={supportsMultimodal}
                    onPreviewMedia={(url, kind) => {
                        if (kind === 'audio') {
                            const safeUrl = secureMediaUrl(url, { absolute: true });
                            if (!safeUrl) { showToast('音频地址无效'); return; }
                            showToast('音频在浏览器新标签播放');
                            window.open(safeUrl, '_blank', 'noopener,noreferrer');
                            return;
                        }
                        setLightboxUrl(url);
                        setLightboxType(kind === 'video' ? 'video' : 'image');
                    }}
                />
            </React.Suspense>
        );
    };


    const renderListViewCard = (group: TaskGroup, index: number) => {
        if (!group.ids) return null;
        const isPair = group.ids.length === 2 && !group.mergedFrom?.length;
        const img1 = uploadedImages.find(i => i.id === group.ids[0]);
        const img2 = isPair ? uploadedImages.find(i => i.id === group.ids[1]) : null;
        const status = tasksStatus[group.uuid] || { state: 'idle' };
        const promptText = getEffectiveGroupPrompt(group);
        const shotRange = getGroupShotRange(group, index);

        if (!img1) return null;

        return (
            <div
                key={group.uuid}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDragDrop(e, index)}
                className={`bg-n0 rounded-lg border px-3 flex items-center gap-3 transition-all hover:border-n40 mb-2 h-16 ${
                    status.selected ? 'border-primary ring-1 ring-primary/30' : 'border-n40'
                }`}
            >

                <div className="cursor-grab active:cursor-grabbing text-n100 hover:text-n300">
                    <GripVertical className="w-4 h-4" />
                </div>


                <div className="flex items-center gap-2 w-32 shrink-0">
                    <input
                        type="checkbox"
                        checked={status.selected || false}
                        onChange={() => toggleTaskSelection(group.uuid)}
                        className="w-4 h-4 rounded bg-n0 border-n40 text-primary cursor-pointer"
                    />
                    <div className="min-w-0" title={shotRange.label}>
                        <div className="truncate text-xs font-bold text-n300">{shotRange.label}</div>
                        {shotRange.isSegmentStart && shotRange.start && (
                            <div className="text-[9px] font-semibold text-warning">分段 {String(shotRange.start.segmentNo).padStart(2, '0')}</div>
                        )}
                    </div>
                </div>


                <div
                    className="w-20 h-14 shrink-0 bg-n800 rounded overflow-hidden cursor-pointer border border-n40 relative"
                    onClick={() => { if (img1.url) { setLightboxUrl(img1.url); setLightboxType('image'); } }}
                >
                    {isPair && img2 ? (
                        <div className="flex h-full">
                            <img src={img1.url} loading="lazy" decoding="async" alt="" className="w-1/2 h-full object-cover" />
                            <img src={img2.url} loading="lazy" decoding="async" alt="" className="w-1/2 h-full object-cover" />
                        </div>
                    ) : img1.isPlaceholder || !img1.url ? (

                        <button
                            type="button"
                            onClick={() => openProjectMaterials(group.uuid, img1.id)}
                            disabled={['pending', 'running', 'processing'].includes(tasksStatus[group.uuid]?.state || '')}
                            className="w-full h-full bg-primary-light border border-dashed border-primary/30 rounded flex flex-col items-center justify-center text-primary disabled:opacity-50"
                        >
                            <Library size={14} /><span className="mt-1 text-[9px]">项目素材</span>
                        </button>
                    ) : (
                        <img src={img1.url} loading="lazy" decoding="async" alt="" className="w-full h-full object-cover" />
                    )}
                    {img1.isUploading && (
                        <div className="absolute inset-0 bg-n900/60 flex flex-col items-center justify-center">
                            <div className="text-[9px] text-white mb-1">{img1.uploadProgress ?? 0}%</div>
                            <div className="w-14 h-1 bg-n0 rounded-full overflow-hidden">
                                <div className="h-full bg-primary transition-all duration-200 rounded-full" style={{ width: `${img1.uploadProgress ?? 0}%` }} />
                            </div>
                        </div>
                    )}
                    {img1.uploadFailed && (
                        <div className="absolute inset-0 bg-r50 flex items-center justify-center">
                            <span className="text-[9px] text-danger">上传失败</span>
                        </div>
                    )}
                </div>


                <div className="flex flex-col gap-1 w-40 shrink-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase text-center ${
                        isPair ? 'bg-p50 text-p400' : 'bg-b50 text-b400'
                    }`}>
                        {isPair ? 'Morph' : 'I2V'}
                    </span>
                    <VideoModelPicker
                        value={group.model}
                        options={getModelSelectOptions(group.model, selectableVideoModelOptions)}
                        onChange={(model) => updateTaskModel(group.uuid, model)}
                        compact
                        className="w-full max-w-none"
                    />
                    {isMiniMaxH3Model(group.model) && (
                        <>
                        <label
                            className={`flex items-center gap-1 text-[9px] ${group.mergedFrom && group.mergedFrom.length >= 2 && group.mergedFrom.length <= 8 ? 'text-n500 cursor-pointer' : 'text-n100 cursor-not-allowed'}`}
                            title="先合并 2–8 个镜头；Director 将逐段生成并用 Motion Context 保持动作和音频连续"
                        >
                            <input
                                type="checkbox"
                                checked={group.h3LongVideo === true}
                                disabled={!group.mergedFrom || group.mergedFrom.length < 2 || group.mergedFrom.length > 8}
                                onChange={(event) => patchTaskGroup(group.uuid, {
                                    h3LongVideo: event.target.checked,
                                })}
                                className="h-3 w-3 accent-primary"
                            />
                            H3 长视频
                        </label>
                        <label
                            className="flex items-center gap-1 text-[9px] text-n500 cursor-pointer"
                            title="H3 生成完成并释放模型后，串行加载 SeedVR2，输出 1280×720"
                        >
                            <input
                                type="checkbox"
                                checked={group.h3Upscale720p === true}
                                onChange={(event) => patchTaskGroup(group.uuid, {
                                    h3Upscale720p: event.target.checked,
                                })}
                                className="h-3 w-3 accent-primary"
                            />
                            720P 放大
                        </label>
                        </>
                    )}
                </div>


                <div className="flex-1 min-w-0 flex items-center gap-2">
                    {isSeedanceModel(group.model) ? (
                        <ListSeedanceRow
                            group={group}
                            params={getSeedanceParams(group.uuid, group.model)}
                            onChangeParams={(next) => setSeedanceParams(group.uuid, next)}
                            onOpenDetail={() => setSeedanceDetailUuid(group.uuid)}
                            isPlaceholder={!!img1.isPlaceholder}
                        />
                    ) : isDashScopeVideoModel(group.model) ? (

                        (() => {
                            const dsParams = getDashScopeParams(group.uuid, group.model);
                            const refCount = (dsParams.media_inputs || []).filter(m => m.kind === 'image').length;
                            const subLabel = group.model === 'Kling'
                                ? (dsParams.sub_model_kling === 'omni' ? 'omni' : `${dsParams.mode || 'std'}`)
                                : group.model === 'Vidu' ? (dsParams.sub_model_vidu || 'q3')
                                : `${dsParams.resolution || '720P'} · ${dsParams.ratio || '16:9'}`;
                            return (
                                <>
                                    <span className="text-[9px] text-n300 px-1.5 py-0.5 bg-n0 rounded border border-n40 whitespace-nowrap">
                                        {subLabel} · {refCount}图
                                    </span>
                                    <textarea
                                        value={dsParams.prompt || ''}
                                        onChange={(e) => setDashScopeParams(group.uuid, { ...dsParams, prompt: e.target.value })}
                                        placeholder="描述画面/动作（详情请切到卡片视图）"
                                        className="flex-1 bg-n20 border border-n40 rounded px-2 py-1 text-xs text-n700 focus:border-primary focus:outline-none resize-none h-10"
                                    />
                                </>
                            );
                        })()
                    ) : group.model === 'MINI' ? (
                        <MiniMaxVideoPanel
                            compact
                            value={normalizeMiniMaxVideoParams(group.minimaxParams, defaultMiniMaxVideoModel)}
                            prompt={promptText}
                            modelOptions={miniMaxModelOptions}
                            onChange={(next: MiniMaxVideoParams) => patchTaskGroup(group.uuid, { minimaxParams: next })}
                            onPromptChange={(next) => updatePrompt(group.ids[0], next)}
                        />
                    ) : (
                        <textarea
                            value={promptText}
                            onChange={(e) => updatePrompt(group.ids[0], e.target.value)}
                            placeholder={isPair ? '描述变化过程...' : '描述动作内容...'}
                            className="flex-1 bg-n20 border border-n40 rounded px-2 py-1 text-xs text-n700 focus:border-primary focus:outline-none resize-none h-10"
                        />
                    )}
                </div>


                <div className="flex w-24 shrink-0 flex-col items-center gap-0.5 text-center">
                    <span data-testid="video-list-card-credit-estimate">
                        <InlineCreditEstimate
                            featureKey="video_generation"
                            params={getGroupVideoCreditEstimateParams(group)}
                            fallbackCost={getGroupVideoCreditFallbackCost(group)}
                            compact
                            className="justify-center whitespace-nowrap text-[9px]"
                        />
                    </span>
                    {status.state === 'done' ? (
                        <span className="text-xs text-success flex items-center justify-center gap-1">
                            <Check className="w-3 h-3" /> 完成
                        </span>
                    ) : status.state === 'running' || status.state === 'processing' ? (
                        <span className="text-xs text-primary flex items-center justify-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> {getElapsedTimeStr(group.uuid)}
                        </span>
                    ) : status.state === 'failed' ? (
                        <span className="text-xs text-danger flex items-center justify-center gap-1">
                            <AlertCircle className="w-3 h-3" /> {hasStoredVideoResult(status) ? '本次失败' : '失败'}
                        </span>
                    ) : (
                        <span className="text-xs text-n100">等待</span>
                    )}
                </div>


                <div className="flex items-center gap-1 shrink-0">

                    {(() => {
                        const seedanceBlock = isSeedanceModel(group.model)
                            ? validateSeedanceMediaInputs(
                                prepareSeedanceParamsForCapability(group.model, getSeedanceParams(group.uuid, group.model)).media_inputs,
                                seedanceSupportsMultimodal(group.model),
                            )
                            : null;
                        const running = status.state === 'running' || status.state === 'processing';
                        return (
                            <button
                                onClick={() => runTask(group.uuid)}
                                disabled={running || !!seedanceBlock}
                                className="p-1.5 bg-n0 hover:bg-primary-hover text-n700 hover:text-white rounded transition-colors disabled:opacity-50"
                                title={seedanceBlock || (status.state === 'done' ? '重做' : '生成')}
                            >
                                {status.state === 'done' ? <RefreshCw className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                            </button>
                        );
                    })()}

                    {hasStoredVideoResult(status) && (
                        <>
                            <button
                                onClick={() => openUpscaleModal(group.uuid)}
                                className="p-1.5 bg-primary hover:bg-primary-hover text-white rounded transition-colors"
                                title="放大"
                            >
                                <Maximize className="w-3 h-3" />
                            </button>
                            <button
                                onClick={() => openVoiceModal(group.uuid)}
                                className="p-1.5 bg-warning hover:bg-warning text-white rounded transition-colors"
                                title="配音"
                            >
                                <Mic className="w-3 h-3" />
                            </button>
                            <button
                                onClick={() => openEditModal(group.uuid)}
                                className="p-1.5 bg-primary hover:bg-primary-hover text-white rounded transition-colors"
                                title="编辑"
                            >
                                <Scissors className="w-3 h-3" />
                            </button>
                            <button
                                onClick={() => openVideoVoiceReferenceModal(group.uuid)}
                                className="p-1.5 bg-success hover:bg-success text-white rounded transition-colors"
                                title="抽离人物声音并供后续分镜参考"
                            >
                                <Volume2 className="w-3 h-3" />
                            </button>
                        </>
                    )}


                    {group.mergedFrom && group.mergedFrom.length > 0 && (
                        <button
                            onClick={() => setMergedCardDialogUuid(group.uuid)}
                            className="p-1.5 bg-n0 hover:bg-warning text-n700 hover:text-white rounded transition-colors"
                            title={`管理 ${group.mergedFrom.length} 个已合并镜头`}
                        >
                            <Split className="w-3 h-3" />
                        </button>
                    )}
                    <button
                        onClick={() => openMergeDialog(index)}
                        disabled={!canMergeWithNext(index)}
                        className="p-1.5 bg-n0 hover:bg-teal text-n700 hover:text-white rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title={canMergeWithNext(index) ? '选择连续向下合并的镜头' : '下方没有可合并的连续镜头'}
                    >
                        <Combine className="w-3 h-3" />
                    </button>

                    <button
                        onClick={() => removeTask(group.uuid)}
                        className="p-1.5 text-n100 hover:text-danger hover:bg-r50 rounded transition-colors"
                        title="删除"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
            </div>
        );
    };



    const renderStoryboardCard = (group: TaskGroup, index: number) => {
        if (!group.ids) return null;
        const isPair = group.ids.length === 2 && !group.mergedFrom?.length;
        const img1 = uploadedImages.find(i => i.id === group.ids[0]);

        if (!img1) return null;

        const sourceImages = group.ids
            .map(id => uploadedImages.find(image => image.id === id))
            .filter((image): image is UploadedImage => Boolean(image));
        const sourcePlaceholderCount = getVideoResultPlaceholderCount(sourceImages.length);


        const isPlaceholderCard = !!img1.isPlaceholder;
        const cardHeight = getCardHeightClass(group.model, isPlaceholderCard);
        const seedanceCard = isSeedanceModel(group.model);
        const activeVideoVoiceReference = getVideoVoiceReferenceForGroup(group);
        const shotRange = getGroupShotRange(group, index);

        return (
            <div
                key={group.uuid}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDragDrop(e, index)}
                className={`bg-n0 rounded-md border border-n40 p-4 transition-all hover:border-n40 shadow-card hover:shadow-atlas group mb-4 flex flex-col overflow-hidden ${cardHeight} ${
                    seedanceCard ? 'border-primary/40 bg-gradient-to-b from-n0 to-n20' : ''
                }`}
            >
                {/* Header */}
                <div className="flex justify-between items-center w-full mb-2 pb-2 border-b border-n40 shrink-0">
                    <div className="flex items-center gap-2 flex-wrap">

                        <div className="cursor-grab active:cursor-grabbing text-n100 hover:text-n300 mr-1">
                            <GripVertical className="w-4 h-4" />
                        </div>
                        {shotRange.isSegmentStart && shotRange.start && (
                            <span className="inline-flex items-baseline gap-1 rounded border border-warning/30 bg-y50 px-1.5 py-0.5 text-[10px] font-semibold text-n500">
                                分段 <span className="font-mono text-warning">{String(shotRange.start.segmentNo).padStart(2, '0')}</span>
                            </span>
                        )}
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-n30 text-n700 mr-1 tabular-nums">
                            {shotRange.label}
                        </span>
                        {shotRange.crossesSegment && (
                            <span className="rounded border border-warning/40 bg-y50 px-1.5 py-0.5 text-[9px] font-semibold text-warning">跨分段</span>
                        )}
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase border mr-2 ${
                            isPair ? 'bg-p50 text-p400 border-p75' : 'bg-b50 text-b400 border-b75'
                        }`}>
                            {isPair ? 'Morph' : 'I2V'}
                        </span>


                        <VideoModelPicker
                            value={group.model}
                            options={getModelSelectOptions(group.model, allVideoModelOptions)}
                            onChange={(model) => updateTaskModel(group.uuid, model)}
                            compact
                        />
                        <span
                            data-testid="video-card-credit-estimate"
                            className="inline-flex rounded border border-warning/25 bg-y50 px-1.5 py-0.5"
                        >
                            <InlineCreditEstimate
                                featureKey="video_generation"
                                params={getGroupVideoCreditEstimateParams(group)}
                                fallbackCost={getGroupVideoCreditFallbackCost(group)}
                                compact
                                className="whitespace-nowrap text-[10px]"
                            />
                        </span>
                        {isMiniMaxH3Model(group.model) && (
                            <>
                            <label
                                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${group.mergedFrom && group.mergedFrom.length >= 2 && group.mergedFrom.length <= 8 ? 'border-p200/40 bg-p50 text-p400 cursor-pointer' : 'border-n40 bg-n20 text-n100 cursor-not-allowed'}`}
                                title="先合并 2–8 个镜头；Director 将逐段生成并用 Motion Context 保持动作和音频连续"
                            >
                                <input
                                    type="checkbox"
                                    checked={group.h3LongVideo === true}
                                    disabled={!group.mergedFrom || group.mergedFrom.length < 2 || group.mergedFrom.length > 8}
                                    onChange={(event) => patchTaskGroup(group.uuid, {
                                        h3LongVideo: event.target.checked,
                                    })}
                                    className="h-3 w-3 accent-primary"
                                />
                                H3 长视频
                            </label>
                            <label
                                className="inline-flex items-center gap-1 rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] text-success cursor-pointer"
                                title="H3 生成完成并释放模型后，串行加载 SeedVR2，输出 1280×720"
                            >
                                <input
                                    type="checkbox"
                                    checked={group.h3Upscale720p === true}
                                    onChange={(event) => patchTaskGroup(group.uuid, {
                                        h3Upscale720p: event.target.checked,
                                    })}
                                    className="h-3 w-3 accent-primary"
                                />
                                720P 放大
                            </label>
                            </>
                        )}
                        {activeVideoVoiceReference && (
                            <span
                                className="text-[10px] px-1.5 py-0.5 rounded border border-success/40 bg-success/10 text-success whitespace-nowrap"
                                title="生成时优先使用已抽离的人物声音参考"
                            >
                                {activeVideoVoiceReference.characterName} · 声音参考
                            </span>
                        )}

                    </div>

                    <div className="flex items-center gap-2">
                        {img1.uploadTime && (
                            <span className="text-[10px] text-n100 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatUploadTime(img1.uploadTime)}
                            </span>
                        )}
                        {isPair ? (
                            <button
                                onClick={() => unlinkGroup(index)}
                                className="text-xs text-n100 hover:text-danger p-1"
                                title="拆分"
                            >
                                <Unlink className="w-3.5 h-3.5" />
                            </button>
                        ) : (
                            <button
                                onClick={() => removeTask(group.uuid)}
                                className="text-n100 hover:text-danger p-1"
                                title="删除"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>


                <div className={`mb-1 grid w-full grid-cols-4 gap-2 overflow-y-auto ${CARD_MEDIA_HEIGHT_CLASS}`} data-testid="video-source-grid">
                    {sourceImages.map((image, sourceIndex) => {
                        const isEmptySource = image.isPlaceholder || !image.url;
                        const sourceLabel = isPair
                            ? (sourceIndex === 0 ? 'Start' : 'End')
                            : (sourceImages.length > 1 ? `#${sourceIndex + 1}` : '');

                        if (isEmptySource) {
                            return (
                                <div
                                    key={image.id}
                                    className="relative flex h-full min-h-[72px] flex-col items-center justify-center gap-2 overflow-hidden rounded border border-dashed border-n40 bg-n20/60 text-n100"
                                >
                                  <label className="flex cursor-pointer flex-col items-center hover:text-primary">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        hidden
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            if (file) handlePlaceholderUpload(image.id, file);
                                            event.target.value = '';
                                        }}
                                    />
                                    <ImageIcon className="h-4 w-4 opacity-50" />
                                    <span className="mt-1 text-[9px]">上传图片</span>
                                  </label>
                                  <button
                                      type="button"
                                      onClick={() => openProjectMaterials(group.uuid, image.id)}
                                      disabled={['pending', 'running', 'processing'].includes(tasksStatus[group.uuid]?.state || '')}
                                      className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary-light px-2 py-1 text-[10px] text-primary hover:border-primary disabled:opacity-50"
                                  >
                                      <Library className="h-3 w-3" /> 项目素材
                                  </button>
                                </div>
                            );
                        }

                        return (
                            <div
                                key={image.id}
                                className="group/img relative h-full min-h-[72px] cursor-zoom-in overflow-hidden rounded border border-n40 bg-n800"
                                onClick={() => { setLightboxUrl(image.url); setLightboxType('image'); }}
                            >
                                <img src={image.url} loading="lazy" decoding="async" alt="" className="h-full w-full bg-n900/50 object-contain" />
                                {sourceLabel && (
                                    <div className="absolute bottom-0 left-0 rounded-tr bg-n900/60 px-1 text-[9px] text-white">{sourceLabel}</div>
                                )}
                                {sourceIndex === 0 && !isPair && !group.mergedFrom?.length && !image.isUploading && (
                                    <button
                                        type="button"
                                        title="清空图（恢复为空卡）"
                                        onClick={(event) => { event.stopPropagation(); clearTaskImage(group.uuid); }}
                                        className="absolute right-1 top-1 rounded bg-n900/70 p-1 text-white opacity-0 transition-opacity hover:bg-danger group-hover/img:opacity-100"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                )}
                                {image.isUploading && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-n900/60">
                                        <div className="mb-1 text-[9px] text-white">上传中 {image.uploadProgress ?? 0}%</div>
                                        <div className="h-1.5 w-2/3 overflow-hidden rounded-full bg-n0">
                                            <div className="h-full rounded-full bg-primary transition-all duration-200" style={{ width: `${image.uploadProgress ?? 0}%` }} />
                                        </div>
                                    </div>
                                )}
                                {image.uploadFailed && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-r50">
                                        <span className="text-[9px] text-danger">上传失败</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {Array.from({ length: sourcePlaceholderCount }, (_, slotIndex) => (
                        <div
                            key={`empty-source-${slotIndex}`}
                            data-testid="video-source-placeholder"
                            className="flex h-full min-h-[72px] items-center justify-center rounded border border-dashed border-n40 bg-n20/60 text-n100"
                        >
                            <ImageIcon className="h-4 w-4 opacity-40" />
                        </div>
                    ))}
                </div>


                {(() => {
                    const itemId = img1.storyboardItemId;
                    const m = itemId ? storyboardMetaByItemId[itemId] : undefined;
                    if (!m) return null;
                    return (
                        <div className="flex items-center justify-between gap-2 shrink-0 mb-1">
                            <AudioBadgesRow meta={m} />
                        </div>
                    );
                })()}


                <div className={`${CARD_BODY_SCROLL_CLASS} flex flex-col`}>
                    {isPlaceholderCard ? (
                        <textarea
                            value={getEffectiveGroupPrompt(group)}
                            onChange={(e) => updatePrompt(group.ids[0], e.target.value)}
                            placeholder="先上传图片或选择项目素材，再描述此分镜内容..."
                            className={PLACEHOLDER_PROMPT_TEXTAREA_CLASS}
                        />
                    ) : isSeedanceModel(group.model) ? (
                        <React.Suspense fallback={<VideoProviderPanelFallback label="加载 Seedance 面板..." />}>
                            <SeedancePanelWithCandidates
                                value={getSeedanceParams(group.uuid, group.model)}
                                onChange={(next) => setSeedanceParams(group.uuid, next)}
                                autoOpenMentionOnMount={!!img1.isPlaceholder && (getSeedanceParams(group.uuid, group.model).prompt || '').trim() === '@'}
                                storyboardItemId={getStoryboardItemId(group.uuid)}
                                onUsePreviousVideoAudio={() => void usePreviousVideoAudioAsReference(group.uuid)}
                                previousVideoAudioBusy={referenceAudioExtractingUuid === group.uuid}
                                audioReferenceNotice={getSeedanceAudioReferenceNotice(group.model)}
                                supportsMultimodal={seedanceSupportsMultimodal(group.model)}
                                durationControl={<DurationFieldForGroup
                                    group={group}
                                    meta={img1.storyboardItemId ? storyboardMetaByItemId[img1.storyboardItemId] : undefined}
                                    onPatchGroup={patchTaskGroup}
                                    maxDuration={getSeedanceMaxDuration(group.model)}
                                    variant={group.model === 'Seedance15' ? 'seedance15' : 'compact'}
                                />}
                                onPreviewMedia={(url, kind) => {
                                    if (kind === 'audio') {
                                        const safeUrl = secureMediaUrl(url, { absolute: true });
                                        if (!safeUrl) { showToast('音频地址无效'); return; }
                                        showToast('音频点击预览（请在浏览器新标签播放）');
                                        window.open(safeUrl, '_blank', 'noopener,noreferrer');
                                        return;
                                    }
                                    setLightboxUrl(url);
                                    setLightboxType(kind === 'video' ? 'video' : 'image');
                                }}
                            />
                        </React.Suspense>
                    ) : isDashScopeVideoModel(group.model) ? (
                        <React.Suspense fallback={<VideoProviderPanelFallback label="加载视频模型面板..." />}>
                            <DashScopeCardWithCandidates
                                params={getDashScopeParams(group.uuid, group.model)}
                                onChange={(next) => setDashScopeParams(group.uuid, next)}
                                onPickImage={(cb) => openDashScopePicker(group.uuid, cb)}
                                onPreviewImage={(url) => { setLightboxUrl(url); setLightboxType('image'); }}
                                storyboardItemId={getStoryboardItemId(group.uuid)}
                                onPreviewMedia={(url, kind) => {
                                    if (kind === 'audio') {
                                        const safeUrl = secureMediaUrl(url, { absolute: true });
                                        if (!safeUrl) { showToast('音频地址无效'); return; }
                                        showToast('音频点击预览（请在浏览器新标签播放）');
                                        window.open(safeUrl, '_blank', 'noopener,noreferrer');
                                        return;
                                    }
                                    setLightboxUrl(url);
                                    setLightboxType(kind === 'video' ? 'video' : 'image');
                                }}
                            />
                        </React.Suspense>
                    ) : group.model === 'MINI' ? (
                        <MiniMaxVideoPanel
                            value={normalizeMiniMaxVideoParams(group.minimaxParams, defaultMiniMaxVideoModel)}
                            prompt={getEffectiveGroupPrompt(group)}
                            modelOptions={miniMaxModelOptions}
                            onChange={(next: MiniMaxVideoParams) => patchTaskGroup(group.uuid, { minimaxParams: next })}
                            onPromptChange={(next) => updatePrompt(group.ids[0], next)}
                        />
                    ) : (
                        <CapabilityVideoPanel
                            capability={getVideoCapability(videoCapabilities, group.model)}
                            value={group.videoParams}
                            prompt={getEffectiveGroupPrompt(group)}
                            onChange={(next) => patchTaskGroup(group.uuid, {
                                videoParams: next,
                                ...(group.model === '大能' && typeof next.shot_type === 'string'
                                    ? { shotType: next.shot_type as ShotType }
                                    : {}),
                            })}
                            onPromptChange={(next) => updatePrompt(group.ids[0], next)}
                        />
                    )}
                </div>

                <div className="mt-2 pt-2 border-t border-n40 shrink-0 flex items-center justify-end gap-2">
                    {isPair ? (
                        <button
                            type="button"
                            onClick={() => unlinkGroup(index)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-n40 bg-n0 text-[10px] text-n700 hover:border-warning hover:text-warning"
                            title="拆开当前首尾帧任务"
                        >
                            <Unlink className="w-3.5 h-3.5" />
                            拆开首尾帧
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => linkGroups(index)}
                            disabled={!canCreateFirstLastPair(taskGroups, index)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-n40 bg-n0 text-[10px] text-n700 hover:border-primary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                            title={canCreateFirstLastPair(taskGroups, index) ? '与下一张卡片组成首尾帧任务' : '需要下一张为相同模型的单图卡片'}
                        >
                            <Link className="w-3.5 h-3.5" />
                            首尾帧
                        </button>
                    )}
                    {group.mergedFrom && group.mergedFrom.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setMergedCardDialogUuid(group.uuid)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-n40 bg-n0 text-[10px] text-n700 hover:border-warning hover:text-warning"
                            title={`管理 ${group.mergedFrom.length} 个已合并镜头`}
                        >
                            <Split className="w-3.5 h-3.5" />
                            管理合并
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => openMergeDialog(index)}
                        disabled={!canMergeWithNext(index)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-primary text-[10px] text-white hover:bg-primary-hover disabled:opacity-30 disabled:cursor-not-allowed"
                        title={canMergeWithNext(index) ? '选择连续向下合并的镜头' : '下方没有可合并的连续镜头'}
                    >
                        <Combine className="w-3.5 h-3.5" />
                        合并
                    </button>
                </div>
            </div>
        );
    };

    const renderResultCard = (group: TaskGroup, index: number) => {
        if (!group.ids) return null;
        const isPair = group.ids.length === 2 && !group.mergedFrom?.length;
        const status = tasksStatus[group.uuid] || { state: 'idle' };
        const promptText = getEffectiveGroupPrompt(group);



        const img1 = uploadedImages.find(i => i.id === group.ids[0]);
        const isPlaceholderCard = !!img1?.isPlaceholder;
        const cardHeight = getCardHeightClass(group.model, isPlaceholderCard);
        const seedanceCard = isSeedanceModel(group.model);
        const activeVideoVoiceReference = getVideoVoiceReferenceForGroup(group);
        const shotRange = getGroupShotRange(group, index);

        const renderStatusBadge = () => {
            if (status.state === 'pending') {
                return (
                    <div className="text-xs text-warning flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        排队中
                    </div>
                );
            }
            if (status.state === 'running') {
                return (
                    <div className="text-xs text-primary flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {getElapsedTimeStr(group.uuid)}
                    </div>
                );
            }
            if (status.state === 'processing') {
                return (
                    <div className="text-xs text-primary flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        处理中 {status.progress || 0}%
                    </div>
                );
            }
            if (status.state === 'done') {
                return (
                    <div className="text-xs text-success flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        完成
                    </div>
                );
            }
            if (status.state === 'failed') {
                return (
                    <div className="text-xs text-danger flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {hasStoredVideoResult(status) ? '本次失败，历史结果已保留' : '失败'}
                    </div>
                );
            }
            return <div className="text-xs text-n100">等待</div>;
        };

        const renderVisual = () => {
            const videos = status.videos || [];
            const videoCount = videos.length;
            const isPair = group.ids.length === 2 && !group.mergedFrom?.length;
            const isQueued = status.state === 'pending';
            const isRunning = status.state === 'running' || status.state === 'processing';
            const isBeautifyVideo = (videoUrl: string) =>
                !!status.result && normVideoKey(status.result) === normVideoKey(videoUrl);
            const renderBeautifyButton = (videoUrl: string, idx: number) => {
                const active = isBeautifyVideo(videoUrl);
                const applying = beautifyApplyingKey === `${group.uuid}:${idx}`;
                return (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!active && !applying) void setVideoForBeautify(group, videoUrl, idx);
                        }}
                        disabled={active || applying}
                        className={`absolute bottom-1 right-1 z-20 flex items-center gap-1 max-w-[calc(100%-8px)] rounded px-1.5 py-0.5 text-[9px] font-semibold shadow-sm backdrop-blur transition-colors ${
                            active
                                ? 'bg-success text-white opacity-100'
                                : 'bg-n900/75 text-white opacity-80 hover:bg-primary hover:opacity-100'
                        } disabled:cursor-default`}
                        title={active ? '美化使用中' : '设为美化使用'}
                    >
                        {applying ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <Check className="w-3 h-3 shrink-0" />}
                        <span className="truncate">{active ? '美化使用中' : '设为美化'}</span>
                    </button>
                );
            };
            const renderEmptyResultSlots = (count: number) => Array.from({ length: count }, (_, slotIndex) => (
                <div
                    key={`empty-result-${slotIndex}`}
                    data-testid="video-result-placeholder"
                    className="h-full min-h-[72px] rounded border border-dashed border-n40 bg-n20/60 flex items-center justify-center text-n100"
                >
                    <Film className="h-4 w-4 opacity-40" />
                </div>
            ));


            if (hasStoredVideoResult(status)) {

                if (videoCount >= 1) {
                    return (
                        <div className={`w-full ${CARD_MEDIA_HEIGHT_CLASS}`} data-testid="video-result-grid">
                            <div className="grid h-full grid-cols-4 gap-2 overflow-y-auto">
                                {videos.map((videoUrl, idx) => {
                                    const active = isBeautifyVideo(videoUrl);
                                    const videoModel = status.videoModels?.[idx];
                                    const uploadedVideo = status.uploadedVideos?.[String(normVideoKey(videoUrl))];
                                    const videoModelLabel = uploadedVideo ? `外部上传 · ${uploadedVideo.filename}` : videoModel
                                        ? formatVideoModelOptionLabel(
                                            videoModel,
                                            getVideoCapability(videoCapabilities, videoModel),
                                        )
                                        : '历史模型未记录';
                                    return (
                                        <div
                                            key={idx}
                                            className={`relative h-full min-h-[72px] bg-n800 rounded border group/video overflow-hidden ${
                                                active ? 'border-success ring-2 ring-success/40' : 'border-n40'
                                            }`}
                                        >
                                            <LazyVideo
                                                src={videoUrl}
                                                preload="none"
                                                className="w-full h-full object-contain cursor-pointer"
                                                onClick={() => { setLightboxUrl(videoUrl); setLightboxType('video'); }}
                                            />

                                            <div
                                                className="absolute left-1 top-1 z-10 flex max-w-[calc(100%-2rem)] items-center gap-1 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm"
                                                title={`#${idx + 1} · ${videoModelLabel}`}
                                            >
                                                <span className="shrink-0">#{idx + 1}</span>
                                                <span className="truncate border-l border-white/40 pl-1 font-medium">{videoModelLabel}</span>
                                            </div>

                                            {status.videoGenerateTimes && status.videoGenerateTimes[idx] && (
                                                <span className="absolute bottom-1 left-1 bg-success/80 text-white text-[10px] px-1.5 py-0.5 rounded font-bold z-10 backdrop-blur-sm">
                                                    {status.videoGenerateTimes[idx]}s
                                                </span>
                                            )}
                                            {!isRunning && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); deleteVideo(group.uuid, idx); }}
                                                    className="absolute top-1 right-1 w-5 h-5 bg-danger hover:bg-danger text-white rounded-full flex items-center justify-center opacity-0 group-hover/video:opacity-100 transition-opacity z-10"
                                                    title="删除此视频"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            )}
                                            {renderBeautifyButton(videoUrl, idx)}
                                        </div>
                                    );
                                })}

                                {isRunning && (
                                    <div className="h-full min-h-[72px] bg-gradient-to-br from-n30 to-n20 rounded border border-n40 flex flex-col items-center justify-center">
                                        <div className="relative w-8 h-8 mb-2">
                                            <div className="absolute inset-0 border-2 border-t-indigo-500 border-r-indigo-500 border-b-transparent border-l-transparent rounded-full animate-spin" />
                                        </div>
                                        <div className="text-primary text-[10px] font-medium">生成中</div>
                                        <div className="text-n100 text-[9px]">{status.progress || 0}%</div>
                                    </div>
                                )}
                                {renderEmptyResultSlots(getVideoResultPlaceholderCount(videoCount, isRunning))}
                            </div>
                        </div>
                    );
                }
            }


            if (isQueued) {
                return (
                    <div className={`grid w-full grid-cols-4 gap-2 ${CARD_MEDIA_HEIGHT_CLASS}`} data-testid="video-result-grid">
                        <div className="h-full rounded border border-warning/30 flex flex-col items-center justify-center bg-warning/5">
                            <Clock className="w-5 h-5 mb-1 text-warning" />
                            <div className="text-warning text-[10px] font-medium">排队中...</div>
                        </div>
                        {renderEmptyResultSlots(3)}
                    </div>
                );
            }


            if (status.state === 'running' || status.state === 'processing') {
                return (
                    <div className={`grid w-full grid-cols-4 gap-2 ${CARD_MEDIA_HEIGHT_CLASS}`} data-testid="video-result-grid">
                        <div className="h-full rounded border border-n40 flex flex-col items-center justify-center bg-gradient-to-br from-n30 to-n20">
                            <div className="relative w-8 h-8 mb-1">
                                <div className="absolute inset-0 border-2 border-t-indigo-500 border-r-indigo-500 border-b-transparent border-l-transparent rounded-full animate-spin" />
                            </div>
                            <div className="text-primary text-[10px] font-medium">生成中...</div>
                            <div className="text-n300 text-[9px]">{status.progress || 0}%</div>
                        </div>
                        {renderEmptyResultSlots(3)}
                    </div>
                );
            }


            return (
                <div className={`grid w-full grid-cols-4 gap-2 ${CARD_MEDIA_HEIGHT_CLASS}`} data-testid="video-result-grid">
                    {renderEmptyResultSlots(4)}
                </div>
            );
        };

        return (
            <div
                key={group.uuid}
                className={`bg-n0 rounded-md border p-4 mb-4 shadow-card hover:shadow-atlas flex flex-col overflow-hidden ${cardHeight} ${
                    seedanceCard ? 'bg-gradient-to-b from-n0 to-n20' : ''
                } ${
                    status.selected ? 'border-primary ring-1 ring-primary/30' : (seedanceCard ? 'border-primary/40' : 'border-n40')
                }`}
            >

                <div className="flex justify-between items-center w-full pb-2 border-b border-n40 shrink-0">
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={status.selected || false}
                            onChange={() => toggleTaskSelection(group.uuid)}
                            className="w-4 h-4 rounded bg-n0 border-n40 text-primary cursor-pointer"
                        />
                        {shotRange.isSegmentStart && shotRange.start && (
                            <span className="rounded border border-warning/30 bg-y50 px-1.5 py-0.5 text-[9px] font-semibold text-warning">
                                分段 {String(shotRange.start.segmentNo).padStart(2, '0')}
                            </span>
                        )}
                        <span className="text-xs font-bold text-n700">{shotRange.label} {isPair ? 'Morph' : 'I2V'}</span>
                        {renderStatusBadge()}
                        {activeVideoVoiceReference && (
                            <span
                                className="text-[10px] px-1.5 py-0.5 rounded border border-success/40 bg-success/10 text-success whitespace-nowrap"
                                title="生成时优先使用已抽离的人物声音参考"
                            >
                                {activeVideoVoiceReference.characterName} · 声音参考
                            </span>
                        )}
                    </div>


                    <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => setVideoUploadTarget(group.uuid)}
                            disabled={!episodeId || ['pending', 'running', 'processing'].includes(status.state || '')}
                            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-primary hover:bg-primary-light disabled:opacity-40"
                            title="上传外部视频到此镜头">
                            <Upload className="w-3 h-3" /> 上传视频
                        </button>
                        <button
                            onClick={() => runTask(group.uuid)}
                            disabled={status.state === 'running' || status.state === 'processing' || !isVideoModelAvailable(group.model)}
                            className="flex items-center gap-1 px-2 py-1 bg-n0 hover:bg-primary-hover text-n700 hover:text-white text-[10px] rounded transition-colors disabled:opacity-50"
                            title={!isVideoModelAvailable(group.model) ? getVideoModelUnavailableReason(group.model) : undefined}
                        >
                            {status.state === 'done' ? <RefreshCw className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                            {status.state === 'done' ? '重做' : '生成'}
                        </button>


                        {status.videos && status.videos.length > 0 && (
                            <>
                                {!status.isUpscaled ? (
                                    <button
                                        onClick={() => openUpscaleModal(group.uuid)}
                                        className="flex items-center gap-1 px-2 py-1 bg-primary hover:bg-primary-hover text-white text-[10px] rounded transition-colors"
                                        title="视频放大"
                                    >
                                        <Maximize className="w-3 h-3" />
                                        放大
                                    </button>
                                ) : (
                                    <span className="flex items-center gap-1 px-2 py-1 bg-success text-white text-[10px] rounded" title="已放大">
                                        <Check className="w-3 h-3" />
                                        已放大
                                    </span>
                                )}
                                <button
                                    onClick={() => openVoiceModal(group.uuid)}
                                    className="flex items-center gap-1 px-2 py-1 bg-warning hover:bg-warning text-white text-[10px] rounded transition-colors"
                                    title="配音"
                                >
                                    <Mic className="w-3 h-3" />
                                    配音
                                </button>
                                <button
                                    onClick={() => openEditModal(group.uuid)}
                                    className="flex items-center gap-1 px-2 py-1 bg-primary hover:bg-primary-hover text-white text-[10px] rounded transition-colors"
                                    title="编辑"
                                >
                                    <Scissors className="w-3 h-3" />
                                    编辑
                                </button>
                                <button
                                    onClick={() => openVideoVoiceReferenceModal(group.uuid)}
                                    className="flex items-center gap-1 px-2 py-1 bg-success hover:bg-success text-white text-[10px] rounded transition-colors"
                                    title="抽离人物声音并供后续分镜参考"
                                >
                                    <Volume2 className="w-3 h-3" />
                                    声音抽离
                                </button>
                            </>
                        )}
                    </div>
                </div>


                <div className="shrink-0 mb-1">
                    {renderVisual()}
                </div>


                <div className={`${CARD_BODY_SCROLL_CLASS} flex flex-col`}>
                    <div
                        className={RESULT_PROMPT_READONLY_CLASS}
                        title={promptText || ''}
                    >
                        {promptText || <span className="italic opacity-50">无描述...</span>}
                    </div>
                </div>

            </div>
        );
    };



    const renderVideoVoiceReferenceModal = () => {
        if (!voiceReferenceModalUuid) return null;
        const group = taskGroups.find(candidate => candidate.uuid === voiceReferenceModalUuid);
        const videos = tasksStatus[voiceReferenceModalUuid]?.videos || [];
        if (!group || videos.length === 0) return null;
        const selectedVideo = videos[Math.min(voiceReferenceVideoIndex, videos.length - 1)];
        const characterOptions = Array.from(new Set([
            ...taskGroups.map(candidate => getCharacterNameForGroup(candidate)),
            ...videoVoiceReferences.map(reference => reference.characterName),
            getCharacterNameForGroup(group),
        ].map(character => character.trim()).filter(Boolean)));
        const currentReference = videoVoiceReferences.find(
            reference => reference.characterName === voiceReferenceCharacter.trim(),
        );

        return (
            <div
                className="fixed inset-0 z-50 bg-n900/80 flex items-center justify-center p-4"
                onClick={() => !voiceReferenceSaving && setVoiceReferenceModalUuid(null)}
            >
                <div
                    className="bg-n0 rounded-md p-5 w-[560px] max-w-full max-h-[86vh] overflow-y-auto shadow-bottom"
                    onClick={event => event.stopPropagation()}
                >
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-base font-bold text-n800 flex items-center gap-2">
                                <Volume2 className="w-5 h-5 text-success" />
                                人物声音抽离
                            </h3>
                            <p className="text-[11px] text-n100 mt-1">从已生成视频抽离声音并绑定人物，后续同人物分镜会自动优先复用。</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setVoiceReferenceModalUuid(null)}
                            disabled={voiceReferenceSaving}
                            className="text-n300 hover:text-n800 disabled:opacity-50"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="space-y-4">
                        <div className="rounded border border-n40 bg-n900 overflow-hidden aspect-video">
                            <LazyVideo
                                src={selectedVideo}
                                controls
                                muted={false}
                                hoverPreview={false}
                                firstFrame={false}
                                preload="metadata"
                                className="w-full h-full object-contain"
                            />
                        </div>

                        {videos.length > 1 && (
                            <label className="block">
                                <span className="block text-xs text-n300 mb-1.5">来源视频</span>
                                <select
                                    value={voiceReferenceVideoIndex}
                                    onChange={event => setVoiceReferenceVideoIndex(Number(event.target.value))}
                                    className="w-full px-3 py-2 rounded border border-n40 bg-n0 text-sm text-n700"
                                >
                                    {videos.map((_video, index) => (
                                        <option key={index} value={index}>第 {index + 1} 个生成结果</option>
                                    ))}
                                </select>
                            </label>
                        )}

                        <label className="block">
                            <span className="block text-xs text-n300 mb-1.5">声音对应人物</span>
                            <input
                                value={voiceReferenceCharacter}
                                onChange={event => setVoiceReferenceCharacter(event.target.value)}
                                list="video-voice-reference-characters"
                                placeholder="选择或输入人物名称"
                                className="w-full px-3 py-2 rounded border border-n40 bg-n0 text-sm text-n700 focus:border-primary focus:outline-none"
                            />
                            <datalist id="video-voice-reference-characters">
                                {characterOptions.map(character => (
                                    <option key={character} value={character} />
                                ))}
                            </datalist>
                            <span className="block text-[11px] text-n100 mt-1.5">
                                后续分镜的对白人物名与这里一致时，系统会自动附加这段声音作为人物参考。
                            </span>
                        </label>

                        {currentReference && (
                            <div className="rounded border border-success/40 bg-success/5 p-3">
                                <div className="text-xs font-medium text-success">该人物已有声音参考，本次保存后将更新</div>
                                <div className="text-[11px] text-n300 mt-1">
                                    {currentReference.videoModel || '未知模型'} · {currentReference.updatedAt ? new Date(currentReference.updatedAt).toLocaleString() : '时间未知'}
                                </div>
                                <audio
                                    src={secureMediaUrl(currentReference.referenceAudioUrl)}
                                    controls
                                    preload="metadata"
                                    className="w-full h-8 mt-2"
                                />
                            </div>
                        )}

                        <div className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-n300 leading-relaxed">
                            若视频包含多人或重叠对白，请选择目标人物单独说话的生成结果，避免把其他人物声音一起绑定。生成优先级：人物声音参考 → 当前分镜参考配音 → 模型自由生成；模型不支持音频参考时会忽略声音并继续生成。
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 mt-5">
                        <button
                            type="button"
                            onClick={() => setVoiceReferenceModalUuid(null)}
                            disabled={voiceReferenceSaving}
                            className="px-4 py-2 text-sm rounded border border-n40 text-n300 hover:text-n700 disabled:opacity-50"
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            onClick={() => void saveVideoVoiceReference()}
                            disabled={voiceReferenceSaving || !voiceReferenceCharacter.trim()}
                            className="px-4 py-2 text-sm rounded bg-success text-white hover:bg-success disabled:opacity-50 flex items-center gap-2"
                        >
                            {voiceReferenceSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                            {voiceReferenceSaving ? '正在抽离声音...' : '抽离并设为人物参考'}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderUpscaleModal = () => {
        if (!upscaleModalUuid) return null;
        const status = tasksStatus[upscaleModalUuid];
        const videos = status?.videos || [];

        return (
            <div className="fixed inset-0 z-50 bg-n900/80 flex items-center justify-center" onClick={() => setUpscaleModalUuid(null)}>
                <div className="bg-n0 rounded-md p-6 w-[500px] max-h-[80vh] overflow-y-auto shadow-bottom" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-n800 flex items-center gap-2">
                            <Maximize className="w-5 h-5 text-primary" />
                            视频放大
                        </h3>
                        <button onClick={() => setUpscaleModalUuid(null)} className="text-n300 hover:text-n800">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {videos.length > 1 && (
                        <div className="mb-4">
                            <label className="text-sm text-n300 mb-2 block">选择要放大的视频</label>
                            <select
                                value={selectedVideoIndex}
                                onChange={(e) => setSelectedVideoIndex(parseInt(e.target.value))}
                                className="w-full bg-n20 border border-n40 text-n800 rounded px-3 py-2"
                            >
                                {videos.map((_, idx) => (
                                    <option key={idx} value={idx}>视频 #{idx + 1}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="mb-4">
                        <video
                            src={videos[selectedVideoIndex]}
                            preload="metadata"
                            className="w-full rounded border border-n40"
                            controls
                        />
                    </div>

                    <GpuNodeSelector
                        onSelectionChange={setUpscaleNodeSelection}
                        disabled={isSubmitting}
                        className="mb-4"
                    />

                    <div className="text-sm text-n300 mb-4 p-3 bg-n20/50 rounded">
                        <p>放大后的视频将提升至2倍分辨率，处理时间约5-10分钟。</p>
                    </div>

                    <div className="flex justify-end gap-3">
                        <button
                            onClick={() => setUpscaleModalUuid(null)}
                            className="px-4 py-2 bg-n0 hover:bg-n20 text-n700 rounded"
                        >
                            取消
                        </button>
                        <button
                            onClick={submitUpscale}
                            disabled={isSubmitting || !upscaleNodeSelection?.usable}
                            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded flex items-center gap-2 disabled:opacity-50"
                        >
                            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            开始放大
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderVoiceModal = () => {
        if (!voiceModalUuid) return null;
        const status = tasksStatus[voiceModalUuid];
        const videos = status?.videos || [];

        return (
            <div className="fixed inset-0 z-50 bg-n900/80 flex items-center justify-center" onClick={() => setVoiceModalUuid(null)}>
                <div className="bg-n0 rounded-md p-6 w-[600px] max-h-[90vh] overflow-y-auto shadow-bottom" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-n800 flex items-center gap-2">
                            <Mic className="w-5 h-5 text-warning" />
                            视频配音
                        </h3>
                        <button onClick={() => setVoiceModalUuid(null)} className="text-n300 hover:text-n800">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {videos.length > 1 && (
                        <div className="mb-4">
                            <label className="text-sm text-n300 mb-2 block">选择视频</label>
                            <select
                                value={selectedVideoIndex}
                                onChange={(e) => setSelectedVideoIndex(parseInt(e.target.value))}
                                className="w-full bg-n20 border border-n40 text-n800 rounded px-3 py-2"
                            >
                                {videos.map((_, idx) => (
                                    <option key={idx} value={idx}>视频 #{idx + 1}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="mb-4">
                        <label className="text-sm text-n300 mb-2 block">上传音频文件</label>
                        <div
                            className="border-2 border-dashed border-n40 rounded-lg p-4 text-center hover:border-warning transition-colors cursor-pointer"
                            onClick={() => audioInputRef.current?.click()}
                        >
                            <input
                                ref={audioInputRef}
                                type="file"
                                accept="audio/*"
                                onChange={handleVoiceAudioUpload}
                                className="hidden"
                            />
                            {voiceAudioFile ? (
                                <div className="flex items-center justify-center gap-2 text-warning">
                                    <Music className="w-5 h-5" />
                                    <span>{voiceAudioFile.name}</span>
                                </div>
                            ) : (
                                <div className="text-n100">
                                    <Upload className="w-8 h-8 mx-auto mb-2" />
                                    <p>点击或拖拽上传音频文件</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {voiceAudioFile && (
                        <div className="mb-4">
                            <label className="text-sm text-n300 mb-2 block">音频裁剪（取5秒）</label>
                            <div className="flex items-center gap-3">
                                <div className="flex-1">
                                    <label className="text-xs text-n100">起始时间(秒)</label>
                                    <input
                                        type="number"
                                        value={voiceStartTime}
                                        onChange={(e) => setVoiceStartTime(parseFloat(e.target.value) || 0)}
                                        min={0}
                                        step={0.1}
                                        className="w-full bg-n20 border border-n40 text-n800 rounded px-3 py-2"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs text-n100">结束时间(秒)</label>
                                    <input
                                        type="number"
                                        value={voiceStartTime + 5}
                                        disabled
                                        className="w-full bg-n20 border border-n40 text-n100 rounded px-3 py-2"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="mb-4">
                        <label className="text-sm text-n300 mb-2 block">配音提示词（可选）</label>
                        <textarea
                            value={voicePrompt}
                            onChange={(e) => setVoicePrompt(e.target.value)}
                            placeholder="例如：生动的表情、自然的口型同步"
                            className="w-full bg-n20 border border-n40 text-n800 rounded px-3 py-2 h-20 resize-none"
                        />
                    </div>

                    <div className="flex justify-end gap-3">
                        <button
                            onClick={() => setVoiceModalUuid(null)}
                            className="px-4 py-2 bg-n0 hover:bg-n20 text-n700 rounded"
                        >
                            取消
                        </button>
                        <button
                            onClick={submitVoice}
                            disabled={isSubmitting || !voiceAudioFile}
                            className="px-4 py-2 bg-warning hover:bg-warning text-white rounded flex items-center gap-2 disabled:opacity-50"
                        >
                            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            开始配音
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderEditModal = () => {
        if (!editModalUuid) return null;
        const status = tasksStatus[editModalUuid];
        const videos = status?.videos || [];
        const currentVideoUrl = getVideoByIndexOrLatest(videos, selectedVideoIndex);

        return (
            <div className="fixed inset-0 z-50 bg-n900/80 flex items-center justify-center" onClick={() => setEditModalUuid(null)}>
                <div className="bg-n0 rounded-md p-6 w-[700px] max-h-[90vh] overflow-y-auto shadow-bottom" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-n800 flex items-center gap-2">
                            <Scissors className="w-5 h-5 text-primary" />
                            视频编辑
                        </h3>
                        <button onClick={() => setEditModalUuid(null)} className="text-n300 hover:text-n800">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {videos.length > 1 && (
                        <div className="mb-4">
                            <label className="text-sm text-n300 mb-2 block">选择视频</label>
                            <select
                                value={selectedVideoIndex}
                                onChange={(e) => setSelectedVideoIndex(parseInt(e.target.value))}
                                className="w-full bg-n20 border border-n40 text-n800 rounded px-3 py-2"
                            >
                                {videos.map((_, idx) => (
                                    <option key={idx} value={idx}>视频 #{idx + 1}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="mb-4">
                        <video
                            ref={editVideoRef}
                            src={currentVideoUrl}
                            preload="metadata"
                            className="w-full rounded border border-n40"
                            controls
                        />
                    </div>


                    <div className="mb-4 p-4 bg-n20/50 rounded-lg">
                        <h4 className="text-sm font-medium text-n800 mb-3">视频裁剪</h4>
                        <div className="grid grid-cols-2 gap-4 mb-3">
                            <div>
                                <label className="text-xs text-n100 block mb-1">开始时间(秒)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        value={cropStartTime}
                                        onChange={(e) => setCropStartTime(parseFloat(e.target.value) || 0)}
                                        min={0}
                                        step={0.1}
                                        className="flex-1 bg-n20 border border-n40 text-n800 rounded px-3 py-2"
                                    />
                                    <button
                                        onClick={setCurrentTimeAsStart}
                                        className="px-3 py-2 bg-n0 hover:bg-n20 text-n700 rounded text-xs"
                                    >
                                        当前
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-n100 block mb-1">结束时间(秒)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        value={cropEndTime}
                                        onChange={(e) => setCropEndTime(parseFloat(e.target.value) || 0)}
                                        min={0}
                                        step={0.1}
                                        className="flex-1 bg-n20 border border-n40 text-n800 rounded px-3 py-2"
                                    />
                                    <button
                                        onClick={setCurrentTimeAsEnd}
                                        className="px-3 py-2 bg-n0 hover:bg-n20 text-n700 rounded text-xs"
                                    >
                                        当前
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => seekToTime(cropStartTime)}
                                className="flex-1 px-3 py-1.5 bg-n0 hover:bg-n20 text-n700 rounded text-xs"
                            >
                                跳到开始
                            </button>
                            <button
                                onClick={() => seekToTime(cropEndTime)}
                                className="flex-1 px-3 py-1.5 bg-n0 hover:bg-n20 text-n700 rounded text-xs"
                            >
                                跳到结束
                            </button>
                        </div>
                    </div>


                    <div className="mb-4 p-4 bg-n20/50 rounded-lg">
                        <h4 className="text-sm font-medium text-n800 mb-3">抽取帧</h4>
                        <div className="grid grid-cols-3 gap-2">
                            <button
                                onClick={() => extractVideoFrame('first')}
                                disabled={isExtractingFrame}
                                className="px-3 py-2 bg-n0 hover:bg-n20 border border-n40 text-n700 rounded flex items-center justify-center gap-1.5 disabled:opacity-50"
                                title="抽取视频第一帧"
                            >
                                <SkipBack className="w-4 h-4" />
                                首帧
                            </button>
                            <button
                                onClick={() => extractVideoFrame('current')}
                                disabled={isExtractingFrame}
                                className="px-3 py-2 bg-primary hover:bg-primary-hover text-white rounded flex items-center justify-center gap-1.5 disabled:opacity-50"
                                title="抽取播放器当前画面"
                            >
                                {isExtractingFrame ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                                当前帧
                            </button>
                            <button
                                onClick={() => extractVideoFrame('last')}
                                disabled={isExtractingFrame}
                                className="px-3 py-2 bg-n0 hover:bg-n20 border border-n40 text-n700 rounded flex items-center justify-center gap-1.5 disabled:opacity-50"
                                title="抽取视频最后一帧"
                            >
                                <SkipForward className="w-4 h-4" />
                                尾帧
                            </button>
                        </div>
                        <p className="text-xs text-n100 mt-2">抽取的图片将添加到左侧分镜板</p>
                    </div>

                    <div className="flex justify-end gap-3">
                        <button
                            onClick={() => setEditModalUuid(null)}
                            className="px-4 py-2 bg-n0 hover:bg-n20 text-n700 rounded"
                        >
                            取消
                        </button>
                        <button
                            onClick={submitCrop}
                            disabled={isSubmitting}
                            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded flex items-center gap-2 disabled:opacity-50"
                        >
                            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            裁剪视频
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderMergeDialog = () => {
        if (!mergeDialog) return null;
        const startIndex = taskGroups.findIndex(group => group.uuid === mergeDialog.groupUuid);
        if (startIndex < 0) return null;
        const plan = getDownwardMergePlan(startIndex, mergeDialog.selectedEndIndex);
        const displayDuration = (seconds: number) => Math.round(seconds * 10) / 10;
        const selectedShotCount = plan.groups.reduce(
            (sum, group) => sum + (group.mergedFrom?.length || 1),
            0,
        );

        return (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-n900/70 p-4"
                onClick={() => setMergeDialog(null)}
                data-testid="video-merge-dialog"
            >
                <div
                    className="flex max-h-[min(760px,calc(100vh-2rem))] w-[min(680px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-n40 bg-n0 shadow-bottom"
                    onClick={event => event.stopPropagation()}
                >
                    <div className="flex items-start justify-between border-b border-n40 px-5 py-4">
                        <div>
                            <h3 className="text-base font-semibold text-n800">向下合并镜头</h3>
                            <p className="mt-1 text-xs text-n300">选择结束镜头，中间所有镜头会按顺序一起选中；建议总时长保持在 10–15 秒。</p>
                        </div>
                        <button type="button" onClick={() => setMergeDialog(null)} className="rounded p-1 text-n300 hover:bg-n20 hover:text-n800">
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                        <div className="mb-3 grid grid-cols-3 gap-2 rounded-md border border-primary/20 bg-primary-light px-3 py-2 text-xs">
                            <div><span className="text-n300">镜头</span><strong className="ml-1 text-n800">{selectedShotCount}</strong></div>
                            <div><span className="text-n300">图片</span><strong className="ml-1 text-n800">{plan.imageCount}/{plan.maxImages}</strong></div>
                            <div><span className="text-n300">预计时长</span><strong className="ml-1 text-n800">{displayDuration(plan.totalDuration)} 秒</strong></div>
                        </div>

                        <div className="space-y-2">
                            {plan.availableGroups.map((candidate, offset) => {
                                const candidateIndex = startIndex + offset;
                                const selected = candidateIndex <= plan.endIndex;
                                const shotRange = getGroupShotRange(candidate, candidateIndex);
                                const duration = displayDuration(getGroupMergeDuration(candidate));
                                return (
                                    <button
                                        key={candidate.uuid}
                                        type="button"
                                        disabled={offset === 0}
                                        onClick={() => setMergeDialog(current => current ? { ...current, selectedEndIndex: candidateIndex } : current)}
                                        className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
                                            selected ? 'border-primary bg-primary-light/60' : 'border-n40 bg-n0 hover:border-primary/50'
                                        } ${offset === 0 ? 'cursor-default' : ''}`}
                                    >
                                        <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? 'border-primary bg-primary text-white' : 'border-n40 text-transparent'}`}>
                                            <Check className="h-3.5 w-3.5" />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-semibold text-n800">{shotRange.label}</span>
                                                {shotRange.isSegmentStart && shotRange.start && (
                                                    <span className="rounded border border-warning/30 bg-y50 px-1.5 py-0.5 text-[9px] font-semibold text-warning">
                                                        分段 {String(shotRange.start.segmentNo).padStart(2, '0')} 开始
                                                    </span>
                                                )}
                                                {candidate.mergedFrom?.length ? (
                                                    <span className="text-[10px] text-primary">已含 {candidate.mergedFrom.length} 个镜头</span>
                                                ) : null}
                                            </div>
                                            <div className="mt-0.5 text-[11px] text-n300">约 {duration} 秒 · {candidate.ids.length} 张图</div>
                                        </div>
                                        <span className="shrink-0 text-[10px] text-n100">{offset === 0 ? '起点' : '选到这里'}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {plan.hardStopReason === 'image_limit' && (
                            <div className="mt-3 flex gap-2 rounded-md border border-warning/30 bg-y50 px-3 py-2 text-xs text-warning">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                合并内容最多包含 9 张图，后续镜头已停止加入候选。
                            </div>
                        )}
                        {plan.crossesSegment && (
                            <div className="mt-3 flex gap-2 rounded-md border border-warning/40 bg-y50 px-3 py-2 text-xs text-warning" data-testid="video-merge-cross-segment-warning">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                当前选择跨越了剧本分段。确认后会合并为一个视频段落卡片，镜头编号仍保留分段范围。
                            </div>
                        )}
                        {plan.exceedsDuration && (
                            <div className="mt-3 flex gap-2 rounded-md border border-danger/30 bg-r50 px-3 py-2 text-xs text-danger" data-testid="video-merge-duration-warning">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                当前约 {displayDuration(plan.totalDuration)} 秒，超过该模型建议上限 {displayDuration(plan.maxDuration)} 秒。接口可能拒绝或截断，确认后仍会合并。
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between border-t border-n40 px-5 py-4">
                        <span className="text-[11px] text-n300">合并后可在“管理合并”中移出单个镜头。</span>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setMergeDialog(null)} className="rounded border border-n40 bg-n0 px-4 py-2 text-xs text-n700 hover:bg-n20">取消</button>
                            <button
                                type="button"
                                disabled={!plan.canMerge}
                                onClick={() => mergeWithNext(startIndex, plan.endIndex)}
                                className="rounded bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
                            >
                                确认合并
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderMergedCardDialog = () => {
        if (!mergedCardDialogUuid) return null;
        const groupIndex = taskGroups.findIndex(group => group.uuid === mergedCardDialogUuid);
        const group = taskGroups[groupIndex];
        if (!group?.mergedFrom?.length) return null;

        return (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-n900/70 p-4"
                onClick={() => setMergedCardDialogUuid(null)}
                data-testid="video-merged-card-dialog"
            >
                <div
                    className="flex max-h-[min(720px,calc(100vh-2rem))] w-[min(620px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-n40 bg-n0 shadow-bottom"
                    onClick={event => event.stopPropagation()}
                >
                    <div className="flex items-start justify-between border-b border-n40 px-5 py-4">
                        <div>
                            <h3 className="text-base font-semibold text-n800">管理已合并镜头</h3>
                            <p className="mt-1 text-xs text-n300">移出中间镜头时，前后镜头会自动保留为两个连续合并组。</p>
                        </div>
                        <button type="button" onClick={() => setMergedCardDialogUuid(null)} className="rounded p-1 text-n300 hover:bg-n20 hover:text-n800">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
                        {group.mergedFrom.map((snapshot, childIndex) => {
                            const childGroup: TaskGroup = {
                                uuid: snapshot.uuid,
                                ids: snapshot.ids,
                                model: snapshot.model,
                            };
                            const shotRange = getGroupShotRange(childGroup, childIndex);
                            return (
                                <div key={`${snapshot.uuid}-${childIndex}`} className="flex items-center gap-3 rounded-md border border-n40 px-3 py-2.5">
                                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-n30 text-[10px] font-semibold text-n500">{childIndex + 1}</div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-semibold text-n800">{shotRange.label}</div>
                                        <div className="mt-0.5 text-[11px] text-n300">约 {Math.round((Number(snapshot.duration) || 5) * 10) / 10} 秒 · {snapshot.ids.length} 张图</div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeShotFromMergedCard(group.uuid, childIndex)}
                                        className="rounded border border-warning/40 bg-y50 px-2.5 py-1.5 text-[11px] font-semibold text-warning hover:border-warning"
                                    >
                                        移出
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex items-center justify-between border-t border-n40 px-5 py-4">
                        <button
                            type="button"
                            onClick={() => splitMergedCard(groupIndex)}
                            className="inline-flex items-center gap-1.5 rounded border border-warning/40 bg-n0 px-3 py-2 text-xs font-semibold text-warning hover:bg-y50"
                        >
                            <Split className="h-3.5 w-3.5" />
                            全部拆分
                        </button>
                        <button type="button" onClick={() => setMergedCardDialogUuid(null)} className="rounded bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover">完成</button>
                    </div>
                </div>
            </div>
        );
    };



    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-n20">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
                    <p className="text-n300">加载工作区...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="layout-safe workflow-stage-layout flex-col text-n800">
            {projectMaterialTarget && (
                <ProjectMaterialPicker
                    {...projectMaterialPicker}
                    references={[]}
                    maxSelected={1}
                    hideShotFilters
                    loading={projectMaterialLoading}
                    busy={projectMaterialBusy}
                    errorMessage={projectMaterialError}
                    description="选择当前项目的人物、场景或道具图片，使用原图填入当前空卡；不会修改来源素材。"
                    footer={projectMaterialBusy ? '正在保存素材到当前卡片...' : '单击一张图片填入当前空卡；不会新增卡片、覆盖提示词或触发生成。'}
                    handleMaterialPickerFilterChange={projectMaterialPicker.setMaterialPickerFilter}
                    handleAddProjectMaterial={item => void selectProjectMaterial(item)}
                    onRefresh={() => void refreshProjectMaterials()}
                    onClose={() => { if (!projectMaterialLock.current) setProjectMaterialTarget(null); }}
                />
            )}
            {videoUploadTarget !== null && (
                <VideoUploadModal
                    initialTarget={videoUploadTarget}
                    targets={taskGroups.map((group, index) => ({
                        uuid: group.uuid, label: getGroupShotRange(group, index).label,
                        hasResult: !!tasksStatus[group.uuid]?.result,
                        busy: ['pending', 'running', 'processing'].includes(tasksStatus[group.uuid]?.state || ''),
                    }))}
                    onClose={() => setVideoUploadTarget(null)}
                    onImport={handleExternalVideoImport}
                />
            )}

            {toast && (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 bg-n0 border border-n40 text-n800 rounded-lg shadow-bottom">
                    {toast}
                </div>
            )}


            <div className="responsive-toolbar workflow-stage-toolbar flex-shrink-0 px-4 flex items-center justify-between">
                <div className="toolbar-group">

                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded text-xs font-bold transition-colors"
                    >
                        <Upload className="w-3.5 h-3.5" />
                        批量上传
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleFileInput}
                        className="hidden"
                    />

                    <button
                        type="button"
                        onClick={() => setVideoUploadTarget('')}
                        disabled={!episodeId}
                        title={episodeId ? '导入完整视频到镜头或新增独立片段' : '请先进入一个分集'}
                        className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:opacity-40"
                    >
                        <Upload className="w-3.5 h-3.5" /> 上传外部视频
                    </button>
                    <button
                        onClick={() => videoInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded text-xs font-bold transition-colors"
                    >
                        <Video className="w-3.5 h-3.5" />
                        视频抽帧
                    </button>
                    <input
                        ref={videoInputRef}
                        type="file"
                        accept="video/*"
                        onChange={handleVideoUpload}
                        className="hidden"
                    />


                    <div className="h-6 w-px bg-n40 mx-1" />

                    <div className="flex items-center bg-n0 rounded-lg p-1">
                        <button
                            onClick={() => setViewMode('card')}
                            className={`p-1.5 rounded ${viewMode === 'card' ? 'bg-primary text-white' : 'text-n300'}`}
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-primary text-white' : 'text-n300'}`}
                        >
                            <List className="w-4 h-4" />
                        </button>
                    </div>

                    <span className="text-xs text-n300">
                        {taskGroups.length} 任务
                    </span>


                    {storyboardItems.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setSyncModalOpen(true)}
                            title="比对当前 storyboard 与工作区，按需同步"
                            className="ml-2 p-1 text-n700 hover:text-n800"
                        >
                            <RotateCw size={14} />
                        </button>
                    )}
                </div>

                <div className="toolbar-actions">

                    <button
                        onClick={selectAll}
                        className="flex items-center gap-1 text-xs text-n300 hover:text-n800"
                    >
                        {taskGroups.every(g => tasksStatus[g.uuid]?.selected) ? (
                            <CheckSquare className="w-3.5 h-3.5" />
                        ) : (
                            <Square className="w-3.5 h-3.5" />
                        )}
                        全选
                    </button>

                    <div className="h-5 w-px bg-n40 mx-1"></div>

                    <button
                        onClick={batchUpscale}
                        className="flex items-center gap-1 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white text-xs font-bold rounded transition-colors"
                    >
                        <Maximize className="w-3.5 h-3.5" />
                        批量放大
                    </button>

                    <button
                        onClick={runAllSelected}
                        disabled={isBatchRunning || !taskGroups.some(g => tasksStatus[g.uuid]?.selected)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-n0 hover:bg-n20 text-n700 text-xs font-bold rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Play className="w-3.5 h-3.5" />
                        {isBatchRunning ? '批量执行中' : '执行选中'}
                    </button>

                    <button
                        onClick={runAllPending}
                        disabled={isBatchRunning}
                        className="flex items-center gap-1 px-3 py-1.5 bg-success hover:bg-success text-white text-xs font-bold rounded shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        {isBatchRunning ? '批量执行中' : '批量执行'}
                    </button>

                    <button
                        onClick={clearAll}
                        className="flex items-center gap-1 px-3 py-1.5 text-danger hover:text-danger hover:bg-r50 rounded text-xs transition-colors"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        清空
                    </button>
                </div>
            </div>


            {viewMode === 'list' ? (

                <div
                    className="responsive-split workflow-stage-layout"
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                >

                    <div
                        ref={leftPanelRef}
                        className="responsive-pane workflow-stage-sidebar workflow-stage-scroll w-1/2 p-4 scrollbar-hide"
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                        {sortedTaskGroups.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-n100">
                                <ImageIcon className="w-16 h-16 mb-4 opacity-20" />
                                <p className="text-sm">拖拽图片或 Ctrl+V 粘贴</p>
                            </div>
                        ) : (
                            <>
                                {visibleTaskGroups.map(({ group, originalIndex }) => renderListViewCard(group, originalIndex))}
                                {renderMoreGroupsControls()}
                            </>
                        )}
                    </div>

                    <div
                        ref={rightPanelRef}
                        className="responsive-pane workflow-stage-canvas workflow-stage-scroll w-1/2 p-4 scrollbar-thin"
                    >
                        {sortedTaskGroups.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-n100">
                                <Film className="w-12 h-12 mb-4 opacity-20" />
                                <p className="text-sm">等待任务配置...</p>
                            </div>
                        ) : (
                            <>
                                {visibleTaskGroups.map(({ group, originalIndex }) => renderListResultCard(group, originalIndex))}
                                {renderMoreGroupsControls()}
                            </>
                        )}
                    </div>
                </div>
            ) : (

                <div
                    className="responsive-split workflow-stage-layout"
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                >

                    <div
                        ref={leftPanelRef}
                        className="responsive-pane workflow-stage-sidebar workflow-stage-scroll w-1/2 p-4 scrollbar-hide"
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                        {sortedTaskGroups.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-n100">
                                <ImageIcon className="w-16 h-16 mb-4 opacity-20" />
                                <p className="text-sm">拖拽图片或 Ctrl+V 粘贴</p>
                            </div>
                        ) : (
                            <>

                                <InsertEmptyCardButton onClick={() => insertEmptyTaskGroup(-1)} />

                                {visibleTaskGroups.map(({ group, originalIndex }, displayIndex) => (
                                    <React.Fragment key={group.uuid}>
                                        {renderStoryboardCard(group, originalIndex)}


                                        <InsertEmptyCardButton onClick={() => insertEmptyTaskGroup(originalIndex)} />
                                    </React.Fragment>
                                ))}
                                {renderMoreGroupsControls()}
                            </>
                        )}
                    </div>


                    <div
                        ref={rightPanelRef}
                        className="responsive-pane workflow-stage-canvas workflow-stage-scroll w-1/2 p-4 scrollbar-thin"
                    >
                        {sortedTaskGroups.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-n100">
                                <Film className="w-12 h-12 mb-4 opacity-20" />
                                <p className="text-sm">等待任务配置...</p>
                            </div>
                        ) : (
                            <>

                                <InsertEmptyCardSpacer />

                                {visibleTaskGroups.map(({ group, originalIndex }, displayIndex) => (
                                    <React.Fragment key={group.uuid}>
                                        {renderResultCard(group, originalIndex)}


                                        {originalIndex < taskGroups.length - 1 &&
                                         group.ids?.length === 1 &&
                                         taskGroups[originalIndex + 1]?.ids?.length === 1 && (
                                            <div className="h-[18px] -mt-3 mb-2" />
                                        )}


                                        <InsertEmptyCardSpacer />
                                    </React.Fragment>
                                ))}
                                {renderMoreGroupsControls()}
                            </>
                        )}
                    </div>
                </div>
            )}


            {dashScopePicker && (
                <div
                    className="fixed inset-0 z-50 bg-n900/85 flex items-center justify-center p-4"
                    onClick={() => setDashScopePicker(null)}
                >
                    <div
                        className="bg-n20 border border-n40 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-y-auto p-4 shadow-bottom"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-n700">从库里添加图片</h3>
                            <div className="flex items-center gap-2">
                                <label className="px-2 py-1 bg-primary hover:bg-primary-hover text-white text-[11px] rounded cursor-pointer inline-flex items-center gap-1">
                                    <Upload className="w-3 h-3" /> 从外部添加
                                    <input
                                        type="file"
                                        accept="image/*"
                                        hidden
                                        onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            e.target.value = '';
                                            if (!file) return;
                                            try {
                                                const r = await uploadImage(file);
                                                const url = r.url || (r as any).storage_url || '';

                                                dashScopePicker.callback({
                                                    kind: 'image',
                                                    url,
                                                    file_id: (r as any).file_id || r.filename || file.name,
                                                });
                                                setDashScopePicker(null);
                                            } catch (err: any) {
                                                showToast(`上传失败: ${err instanceof Error ? err.message : String(err)}`);
                                            }
                                        }}
                                    />
                                </label>
                                <button
                                    className="text-n300 hover:text-n800"
                                    onClick={() => setDashScopePicker(null)}
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <p className="text-[11px] text-n100 mb-3">
                            可从设计、素材、分镜生成结果及通用素材库中选择，或从外部上传本地图片。
                        </p>
                        {(() => {
                            const seen = new Set<string>();
                            const libraryImages = videoLibraryCandidates
                                .filter(candidate => candidate.kind === 'image' && candidate.url)
                                .map(candidate => ({
                                    id: candidate.id,
                                    url: candidate.url as string,
                                    filename: candidate.label,
                                }));
                            const candidates = [
                                ...uploadedImages
                                    .filter(img => img.url && !img.isPlaceholder)
                                    .map(img => ({ id: img.id, url: img.url, filename: img.filename || img.id })),
                                ...libraryImages,
                            ].filter(candidate => {
                                if (seen.has(candidate.url)) return false;
                                seen.add(candidate.url);
                                return true;
                            });
                            if (candidates.length === 0) {
                                return (
                                    <div className="text-center text-n100 py-12 text-sm">
                                        {videoLibraryLoading
                                            ? '正在加载项目素材库...'
                                            : '项目里还没有可选图片，请从外部添加。'}
                                    </div>
                                );
                            }
                            return (
                                <div className="grid grid-cols-4 gap-2">
                                    {candidates.map((img) => (
                                        <button
                                            key={img.id}
                                            type="button"
                                            onClick={() => {
                                                dashScopePicker.callback({
                                                    kind: 'image',
                                                    url: img.url,
                                                    file_id: img.id,
                                                });
                                                setDashScopePicker(null);
                                            }}
                                            className="relative aspect-video rounded border border-n40 hover:border-primary overflow-hidden bg-n800"
                                        >
                                            <img src={img.url} loading="lazy" decoding="async" alt="" className="w-full h-full object-cover" />
                                            <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-n900/60 text-[9px] text-n700 truncate">
                                                {img.filename || img.id}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* Lightbox */}
            {lightboxUrl && (
                <div
                    className="fixed inset-0 z-50 bg-n900/90 flex items-center justify-center"
                    onClick={() => setLightboxUrl(null)}
                >
                    <button
                        className="absolute top-4 right-4 text-white hover:text-n300"
                        onClick={() => setLightboxUrl(null)}
                    >
                        <X className="w-8 h-8" />
                    </button>
                    <a
                        href={lightboxUrl}
                        download
                        className="absolute top-4 right-16 text-white hover:text-n300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Download className="w-8 h-8" />
                    </a>
                    {lightboxType === 'video' ? (
                        <video
                            src={lightboxUrl}
                            preload="metadata"
                            className="max-w-[90vw] max-h-[90vh]"
                            controls
                            autoPlay
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <img
                            src={lightboxUrl}
                            decoding="async"
                            alt=""
                            className="max-w-[90vw] max-h-[90vh] object-contain"
                            onClick={(e) => e.stopPropagation()}
                        />
                    )}
                </div>
            )}


            {renderUpscaleModal()}
            {renderVoiceModal()}
            {renderEditModal()}
            {renderVideoVoiceReferenceModal()}
            {renderMergeDialog()}
            {renderMergedCardDialog()}


            {syncModalOpen && (
                <React.Suspense fallback={<VideoModalFallback label="加载同步面板..." />}>
                    <StoryboardSyncModal
                        open={syncModalOpen}
                        onClose={() => setSyncModalOpen(false)}
                        storyboardItems={storyboardItems}
                        session={{
                            uploaded_images: uploadedImages,
                            task_groups: taskGroups,
                            image_prompts: imagePrompts,
                            tasks_status: tasksStatus,
                            seedance_params: seedanceParamsByUuid,
                            storyboard_meta: storyboardMetaByItemId,
                        }}
                        onApply={async (mode: SyncMode) => {
                            try {
                                const r = await applySyncStrategy(
                                    mode,
                                    storyboardItems,
                                    {
                                        uploaded_images: uploadedImages,
                                        task_groups: taskGroups,
                                        image_prompts: imagePrompts,
                                        tasks_status: tasksStatus,
                                        seedance_params: seedanceParamsByUuid,
                                        storyboard_meta: storyboardMetaByItemId,
                                    },
                                    sessionScope,
                                );
                                if (r.shouldReimport && onRequestReimport) {
                                    await onRequestReimport();
                                } else {

                                    await loadSession();
                                }
                            } catch (e) {
                                console.error('[VideoPage] applySyncStrategy 失败:', e);
                            } finally {
                                setSyncModalOpen(false);
                            }
                        }}
                    />
                </React.Suspense>
            )}

            {/* Issue 7: list-view ⚙ Seedance detail modal */}
            {seedanceDetailUuid && (() => {
                const g = taskGroups.find(x => x.uuid === seedanceDetailUuid);
                if (!g || !isSeedanceModel(g.model)) return null;
                const params = getSeedanceParams(g.uuid, g.model);
                return (
                    <SeedanceDetailModalWithCandidates
                        groupUuid={g.uuid}
                        title={`#${(taskGroups.findIndex(x => x.uuid === g.uuid) + 1)}`}
                        value={params}
                        storyboardItemId={getStoryboardItemId(g.uuid)}
                        onChange={(next) => setSeedanceParams(g.uuid, next)}
                        onClose={() => setSeedanceDetailUuid(null)}
                    />
                );
            })()}
        </div>
    );
};

export default VideoPage;
