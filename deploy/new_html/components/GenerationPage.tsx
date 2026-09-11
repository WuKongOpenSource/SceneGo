

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ProjectMaterialPicker, useProjectMaterialPicker } from './ProjectMaterialPicker';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ProjectFile, StoryboardItem, MaterialLibrary, GenerationReference, ReferenceType, GeneratedImage, FileVersion } from '../types';
import { LayoutDashboard, Image as ImageIcon, Sparkles, Upload, X, ChevronLeft, ChevronRight, Wand2, Users, MapPin, Box, Zap, User, Play, CheckCircle2, CircleDashed, CheckSquare, Square, Trash2, ArrowRight, Save, History, Clock, RefreshCw, ZoomIn, Eye, FolderInput, GripVertical, Camera, Pencil, Type, MoveRight, Eraser, RotateCcw, Download, Layers, Scissors, Grid3X3, Clapperboard, AlertTriangle, Library, Search, Check, FlipHorizontal2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { generateFinalIllustrationResult } from '../services/geminiImageGenerationService';
import {
  generateImageWithPreferredFallback,
  IMAGE_FALLBACK_REASON,
} from '../services/preferredImageGenerationService';
import { isSeedreamStoryboardModel, SEEDREAM_PRO_MODEL, SEEDREAM_LITE_MODEL, storyboardSubmissionReferences, seedreamTextOnlyPrompt } from '../utils/seedreamStoryboard';
import { generateWithComfyUIWorkflowQueued, generateHumanMultiAngleQueued, generateAroundAngleQueued, adjustImageAngleQueued, generateMattingQueued, generateImageFusionQueued, generatePanorama360Queued, generatePanoramaFusionQueued, generateAutoStoryboardQueued, generateMultiGridStoryboard } from '@runtime/comfyuiGenerationService';
import { getComfyUIQueueStatus, normalizeComfyUITaskError, waitForComfyUITaskAllImages } from '@runtime/comfyuiTaskWaitService';

import { generateGptImage, type GptImageQuality } from '../services/gptImageService';
import {
  fetchImageGenerationCapabilities,
  type ImageGenerationCapabilities,
} from '../services/doubaoService';
import {
  GPT_IMAGE_RATIO_OPTIONS,
  GPT_IMAGE_K_OPTIONS,
  GPT_IMAGE_QUALITY_OPTIONS,
  recommendGptImageSize,
  resolveGptImageSettings,
  type GptImageRatio,
  type GptImageK,
  type SourceImageDimensions,
} from '../utils/gptImageSizeMap';
import type { GeneratedImageResult, ComfyUITaskRegistryMeta } from '@runtime/comfyuiTaskWaitService';
import type { TaskKind } from '../types';
import { generateThumbnail } from '../utils/imageOptimization';
import { recommendDoubaoImageSize } from '../utils/doubaoImageSize';
import { buildStoryboardSegmentLookup } from '../utils/storyboardSegments';
import { loadShotImages, clearImageCache, getCachedBlobUrl, setCachedBlobUrl, removeImageFromCache, getImageThumbnailUrl } from '../services/imageLoaderService';
import { saveRunningTask, removeRunningTask, getRecoverableTasks } from '../services/taskRecovery';
import { usePersistedPageState } from '../hooks/usePersistedPageState';
import { apiBlob, secureApiUrl } from '../services/httpClient';
import {
  clusterNodePreferenceId,
  DEFAULT_GPU_NODE_NAME,
  fetchClusterNodes,
  formatClusterNodeQueue,
  isClusterNodeUsable,
  resolveGpuTaskRouting,
  setPreferredGpuNodeId,
  type ClusterNodeOption,
} from '@runtime/clusterNodeService';
import { formatProcessingNodeName } from '../utils/processingTerminology';
import { fitAngleOutputDimensions } from '../utils/angleOutputSize';
import { StoryboardResultImage } from './StoryboardResultImage';
import {
  applyComputerOperationOrientationConstraint,
  buildIdentityAnchoredPrompt,
  mergeDefaultShotReferences,
  resolveSelectedShotReferences,
  resolveShotReferencePlan,
  resolveShotReferences,
  type StoryboardGenerationModel,
} from '../utils/storyboardConsistency';
import {
  applyStoryboardProviderProgress,
  createStoryboardGenerationProgress,
  dedupeGeneratedImages,
  estimateStoryboardGenerationProgress,
  formatStoryboardGenerationEta,
  runSingleFlight,
  type StoryboardGenerationProgressState,
} from '../utils/storyboardGeneration';
import {
  resolveStoryboardImageDrag,
  serializeStoryboardImageDrag,
  STORYBOARD_IMAGE_DRAG_MIME,
} from '../utils/storyboardImageDrag';
import { GpuNodeSelector, type GpuNodeSelection } from '@runtime/GpuNodeSelector';
import { InlineCreditEstimate } from './InlineCreditEstimate';
import { ModelPicker, type ModelPickerOption } from './ModelPicker';
import { StoryboardImageSourceBadge } from './StoryboardImageSourceBadge';
import { buildStoryboardModelPickerOptions } from './modelPickerCatalogs';
import { crmMessage } from '../admin/crmUI';
import { assertEnoughCredits, consumeCredits } from '../services/creditService';
import {
  DESIGN_CREDIT_DEFAULTS,
  DESIGN_CREDIT_FEATURES,
  designOperationCreditParams,
  newDesignCreditUsageId,
} from '../utils/designCredits';
import {
  getStoryboardGenerationModelOption,
  STORYBOARD_GENERATION_MODEL_OPTIONS,
} from '../utils/storyboardGenerationModels';

const STORYBOARD_IMAGE_CREDIT_FEATURE = 'image_generation';
const STORYBOARD_IMAGE_CREDIT_FALLBACK = 10;

const MattingModal = React.lazy(() => import('./MattingModal'));
const ImageFusionModal = React.lazy(() => import('./ImageFusionModal'));
const StoryboardToolModal = React.lazy(() => import('./StoryboardToolModal'));
const MultiAngle3DController = React.lazy(() => import('./MultiAngle3DController'));

function normalizeImageDownloadUrl(url: string): string {
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  const normalized = url.startsWith('http') ? url : (url.startsWith('/') ? url : `/${url}`);
  return secureApiUrl(normalized, { absolute: true });
}

const imageDimensionRequestCache = new Map<string, Promise<SourceImageDimensions | null>>();

function probeImageDimensions(url: string): Promise<SourceImageDimensions | null> {
  if (!url || typeof Image === 'undefined') return Promise.resolve(null);
  const normalizedUrl = normalizeImageDownloadUrl(url);
  const cached = imageDimensionRequestCache.get(normalizedUrl);
  if (cached) return cached;

  const request = new Promise<SourceImageDimensions | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      resolve(width > 0 && height > 0 ? { width, height } : null);
    };
    image.onerror = () => resolve(null);
    image.src = normalizedUrl;
  });
  imageDimensionRequestCache.set(normalizedUrl, request);
  return request;
}

async function loadImageDimensions(urls: string[]): Promise<SourceImageDimensions[]> {
  const dimensions = await Promise.all(
    Array.from(new Set(urls.filter(Boolean))).map(probeImageDimensions),
  );
  return dimensions.filter((item): item is SourceImageDimensions => item !== null);
}

async function downloadImageBlob(url: string, apiName = '下载图片'): Promise<Blob> {
  return apiBlob(normalizeImageDownloadUrl(url), { method: 'GET' }, apiName, {
    requireAuth: false,
    includeContentType: false,
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function horizontallyMirrorImage(blob: Blob): Promise<Blob> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('图片加载失败'));
      element.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) throw new Error('图片处理失败');
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片处理失败')), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function notifyStoryboardImageChanged(episodeId: string | undefined, shotId: string | undefined) {
  if (typeof window === 'undefined' || !shotId) return;
  window.dispatchEvent(new CustomEvent('ostory:episode-data-changed', {
    detail: {
      episodeId,
      entityType: 'storyboard_item',
      entityId: shotId,
      fileRole: 'generated_image',
      type: 'image',
      targetPage: 'generation',
      targetItemId: shotId,
      status: 'completed',
    },
  }));
}

const ModalChunkFallback: React.FC = () => (
  <div className="fixed inset-0 z-50 bg-n900/80 flex items-center justify-center">
    <div className="rounded-md border border-n40 bg-n0 px-4 py-3 text-sm text-n300 shadow-bottom">
      加载工具...
    </div>
  </div>
);

interface GenerationPageProps {
  files: ProjectFile[];
  selectedFileId: string | null;
  episodeId?: string;
  projectId?: string;
  focusShotId?: string | null;
  materialLibrary: MaterialLibrary;
  onUpdateStoryboardItem: (shotId: string, updates: Partial<StoryboardItem> | ((item: StoryboardItem) => Partial<StoryboardItem>)) => void;
  onSaveVersion: (name: string) => Promise<void> | void;
  onRestoreVersion: (version: FileVersion) => void;
  onDeleteVersion: (versionId: string) => void;
  onForceSave: () => void;
  onExportNext: (data: any) => void;
  onImportProject?: () => void;
  shotPageSize?: number;
  totalShotCount?: number;
  onVisibleShotCountChange?: (count: number) => void;
  onLoadAllStoryboardItems?: () => Promise<void> | void;
  onDeleteStoryboardItem?: (itemId: string) => void;
  onBatchDeleteStoryboardItems?: (itemIds: string[]) => Promise<void> | void;
  assetScopeMode?: 'episode' | 'project';
  onAssetScopeModeChange?: (mode: 'episode' | 'project') => void;
  defaultImageRatio?: GptImageRatio;
}

export const GenerationPage: React.FC<GenerationPageProps> = ({
  files,
  selectedFileId,
  episodeId,
  projectId,
  focusShotId,
  materialLibrary,
  onUpdateStoryboardItem,
  onSaveVersion,
  onRestoreVersion,
  onDeleteVersion,
  onForceSave,
  onExportNext,
  shotPageSize,
  totalShotCount,
  onVisibleShotCountChange,
  onLoadAllStoryboardItems,
  onDeleteStoryboardItem,
  onBatchDeleteStoryboardItems,
  assetScopeMode = 'episode',
  onAssetScopeModeChange,
  defaultImageRatio = '16:9',
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const selectedFile = files.find(f => f.id === selectedFileId);

  const [selectedShotId, setSelectedShotId] = usePersistedPageState<string | null>({
    page: 'GenerationPage:selectedShotId',
    episodeId,
    version: 1,
    defaultValue: null,
  });
  const shotCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingNotificationFocusRef = useRef<string | null>(null);
  const handledNotificationFocusRef = useRef<string | null>(null);


  const [selectedShotIds, setSelectedShotIds] = useState<Set<string>>(new Set());
  const [isLoadingAllShotsForSelection, setIsLoadingAllShotsForSelection] = useState(false);
  const [selectAllAfterLoad, setSelectAllAfterLoad] = useState(false);

  const SHOT_PAGE_SIZE = Math.max(1, shotPageSize || 10);
  const [visibleShotCount, setVisibleShotCount] = useState<number>(SHOT_PAGE_SIZE);

  const [prompt, setPrompt] = useState<string>('');
  const [references, setReferences] = useState<GenerationReference[]>([]);
  const referencesRef = useRef<GenerationReference[]>([]);
  const activeReferenceShotIdRef = useRef<string | null>(null);
  const visibleStoryboardItems = useMemo(
    () => selectedFile?.storyboard?.items.slice(0, visibleShotCount) || [],
    [selectedFile?.storyboard?.items, visibleShotCount],
  );
  const storyboardSegmentLookup = useMemo(
    () => buildStoryboardSegmentLookup(
      selectedFile?.storyboard?.items || [],
      selectedFile?.scriptSegments || [],
    ),
    [selectedFile?.scriptSegments, selectedFile?.storyboard?.items],
  );

  useEffect(() => {
    onVisibleShotCountChange?.(visibleShotCount);
  }, [visibleShotCount, onVisibleShotCountChange]);

  useEffect(() => {
    setVisibleShotCount(SHOT_PAGE_SIZE);
  }, [selectedFileId, SHOT_PAGE_SIZE]);



  const buildRegistryMeta = useCallback((
    shot: StoryboardItem | null | undefined,
    kind: TaskKind,
    titlePrefix: string,
  ): ComfyUITaskRegistryMeta => {
    const resolvedProjectId = projectId || (() => {
      try { return localStorage.getItem('current_project_id') || undefined; } catch { return undefined; }
    })();
    const shotLabel = shot?.shotNumber || (shot?.id ? `#${String(shot.id).slice(0, 6)}` : '?');
    return {
      title: `${titlePrefix} · 镜头 ${shotLabel}`,
      kind,
      targetPage: 'generation',
      targetEntityType: 'storyboard_item',
      targetEntityId: shot?.id,
      targetItemId: shot?.id,
      targetProjectId: resolvedProjectId,
      episodeId,
      fileRole: 'generated_image',
    };
  }, [episodeId, projectId]);


  const userEditedPromptRef = useRef<boolean>(false);
  const generationRequestsRef = useRef<Map<string, Promise<void>>>(new Map());
  const recoveryStartedRef = useRef(false);
  const updateCurrentShotReferences = useCallback((
    nextValue: GenerationReference[] | ((current: GenerationReference[]) => GenerationReference[]),
    extraUpdates: Partial<StoryboardItem> = {},
  ) => {
    const nextReferences = typeof nextValue === 'function'
      ? nextValue(referencesRef.current)
      : nextValue;
    referencesRef.current = nextReferences;
    setReferences(nextReferences);
    if (selectedShotId) {
      onUpdateStoryboardItem(selectedShotId, {
        ...extraUpdates,
        configuredReferences: nextReferences,
        referenceConfigInitialized: true,
      });
    }
    return nextReferences;
  }, [onUpdateStoryboardItem, selectedShotId]);






  useEffect(() => {
    if (!selectedShotId || !selectedFile?.storyboard) return;

    const shot = selectedFile.storyboard.items.find(s => s.id === selectedShotId);
    if (!shot) return;

    console.log('🔄 切换到镜头，重新加载数据:', selectedShotId);


    setPrompt(shot.imagePrompt || '');
    userEditedPromptRef.current = false;



    const nextReferences = resolveSelectedShotReferences(
      shot,
      materialLibrary,
      activeReferenceShotIdRef.current,
      referencesRef.current,
    );
    activeReferenceShotIdRef.current = shot.id;
    referencesRef.current = nextReferences;
    setReferences(nextReferences);
    if (!shot.referenceConfigInitialized) {
      onUpdateStoryboardItem(shot.id, {
        configuredReferences: nextReferences,
        referenceConfigInitialized: true,
      });
    }
  }, [selectedShotId, selectedFile?.storyboard?.items, materialLibrary, onUpdateStoryboardItem]);


  const [thumbnailProcessed, setThumbnailProcessed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visibleStoryboardItems.length) return;


    visibleStoryboardItems.forEach(shot => {
      if (!shot.generatedImages) return;


      if (thumbnailProcessed.has(shot.id)) return;

      const imagesToProcess = shot.generatedImages.filter(img => !img.thumbnail);

      if (imagesToProcess.length > 0) {
        console.log(`🔄 镜头 ${shot.id}: 为 ${imagesToProcess.length} 张图片生成缩略图...`);


        setThumbnailProcessed(prev => new Set(prev).add(shot.id));

        Promise.all(
          imagesToProcess.map(async (img) => {
            try {
              const thumbnail = await generateThumbnail(img.url, 1024, 0.8);
              return { id: img.id, thumbnail };
            } catch (error) {
              console.error('生成缩略图失败:', error);
              return null;
            }
          })
        ).then(results => {
          const updates = results.filter(r => r !== null) as { id: string; thumbnail: string }[];

          if (updates.length > 0) {
            const updatedImages = shot.generatedImages!.map(img => {
              const update = updates.find(u => u.id === img.id);
              return update ? { ...img, thumbnail: update.thumbnail } : img;
            });

            onUpdateStoryboardItem(shot.id, {
              generatedImages: updatedImages
            });

            console.log(`✅ 镜头 ${shot.id}: 已为 ${updates.length} 张图片生成缩略图并保存`);
          }
        });
      } else {

        setThumbnailProcessed(prev => new Set(prev).add(shot.id));
      }
    });
  }, [selectedFile?.id, visibleStoryboardItems]);

  const [generatingShotIds, setGeneratingShotIds] = useState<Set<string>>(new Set());
  const [generationProgressByShot, setGenerationProgressByShot] = useState<Record<string, StoryboardGenerationProgressState>>({});
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number, activeShotId?: string} | null>(null);
  const isGenerating = generatingShotIds.size > 0;
  const isCurrentShotGenerating = selectedShotId ? generatingShotIds.has(selectedShotId) : false;
  const currentGenerationProgress = selectedShotId ? generationProgressByShot[selectedShotId] : undefined;

  const beginShotProgress = useCallback((
    shotId: string,
    model: string,
    startedAt = Date.now(),
    stage = '准备生成',
  ) => {
    setGenerationProgressByShot(prev => ({
      ...prev,
      [shotId]: createStoryboardGenerationProgress(model, startedAt, stage),
    }));
  }, []);

  const updateShotProgressStage = useCallback((
    shotId: string,
    stage: string,
    percent?: number,
  ) => {
    setGenerationProgressByShot(prev => {
      const current = prev[shotId];
      if (!current) return prev;
      return {
        ...prev,
        [shotId]: {
          ...current,
          stage,
          percent: percent == null ? current.percent : Math.max(current.percent, percent),
        },
      };
    });
  }, []);

  const updateShotProviderProgress = useCallback((shotId: string, progress: number) => {
    setGenerationProgressByShot(prev => {
      const current = prev[shotId];
      if (!current) return prev;
      return {
        ...prev,
        [shotId]: applyStoryboardProviderProgress(current, progress),
      };
    });
  }, []);

  const clearShotProgress = useCallback((shotId: string) => {
    setGenerationProgressByShot(prev => {
      if (!prev[shotId]) return prev;
      const next = { ...prev };
      delete next[shotId];
      return next;
    });
  }, []);

  useEffect(() => {
    if (generatingShotIds.size === 0) return;
    const timer = window.setInterval(() => {
      setGenerationProgressByShot(prev => {
        let changed = false;
        const next = { ...prev };
        generatingShotIds.forEach(shotId => {
          const current = prev[shotId];
          if (!current) return;
          const updated = estimateStoryboardGenerationProgress(current);
          if (updated.percent !== current.percent || updated.etaSeconds !== current.etaSeconds) {
            next[shotId] = updated;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generatingShotIds]);

  const batchProgressDisplay = useMemo(() => {
    if (!batchProgress || batchProgress.total <= 0) return null;
    const active = batchProgress.activeShotId
      ? generationProgressByShot[batchProgress.activeShotId]
      : undefined;
    const aggregatePercent = Math.min(100, Math.round(
      ((batchProgress.current + ((active?.percent || 0) / 100)) / batchProgress.total) * 100,
    ));
    const remainingQueued = Math.max(
      0,
      batchProgress.total - batchProgress.current - (batchProgress.activeShotId ? 1 : 0),
    );
    const expectedPerQueuedShot = active?.expectedSeconds || 120;
    const activeEta = active?.etaSeconds ?? expectedPerQueuedShot;
    const etaSeconds = activeEta === null
      ? null
      : activeEta + (remainingQueued * expectedPerQueuedShot);
    return { aggregatePercent, etaSeconds, active };
  }, [batchProgress, generationProgressByShot]);

  const [showHistory, setShowHistory] = useState(false);
  const [isNamingVersion, setIsNamingVersion] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [isSavingVersion, setIsSavingVersion] = useState(false);
  const [versionSaveError, setVersionSaveError] = useState<string | null>(null);

  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isLoadingFullImage, setIsLoadingFullImage] = useState(false);

  const [previewShotId, setPreviewShotId] = useState<string | null>(null);
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);


  const [cameraModalImage, setCameraModalImage] = useState<string | null>(null);
  const [isAngleAdjusting, setIsAngleAdjusting] = useState(false);
  const [isHorizontalMirroring, setIsHorizontalMirroring] = useState(false);

  const [humanMultiAngleModalImage, setHumanMultiAngleModalImage] = useState<string | null>(null);
  const [isHumanMultiAngleGenerating, setIsHumanMultiAngleGenerating] = useState(false);


  const [aroundAngleModalImage, setAroundAngleModalImage] = useState<string | null>(null);
  const [isAroundAngleGenerating, setIsAroundAngleGenerating] = useState(false);

  const closeCameraAngleModal = useCallback(() => {
    setCameraModalImage(null);
    if (isAngleAdjusting) {
      crmMessage.info('新角度正在后台生成，完成后会自动保存到当前镜头');
    }
  }, [isAngleAdjusting]);

  const closeHumanMultiAngleModal = useCallback(() => {
    setHumanMultiAngleModalImage(null);
    if (isHumanMultiAngleGenerating) {
      crmMessage.info('多角度人物正在后台生成，完成后会自动保存到当前镜头');
    }
  }, [isHumanMultiAngleGenerating]);

  const closeAroundAngleModal = useCallback(() => {
    setAroundAngleModalImage(null);
    if (isAroundAngleGenerating) {
      crmMessage.info('全景角度正在后台生成，完成后会自动保存到当前镜头');
    }
  }, [isAroundAngleGenerating]);


  const [mattingModalImage, setMattingModalImage] = useState<string | null>(null);
  const [isMattingProcessing, setIsMattingProcessing] = useState(false);


  const [showFusionModal, setShowFusionModal] = useState(false);
  const [isFusionProcessing, setIsFusionProcessing] = useState(false);


  const [showStoryboardToolModal, setShowStoryboardToolModal] = useState(false);
  const [isStoryboardToolProcessing, setIsStoryboardToolProcessing] = useState(false);

  const [imageEditorData, setImageEditorData] = useState<{
    imageUrl: string;
    referenceId: string;
  } | null>(null);

  const [showMaterialPicker, setShowMaterialPicker] = useState(false);
  const [isLoadingOtherShotImages, setIsLoadingOtherShotImages] = useState(false);

  type GenerationModel = StoryboardGenerationModel;

  const [globalModel, setGlobalModel] = usePersistedPageState<GenerationModel>({
    page: 'GenerationPage:globalModel',
    episodeId,


    version: 3,
    defaultValue: 'doubao',
  });

  const COMFYUI_MODELS = React.useMemo(() => new Set<string>(
    STORYBOARD_GENERATION_MODEL_OPTIONS
      .filter(option => option.requiresCluster)
      .map(option => option.value),
  ), []);
  const [seedancePortrait, setSeedancePortrait] = usePersistedPageState<boolean>({
    page: 'GenerationPage:seedancePortrait', episodeId, version: 1, defaultValue: false,
  });
  const [imageGenerationCapabilities, setImageGenerationCapabilities] = useState<ImageGenerationCapabilities | null>(null);
  const [clusterNodes, setClusterNodes] = useState<ClusterNodeOption[]>([]);
  const [clusterNodesLoading, setClusterNodesLoading] = useState(false);
  const [clusterNodeMessage, setClusterNodeMessage] = useState('');
  const [selectedClusterNodeId, setSelectedClusterNodeId] = usePersistedPageState<string>({
    page: 'GenerationPage:selectedClusterNodeId',
    episodeId,
    version: 2,
    defaultValue: DEFAULT_GPU_NODE_NAME,
  });
  const usableClusterNodes = useMemo(
    () => clusterNodes.filter(isClusterNodeUsable),
    [clusterNodes],
  );
  const storyboardModelPickerOptions = useMemo(
    () => buildStoryboardModelPickerOptions(
      STORYBOARD_GENERATION_MODEL_OPTIONS,
      usableClusterNodes.length > 0,
      imageGenerationCapabilities?.models,
    ),
    [imageGenerationCapabilities, usableClusterNodes.length],
  );
  const selectedClusterNode = useMemo(
    () => clusterNodes.find((node) => (
      node.id === selectedClusterNodeId
      || node.nodeId === selectedClusterNodeId
      || node.agentId === selectedClusterNodeId
      || node.name === selectedClusterNodeId
      || node.routingName === selectedClusterNodeId
    )),
    [clusterNodes, selectedClusterNodeId],
  );
  const loadClusterNodeOptions = useCallback(async () => {
    setClusterNodesLoading(true);
    try {
      const result = await fetchClusterNodes();
      setClusterNodes(result.nodes);
      setClusterNodeMessage(result.message);
    } catch (error) {
      console.warn('[GenerationPage] cluster nodes unavailable:', error);
      setClusterNodes([]);
      setClusterNodeMessage('处理集群节点状态暂时不可用，请刷新后重试。');
    } finally {
      setClusterNodesLoading(false);
    }
  }, []);
  useEffect(() => {
    loadClusterNodeOptions();
  }, [loadClusterNodeOptions]);
  useEffect(() => {
    let active = true;
    void fetchImageGenerationCapabilities()
      .then(result => {
        if (active) setImageGenerationCapabilities(result);
      })
      .catch(error => console.warn('[GenerationPage] image model capabilities unavailable:', error));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (imageGenerationCapabilities?.seedance_portrait.available === false && seedancePortrait) {
      setSeedancePortrait(false);
    }
  }, [imageGenerationCapabilities, seedancePortrait, setSeedancePortrait]);
  useEffect(() => {
    if (!selectedClusterNode) return;
    const stableId = clusterNodePreferenceId(selectedClusterNode);
    if (stableId !== selectedClusterNodeId) {
      setSelectedClusterNodeId(stableId);
    }
    setPreferredGpuNodeId(stableId);
  }, [selectedClusterNode, selectedClusterNodeId, setSelectedClusterNodeId]);
  const [shotModels, setShotModels] = usePersistedPageState<Record<string, GenerationModel>>({
    page: 'GenerationPage:shotModels',
    episodeId,
    version: 1,
    defaultValue: {},
  });
  const shotModelPickerOptions = useMemo<readonly ModelPickerOption<GenerationModel | ''>[]>(() => ([
    {
      value: '',
      label: `跟随默认 · ${getStoryboardGenerationModelOption(globalModel).shortLabel}`,
      description: '自动使用顶部配置的默认模型',
      group: '项目设置',
    },
    ...storyboardModelPickerOptions,
  ]), [globalModel, storyboardModelPickerOptions]);
  const [configLockDrafts, setConfigLockDrafts] = useState<Record<string, boolean>>({});
  const isStoryboardConfigLocked = useCallback((item: StoryboardItem) => (
    configLockDrafts[item.id] ?? Boolean(item.isConfigConfirmed)
  ), [configLockDrafts]);



  const [imageRatio, setImageRatio] = usePersistedPageState<GptImageRatio>({
    page: 'GenerationPage:imageRatio',
    episodeId,
    version: 3,
    defaultValue: defaultImageRatio,
  });
  const [imageK, setImageK] = usePersistedPageState<GptImageK>({
    page: 'GenerationPage:imageK',
    episodeId,
    version: 2,
    defaultValue: '1K',
  });
  const [imageQuality, setImageQuality] = usePersistedPageState<GptImageQuality>({
    page: 'GenerationPage:imageQuality',
    episodeId,
    version: 1,
    defaultValue: 'auto',
  });




  const [sidebarWidth, setSidebarWidth] = usePersistedPageState<number>({
    page: 'GenerationPage:sidebarWidth',
    episodeId: 'global',
    version: 2,
    defaultValue: 340,
  });
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback(() => {
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const resize = useCallback((mouseMoveEvent: MouseEvent) => {
    if (isResizing) {
        const newWidth = mouseMoveEvent.clientX;
        if (newWidth >= 200 && newWidth <= 600) {
            setSidebarWidth(newWidth);
        }
    }
  }, [isResizing]);

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
        window.removeEventListener("mousemove", resize);
        window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);




  useEffect(() => {
      const items = selectedFile?.storyboard?.items;
      if (!items?.length) return;
      const exists = selectedShotId && items.some(s => s.id === selectedShotId);
      if (!exists) {
          setSelectedShotId(items[0].id);
      }
  }, [selectedFile, selectedShotId]);


  useEffect(() => {
      const items = selectedFile?.storyboard?.items;
      if (!items?.length || !selectedShotId) return;
      const idx = items.findIndex(s => s.id === selectedShotId);
      if (idx >= visibleShotCount) {
          setVisibleShotCount(Math.ceil((idx + 1) / SHOT_PAGE_SIZE) * SHOT_PAGE_SIZE);
      }
  }, [selectedShotId, selectedFile, visibleShotCount]);

  // A notification deep link selects the originating shot and ensures the
  // virtualized rail has rendered enough items before scrolling it into view.
  useEffect(() => {
      if (!focusShotId || handledNotificationFocusRef.current === focusShotId) return;
      const items = selectedFile?.storyboard?.items || [];
      const index = items.findIndex(item => item.id === focusShotId);
      if (index < 0) return;
      pendingNotificationFocusRef.current = focusShotId;
      setSelectedShotId(focusShotId);
      setVisibleShotCount(current => Math.max(current, index + 1));
  }, [focusShotId, selectedFile?.storyboard?.items, setSelectedShotId]);

  useEffect(() => {
      const targetShotId = pendingNotificationFocusRef.current;
      if (!targetShotId || selectedShotId !== targetShotId) return;
      const target = shotCardRefs.current.get(targetShotId);
      if (!target) return;
      const frame = window.requestAnimationFrame(() => {
          target.scrollIntoView({ block: 'center', behavior: 'smooth' });
          handledNotificationFocusRef.current = targetShotId;
          pendingNotificationFocusRef.current = null;
      });
      return () => window.cancelAnimationFrame(frame);
  }, [selectedShotId, visibleShotCount, selectedFile?.storyboard?.items]);



  useEffect(() => {
    if (recoveryStartedRef.current) return;
    recoveryStartedRef.current = true;
    const recoverTasks = async () => {
      const tasks = getRecoverableTasks();
      if (tasks.length === 0) return;
      console.log(`🔄 发现 ${tasks.length} 个未完成的生成任务，开始恢复...`);
      for (const task of tasks) {
        try {
          setGeneratingShotIds(prev => new Set(prev).add(task.shotId));
          beginShotProgress(task.shotId, task.model, task.startedAt, '正在恢复生成任务');
          const urls = await waitForComfyUITaskAllImages(
            task.taskId,
            progress => updateShotProviderProgress(task.shotId, progress),
          );
          updateShotProgressStage(task.shotId, '正在保存生成结果', 97);
          removeRunningTask(task.taskId);

          const newImages: GeneratedImage[] = (urls as GeneratedImageResult[])
            .filter((r) => r.url)
            .map((r) => ({
              id: r.fileId || uuidv4(),
              url: r.url,
              thumbnail: r.url,
              timestamp: Date.now(),
              fileId: r.fileId || undefined,
              generationModel: task.model,
            }));

          if (newImages.length > 0) {
            onUpdateStoryboardItem(task.shotId, {
              generatedImages: newImages,
              selectedImageId: newImages[0].id,
              generatedImage: newImages[0].url,
            });
            window.dispatchEvent(new CustomEvent('generation-save-trigger'));
            console.log(`✅ 恢复任务完成: ${task.shotId}, ${newImages.length} 张图片`);
          }
        } catch (e) {
          console.error(`❌ 恢复任务失败: ${task.taskId}`, e);
          removeRunningTask(task.taskId);
        } finally {
          setGeneratingShotIds(prev => { const next = new Set(prev); next.delete(task.shotId); return next; });
          clearShotProgress(task.shotId);
        }
      }
    };
    recoverTasks();
  }, [beginShotProgress, clearShotProgress, onUpdateStoryboardItem, updateShotProgressStage, updateShotProviderProgress]);

  const renderHistoryPanel = () => (
    <div className="absolute top-[52px] right-0 bottom-0 w-80 bg-n0 border-l border-n40 z-40 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        <div className="p-3 border-b border-n40 flex items-center justify-between bg-n0">
            <h3 className="text-xs font-bold text-n700 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                内部历史版本存档
            </h3>
            <button onClick={() => setShowHistory(false)} className="text-n100 hover:text-n800">
                <X className="w-4 h-4" />
            </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {selectedFile?.versions && selectedFile.versions.length > 0 ? (
                [...selectedFile.versions].reverse().map(ver => (
                    <div key={ver.id} className="bg-n30 border border-n40 rounded-lg p-3 hover:bg-n20 transition-colors group">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <div className="text-xs font-bold text-n700">{ver.name}</div>
                                <div className="text-[10px] text-n100 font-mono mt-0.5">
                                    {new Date(ver.timestamp).toLocaleString()}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => {
                                    if(confirm(`确定要从内部存档 "${ver.name}" 恢复吗？\n当前未保存的修改将丢失。`)) {
                                        onRestoreVersion(ver);
                                        setShowHistory(false);
                                    }
                                }}
                                className="flex-1 py-1.5 bg-primary-light hover:bg-primary border border-primary/30 rounded text-[10px] text-primary hover:text-n800 transition-colors flex items-center justify-center gap-1 group-hover:border-primary"
                            >
                                <RefreshCw className="w-3 h-3" />
                                恢复此版本
                            </button>
                            <button
                                onClick={() => {
                                    if(confirm(`确定要删除版本 "${ver.name}" 吗？\n此操作不可撤销。`)) {
                                        onDeleteVersion(ver.id);
                                    }
                                }}
                                className="py-1.5 px-3 bg-r50 hover:bg-danger border border-danger rounded text-[10px] text-danger hover:text-white transition-colors flex items-center justify-center gap-1 group-hover:border-danger"
                                title="删除此版本"
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                        </div>
                    </div>
                ))
            ) : (
                <div className="flex flex-col items-center justify-center py-10 text-n100 gap-2">
                    <History className="w-8 h-8 opacity-20" />
                    <div className="text-center text-xs">
                        暂无内部存档记录<br/>
                        请点击上方 <span className="text-primary font-bold">保存</span> 按钮创建存档
                    </div>
                </div>
            )}
        </div>
    </div>
  );

  const hasStoryboard = selectedFile && selectedFile.storyboard && selectedFile.storyboard.items.length > 0;
  const storyboardTotalCount = totalShotCount ?? selectedFile?.storyboard?.items.length ?? 0;
  const loadedStoryboardCount = selectedFile?.storyboard?.items.length ?? 0;
  const hasUnloadedStoryboardItems = storyboardTotalCount > loadedStoryboardCount;
  const allStoryboardItemsSelected = storyboardTotalCount > 0 && selectedShotIds.size === storyboardTotalCount;
  const selectedShot = hasStoryboard && selectedFile ? selectedFile.storyboard!.items.find(i => i.id === selectedShotId) : null;
  useEffect(() => {
      const items = selectedFile?.storyboard?.items || [];
      setConfigLockDrafts(previous => {
          const next = { ...previous };
          let changed = false;
          items.forEach(item => {
              if (next[item.id] === Boolean(item.isConfigConfirmed)) {
                  delete next[item.id];
                  changed = true;
              }
          });
          return changed ? next : previous;
      });
  }, [selectedFile?.storyboard?.items]);
  const referencePlan = useMemo(() => (
      selectedShot
          ? resolveShotReferencePlan(selectedShot, materialLibrary, references)
          : { references: [], excluded: [], criticalExcluded: [], maxReferences: 6 }
  ), [materialLibrary, references, selectedShot]);
  const selectedShotModelOverride = selectedShot ? shotModels[selectedShot.id] : undefined;
  const selectedGenerationModel = selectedShotModelOverride || globalModel;
  const selectedPortraitMode = seedancePortrait && isSeedreamStoryboardModel(selectedGenerationModel);
  const globalModelOption = getStoryboardGenerationModelOption(globalModel);
  const selectedGenerationModelOption = getStoryboardGenerationModelOption(selectedGenerationModel);
  const selectedConfigLocked = selectedShot ? isStoryboardConfigLocked(selectedShot) : false;
  const [selectedReferenceDimensions, setSelectedReferenceDimensions] = useState<SourceImageDimensions[]>([]);
  const [isLoadingReferenceDimensions, setIsLoadingReferenceDimensions] = useState(false);
  useEffect(() => {
      let active = true;
      const urls = referencePlan.references.map(reference => reference.url).filter(Boolean);
      const needsAutomaticResolution = imageRatio === 'auto' || imageK === 'auto';
      if (!needsAutomaticResolution || urls.length === 0) {
          setSelectedReferenceDimensions([]);
          setIsLoadingReferenceDimensions(false);
          return () => {
              active = false;
          };
      }

      setIsLoadingReferenceDimensions(true);
      loadImageDimensions(urls)
          .then(dimensions => {
              if (active) setSelectedReferenceDimensions(dimensions);
          })
          .finally(() => {
              if (active) setIsLoadingReferenceDimensions(false);
          });
      return () => {
          active = false;
      };
  }, [imageK, imageRatio, referencePlan.references]);
  const selectedImageSettings = useMemo(
      () => resolveGptImageSettings(imageRatio, imageK, selectedReferenceDimensions),
      [imageK, imageRatio, selectedReferenceDimensions],
  );
  const materialPicker = useProjectMaterialPicker(
      materialLibrary, files, selectedShot, selectedFile?.storyboard?.items,
  );
  const { materialPickerItems, otherStoryboardImageItems, setMaterialPickerFilter, setMaterialPickerSearch } = materialPicker;

  useEffect(() => {
      if (!selectAllAfterLoad || !selectedFile?.storyboard?.items.length) return;
      const items = selectedFile.storyboard.items;
      const total = storyboardTotalCount || items.length;
      if (items.length < total) return;
      setVisibleShotCount(total);
      setSelectedShotIds(new Set(items.map(i => i.id)));
      setSelectAllAfterLoad(false);
  }, [selectAllAfterLoad, selectedFile?.storyboard?.items, storyboardTotalCount]);

  const toggleShotSelection = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setSelectedShotIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
      });
  };

  const toggleSelectAll = async () => {
      if (allStoryboardItemsSelected) {
          setSelectedShotIds(new Set());
          setSelectAllAfterLoad(false);
      } else {
          if (hasUnloadedStoryboardItems && onLoadAllStoryboardItems) {
              setIsLoadingAllShotsForSelection(true);
              setSelectAllAfterLoad(true);
              try {
                  await onLoadAllStoryboardItems();
              } catch (e) {
                  console.error('加载全部分镜失败:', e);
                  setSelectAllAfterLoad(false);
              } finally {
                  setIsLoadingAllShotsForSelection(false);
              }
              return;
          }
          setSelectedShotIds(new Set(selectedFile.storyboard?.items.map(i => i.id)));
      }
  };

  const handleAddReference = (
      url: string,
      type: ReferenceType,
      name?: string,
      metadata: Partial<Pick<GenerationReference, 'assetId' | 'fileId' | 'description'>> = {},
  ) => {
      if (references.length >= 6) {
          alert("最多只能加载6张参考图片");
          return;
      }
      if (references.some(reference => reference.url === url)) return;
      const newRef: GenerationReference = {
          id: uuidv4(),
          url,
          type,
          name,
          source: 'manual',
          ...metadata,
      };
      console.log(`➕ 添加参考图片:`, { type, name, urlLength: url.length });
      updateCurrentShotReferences(prev => {
          const updated = [...prev, newRef];
          console.log(`📊 当前参考图片总数: ${updated.length}`);
          return updated;
      });
  };

  const handleAutoFill = () => {
      if (!selectedShot) return;
      const merged = mergeDefaultShotReferences(
        referencesRef.current,
        resolveShotReferences(selectedShot, materialLibrary),
      );
      if (merged.exceedsLimit) {
          alert('无法恢复自动绑定，因为超过6张图');
          return;
      }
      if (merged.references.length === referencesRef.current.length) {
          alert('当前已是默认绑定状态');
          return;
      }
      updateCurrentShotReferences(merged.references);
  };

  const handleAddProjectMaterial = (item: (typeof materialPickerItems)[number]) => {
      handleAddReference(
          item.material.url,
          item.type,
          item.tagName || item.material.name,
          {
              assetId: item.material.assetId,
              fileId: item.material.fileId,
              description: item.material.description,
          },
      );
  };

  const handleAddOtherStoryboardImage = (
      item: (typeof otherStoryboardImageItems)[number],
  ) => {
      handleAddReference(
          item.url,
          'pose',
          `${item.shotLabel} · ${item.imageLabel}`,
          {
              fileId: item.fileId || undefined,
              description: `来自其他分镜：${item.shotLabel}`,
          },
      );
  };

  const handleMaterialPickerFilterChange = async (
      filter: typeof materialPicker.materialPickerFilter,
  ) => {
      setMaterialPickerFilter(filter);
      if (
          (filter === 'other-shot' || filter === 'all')
          && hasUnloadedStoryboardItems
          && onLoadAllStoryboardItems
          && !isLoadingOtherShotImages
      ) {
          setIsLoadingOtherShotImages(true);
          try {
              await onLoadAllStoryboardItems();
          } catch (error) {
              console.error('加载其他分镜图片失败:', error);
          } finally {
              setIsLoadingOtherShotImages(false);
          }
      }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: ReferenceType) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          console.log(`📤 上传参考图片: ${file.name}, 大小: ${(file.size / 1024).toFixed(2)}KB`);
          try {
              const { uploadEntityFile } = await import('../services/entityFileService');
              const shotId = selectedShot?.id || 'temp';
              const saved = await uploadEntityFile(file, 'storyboard_item', shotId, 'reference_image', episodeId);
              console.log(`✅ 参考图片已上传到服务器: ${saved.fileUrl}`);
              handleAddReference(saved.fileUrl, type, file.name, { fileId: saved.fileId });
          } catch (err) {
              console.error('❌ 参考图片上传失败，回退到本地预览:', err);
              const reader = new FileReader();
              reader.onload = (ev) => {
                  if (ev.target?.result) {
                      handleAddReference(ev.target.result as string, type, file.name);
                  }
              };
              reader.readAsDataURL(file);
          }
      }
  };

  const handleConfirmConfig = () => {
      if (!selectedShot) return;


      const newState = !isStoryboardConfigLocked(selectedShot);
      console.log(newState ? '🔒 锁定配置' : '🔓 解锁配置');
      setConfigLockDrafts(previous => ({
        ...previous,
        [selectedShot.id]: newState,
      }));
      onUpdateStoryboardItem(selectedShot.id, {
        isConfigConfirmed: newState
      });
  };

  const handleDeleteReference = (reference: GenerationReference) => {
      if (!selectedShot) return;
      updateCurrentShotReferences(current => (
          current.filter(item => item.id !== reference.id)
      ));
  };


  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [isDraggingResult, setIsDraggingResult] = useState(false);
  const [imageDropTargetShotId, setImageDropTargetShotId] = useState<string | null>(null);
  const [copyingImageToShotId, setCopyingImageToShotId] = useState<string | null>(null);


  const handleRefDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingRef(true);
  };

  const handleRefDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingRef(false);
  };

  const handleRefDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingRef(false);

      if (references.length >= 6) {
          alert('最多只能添加6张参考图片');
          return;
      }


      const imageUrl = e.dataTransfer.getData('text/plain');
      if (imageUrl && (imageUrl.startsWith('data:') || imageUrl.startsWith('http') || imageUrl.startsWith('/'))) {
          console.log('📥 从生成结果拖入参考图片');
          handleAddReference(imageUrl, 'character', '从生成结果拖入');
          return;
      }


      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
          const file = files[0];
          if (!file.type.startsWith('image/')) {
              alert('只支持图片文件');
              return;
          }
          console.log(`📤 拖拽上传参考图片: ${file.name}`);
          (async () => {
              try {
                  const { uploadEntityFile } = await import('../services/entityFileService');
                  const shotId = selectedShot?.id || 'temp';
                  const saved = await uploadEntityFile(file, 'storyboard_item', shotId, 'reference_image', episodeId);
                  console.log(`✅ 拖拽参考图片已上传: ${saved.fileUrl}`);
                  handleAddReference(saved.fileUrl, 'character', file.name, { fileId: saved.fileId });
              } catch (err) {
                  console.error('❌ 拖拽上传失败，回退本地预览:', err);
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                      if (ev.target?.result) {
                          handleAddReference(ev.target.result as string, 'character', file.name);
                      }
                  };
                  reader.readAsDataURL(file);
              }
          })();
      }
  };


  const handleResultDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingResult(true);
  };

  const handleResultDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingResult(false);
  };

  const handleResultDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingResult(false);

      if (!selectedShot) return;

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
          const file = files[0];
          if (!file.type.startsWith('image/')) {
              alert('只支持图片文件');
              return;
          }
          console.log(`📤 拖拽上传到生成结果: ${file.name}`);
          // Upload first so the storyboard stores a durable server URL. A data
          // URL can exceed field/request limits and is unusable by later workers.
          (async () => {
              try {
                  const { uploadEntityFile } = await import('../services/entityFileService');
                  const saved = await uploadEntityFile(
                      file, 'storyboard_item', selectedShot.id, 'generated_image', episodeId
                  );
                  console.log(`✅ 拖拽上传画面成功（持久化 URL）: ${saved.fileUrl}`);
                  const newImage: GeneratedImage = {
                      id: saved.fileId || uuidv4(),
                      url: saved.fileUrl,
                      thumbnail: saved.fileUrl,
                      timestamp: Date.now(),
                      fileId: saved.fileId || undefined,
                      source: 'upload',
                  };
                  onUpdateStoryboardItem(selectedShot.id, (currentItem) => {
                      const existingImages = currentItem.generatedImages || [];
                      return {
                          generatedImages: [...existingImages, newImage],
                          selectedImageId: newImage.id,
                          generatedImage: saved.fileUrl,
                      };
                  });
                  queryClient.invalidateQueries({
                      queryKey: ['entityFiles', 'storyboard_item', selectedShot.id, 'generated_image'],
                  });
                  notifyStoryboardImageChanged(episodeId, selectedShot.id);
                  console.log('✅ 已添加到生成结果（已持久化，视频页可正常导入）');
              } catch (err) {
                  console.error('❌ 拖拽上传到生成结果失败:', err);
                  alert(`上传失败：${(err as Error).message || '未知错误'}\n\n图片未保存，请重试或检查网络。`);
              }
          })();
      }
  };

  const handleShotImageDragOver = (e: React.DragEvent, targetShotId: string) => {
      const dragTypes = Array.from(e.dataTransfer.types);
      if (
          !dragTypes.includes(STORYBOARD_IMAGE_DRAG_MIME)
          && !dragTypes.includes('text/plain')
      ) {
          return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setImageDropTargetShotId(targetShotId);
  };

  const handleShotImageDragLeave = (e: React.DragEvent, targetShotId: string) => {
      const relatedTarget = e.relatedTarget as Node | null;
      if (relatedTarget && e.currentTarget.contains(relatedTarget)) return;
      if (imageDropTargetShotId === targetShotId) setImageDropTargetShotId(null);
  };

  const handleShotImageDrop = async (e: React.DragEvent, targetShot: StoryboardItem) => {
      e.preventDefault();
      e.stopPropagation();
      setImageDropTargetShotId(null);

      const storyboardItems = selectedFile?.storyboard?.items || [];
      const dragged = resolveStoryboardImageDrag(
          e.dataTransfer.getData(STORYBOARD_IMAGE_DRAG_MIME),
          storyboardItems,
          e.dataTransfer.getData('text/plain'),
      );
      if (!dragged || dragged.sourceShotId === targetShot.id || copyingImageToShotId) return;
      const targetReferences = resolveShotReferences(
          targetShot,
          materialLibrary,
          targetShot.referenceConfigInitialized || (targetShot.configuredReferences?.length || 0) > 0
              ? targetShot.configuredReferences || []
              : undefined,
      );
      if (targetReferences.some(reference => reference.url === dragged.image.url)) {
          setSelectedShotId(targetShot.id);
          return;
      }
      if (targetReferences.length >= 6) {
          alert('目标镜头最多只能提交 6 张参考图片，请先删除不需要的参考图。');
          return;
      }

      setCopyingImageToShotId(targetShot.id);
      try {
          const blob = await downloadImageBlob(dragged.image.url, '复制分镜参考图片');
          const mimeType = blob.type || 'image/png';
          const extension = mimeType.split('/')[1]?.split('+')[0] || 'png';
          const file = new File(
              [blob],
              `shot-${targetShot.shotNumber || targetShot.id}-${Date.now()}.${extension}`,
              { type: mimeType },
          );
          const { uploadEntityFile } = await import('../services/entityFileService');
          const saved = await uploadEntityFile(
              file,
              'storyboard_item',
              targetShot.id,
              'reference_image',
              episodeId,
          );
          const sourceShot = storyboardItems.find(item => item.id === dragged.sourceShotId);
          const copiedReference: GenerationReference = {
              id: saved.fileId || uuidv4(),
              url: saved.fileUrl,
              type: 'pose',
              name: `来自镜头 ${sourceShot?.shotNumber || dragged.sourceShotId}`,
              fileId: saved.fileId || undefined,
              description: '从其他镜头的画面分镜结果拖入',
              source: 'manual',
          };

          onUpdateStoryboardItem(targetShot.id, (currentItem) => {
              const currentReferences = resolveShotReferences(
                  currentItem,
                  materialLibrary,
                  currentItem.referenceConfigInitialized || (currentItem.configuredReferences?.length || 0) > 0
                      ? currentItem.configuredReferences || []
                      : undefined,
              );
              if (currentReferences.some(reference => reference.url === copiedReference.url)) {
                  return {};
              }
              return {
                  configuredReferences: [...currentReferences, copiedReference].slice(0, 6),
                  referenceConfigInitialized: true,
              };
          });
          setSelectedShotId(targetShot.id);
          queryClient.invalidateQueries({
              queryKey: ['entityFiles', 'storyboard_item', targetShot.id, 'reference_image'],
          });
          window.dispatchEvent(new CustomEvent('generation-save-trigger'));
      } catch (error) {
          console.error('复制分镜参考图片失败:', error);
          alert(`复制到目标镜头参考图片失败：${(error as Error)?.message || '请稍后重试'}`);
      } finally {
          setCopyingImageToShotId(null);
      }
  };


  const handleResultImageDragStart = (
      e: React.DragEvent,
      image: GeneratedImage,
  ) => {
      if (!selectedShot) return;
      e.dataTransfer.setData(
          STORYBOARD_IMAGE_DRAG_MIME,
          serializeStoryboardImageDrag(selectedShot.id, image),
      );
      e.dataTransfer.setData('text/plain', image.url);
      e.dataTransfer.effectAllowed = 'copy';
  };


  const executeGenerationForShot = async (
      shot: StoryboardItem,
      useCurrentState = false,
      model?: GenerationModel,
      currentRefs?: GenerationReference[],
  ) => {
      const plan = resolveShotReferencePlan(
          shot,
          materialLibrary,
          currentRefs ?? (
              shot.referenceConfigInitialized || (shot.configuredReferences?.length || 0) > 0
                  ? shot.configuredReferences || []
                  : undefined
          ),
      );
      const modelToUse = model || (useCurrentState ? globalModel : (shotModels[shot.id] || globalModel));
      const portraitMode = seedancePortrait && isSeedreamStoryboardModel(modelToUse);
      const onlineCapability = imageGenerationCapabilities?.models[modelToUse];
      if (onlineCapability?.available === false) {
          throw new Error(onlineCapability.reason || '当前图像模型暂不可用，请联系管理员。');
      }
      if (portraitMode && imageGenerationCapabilities?.seedance_portrait.available === false) {
          throw new Error(imageGenerationCapabilities.seedance_portrait.reason || 'Seedance 人像原图模式当前不可用。');
      }
      const submittedReferences = storyboardSubmissionReferences(shot, plan.references, portraitMode);
      const creditParams = { image_count: 1, model: modelToUse };
      await assertEnoughCredits(STORYBOARD_IMAGE_CREDIT_FEATURE, creditParams);
      beginShotProgress(shot.id, modelToUse);
      if (COMFYUI_MODELS.has(modelToUse) && submittedReferences.length === 0) {
          throw new Error('当前生成模型需要一张参考图；请添加参考图，或先选择当前分镜已有的生成结果。');
      }

      const basePrompt = (useCurrentState ? prompt : shot.imagePrompt) || shot.scriptSegment || '';
      const refImages = submittedReferences.map(reference => reference.url);
      let successfulBillingModel: GenerationModel = modelToUse;
      let generationFallbackReason: string | undefined;

      const runOnce = async (): Promise<GeneratedImage[]> => {
          const attempt = 1;
          updateShotProgressStage(
              shot.id,
              portraitMode ? '正在准备纯文生图' : '正在分析提示词与参考图',
              6,
          );
          const identityAnchoredPrompt = buildIdentityAnchoredPrompt(
              shot,
              portraitMode ? seedreamTextOnlyPrompt(basePrompt, plan.references) : basePrompt,
              materialLibrary,
              submittedReferences,
          );
          const promptToUse = applyComputerOperationOrientationConstraint(identityAnchoredPrompt, [
              shot.originalText,
              shot.scriptSegment,
              shot.imagePrompt,
              shot.videoPrompt,
              shot.dialogue,
              shot.scene,
              ...(shot.props || []),
          ]);
          const sourceDimensions = imageRatio === 'auto' || imageK === 'auto'
              ? await loadImageDimensions(refImages)
              : [];
          const resolvedImageSettings = resolveGptImageSettings(
              imageRatio,
              imageK,
              sourceDimensions,
          );
          const [outputWidth, outputHeight] = recommendGptImageSize(
              resolvedImageSettings.ratio,
              resolvedImageSettings.k,
          ).split('x').map(Number);
          let generated: GeneratedImage[] = [];

          console.log(`🎨 开始生成 - 模型: ${modelToUse}, 尝试: ${attempt}, 参考图片: ${refImages.length}`);
          if (modelToUse === 'nanobanana') {
              updateShotProgressStage(shot.id, 'AI 正在生成画面', 10);
              const result = await generateFinalIllustrationResult(
                  promptToUse,
                  refImages,
                  {
                      entityType: 'storyboard_item',
                      entityId: shot.id,
                      fileRole: 'generated_image',
                      projectId,
                      episodeId,
                      sourcePage: 'generation',
                      sourceItemId: shot.id,
                  },
                  {
                      aspectRatio: resolvedImageSettings.ratio,
                      imageSize: resolvedImageSettings.k,
                  },
                  submittedReferences.map(reference => ({
                      referenceId: reference.id,
                      assetId: reference.assetId,
                      fileId: reference.fileId,
                      type: reference.type,
                      name: reference.name,
                      description: reference.description,
                      source: reference.source,
                  })),
              );
              generated = [{
                  id: result.fileId || uuidv4(),
                  url: result.fileUrl || result.url,
                  thumbnail: result.fileUrl || result.url,
                  timestamp: Date.now(),
                  fileId: result.fileId,
                  generationModel: modelToUse,
                  generationAttempt: attempt,
              }];
          } else if (isSeedreamStoryboardModel(modelToUse)) {
              updateShotProgressStage(shot.id, '豆包正在生成画面', 10);
              const referenceMetadata = submittedReferences.map(reference => ({
                      referenceId: reference.id,
                      assetId: reference.assetId,
                      fileId: reference.fileId,
                      type: reference.type,
                      name: reference.name,
                      description: reference.description,
                      source: reference.source,
              }));
              const entityOptions = {
                entityType: 'storyboard_item', entityId: shot.id, fileRole: 'generated_image',
                projectId, episodeId, sourcePage: 'generation', sourceItemId: shot.id,
              };
              const result = await generateImageWithPreferredFallback({
                engine: 'doubao',
                model: modelToUse === 'doubao_pro' ? SEEDREAM_PRO_MODEL : SEEDREAM_LITE_MODEL,
                billingModel: modelToUse,
                count: 1,
                doubao: {
                  prompt: promptToUse,
                  seedancePortrait: portraitMode,
                  references: refImages,
                  referenceMetadata,
                  size: recommendDoubaoImageSize(resolvedImageSettings.ratio, resolvedImageSettings.k),
                  sequential: 'disabled',
                  ...entityOptions,
                },
                gemini: {
                  prompt: promptToUse,
                  references: refImages,
                  referenceMetadata,
                  aspectRatio: resolvedImageSettings.ratio,
                  imageSize: resolvedImageSettings.k,
                  ...entityOptions,
                },
              });
              successfulBillingModel = result.fallbackReason ? 'nanobanana' : modelToUse;
              generationFallbackReason = result.fallbackReason;
              if (result.fallbackReason === IMAGE_FALLBACK_REASON) {
                updateShotProgressStage(shot.id, '豆包暂不可用，已由 Gemini 3.1 完成', 90);
              }
              generated = result.files.map(file => {
                  const url = file.fileUrl || file.url;
                  return {
                      id: file.fileId || uuidv4(),
                      url,
                      thumbnail: url,
                      timestamp: Date.now(),
                      fileId: file.fileId,
                      generationModel: result.actualModel,
                      fallbackReason: result.fallbackReason,
                      generationAttempt: attempt,
                  };
              }).filter(image => image.url);
          } else if (modelToUse === 'gpt_image_vip' || modelToUse === 'gpt_image_official') {
              updateShotProgressStage(shot.id, 'AI 正在生成画面', 10);
              const tier = modelToUse === 'gpt_image_vip' ? 'vip' : 'official';
              const response = await generateGptImage({
                  tier,
                  prompt: promptToUse,
                  references: refImages,
                  referenceMetadata: submittedReferences.map(reference => ({
                      referenceId: reference.id,
                      assetId: reference.assetId,
                      fileId: reference.fileId,
                      type: reference.type,
                      name: reference.name,
                      description: reference.description,
                      source: reference.source,
                  })),
                  ratio: resolvedImageSettings.ratio,
                  k: resolvedImageSettings.k,
                  quality: tier === 'official' ? imageQuality : 'auto',
                  entityType: 'storyboard_item',
                  entityId: shot.id,
                  fileRole: 'generated_image',
                  projectId,
                  episodeId,
                  sourcePage: 'generation',
                  sourceItemId: shot.id,
              });
              generated = response.files.map((file, index) => {
                  const url = file.file_url || file.url || file.data_url || response.images[index] || '';
                  return {
                      id: file.file_id || uuidv4(),
                      url,
                      thumbnail: url,
                      timestamp: Date.now(),
                      fileId: file.file_id || undefined,
                      generationModel: modelToUse,
                      generationAttempt: attempt,
                  };
              }).filter(image => image.url);
          } else {
              updateShotProgressStage(shot.id, '等待处理节点接收任务', 8);
              let workflowType: 'qwen' | 'qwen_lora' | 'kontext' | 'qwenN' | 'qwenN_lora';
              if (modelToUse === 'qwen') workflowType = 'qwen';
              else if (modelToUse === 'qwen_lora') workflowType = 'qwen_lora';
              else if (modelToUse === 'kontext') workflowType = 'qwenN';
              else if (modelToUse === 'qwenN') workflowType = 'kontext';
              else if (modelToUse === 'qwenN_lora') workflowType = 'qwenN_lora';
              else workflowType = 'kontext';

              const mainImage = refImages[0] || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
              const preferredAgentId = selectedClusterNode?.agentId || (selectedClusterNode?.kind === 'agent' ? selectedClusterNode.id : undefined);
              const preferredNodeId = selectedClusterNode?.nodeId || selectedClusterNode?.id;
              let currentTaskId = '';
              const resultUrls = await generateWithComfyUIWorkflowQueued(
                  workflowType,
                  promptToUse,
                  mainImage,
                  refImages.slice(1),
                  -1,
                  taskId => {
                      currentTaskId = taskId;
                      saveRunningTask({ taskId, shotId: shot.id, fileId: selectedFileId || '', model: modelToUse, startedAt: Date.now() });
                      updateShotProgressStage(shot.id, '处理节点已接收任务，正在生成', 10);
                  },
                  {
                      entityType: 'storyboard_item', entityId: shot.id, fileRole: 'generated_image', projectId, episodeId,
                      preferredAgentId, preferredNodeId, outputWidth, outputHeight,
                  },
                  buildRegistryMeta(
                      shot,
                      workflowType === 'qwen_lora' ? 'qwen-lora'
                          : workflowType === 'kontext' ? 'kontext'
                              : workflowType === 'qwenN_lora' ? 'qwen-lora' : 'qwen-image',
                      `画面分镜 ${workflowType}`,
                  ),
                  progress => updateShotProviderProgress(shot.id, progress),
              );
              if (currentTaskId) removeRunningTask(currentTaskId);
              generated = (resultUrls as GeneratedImageResult[]).filter(result => result.url).map(result => ({
                  id: result.fileId || uuidv4(),
                  url: result.url,
                  thumbnail: result.url,
                  timestamp: Date.now(),
                  fileId: result.fileId || undefined,
                  generationModel: modelToUse,
                  generationAttempt: attempt,
              }));
          }

          if (!generated.length) throw new Error('未获取到生成结果');
          updateShotProgressStage(
              shot.id,
              '画面已生成，正在整理结果',
              90,
          );
          return generated;
      };

      try {
          const generated = await runOnce();
           const selected = generated[generated.length - 1];
           updateShotProgressStage(shot.id, '正在保存生成结果', 97);
           onUpdateStoryboardItem(shot.id, currentItem => {
              const existingImages = currentItem.generatedImages || [];
              const mergedImages = dedupeGeneratedImages([...existingImages, ...generated]);
              return {
                  generatedImages: mergedImages,
                  selectedImageId: selected.id,
                  generatedImage: selected.url,
              };
          });
          queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', shot.id, 'generated_image'] });
           notifyStoryboardImageChanged(episodeId, shot.id);
           window.dispatchEvent(new CustomEvent('generation-save-trigger'));
           if (!COMFYUI_MODELS.has(modelToUse)) {
             try {
               const projectId = (() => {
                 try { return localStorage.getItem('current_project_id') || null; } catch { return null; }
               })();
               await consumeCredits({
                 featureKey: STORYBOARD_IMAGE_CREDIT_FEATURE,
                 taskId: newDesignCreditUsageId('storyboard-image'),
                 params: { image_count: generated.length, model: successfulBillingModel },
                 projectId,
                 metadata: {
                   surface: 'storyboard',
                   episode_id: episodeId || null,
                   storyboard_item_id: shot.id,
                   requested_model: modelToUse,
                   actual_model: successfulBillingModel,
                   fallback_reason: generationFallbackReason || null,
                 },
               });
             } catch (settlementError: any) {
               crmMessage.warning(`分镜图片已生成，但创作点数结算失败：${settlementError?.message || String(settlementError)}`);
             }
           }
           updateShotProgressStage(shot.id, '生成完成', 100);
      } catch (error) {
          console.error(`Generation failed for shot ${shot.id}`, error);
          throw error;
      }
  };

  const generateForShot = (
      shot: StoryboardItem,
      useCurrentState = false,
      model?: GenerationModel,
      currentRefs?: GenerationReference[],
  ): Promise<void> => runSingleFlight(
      generationRequestsRef.current,
      shot.id,
      () => executeGenerationForShot(shot, useCurrentState, model, currentRefs),
  );

  const handleGenerateCurrent = async () => {
      if (!selectedShot) return;

      const shotId = selectedShot.id;
      setGeneratingShotIds(prev => new Set(prev).add(shotId));
      try {
          console.log('🔄 重新生成 - 当前参考图片:', references.map(r => ({ id: r.id, url: r.url.substring(0, 50) + '...' })));
          await generateForShot(selectedShot, true, selectedGenerationModel, references);
      } catch (e: any) {

          crmMessage.error(`生成失败：${e?.message || e || '请检查网络或图片大小'}`);
       } finally {
           setGeneratingShotIds(prev => { const next = new Set(prev); next.delete(shotId); return next; });
           clearShotProgress(shotId);
       }
  };

  const handleBatchGenerate = async () => {
      if (!selectedFile?.storyboard || !selectedShot || selectedShotIds.size === 0) return;

      setBatchProgress({ current: 0, total: selectedShotIds.size });

      const ids = Array.from(selectedShotIds);
      setGeneratingShotIds(prev => {
          const next = new Set(prev);
          ids.forEach(id => next.add(id));
          return next;
      });
      let successCount = 0;
      const failures: { label: string; message: string }[] = [];

      for (let i = 0; i < ids.length; i++) {
           const id = ids[i];
           const shot = selectedFile.storyboard?.items.find(item => item.id === id);
           if (shot) {
               setBatchProgress({ current: i, total: ids.length, activeShotId: id });
               const shotLabel = String(shot.shotNumber || `#${String(shot.id).slice(0, 6)}`);
              try {
                  const isCurrent = id === selectedShot.id;
                  const model = shotModels[shot.id] || globalModel;
                  await generateForShot(shot, isCurrent, model);
                  successCount++;
              } catch (e) {

                  const message = e instanceof Error ? e.message : String(e);
                  console.error(`镜头 ${shotLabel} 批量生成失败:`, e);
                  failures.push({ label: shotLabel, message });
              }
           }
           setBatchProgress({ current: i + 1, total: ids.length });
           setGeneratingShotIds(prev => { const next = new Set(prev); next.delete(id); return next; });
           clearShotProgress(id);
       }

      setBatchProgress(null);
      if (failures.length === 0) {
          alert(`批量生成完成: ${successCount}/${ids.length} 全部成功`);
      } else {
          const detail = failures
              .map(f => `• 镜头 ${f.label}: ${f.message || '生成失败'}`)
              .join('\n');
          alert(
              `批量生成完成: ${successCount}/${ids.length} 成功，${failures.length} 个失败，请重新生成以下镜头:\n${detail}`,
          );
      }
  };

  const handleDeleteResult = async (imgId: string) => {
      if (!selectedShot || !selectedShotId) return;

      const existingImages = selectedShot.generatedImages || [];
      const imgToDelete = existingImages.find(img => img.id === imgId);
      const newImages = existingImages.filter(img => img.id !== imgId);

      let newSelectedId = selectedShot.selectedImageId;
      if (newSelectedId === imgId) {
          newSelectedId = newImages.length > 0 ? newImages[0].id : undefined;
      }

      console.log(`🗑️ 删除图片 ${imgId} 从镜头 ${selectedShot.id} (${existingImages.length} → ${newImages.length})`);

      removeImageFromCache(selectedShot.id, imgId);


      if (imgToDelete?.fileId) {
          try {
              const { deleteEntityFile } = await import('../services/entityFileService');
              await deleteEntityFile(imgToDelete.fileId);
              console.log(`✅ DB 删除成功: ${imgToDelete.fileId}`);
          } catch (err) {
              console.error('DB 删除失败:', err);
          }
      }

      onUpdateStoryboardItem(selectedShot.id, {
          generatedImages: newImages,
          selectedImageId: newSelectedId,
          generatedImage: newImages.length > 0 ? newImages[0].url : undefined
      });

      onForceSave();
  };

  const handleSelectResult = (imgId: string) => {
      if (!selectedShot) return;
      const img = (selectedShot.generatedImages || []).find(i => i.id === imgId);
      onUpdateStoryboardItem(selectedShot.id, {
          selectedImageId: imgId,
          generatedImage: img?.url || img?.thumbnail
      });
  };

  const handleViewFullImage = async (shotId: string, imageId: string) => {
      if (!selectedFileId) return;

      const currentImg = currentGeneratedImages.find(img => img.id === imageId);

      if (!currentImg) {
          console.error(`❌ 未找到图片: shotId=${shotId}, imageId=${imageId}`);
          return;
      }


      setPreviewShotId(shotId);
      setPreviewImageId(imageId);


      const imageUrl = currentImg.url || currentImg.thumbnail;

      if (!imageUrl) {
          console.error('❌ 图片URL为空');
          return;
      }

      console.log(`🖼️ 查看大图: ${imageId}, URL类型: ${imageUrl.startsWith('data:') ? 'dataURL' : imageUrl.startsWith('blob:') ? 'blobURL' : 'serverURL'}`);


      if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
          setIsLoadingFullImage(false);
          setPreviewImage(imageUrl);
          return;
      }


      setIsLoadingFullImage(true);
      setPreviewImage(currentImg.thumbnail || imageUrl);

      try {

          const cacheKey = `${shotId}:${imageId}`;
          const cachedUrl = getCachedBlobUrl(cacheKey);
          if (cachedUrl) {
              console.log('📦 从缓存加载完整图片');
              setPreviewImage(cachedUrl);
              setIsLoadingFullImage(false);
              return;
          }


          const blob = await downloadImageBlob(imageUrl, '加载完整图片');
          const blobUrl = URL.createObjectURL(blob);


          setCachedBlobUrl(cacheKey, blobUrl);
          setPreviewImage(blobUrl);
          console.log('✅ 完整图片已加载');

      } catch (error) {
          console.error('❌ 加载完整图片失败:', error);

      } finally {
          setIsLoadingFullImage(false);
      }
  };

  const getPreviewImageList = () => {
      if (!previewShotId) return [];
      return currentGeneratedImages;
  };


  const handlePrevImage = () => {
      if (!previewShotId || !previewImageId || isLoadingFullImage) return;
      const imageList = getPreviewImageList();
      const currentIndex = imageList.findIndex(img => img.id === previewImageId);
      if (currentIndex > 0) {
          const prevImage = imageList[currentIndex - 1];
          handleViewFullImage(previewShotId, prevImage.id);
      }
  };


  const handleNextImage = () => {
      if (!previewShotId || !previewImageId || isLoadingFullImage) return;
      const imageList = getPreviewImageList();
      const currentIndex = imageList.findIndex(img => img.id === previewImageId);
      if (currentIndex < imageList.length - 1) {
          const nextImage = imageList[currentIndex + 1];
          handleViewFullImage(previewShotId, nextImage.id);
      }
  };


  const closePreview = () => {
      setPreviewImage(null);
      setPreviewShotId(null);
      setPreviewImageId(null);
  };

  const randomSeed = () => Math.floor(Math.random() * 900000000000000) + 100000000000000;

  const ensureDataUrl = async (url: string): Promise<string> => {
    if (url.startsWith('data:')) return url;
    const blob = await downloadImageBlob(url, '下载图片');
    return blobToDataUrl(blob);
  };


  const ensureDataUrlAsPng = async (url: string): Promise<string> => {
    return new Promise<string>(async (resolve, reject) => {
        try {

            const img = new Image();
            img.crossOrigin = 'anonymous';

            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('无法创建 Canvas 上下文'));
                        return;
                    }
                    ctx.drawImage(img, 0, 0);
                    const pngDataUrl = canvas.toDataURL('image/png');
                    console.log(`✅ 图片已转换为 PNG 格式 (${img.naturalWidth}x${img.naturalHeight})`);
                    resolve(pngDataUrl);
                } catch (err) {
                    reject(err);
                }
            };

            img.onerror = () => {
                reject(new Error('图片加载失败，无法转换为 PNG'));
            };


            if (url.startsWith('data:') || url.startsWith('blob:')) {
                img.src = url;
            } else {

                const blob = await downloadImageBlob(url, '下载图片');
                img.src = URL.createObjectURL(blob);
            }
        } catch (err) {
            reject(err);
        }
    });
  };

  const handleAngleAdjustment = async (imageUrl: string, params: {
    rotate: number;
    move: number;
    vertical: number;
    wideAngle: boolean;
    customPrompt?: string;
    seed: number;
  }) => {
    if (!selectedShot) return;

    setIsAngleAdjusting(true);
    try {
        let prompt = '';


        if (params.customPrompt?.trim()) {
            prompt = params.customPrompt.trim();
        } else {

            const prompts: string[] = [];


            if (params.rotate === -90) {
                prompts.push("将镜头向左旋转90度 Rotate the camera 90 degrees to the left.");
            } else if (params.rotate === -45) {
                prompts.push("将镜头向左旋转45度 Rotate the camera 45 degrees to the left.");
            } else if (params.rotate === 45) {
                prompts.push("将镜头向右旋转45度 Rotate the camera 45 degrees to the right.");
            } else if (params.rotate === 90) {
                prompts.push("将镜头向右旋转90度 Rotate the camera 90 degrees to the right.");
            }


            if (params.move === 5) {
                prompts.push("将镜头向前移动 Move the camera forward.");
            } else if (params.move === 10) {
                prompts.push("将镜头转为特写镜头 Turn the camera into a close-up shot.");
            }


            if (params.vertical === 1) {
                prompts.push("将相机切换到仰视视角 Turn the camera to a worm's-eye view.");
            } else if (params.vertical === -1) {
                prompts.push("将相机转向鸟瞰视角 Turn the camera to a bird's-eye view.");
            }


            if (params.wideAngle) {
                prompts.push("将镜头转为广角镜头 Turn the camera to a wide-angle lens.");
            }

            prompt = prompts.join(' ');
        }


        if (!prompt) {
            prompt = "保持当前画面构图和内容。";
        }

        const baseImage = await ensureDataUrl(imageUrl);
        const sourceDimensions = await probeImageDimensions(imageUrl);
        const outputDimensions = fitAngleOutputDimensions(sourceDimensions);
        const routing = await resolveGpuTaskRouting(selectedClusterNodeId);
        const actualNodeId = routing.node
          ? clusterNodePreferenceId(routing.node)
          : routing.preferredAgentId || routing.preferredNodeId;
        if (actualNodeId && actualNodeId !== selectedClusterNodeId) {
          setSelectedClusterNodeId(actualNodeId);
          setPreferredGpuNodeId(actualNodeId);
        }

        const resultUrl = await adjustImageAngleQueued(baseImage, prompt, params.seed, {
          entityType: 'storyboard_item',
          entityId: selectedShot?.id,
          fileRole: 'generated_image',
          episodeId,
          preferredAgentId: routing.preferredAgentId,
          preferredNodeId: routing.preferredNodeId,
          outputWidth: outputDimensions.width,
          outputHeight: outputDimensions.height,
        }, buildRegistryMeta(selectedShot, 'angle-adjust', '角度调整'));

        const newImage: GeneratedImage = {
            id: uuidv4(),
            url: resultUrl,
            thumbnail: resultUrl,
            timestamp: Date.now()
        };


        onUpdateStoryboardItem(selectedShot.id, (currentItem) => {
            const existingImages = currentItem.generatedImages || [];
            const updatedImages = [...existingImages, newImage];
            return {
                generatedImages: updatedImages,
                selectedImageId: newImage.id,
                generatedImage: resultUrl,
            };
        });


        console.log('💾 角度调整完成，触发立即保存');
        onForceSave();
        queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
        notifyStoryboardImageChanged(episodeId, selectedShot?.id);


        setCameraModalImage(null);
    } catch (error: any) {
        console.error('Angle adjustment failed', error);
        crmMessage.error(normalizeComfyUITaskError(error, { kind: 'angle-adjust', title: '角度调整' }));
    } finally {
        setIsAngleAdjusting(false);
    }
  };

  const handleHorizontalMirror = async (imageUrl: string) => {
    const targetShot = selectedShot;
    if (!targetShot || isHorizontalMirroring) return;

    setIsHorizontalMirroring(true);
    try {
      const sourceBlob = await downloadImageBlob(imageUrl, '加载完整图片');
      const mirroredBlob = await horizontallyMirrorImage(sourceBlob);
      const file = new File(
        [mirroredBlob],
        `storyboard-horizontal-mirror-${Date.now()}.png`,
        { type: 'image/png' },
      );
      const { uploadEntityFile } = await import('../services/entityFileService');
      const saved = await uploadEntityFile(
        file,
        'storyboard_item',
        targetShot.id,
        'generated_image',
        episodeId,
        { source: 'local_transform', transform: 'horizontal_mirror' },
      );
      const newImage: GeneratedImage = {
        id: saved.fileId || uuidv4(),
        url: saved.fileUrl,
        thumbnail: saved.fileUrl,
        timestamp: Date.now(),
        fileId: saved.fileId,
        source: 'local_transform',
        generationModel: 'horizontal_mirror',
      };
      onUpdateStoryboardItem(targetShot.id, currentItem => ({
        generatedImages: [...(currentItem.generatedImages || []), newImage],
        selectedImageId: newImage.id,
        generatedImage: saved.fileUrl,
      }));
      onForceSave();
      queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', targetShot.id] });
      notifyStoryboardImageChanged(episodeId, targetShot.id);
      setCameraModalImage(null);
      crmMessage.success('水平镜像已生成并保存为新画面');
    } catch (error) {
      console.error('Horizontal mirror failed', error);
      crmMessage.error('水平镜像处理失败，请稍后重试。');
    } finally {
      setIsHorizontalMirroring(false);
    }
  };


  const handleHumanMultiAngle = async (imageUrl: string, seed: number, gpu: GpuNodeSelection) => {
    if (!selectedShot) return;

    const creditParams = designOperationCreditParams('human_multi_angle');
    const registryMeta = buildRegistryMeta(selectedShot, 'human-multi-angle', '多角度人物');
    let generatedCount = 0;
    let backendTaskId = '';
    setIsHumanMultiAngleGenerating(true);
    try {
        await assertEnoughCredits(DESIGN_CREDIT_FEATURES.multiAngleGeneration, creditParams);


        const baseImage = await ensureDataUrl(imageUrl);


        console.log(`🔄 开始多角度生成任务（队列执行）`);
        const resultUrls = await generateHumanMultiAngleQueued(baseImage, seed, {
          entityType: 'storyboard_item',
          entityId: selectedShot?.id,
          fileRole: 'generated_image',
          projectId: registryMeta.targetProjectId,
          episodeId,
          preferredAgentId: gpu.preferredAgentId,
          preferredNodeId: gpu.preferredNodeId,
        }, registryMeta, taskId => { backendTaskId = taskId; });
        console.log(`✅ 多角度生成完成，共 ${resultUrls.length} 张图片:`, resultUrls);

        const newImages: GeneratedImage[] = (resultUrls as GeneratedImageResult[])
            .filter((r) => r.url)
            .map((r) => ({
                id: r.fileId || uuidv4(),
                url: r.url,
                thumbnail: r.url,
                timestamp: Date.now(),
                fileId: r.fileId || undefined,
            }));

        if (newImages.length === 0) {
            throw new Error('没有成功生成任何图片');
        }
        generatedCount = newImages.length;

        onUpdateStoryboardItem(selectedShot.id, {
            generatedImages: newImages,
            selectedImageId: newImages[0]?.id,
            generatedImage: newImages[0]?.url,
        });

        console.log('💾 多角度生成完成，触发立即保存');
        onForceSave();
        queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
        notifyStoryboardImageChanged(episodeId, selectedShot?.id);
        setHumanMultiAngleModalImage(null);

        try {
            const settlement = await consumeCredits({
                featureKey: DESIGN_CREDIT_FEATURES.multiAngleGeneration,
                taskId: backendTaskId
                    ? `storyboard-human-multi-angle:${backendTaskId}`
                    : newDesignCreditUsageId('storyboard-human-multi-angle'),
                params: creditParams,
                projectId: registryMeta.targetProjectId,
                metadata: {
                    episode_id: episodeId || null,
                    storyboard_item_id: selectedShot.id,
                    workflow: 'human_multi_angle',
                    output_count: generatedCount,
                    processing_node: gpu.name,
                },
            });
            crmMessage.success(`多角度人物生成完成，已扣除 ${settlement.charged_credits} 创作点数`);
        } catch (settlementError: any) {
            crmMessage.warning(`多角度图片已生成，但创作点数结算失败：${settlementError?.message || String(settlementError)}`);
        }
    } catch (error: any) {
        console.error('Human multi-angle generation failed', error);
        if (generatedCount === 0) {
            crmMessage.error(error?.message || '多角度人物生成失败，请稍后再试。');
        }
    } finally {
        setIsHumanMultiAngleGenerating(false);
    }
  };


  const handleAroundAngle = async (imageUrl: string, prompt: string, seed: number) => {
    if (!selectedShot) return;

    setIsAroundAngleGenerating(true);
    try {
        const baseImage = await ensureDataUrl(imageUrl);


        console.log(`🔄 开始全景角度生成任务（队列执行）`);
        const resultUrls = await generateAroundAngleQueued(baseImage, prompt, seed, {
          entityType: 'storyboard_item',
          entityId: selectedShot?.id,
          fileRole: 'generated_image',
          episodeId,
        }, buildRegistryMeta(selectedShot, 'around-angle', '全景角度'));
        console.log(`✅ 全景角度生成完成，共 ${resultUrls.length} 张图片`);

        const newImages: GeneratedImage[] = (resultUrls as GeneratedImageResult[])
            .filter((r) => r.url)
            .map((r) => ({
                id: r.fileId || uuidv4(),
                url: r.url,
                thumbnail: r.url,
                timestamp: Date.now(),
                fileId: r.fileId || undefined,
            }));

        if (newImages.length === 0) {
            throw new Error('没有成功生成任何图片');
        }

        onUpdateStoryboardItem(selectedShot.id, {
            generatedImages: newImages,
            selectedImageId: newImages[0]?.id,
            generatedImage: newImages[0]?.url,
        });

        console.log('💾 全景角度生成完成，触发立即保存');
        onForceSave();
        queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
        notifyStoryboardImageChanged(episodeId, selectedShot?.id);

        setAroundAngleModalImage(null);
    } catch (error: any) {
        console.error('Around angle generation failed', error);
        alert(error?.message || '全景角度生成失败，请稍后再试。');
    } finally {
        setIsAroundAngleGenerating(false);
    }
  };


  const handleMatting = async (mattingType: 'subject' | 'split', seed: number) => {
    if (!selectedShot || !mattingModalImage) return;

    setIsMattingProcessing(true);
    try {

        console.log(`🔄 将图片转换为 PNG 格式...`);
        const baseImage = await ensureDataUrlAsPng(mattingModalImage);

        console.log(`🔄 开始抠图任务（类型: ${mattingType}）`);
        const resultUrls = await generateMattingQueued(baseImage, mattingType, seed, {
          entityType: 'storyboard_item',
          entityId: selectedShot?.id,
          fileRole: 'generated_image',
          episodeId,
        }, buildRegistryMeta(selectedShot, 'matting', mattingType === 'subject' ? '抠图（主体）' : '抠图（分离）'));
        console.log(`✅ 抠图完成，返回 ${resultUrls.length} 张图片`);

        if (!resultUrls || resultUrls.length === 0) {
            throw new Error('抠图失败，没有返回结果');
        }

        const newImages: GeneratedImage[] = (resultUrls as GeneratedImageResult[])
            .filter((r) => r.url)
            .map((r) => ({
                id: r.fileId || uuidv4(),
                url: r.url,
                thumbnail: r.url,
                timestamp: Date.now(),
                fileId: r.fileId || undefined,
            }));

        console.log(`📸 创建了 ${newImages.length} 张新图片`);

        onUpdateStoryboardItem(selectedShot.id, {
            generatedImages: newImages,
            selectedImageId: newImages[0]?.id,
            generatedImage: newImages[0]?.url,
        });

        console.log('💾 抠图完成，触发保存');
        onForceSave();
        queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
        notifyStoryboardImageChanged(episodeId, selectedShot?.id);

        setMattingModalImage(null);
    } catch (error: any) {
        console.error('Matting failed', error);
        alert(error?.message || '抠图失败，请稍后再试。');
    } finally {
        setIsMattingProcessing(false);
    }
  };


  const handleImageFusion = async (
    fusionType: 'fusion' | 'transfer' | 'imitation' | 'direct',
    params: { imageBk: string; imageHu: string; imageMb?: string; compositeImage?: string; seed?: number }
  ) => {
    if (!selectedShot) return;

    setIsFusionProcessing(true);
    try {

        if (fusionType === 'direct') {
            console.log('🔄 直接拼合（前端已合成）');

            if (!params.compositeImage) {
                throw new Error('合成图片缺失');
            }

            const newImage: GeneratedImage = {
                id: uuidv4(),
                url: params.compositeImage,
                timestamp: Date.now()
            };

            onUpdateStoryboardItem(selectedShot.id, (currentItem) => ({
                generatedImages: [...(currentItem.generatedImages || []), newImage],
                selectedImageId: newImage.id,
                generatedImage: newImage.url
            }));

            console.log('✅ 直接拼合完成');
        } else if (fusionType === 'fusion') {

            console.log('🔄 开始图像融合（提交到处理节点）');

            if (!params.compositeImage) {
                throw new Error('合成图片缺失');
            }


            const compositeDataUrl = await ensureDataUrl(params.compositeImage);

            const resultUrl = await generateImageFusionQueued(
                compositeDataUrl,
                compositeDataUrl,
                'fusion',
                undefined,
                params.seed ?? -1,
                {
                  entityType: 'storyboard_item',
                  entityId: selectedShot?.id,
                  fileRole: 'generated_image',
                  episodeId,
                },
                buildRegistryMeta(selectedShot, 'image-fusion', '图像融合'),
            );

            if (!resultUrl) {
                throw new Error('融合失败，没有返回结果');
            }

            const newImage: GeneratedImage = {
                id: uuidv4(),
                url: resultUrl,
                thumbnail: resultUrl,
                timestamp: Date.now()
            };

            onUpdateStoryboardItem(selectedShot.id, (currentItem) => ({
                generatedImages: [...(currentItem.generatedImages || []), newImage],
                selectedImageId: newImage.id,
                generatedImage: newImage.url
            }));

            console.log('✅ 图像融合完成');
        } else {

            console.log(`🔄 开始${fusionType}（多图模式）`);

            const bkDataUrl = await ensureDataUrl(params.imageBk);
            const huDataUrl = await ensureDataUrl(params.imageHu);
            let mbDataUrl: string | undefined;
            if (params.imageMb) {
                mbDataUrl = await ensureDataUrl(params.imageMb);
            }

            const resultUrl = await generateImageFusionQueued(
                bkDataUrl,
                huDataUrl,
                fusionType as 'transfer' | 'imitation',
                mbDataUrl,
                params.seed ?? -1,
                {
                  entityType: 'storyboard_item',
                  entityId: selectedShot?.id,
                  fileRole: 'generated_image',
                  episodeId,
                },
                buildRegistryMeta(selectedShot, 'image-fusion', fusionType === 'transfer' ? '迁移学习' : '模仿学习'),
            );

            if (!resultUrl) {
                throw new Error('融合失败，没有返回结果');
            }

            const newImage: GeneratedImage = {
                id: uuidv4(),
                url: resultUrl,
                thumbnail: resultUrl,
                timestamp: Date.now()
            };

            onUpdateStoryboardItem(selectedShot.id, (currentItem) => ({
                generatedImages: [...(currentItem.generatedImages || []), newImage],
                selectedImageId: newImage.id,
                generatedImage: newImage.url
            }));

            console.log(`✅ ${fusionType}完成`);
        }

        onForceSave();
        queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
        notifyStoryboardImageChanged(episodeId, selectedShot?.id);
        setShowFusionModal(false);
    } catch (error: any) {
        console.error('Image fusion failed', error);
        alert(error?.message || '融合失败，请稍后再试。');
    } finally {
        setIsFusionProcessing(false);
    }
  };


  const handlePanorama360 = async (imageUrl: string, prompt: string, seed: number): Promise<string> => {
    const baseImage = await ensureDataUrl(imageUrl);
    const result = await generatePanorama360Queued(baseImage, prompt, seed, undefined, buildRegistryMeta(selectedShot, 'panorama-360', '360 全景'));
    return result;
  };

  const handlePanoramaFusion = async (
    image1: string,
    image3: string,
    prompt: string,
    image2?: string,
    seed?: number
  ): Promise<string> => {
    const img1 = await ensureDataUrl(image1);
    const img3 = await ensureDataUrl(image3);
    const img2 = image2 ? await ensureDataUrl(image2) : undefined;
    const result = await generatePanoramaFusionQueued(img1, img3, prompt, img2, seed ?? -1, undefined, buildRegistryMeta(selectedShot, 'panorama-fusion', '全景融合'));
    return result;
  };

  const handleAutoStoryboard = async (imageUrl: string, prompt: string, seed: number): Promise<string> => {
    if (!selectedShot) throw new Error('请先选择镜头');

    const baseImage = await ensureDataUrl(imageUrl);
    const result = await generateAutoStoryboardQueued(baseImage, prompt, seed, {
      entityType: 'storyboard_item',
      entityId: selectedShot?.id,
      fileRole: 'generated_image',
      episodeId,
    }, buildRegistryMeta(selectedShot, 'auto-storyboard', '自动分镜'));

    const newImage: GeneratedImage = {
        id: uuidv4(),
        url: result,
        thumbnail: result,
        timestamp: Date.now()
    };

    onUpdateStoryboardItem(selectedShot.id, (currentItem) => ({
        generatedImages: [...(currentItem.generatedImages || []), newImage],
        selectedImageId: newImage.id,
        generatedImage: newImage.url
    }));

    onForceSave();
    queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
    notifyStoryboardImageChanged(episodeId, selectedShot?.id);
    return result;
  };

  const handleMultiGridStoryboardSubmit = async (
    mode: 'multi_shot' | 'story',
    prompt: string,
    referenceImage: string
  ): Promise<{ images?: string[] }> => {
    const result = await generateMultiGridStoryboard(mode, prompt, referenceImage, {
      entityType: 'storyboard_item',
      entityId: selectedShot?.id,
      fileRole: 'generated_image',
      episodeId,
    });


    if (result.images && result.images.length > 0 && selectedShot) {
        const newImages: GeneratedImage[] = result.images
            .filter(url => url)
            .map(url => ({
                id: uuidv4(),
                url: url,
                thumbnail: url,
                timestamp: Date.now()
            }));

        if (newImages.length > 0) {
            onUpdateStoryboardItem(selectedShot.id, (currentItem) => ({
                generatedImages: [...(currentItem.generatedImages || []), ...newImages],
                selectedImageId: newImages[0].id,
                generatedImage: newImages[0].url
            }));
            onForceSave();
            queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
            notifyStoryboardImageChanged(episodeId, selectedShot?.id);
        }
    }

    return result;
  };


  const handleImageEditorSave = (editedImageUrl: string, referenceId: string) => {
    console.log('💾 保存编辑后的图片:', { referenceId, urlLength: editedImageUrl.length });
    updateCurrentShotReferences(prev => prev.map(ref =>
      ref.id === referenceId ? { ...ref, url: editedImageUrl } : ref
    ));
    setImageEditorData(null);
  };


  const handleAddSketch = (sketchImageUrl: string) => {
    if (references.length >= 6) {
      alert('参考图片已满（最多6张），请先删除一些再添加线稿');
      return;
    }
    console.log('🎨 添加线稿作为新参考图');
    const newRef: GenerationReference = {
      id: uuidv4(),
      url: sketchImageUrl,
      type: 'pose',
      name: '手绘线稿',
      source: 'manual',
    };
    updateCurrentShotReferences(prev => [...prev, newRef]);

  };

  const handleExport = () => {
      if (!selectedFile?.storyboard) {
          console.error('❌ 没有分镜数据');
          return;
      }

      console.log('🔍 开始导出流程...');
      console.log('   - 当前选中镜头数:', selectedShotIds.size);
      console.log('   - 总镜头数:', selectedFile.storyboard.items.length);





      let itemsToCheck = selectedShotIds.size > 0
          ? selectedFile.storyboard.items.filter(item => selectedShotIds.has(item.id))
          : [...selectedFile.storyboard.items];

      console.log('   - 待导出的镜头数:', itemsToCheck.length);

      const itemsToExport = itemsToCheck.map(item => {
          const selectedImg = (
              item.selectedImageId
                  ? item.generatedImages?.find(img => img.id === item.selectedImageId)
                  : undefined
          ) || item.generatedImages?.[0];

          console.log(`   📸 镜头 ${item.id}:`, {
              hasImages: !!item.generatedImages,
              imageCount: item.generatedImages?.length || 0,
              selectedImageId: item.selectedImageId,
              hasSelectedImg: !!selectedImg,
              isPlaceholder: !selectedImg,
          });

          return {
              shotId: item.id,
              script: item.scriptSegment,
              imagePrompt: item.imagePrompt,
              videoPrompt: item.videoPrompt,
              finalImage: selectedImg?.url || selectedImg?.thumbnail || null,
          };
      });

      console.log('   - 最终导出镜头数:', itemsToExport.length, '（含无图占位项）');

      if (!itemsToExport || itemsToExport.length === 0) {
          alert("还没有分镜数据可导出。\n\n请先生成分镜镜头（剧本 → 分镜），然后再导出到视频生成阶段。");
          return;
      }

      console.log(`📤 准备导出 ${itemsToExport.length} 个镜头到视频生成阶段`);
      console.log('📋 导出的镜头:', itemsToExport.map(i => ({ shotId: i.shotId, hasImage: !!i.finalImage })));

      onExportNext({ items: itemsToExport });
  };

  const handleSaveClick = () => {
    setVersionSaveError(null);
    setIsNamingVersion(true);
    const count = selectedFile?.versions?.length || 0;
    setVersionName(`画面分镜存档 v${count + 1} - ${new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute:'2-digit'})}`);
  };

  const submitVersionSave = async () => {
    if (!versionName.trim() || isSavingVersion) return;
    setIsSavingVersion(true);
    setVersionSaveError(null);
    try {
      await onSaveVersion(versionName.trim());
      setIsNamingVersion(false);
      setShowHistory(true);
    } catch (error) {
      setVersionSaveError(error instanceof Error ? error.message : '存档保存失败，请稍后重试');
    } finally {
      setIsSavingVersion(false);
    }
  };

  const categories: { type: ReferenceType; label: string; icon: any }[] = [
      { type: 'character', label: '角色', icon: Users },
      { type: 'scene', label: '场景', icon: MapPin },
      { type: 'pose', label: '姿态', icon: User },
      { type: 'prop', label: '道具', icon: Box },
      { type: 'effect', label: '特效', icon: Zap },
  ];


  const currentGeneratedImages = [
      ...(selectedShot?.generatedImages || []),
      ...(selectedShot?.generatedImage && !(selectedShot?.generatedImages?.length)
          ? [{ id: 'legacy', url: selectedShot.generatedImage, thumbnail: selectedShot.generatedImage, timestamp: 0 }]
          : [])
  ].filter(img => img.url || img.thumbnail);
  const effectiveSelectedId = selectedShot?.selectedImageId;

  if (selectedShotId) {
    console.log(`🖼️ [GenerationPage render] shotId=${selectedShotId}, generatedImages=${selectedShot?.generatedImages?.length || 0}, currentGeneratedImages=${currentGeneratedImages.length}`);
  }

  return (
      <div className="workflow-stage-layout layout-safe flex-1 flex h-full w-full bg-n20 overflow-hidden relative">

          {/* Header Bar */}
          <div className="workflow-stage-toolbar storyboard-generation-toolbar absolute left-0 right-0 top-0 z-20 flex h-[52px] items-center border-b border-n40 bg-n0">
              <div
                  data-testid="storyboard-shot-list-title-row"
                  style={{ width: sidebarWidth }}
                  className="flex h-full flex-shrink-0 items-center gap-2 border-r border-n40 px-3"
              >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-n800">画面分镜列表</h2>
                    <span className="whitespace-nowrap font-mono text-xs text-n100">({storyboardTotalCount})</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={toggleSelectAll}
                        disabled={isLoadingAllShotsForSelection}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-n40 bg-n0 px-2 text-[10px] text-n300 transition-colors hover:bg-n20 hover:text-n800 disabled:cursor-wait disabled:opacity-50"
                      >
                         {isLoadingAllShotsForSelection ? <CircleDashed className="w-4 h-4 animate-spin" /> : allStoryboardItemsSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                         {isLoadingAllShotsForSelection ? '加载全部...' : '全选'}
                      </button>
                      <span className="whitespace-nowrap text-[10px] text-n100">
                          已选 {selectedShotIds.size}
                      </span>
                  </div>
              </div>

              <div className="flex min-w-0 flex-1 items-center justify-end gap-3 px-4">
                  {onAssetScopeModeChange && (
                    <div className="flex items-center gap-1 p-0.5 rounded-md border border-n40 bg-n20" title="素材引用范围">
                      <button
                        type="button"
                        onClick={() => onAssetScopeModeChange('episode')}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                          assetScopeMode === 'episode'
                            ? 'bg-primary text-white'
                            : 'text-n300 hover:text-n800 hover:bg-n0'
                        }`}
                      >
                        <ImageIcon className="w-3 h-3" />
                        本集素材
                      </button>
                      <button
                        type="button"
                        onClick={() => onAssetScopeModeChange('project')}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                          assetScopeMode === 'project'
                            ? 'bg-primary text-white'
                            : 'text-n300 hover:text-n800 hover:bg-n0'
                        }`}
                      >
                        <Layers className="w-3 h-3" />
                        全部素材
                      </button>
                    </div>
                  )}
                  {onBatchDeleteStoryboardItems && selectedShotIds.size > 0 && !batchProgress && (
                      <button
                          onClick={async () => {
                              const ids = Array.from(selectedShotIds);
                              await onBatchDeleteStoryboardItems(ids);
                              setSelectedShotIds(new Set());
                          }}
                          disabled={isGenerating}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-n0 hover:bg-r50 text-danger border border-danger/30 rounded text-xs font-bold transition-colors disabled:opacity-50"
                          title="删除选中的镜头"
                      >
                          <Trash2 className="w-3.5 h-3.5" /> 删除选中 ({selectedShotIds.size})
                      </button>
                  )}
                  {batchProgress ? (
                      <div className="min-w-56 bg-primary-light px-3 py-1.5 rounded text-xs text-primary border border-primary/20">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                           <CircleDashed className="w-3.5 h-3.5 animate-spin" />
                           <span>批量生成中 {batchProgress.current}/{batchProgress.total}</span>
                          </div>
                          <span className="font-mono font-bold">{batchProgressDisplay?.aggregatePercent || 0}%</span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-primary/15">
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-500"
                            style={{ width: `${batchProgressDisplay?.aggregatePercent || 0}%` }}
                          />
                        </div>
                        <div className="mt-1 whitespace-nowrap text-[9px] text-primary/80">
                          {batchProgressDisplay?.active?.stage || '等待下一个镜头'}
                          {batchProgressDisplay ? ` · ${formatStoryboardGenerationEta(batchProgressDisplay.etaSeconds)}` : ''}
                        </div>
                      </div>
                  ) : (
                      <button
                          onClick={handleBatchGenerate}
                          disabled={isGenerating || selectedShotIds.size === 0}
                          className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                      >
                          <Play className="w-3.5 h-3.5" />
                          批量生成 ({selectedShotIds.size})
                      </button>
                  )}

                  <div className="h-6 w-px bg-n40 mx-1"></div>

                  {/* Fixed Top-Right Buttons */}
                  <button
                        onClick={handleSaveClick}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-n700 hover:text-n800 bg-n0 hover:bg-n20 rounded border border-n40 transition-colors"
                    >
                        <Save className="w-3.5 h-3.5" />
                        <span>存档</span>
                    </button>

                    <button
                        onClick={() => setShowHistory(!showHistory)}
                        className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                        showHistory
                            ? 'bg-primary text-white border-primary'
                            : 'bg-n0 text-n700 hover:text-n800 hover:bg-n20 border-n40'
                        }`}
                    >
                        <History className="w-3.5 h-3.5" />
                        <span>历史</span>
                    </button>

                    <button
                        onClick={() => {
                            const pid = (() => { try { return localStorage.getItem('current_project_id') || ''; } catch { return ''; } })();
                            if (pid && episodeId) navigate(`/projects/${pid}/ep/${episodeId}/workflow/final`);
                            else navigate('final');
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-n700 hover:text-n800 bg-n0 hover:bg-n20 rounded border border-n40 transition-colors"
                        title="去成品页合成完整成片"
                    >
                        <Clapperboard className="w-3.5 h-3.5" />
                        <span>导出到成品</span>
                    </button>

                    <button
                        onClick={handleExport}
                        className="flex items-center gap-1 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded text-xs font-semibold shadow-card ml-2"
                    >
                        一键导出选定
                        <ArrowRight className="w-3.5 h-3.5" />
                    </button>
              </div>
          </div>

          {/* Resizable Sidebar: Shot List */}
          <div
             style={{ width: sidebarWidth }}
             className="workflow-stage-sidebar pt-[52px] border-r border-n40 bg-n0 flex flex-col z-10 flex-shrink-0 relative"
          >
               <div className="workflow-stage-scroll flex-1 overflow-y-auto custom-scrollbar pb-2">
                   {hasStoryboard && visibleStoryboardItems.map((item, index) => {
                       const segmentInfo = storyboardSegmentLookup.get(item.id);
                       const shotLabel = segmentInfo?.localShotLabel || `镜头${String(index + 1).padStart(2, '0')}`;
                       const isSelected = item.id === selectedShotId;
                       const hasImage = (item.generatedImages && item.generatedImages.length > 0) || !!item.generatedImage;
                       const isChecked = selectedShotIds.has(item.id);
                       const isShotGenerating = generatingShotIds.has(item.id);
                       const shotProgress = generationProgressByShot[item.id];


                       const selectedImg = item.selectedImageId
                            ? item.generatedImages?.find(img => img.id === item.selectedImageId)
                            : item.generatedImages?.[0];

                       const rawThumb = selectedImg?.thumbnail || selectedImg?.url || item.generatedImage;
                       const thumb = rawThumb ? getImageThumbnailUrl(rawThumb, 144, 96) : undefined;

                       return (
                           <div
                               key={item.id}
                               data-testid="storyboard-shot-card"
                               data-storyboard-shot-id={item.id}
                               ref={(element) => {
                                   if (element) shotCardRefs.current.set(item.id, element);
                                   else shotCardRefs.current.delete(item.id);
                               }}
                               onClick={() => {
                                   setSelectedShotId(item.id);
                               }}
                               onDragOver={(e) => handleShotImageDragOver(e, item.id)}
                               onDragLeave={(e) => handleShotImageDragLeave(e, item.id)}
                               onDrop={(e) => void handleShotImageDrop(e, item)}
                               className={`group relative flex min-h-[112px] cursor-pointer flex-col justify-center border-b border-l-[3px] border-n40 px-4 py-4 transition-colors duration-150 ${
                                   imageDropTargetShotId === item.id
                                   ? 'border-l-success bg-success/10'
                                   : isSelected
                                     ? 'border-l-primary bg-primary-light'
                                     : 'border-l-transparent bg-n0 hover:bg-n20'
                               }`}
                           >
                               <div className="flex min-h-7 w-full min-w-0 items-center gap-1.5">
                                 <button
                                      type="button"
                                      onClick={(e) => toggleShotSelection(e, item.id)}
                                      className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-transparent text-n100 transition-colors hover:border-n40 hover:bg-n30 hover:text-n800"
                                      aria-label={`选择${shotLabel}`}
                                 >
                                     {isChecked ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                                 </button>
                                 <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                   {segmentInfo?.isFirstInSegment && (
                                     <span className="inline-flex shrink-0 items-baseline gap-1 rounded border border-warning/30 bg-y50 px-1.5 py-0.5 text-[9px] font-semibold text-n500">
                                       分段 <span className="font-mono text-warning">{String(segmentInfo.segmentNo).padStart(2, '0')}</span>
                                     </span>
                                   )}
                                   <span className={`min-w-0 truncate text-sm font-semibold ${isSelected ? 'text-n800' : 'text-n700 group-hover:text-n800'}`}>
                                     {shotLabel}
                                   </span>
                                 </div>
                                 <div className="flex shrink-0 items-center gap-1">
                                   {isStoryboardConfigLocked(item) && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                                   {onDeleteStoryboardItem && (
                                     <button
                                         type="button"
                                         onClick={(e) => { e.stopPropagation(); onDeleteStoryboardItem(item.id); }}
                                         className="inline-flex h-7 w-7 items-center justify-center rounded-md text-n100 opacity-0 transition-all hover:bg-r50 hover:text-danger group-hover:opacity-100"
                                         title="删除此镜头"
                                     >
                                         <Trash2 className="h-3.5 w-3.5" />
                                     </button>
                                   )}
                                 </div>
                               </div>

                               <div className="mt-3 flex min-w-0 gap-3 pl-[34px] pr-1">
                               <div className="relative h-10 w-12 flex-shrink-0 overflow-hidden rounded border border-n40 bg-n30">
                                   {thumb ? (
                                       <img
                                           src={thumb}
                                           loading="lazy"
                                           decoding="async"
                                           alt=""
                                           className="w-full h-full object-cover"
                                       />
                                   ) : (
                                       <div className="w-full h-full flex items-center justify-center">
                                           <ImageIcon className="w-3 h-3 text-n100" />
                                       </div>
                                   )}
                                   {isShotGenerating && (
                                       <div className="absolute inset-0 bg-n900/60 flex flex-col items-center justify-center text-white">
                                           <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                           <span className="mt-0.5 text-[8px] font-mono">{shotProgress?.percent || 0}%</span>
                                       </div>
                                   )}
                                   {copyingImageToShotId === item.id && (
                                       <div className="absolute inset-0 bg-n900/55 flex items-center justify-center text-white">
                                           <CircleDashed className="w-4 h-4 animate-spin" />
                                       </div>
                                   )}
                               </div>
                               <div className="flex-1 min-w-0">
                                    <p className="line-clamp-2 min-h-10 text-xs leading-5 text-n100">{item.scriptSegment || '暂无分镜内容'}</p>
                                    {isShotGenerating && (
                                      <div className="mt-1">
                                        <div className="flex items-center justify-between gap-1 text-[8px]">
                                          <span className="truncate text-primary">
                                            {shotProgress?.stage || '等待批量队列'}
                                          </span>
                                          <span className="shrink-0 font-mono text-primary">{shotProgress?.percent || 0}%</span>
                                        </div>
                                        <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-primary/15">
                                          <div
                                            className="h-full rounded-full bg-primary transition-[width] duration-500"
                                            style={{ width: `${shotProgress?.percent || 0}%` }}
                                          />
                                        </div>
                                        {shotProgress && (
                                          <p className="mt-0.5 whitespace-nowrap text-[8px] text-n300">
                                            {shotProgress.mode === 'live' ? '实时进度' : '预计进度'}
                                            {' · '}
                                            {formatStoryboardGenerationEta(shotProgress.etaSeconds)}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                </div>
                                </div>
                            </div>
                       );
                   })}

                   {hasStoryboard && storyboardTotalCount > visibleShotCount && (
                       <button
                           onClick={() => setVisibleShotCount(c => c + SHOT_PAGE_SIZE)}
                           className="mx-2 mt-2 w-[calc(100%_-_1rem)] rounded-md border border-primary/20 bg-primary-light/50 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary-light"
                       >
                           展开更多（还有 {storyboardTotalCount - visibleShotCount} 个镜头）
                       </button>
                   )}
                   {hasStoryboard && visibleShotCount > SHOT_PAGE_SIZE && (
                       <button
                           onClick={() => setVisibleShotCount(SHOT_PAGE_SIZE)}
                           className="mx-2 mt-1 w-[calc(100%_-_1rem)] rounded-md py-1.5 text-[11px] text-n300 transition-colors hover:bg-n20 hover:text-n800"
                       >
                           收起（只看前 {SHOT_PAGE_SIZE} 个）
                       </button>
                   )}
               </div>
               {/* Drag Handle */}
               <div
                    className="absolute top-0 right-0 bottom-0 w-1 bg-transparent hover:bg-primary-hover/50 cursor-col-resize z-50 transition-colors"
                    onMouseDown={startResizing}
                >
                    <div className="absolute top-1/2 -translate-y-1/2 right-0.5">
                        <GripVertical className="w-3 h-3 text-n100 opacity-0 hover:opacity-100" />
                    </div>
                </div>
          </div>

          {/* Main Content */}
          <div className="workflow-stage-canvas storyboard-generation-main min-h-0 flex-1 flex overflow-hidden pt-[52px]">

            {/* Configuration Column */}
            <div className="storyboard-config-pane min-h-0 flex flex-col border-r border-n40 bg-n0 px-6 pt-6 pb-24 overflow-y-auto custom-scrollbar">
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                      <h3 className="text-sm font-bold text-n700 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" />
                      画面分镜配置
                      </h3>
                      <div className="ml-auto flex min-w-0 items-center gap-2 text-[10px] text-n300">
                        <span className="shrink-0">默认模型</span>
                        <ModelPicker<StoryboardGenerationModel>
                          value={globalModel}
                          options={storyboardModelPickerOptions}
                          onChange={setGlobalModel}
                          disabled={isGenerating}
                          compact
                          className="max-w-[220px]"
                          ariaLabel="默认生成模型"
                          title="默认生成模型"
                          kind="image"
                        />
                      </div>
                      <button
                        onClick={handleConfirmConfig}
                        disabled={!selectedShot || isGenerating}
                        aria-pressed={selectedConfigLocked}
                        className={`text-[10px] flex items-center gap-1 px-2 py-1 rounded border transition-colors ${
                          selectedConfigLocked
                            ? 'bg-g50 text-success border-g75'
                            : 'bg-n0 text-n300 border-n40 hover:text-n800'
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                          <CheckCircle2 className="w-3 h-3" />
                        {selectedConfigLocked ? '解除配置锁定' : '确认并锁定配置'}
                      </button>
                  </div>

                {/* Model Selection */}
                <div className="mb-6 p-4 bg-n20 border border-n40 rounded-md">
                    <div className="flex items-center gap-2 mb-3">
                        <Zap className="w-3.5 h-3.5 text-yellow-400" />
                        <span className="text-xs font-bold text-n700">当前镜头生成模型</span>
                    </div>
                    <ModelPicker<GenerationModel | ''>
                        value={selectedShotModelOverride || ''}
                        options={shotModelPickerOptions}
                        onChange={(nextModel) => {
                          if (!selectedShot || selectedConfigLocked) return;
                          setShotModels(previous => {
                            if (!nextModel) {
                              const next = { ...previous };
                              delete next[selectedShot.id];
                              return next;
                            }
                            return {
                              ...previous,
                              [selectedShot.id]: nextModel as GenerationModel,
                            };
                          });
                        }}
                        disabled={!selectedShot || selectedConfigLocked || isGenerating}
                        fullWidth
                        ariaLabel="当前镜头生成模型"
                        title="当前镜头生成模型"
                        kind="image"
                    />
                    <div className="mt-2 rounded bg-n0 px-3 py-2 text-[10px] leading-4 text-n300">
                        <strong className="mr-1 text-n700">{selectedGenerationModelOption.shortLabel}</strong>
                        {selectedGenerationModelOption.hint}
                        {!selectedShotModelOverride && <span className="ml-1 text-primary">· 跟随默认</span>}
                    </div>

                    {isSeedreamStoryboardModel(selectedGenerationModel) && (
                      <div className="mt-2 rounded border border-primary/20 bg-primary-light p-3 text-[11px] leading-5">
                        <label className="flex items-center gap-2 font-medium text-primary">
                          <input type="checkbox" checked={seedancePortrait}
                            onChange={event => setSeedancePortrait(event.target.checked)}
                            aria-describedby="seedance-portrait-help"
                            disabled={isGenerating || selectedConfigLocked || imageGenerationCapabilities?.seedance_portrait.available === false} />
                          为 Seedance 真人写实视频准备原图
                        </label>
                        <p id="seedance-portrait-help" className="mt-1 text-n500">
                          适用于真人写实效果的人像视频。只按文字生成分镜，不使用参考图。
                        </p>
                        <p className="mt-1 text-n500">
                          人物可能与参考图不同；仍需平台审核。
                        </p>
                        {imageGenerationCapabilities?.seedance_portrait.available === false && (
                          <p role="status" className="mt-1 text-warning">
                            {imageGenerationCapabilities.seedance_portrait.reason}
                          </p>
                        )}
                        {(isGenerating || selectedConfigLocked) && (
                          <p role="status" className="mt-1 text-warning">
                            {isGenerating ? '正在生成，结束后可修改此选项。' : '配置已锁定，请先点击上方“解除配置锁定”。'}
                          </p>
                        )}
                        <details className="mt-1 text-n300">
                          <summary className="cursor-pointer text-primary">适用范围与注意事项</summary>
                          <p>此选项不会自动切换画风；需要真人写实效果时，请在画面提示词中明确描述。</p>
                          <p>对本集所有 Seedream 镜头生效（含批量）。关闭后恢复普通生图方式。</p>
                          <p>开启后请重新生成分镜；已有图片和素材绑定不会改变。</p>
                          <p>请使用生成的原图，不要裁切、压缩或修改。本系统会校验同一官方 API Key、30 天有效期和文件完整性；通过校验不代表免审核。</p>
                        </details>
                      </div>
                    )}

                    {COMFYUI_MODELS.has(selectedGenerationModel) && (
                        <div className={`mt-2 rounded border px-2 py-2 text-[10px] leading-relaxed ${
                            usableClusterNodes.length > 0
                                ? 'bg-g50 text-g400 border-g200'
                                : 'bg-y50 text-y400 border-y200'
                        }`}>
                            <div className="flex items-start justify-between gap-2">
                                <span>
                                    {usableClusterNodes.length > 0
                                        ? <>此选项使用 <b>处理集群</b> 的本地节点模型，默认使用处理节点1，可手动切换，节点资源有限可能需要排队。</>
                                        : <>此选项使用 <b>处理集群</b> 的本地节点模型。当前未检测到在线处理节点，请稍后重试或联系管理员。</>}
                                </span>
                                <button
                                    type="button"
                                    onClick={loadClusterNodeOptions}
                                    disabled={clusterNodesLoading}
                                    className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-current/20 bg-n0/70 hover:bg-n0 disabled:opacity-60"
                                    title="刷新处理集群节点"
                                >
                                    <RefreshCw className={`w-3 h-3 ${clusterNodesLoading ? 'animate-spin' : ''}`} />
                                    刷新
                                </button>
                            </div>
                            <div className="mt-2 grid grid-cols-[48px,1fr] items-center gap-2">
                                <span className="text-n300">处理节点</span>
                                <select
                                    value={selectedClusterNodeId}
                                    onChange={(e) => {
                                        setSelectedClusterNodeId(e.target.value);
                                        setPreferredGpuNodeId(e.target.value);
                                    }}
                                    disabled={clusterNodesLoading || clusterNodes.length === 0 || isGenerating}
                                    className="w-full px-2 py-1 text-[10px] bg-n0 border border-n40 rounded text-n700 focus:border-primary focus:outline-none disabled:bg-n20 disabled:text-n100"
                                >
                                    {clusterNodes.length === 0 && (
                                        <option value={DEFAULT_GPU_NODE_NAME}>{formatProcessingNodeName(DEFAULT_GPU_NODE_NAME)} · offline</option>
                                    )}
                                    {clusterNodes.map((node) => (
                                        <option key={node.id} value={clusterNodePreferenceId(node)}>
                                            {node.name} · {node.status}{formatClusterNodeQueue(node) ? ` · ${formatClusterNodeQueue(node)}` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="mt-1 text-[9px] text-n300">
                                当前指定：{selectedClusterNode?.name || selectedClusterNodeId}
                                {selectedClusterNode && !isClusterNodeUsable(selectedClusterNode) ? '（离线，提交时自动回退）' : ''}
                                {clusterNodeMessage ? ` · ${clusterNodeMessage}` : ''}
                            </div>
                        </div>
                    )}
                    <p className="mt-2 text-[9px] text-n100">
                      顶部设置全局默认模型；当前镜头可以跟随默认，也可在此单独覆盖。在线 API 模型排在前面，本地节点模型排在后面并依赖处理集群可用节点。
                    </p>

                    <div className="mt-3 pt-3 border-t border-n40">
                        <div className="text-[9px] text-n100 mb-2 flex items-center gap-1">
                          <span className="text-primary">●</span>
                          当前镜头输出参数
                          <span className="text-n100 ml-1">· 项目默认 {defaultImageRatio} / 1K</span>
                        </div>
                        <div className={`grid ${selectedGenerationModel === 'gpt_image_official' ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                          <div>
                            <label className="text-[9px] text-n100 block mb-1">画面比例</label>
                            <select
                              value={imageRatio}
                              onChange={(e) => setImageRatio(e.target.value as GptImageRatio)}
                              disabled={selectedConfigLocked || isGenerating}
                              className="w-full px-2 py-1 text-[10px] bg-n0 border border-n40 rounded text-n700 focus:border-primary focus:outline-none"
                            >
                              {GPT_IMAGE_RATIO_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] text-n100 block mb-1">分辨率</label>
                            <select
                              value={imageK}
                              onChange={(e) => setImageK(e.target.value as GptImageK)}
                              disabled={selectedConfigLocked || isGenerating}
                              className="w-full px-2 py-1 text-[10px] bg-n0 border border-n40 rounded text-n700 focus:border-primary focus:outline-none"
                            >
                              {GPT_IMAGE_K_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          {selectedGenerationModel === 'gpt_image_official' && (
                            <div>
                              <label className="text-[9px] text-n100 block mb-1">质量</label>
                              <select
                                value={imageQuality}
                                onChange={(e) => setImageQuality(e.target.value as GptImageQuality)}
                                disabled={selectedConfigLocked || isGenerating}
                                className="w-full px-2 py-1 text-[10px] bg-n0 border border-n40 rounded text-n700 focus:border-rose-500 focus:outline-none"
                              >
                                {GPT_IMAGE_QUALITY_OPTIONS.map(o => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                        <div className="mt-2 rounded border border-n40 bg-n10 px-2 py-1.5 text-[9px] leading-4 text-n300">
                          实际输出：{selectedImageSettings.ratio} · {selectedImageSettings.k}
                          {isLoadingReferenceDimensions
                            ? ' · 正在读取参考素材尺寸'
                            : selectedImageSettings.sourceDimensions
                              ? ` · 最大参考图 ${selectedImageSettings.sourceDimensions.width}×${selectedImageSettings.sourceDimensions.height}`
                              : ' · 无可用尺寸时使用标准 16:9 / 1K'}
                          {(imageRatio === 'auto' || imageK === 'auto') && ' · 按最大参考图和尺寸自动决定档位'}
                        </div>
                      </div>
                  </div>

                  {/* Prompt */}
                  <div className="mb-6">
                      <label className="text-xs font-bold text-n300 mb-2 block">画面提示词 (Image Prompt)</label>
                      <textarea
                          value={prompt}
                          onChange={(e) => {
                            setPrompt(e.target.value);
                            userEditedPromptRef.current = true;
                          }}
                          onBlur={(e) => {

                            if (selectedShot && userEditedPromptRef.current) {
                              console.log('💾 同步prompt到storyboard:', e.target.value.substring(0, 50) + '...');
                              onUpdateStoryboardItem(selectedShot.id, {
                                imagePrompt: e.target.value
                              });
                            }
                          }}
                        disabled={selectedConfigLocked}
                        className={`w-full h-32 bg-n0 border border-n40 rounded-lg p-3 text-xs text-n700 focus:border-primary focus:outline-none resize-none leading-relaxed ${selectedConfigLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                      />
                  </div>

                  {/* Reference Images */}
                  <div
                      className={`mb-6 transition-all ${isDraggingRef ? 'ring-2 ring-primary ring-inset rounded-lg bg-primary-light' : ''}`}
                      onDragOver={handleRefDragOver}
                      onDragLeave={handleRefDragLeave}
                      onDrop={handleRefDrop}
                  >
                      <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <label className="block text-xs font-bold text-n300">
                                {selectedPortraitMode ? '已保留参考素材（纯文生图不提交图片）' : `实际提交参考图片 (${referencePlan.references.length}/${referencePlan.maxReferences})`}
                            </label>
                            <div className="mt-1 text-[11px] font-normal text-n100">可拖拽图片到此</div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              onClick={() => { setMaterialPickerFilter('shot'); setShowMaterialPicker(true); }}
                              disabled={references.length >= 6}
                              className="inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded border border-primary bg-primary px-3 py-2 text-xs text-white hover:bg-primary-hover disabled:opacity-50"
                            >
                                <Library className="w-3 h-3" />
                                项目素材
                            </button>
                            <button
                              onClick={handleAutoFill}
                              className="inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded border border-primary/30 bg-primary-light px-3 py-2 text-xs text-primary hover:bg-primary-light disabled:opacity-50"
                            >
                                <Wand2 className="w-3 h-3" />
                                自动绑定
                            </button>
                          </div>
                      </div>

                      {referencePlan.excluded.length > 0 && (
                        <div className="mb-3 rounded border border-warning/40 bg-warning/5 px-3 py-2 text-[10px] leading-relaxed text-warning">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <div>
                              <div className="font-semibold">{referencePlan.excluded.length} 张参考图未提交</div>
                              <div className="mt-1 text-current/80">
                                未提交：{referencePlan.excluded.map(item => `${item.reference.type === 'character' ? '角色' : item.reference.type === 'scene' ? '场景' : item.reference.type === 'prop' ? '道具' : '补充'}「${item.reference.name || '未命名'}」`).join('、')}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Reference Grid */}
                      <div className="grid grid-cols-3 gap-2 mb-4">
                          {references.map((ref) => (
                              <div
                                key={ref.id}
                              className="relative group aspect-square bg-n30 rounded-lg border border-n40 overflow-hidden"
                              >
                                <img
                                  src={ref.url}
                                  loading="lazy"
                                  decoding="async"
                                  alt=""
                                  className="w-full h-full object-cover cursor-pointer"
                                  onClick={() => setImageEditorData({ imageUrl: ref.url, referenceId: ref.id })}
                                />

                                {/* Action Buttons */}
                                <div
                                  className="pointer-events-none absolute right-1 top-1 z-10 grid grid-cols-2 gap-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
                                  data-testid="reference-image-actions"
                                >
                                      <button
                                          onClick={(e) => { e.stopPropagation(); setImageEditorData({ imageUrl: ref.url, referenceId: ref.id }); }}
                                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white hover:bg-primary-hover"
                                          title="编辑图片"
                                      >
                                          <Pencil className="w-3 h-3" />
                                      </button>
                                      <button
                                          onClick={(e) => { e.stopPropagation(); setCameraModalImage(ref.url); }}
                                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white hover:bg-primary-hover"
                                          title="角度调整"
                                      >
                                          <Camera className="w-3 h-3" />
                                      </button>
                                      <button
                                          onClick={(e) => { e.stopPropagation(); setAroundAngleModalImage(ref.url); }}
                                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/80 text-white hover:bg-cyan-600"
                                          title="全景角度生成"
                                      >
                                          <RotateCcw className="w-3 h-3" />
                                      </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteReference(ref);
                                            }}
                                            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-n900/50 text-white hover:bg-danger"
                                            title="从当前镜头删除参考图片"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                </div>

                                  <div className="absolute top-1 left-1 pointer-events-none">
                                      {ref.type === 'character' && <Users className="w-3 h-3 text-primary drop-shadow-md" />}
                                      {ref.type === 'scene' && <MapPin className="w-3 h-3 text-orange-400 drop-shadow-md" />}
                                      {ref.type === 'pose' && <User className="w-3 h-3 text-blue-400 drop-shadow-md" />}
                                      {ref.type === 'prop' && <Box className="w-3 h-3 text-yellow-400 drop-shadow-md" />}
                                      {ref.type === 'effect' && <Zap className="w-3 h-3 text-primary drop-shadow-md" />}
                                  </div>
                                  <div className="absolute bottom-1 left-1 right-1 pointer-events-none">
                                    <span className="max-w-full truncate rounded bg-n900/60 px-1.5 py-0.5 text-[9px] text-white">{ref.name || '参考图'}</span>
                                  </div>
                              </div>
                          ))}


                          {Array.from({ length: Math.max(0, 6 - references.length) }).map((_, i) => (
                              <div
                                  key={i}
                                  onClick={() => {
                                      setMaterialPickerFilter('shot');
                                      setShowMaterialPicker(true);
                                   }}
                                  className="aspect-square rounded-lg border border-dashed flex flex-col items-center justify-center text-xs bg-n30 border-n40 text-n100 hover:bg-n20 hover:border-n40 hover:text-n300 cursor-pointer transition-all"
                              >
                                   <Library className="w-4 h-4 mb-1 opacity-50" />
                                   <span>{i + 1 + references.length}</span>
                               </div>
                           ))}
                       </div>

                       {/* External references are a secondary supplement after project materials. */}
                       <div className="space-y-2 border-t border-n40 pt-3">
                           <div className="flex items-center gap-2 text-[10px] text-n100">
                             <Upload className="w-3 h-3" />
                             外部参考（可选补充）
                           </div>
                           <div className="flex flex-wrap gap-2">
                              {categories.map((cat) => (
                                  <label
                                    key={cat.type}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-[10px] cursor-pointer transition-colors ${references.length >= 6 ? 'opacity-50 cursor-not-allowed bg-n0 border-n40 text-n100' : 'bg-n0 hover:bg-n20 border-n40 text-n700 hover:text-n800'}`}
                                  >
                                      <cat.icon className="w-3 h-3" />
                                      上传{cat.label}
                                      <input
                                        type="file"
                                        className="hidden"
                                        accept="image/*"
                                      disabled={references.length >= 6}
                                        onChange={(e) => handleFileUpload(e, cat.type)}
                                      />
                                  </label>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>

            {/* Results Column */}
            <div
                className={`storyboard-results-pane flex-1 flex flex-col bg-n20 relative overflow-hidden transition-all ${isDraggingResult ? 'ring-2 ring-emerald-500 ring-inset bg-emerald-500/5' : ''}`}
                onDragOver={handleResultDragOver}
                onDragLeave={handleResultDragLeave}
                onDrop={handleResultDrop}
            >
                   <div className="flex-1 overflow-y-auto p-6 custom-scrollbar pb-20">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-bold text-n700 flex items-center gap-2">
                                <ImageIcon className="w-4 h-4 text-success" />
                              画面分镜结果
                              <span className="font-normal text-n100 text-xs">可拖拽图片到此</span>
                            </h3>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowStoryboardToolModal(true)}
                                    disabled={!selectedShot}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-primary-light hover:bg-primary-light border border-primary hover:border-primary rounded-lg text-xs font-medium text-primary hover:text-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="分镜工具（全景融合/自动分镜/多宫格）"
                                >
                                    <Grid3X3 className="w-3.5 h-3.5" />
                                    分镜工具
                                </button>
                            </div>
                            <input
                                type="file"
                                id="upload-result-image"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={async (e) => {
                                    const fileList = e.target.files;
                                    if (!fileList || fileList.length === 0 || !selectedShot) return;
                                    const { uploadEntityFile } = await import('../services/entityFileService');

                                    for (const file of Array.from(fileList)) {
                                        try {
                                            const saved = await uploadEntityFile(
                                                file, 'storyboard_item', selectedShot.id,
                                                'generated_image', episodeId
                                            );
                                            const newImage: GeneratedImage = {
                                                id: saved.fileId || uuidv4(),
                                                url: saved.fileUrl,
                                                thumbnail: saved.fileUrl,
                                                timestamp: Date.now(),
                                                fileId: saved.fileId || undefined,
                                                source: 'upload',
                                            };
                                            onUpdateStoryboardItem(selectedShot.id, {
                                                generatedImages: [newImage],
                                                selectedImageId: newImage.id,
                                                generatedImage: saved.fileUrl,
                                            });
                                            queryClient.invalidateQueries({ queryKey: ['entityFiles', 'storyboard_item', selectedShot?.id] });
                                            notifyStoryboardImageChanged(episodeId, selectedShot?.id);
                                        } catch (err) {
                                            console.error('上传图片失败:', err);
                                        }
                                    }
                                    e.target.value = '';
                                }}
                            />
                            <button
                                onClick={() => document.getElementById('upload-result-image')?.click()}
                                disabled={!selectedShot}
                                className="flex items-center gap-2 px-3 py-1.5 bg-n0 hover:bg-n20 border border-n40 hover:border-emerald-500 rounded-lg text-xs font-medium text-n700 hover:text-success transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                title="从本地上传图片"
                            >
                                <Upload className="w-3.5 h-3.5" />
                                上传图片
                            </button>
                        </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {currentGeneratedImages.map((img) => (
                                <div
                                    key={img.id}
                                    draggable
                                    onDragStart={(e) => handleResultImageDragStart(e, img)}
                                    onDragEnd={() => setImageDropTargetShotId(null)}
                                  className={`relative group bg-n0 border rounded-md overflow-hidden shadow-lg transition-all cursor-grab active:cursor-grabbing ${effectiveSelectedId === img.id ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-n40'}`}
                                    onClick={() => handleSelectResult(img.id)}
                                    title="拖到左侧其他镜头可复制为该镜头的实际提交参考图片；拖到参考图区可添加为当前镜头参考图"
                                >
                                    <div
                                        className="aspect-video bg-n30 relative cursor-zoom-in group"
                                        onClick={(e) => {
                                            e.stopPropagation();

                                            if (selectedShot && selectedFileId) {
                                                handleViewFullImage(selectedShot.id, img.id);
                                            }
                                        }}
                                    >
                                        <StoryboardResultImage url={img.url} thumbnail={img.thumbnail} />
                                        {img.thumbnail && (
                                            <div className="absolute inset-0 bg-n900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <span className="text-xs text-white bg-n900/50 px-2 py-1 rounded">点击查看高清原图</span>
                                            </div>
                                        )}
                                      {effectiveSelectedId === img.id && (
                                            <div className="absolute top-2 right-2 bg-emerald-500 text-white p-1 rounded-full shadow-lg">
                                                <CheckCircle2 className="w-4 h-4" />
                                            </div>
                                        )}
                                        <StoryboardImageSourceBadge image={img} />
                                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                                          <div data-testid="storyboard-result-actions" className="grid grid-cols-6 gap-1">
                                               <button
                                                   onClick={(e) => {
                                                       e.stopPropagation();

                                                      setHumanMultiAngleModalImage(img.url || img.thumbnail);
                                                  }}
                                                  className="inline-flex h-7 min-w-0 items-center justify-center rounded-md bg-blue-500/85 text-white transition-colors hover:bg-blue-600"
                                                  title="多角度人物生成：一次生成 14 个身份一致视角"
                                                  aria-label="多角度人物生成，一次生成 14 个身份一致视角"
                                              >
                                                  <Users className="w-3.5 h-3.5" />
                                                  <span className="sr-only">14 视角</span>
                                              </button>
                                              <button
                                                  onClick={(e) => {
                                                      e.stopPropagation();

                                                      setAroundAngleModalImage(img.url || img.thumbnail);
                                                  }}
                                                  className="inline-flex h-7 min-w-0 items-center justify-center rounded-md bg-cyan-500/85 text-white transition-colors hover:bg-cyan-600"
                                                  title="全景角度生成"
                                                  aria-label="全景角度生成"
                                              >
                                                  <RotateCcw className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                  onClick={(e) => { e.stopPropagation(); setCameraModalImage(img.url || img.thumbnail); }}
                                                  className="inline-flex h-7 min-w-0 items-center justify-center rounded-md bg-primary text-white transition-colors hover:bg-primary-hover"
                                                  title="角度调整：生成 1 个指定镜头角度"
                                                  aria-label="角度调整，生成 1 个指定镜头角度"
                                              >
                                                  <Camera className="w-3.5 h-3.5" />
                                                  <span className="sr-only">单角度</span>
                                              </button>
                                              <button
                                                  onClick={(e) => { e.stopPropagation(); setMattingModalImage(img.url || img.thumbnail); }}
                                                  className="inline-flex h-7 min-w-0 items-center justify-center rounded-md bg-green-500/85 text-white transition-colors hover:bg-green-600"
                                                  title="抠图"
                                                  aria-label="抠图"
                                              >
                                                  <Scissors className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                  onClick={(e) => { e.stopPropagation(); setShowFusionModal(true); }}
                                                  className="inline-flex h-7 min-w-0 items-center justify-center rounded-md bg-orange-500/85 text-white transition-colors hover:bg-orange-600"
                                                  title="融合"
                                                  aria-label="融合"
                                              >
                                                  <Layers className="w-3.5 h-3.5" />
                                              </button>
                                            <button
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteResult(img.id); }}
                                                    className="inline-flex h-7 min-w-0 items-center justify-center rounded-md bg-danger text-white transition-colors hover:bg-danger"
                                                    title="删除"
                                                    aria-label="删除结果图片"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        </div>
                                    </div>
                                    <div className="p-2 bg-n0 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 cursor-pointer hover:bg-n20 transition-colors" onClick={(e) => { e.stopPropagation(); handleSelectResult(img.id); }}>
                                      <span className={`text-xs font-medium ${effectiveSelectedId === img.id ? 'text-success' : 'text-n100'}`}>
                                        {effectiveSelectedId === img.id ? '已选定 (最终结果)' : '点击选定'}
                                      </span>
                                    </div>
                                </div>
                            ))}

                            {isCurrentShotGenerating && (
                                <div className="aspect-video bg-n0 border-2 border-dashed border-primary/50 rounded-md flex flex-col items-center justify-center px-8">
                                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
                                    <span className="text-primary text-sm font-bold">
                                      生成中 {currentGenerationProgress?.percent || 0}%
                                    </span>
                                    <span className="mt-1 text-xs text-n300">
                                      {currentGenerationProgress?.stage || '正在提交生成任务'}
                                    </span>
                                    <div className="mt-3 h-1.5 w-full max-w-72 overflow-hidden rounded-full bg-primary/15">
                                      <div
                                        className="h-full rounded-full bg-primary transition-[width] duration-500"
                                        style={{ width: `${currentGenerationProgress?.percent || 0}%` }}
                                      />
                                    </div>
                                    {currentGenerationProgress && (
                                      <span className="mt-2 whitespace-nowrap text-[10px] text-n300">
                                        {currentGenerationProgress.mode === 'live' ? '实时进度' : '预计进度'}
                                        {' · '}
                                        {formatStoryboardGenerationEta(currentGenerationProgress.etaSeconds)}
                                      </span>
                                    )}
                                </div>
                            )}

                            {!isCurrentShotGenerating && currentGeneratedImages.length === 0 && (
                                <div className="col-span-full py-12 border-2 border-dashed border-n40 rounded-md flex flex-col items-center justify-center text-n100 bg-n0">
                                    <ImageIcon className="w-12 h-12 mb-3 opacity-20" />
                                    <p className="text-sm">暂无生成结果</p>
                                    <p className="text-xs mt-1">请配置提示词并点击生成</p>
                                </div>
                            )}
                      </div>
                        </div>
                   </div>


                   <div className="absolute bottom-0 left-0 right-0 flex flex-wrap items-center justify-center gap-3 py-3 bg-n20 border-t border-n40 backdrop-blur-sm">
                        <InlineCreditEstimate
                            featureKey={STORYBOARD_IMAGE_CREDIT_FEATURE}
                            params={{ image_count: 1, model: selectedGenerationModel }}
                            fallbackCost={STORYBOARD_IMAGE_CREDIT_FALLBACK}
                        />
                        <button
                            onClick={handleGenerateCurrent}
                            disabled={isCurrentShotGenerating || !prompt}
                            className="px-8 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold text-sm shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 transition-transform"
                            title={COMFYUI_MODELS.has(selectedGenerationModel) && references.length === 0 && currentGeneratedImages.length === 0 ? '当前模型需要参考图' : ''}
                        >
                            <Sparkles className={`w-4 h-4 ${isCurrentShotGenerating ? 'animate-spin' : ''}`} />
                            {isCurrentShotGenerating
                              ? `正在生成 ${currentGenerationProgress?.percent || 0}%`
                              : (currentGeneratedImages.length > 0 ? '重新/追加生成' : '开始生成')}
                        </button>
                   </div>

        </div>

          {/* Save Version Modal */}
         {isNamingVersion && (
            <div className="absolute top-14 right-40 z-50 bg-n0 border border-n40 shadow-xl rounded-lg p-3 w-72 animate-in fade-in slide-in-from-top-2">
                <h4 className="text-xs font-bold text-n700 mb-2">保存生成存档</h4>
                <input
                    type="text"
                    value={versionName}
                    onChange={(e) => setVersionName(e.target.value)}
                    className="w-full bg-n0 border border-n40 rounded px-2 py-1.5 text-xs text-n800 mb-2 focus:outline-none focus:border-primary"
                    autoFocus
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void submitVersionSave();
                        if (e.key === 'Escape') setIsNamingVersion(false);
                    }}
                    disabled={isSavingVersion}
                />
                {versionSaveError && (
                    <div className="mb-2 text-[11px] leading-4 text-danger" role="alert">
                        {versionSaveError}
                    </div>
                )}
                <div className="flex gap-2">
                    <button onClick={() => setIsNamingVersion(false)} disabled={isSavingVersion} className="flex-1 py-1 bg-n0 text-n700 text-xs rounded hover:bg-n20 disabled:opacity-50">取消</button>
                    <button onClick={() => void submitVersionSave()} disabled={isSavingVersion || !versionName.trim()} className="flex-1 py-1 bg-primary text-white text-xs rounded hover:bg-primary-hover disabled:opacity-50">
                        {isSavingVersion ? '保存中...' : '确认保存'}
                    </button>
                </div>
            </div>
        )}

        {/* History Panel */}
        {showHistory && renderHistoryPanel()}

        {/* Image Preview Modal (Lightbox) with Navigation */}
        {previewImage && (
            <div
                className="fixed inset-0 z-[100] bg-n900/50 flex items-center justify-center p-8 cursor-zoom-out"
                onClick={closePreview}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') handlePrevImage();
                    else if (e.key === 'ArrowRight') handleNextImage();
                    else if (e.key === 'Escape') closePreview();
                }}
                tabIndex={0}
            >

                <div className="relative flex items-center justify-center" style={{ minWidth: '50vw', minHeight: '50vh' }}>

                    {isLoadingFullImage && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-n900/50 rounded-lg z-10">
                            <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4"></div>
                            <p className="text-white text-sm">加载大图中...</p>
                        </div>
                    )}
                    <img
                        src={previewImage}
                        decoding="async"
                        alt=""
                        className={`max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl transition-opacity ${isLoadingFullImage ? 'opacity-30' : 'opacity-100'}`}
                        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking image
                        onLoad={() => {
                            console.log('✅ 大图加载完成');
                            setIsLoadingFullImage(false);
                        }}
                        onError={() => {
                            console.error('❌ 大图加载失败');
                            setIsLoadingFullImage(false);
                        }}
                    />


                    {(() => {
                        const imageList = getPreviewImageList();
                        const currentIndex = imageList.findIndex(img => img.id === previewImageId);
                        const hasPrev = currentIndex > 0;
                        const hasNext = currentIndex < imageList.length - 1;
                        const totalImages = imageList.length;

                        return (
                            <>

                                {hasPrev && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handlePrevImage(); }}
                                        className="absolute left-4 top-1/2 -translate-y-1/2 bg-n0 hover:bg-n20 text-n800 rounded-full p-3 border border-n40 transition-all hover:scale-110 z-20"
                                        title="上一张 (←)"
                                    >
                                        <ChevronLeft className="w-6 h-6" />
                                    </button>
                                )}


                                {hasNext && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleNextImage(); }}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 bg-n0 hover:bg-n20 text-n800 rounded-full p-3 border border-n40 transition-all hover:scale-110 z-20"
                                        title="下一张 (→)"
                                    >
                                        <ChevronRight className="w-6 h-6" />
                                    </button>
                                )}


                                {totalImages > 1 && (
                                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-n0 text-n800 text-sm px-4 py-2 rounded-full border border-n40 z-20">
                                        {currentIndex + 1} / {totalImages}
                                    </div>
                                )}
                            </>
                        );
                    })()}


                    <button
                        onClick={closePreview}
                        className="absolute -top-4 -right-4 bg-n0 text-n800 rounded-full p-2 hover:bg-n20 border border-n40 z-20"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </div>
        )}

        {/* Camera Angle Adjustment Modal */}
        {cameraModalImage && (
            <CameraAngleModal
                imageUrl={cameraModalImage}
                onClose={closeCameraAngleModal}
                onSubmit={handleAngleAdjustment}
                onMirror={handleHorizontalMirror}
                isProcessing={isAngleAdjusting}
                isMirroring={isHorizontalMirroring}
                clusterNodes={clusterNodes}
                clusterNodesLoading={clusterNodesLoading}
                selectedClusterNodeId={selectedClusterNodeId}
                clusterNodeMessage={clusterNodeMessage}
                onSelectClusterNode={(nodeId) => {
                    setSelectedClusterNodeId(nodeId);
                    setPreferredGpuNodeId(nodeId);
                }}
                onRefreshClusterNodes={loadClusterNodeOptions}
            />
        )}

        {/* 🆕 Human Multi-Angle Generation Modal */}
        {humanMultiAngleModalImage && (
            <HumanMultiAngleModal
                imageUrl={humanMultiAngleModalImage}
                onClose={closeHumanMultiAngleModal}
                onSubmit={handleHumanMultiAngle}
                isProcessing={isHumanMultiAngleGenerating}
            />
        )}

        {/* 🆕 Around Angle Generation Modal */}
        {aroundAngleModalImage && (
            <AroundAngleModal
                imageUrl={aroundAngleModalImage}
                onClose={closeAroundAngleModal}
                onSubmit={handleAroundAngle}
                isProcessing={isAroundAngleGenerating}
            />
        )}

        {/* 🆕 Image Editor Modal */}
        {imageEditorData && (
            <ImageEditorModal
                imageUrl={imageEditorData.imageUrl}
                referenceId={imageEditorData.referenceId}
                onClose={() => setImageEditorData(null)}
                onSave={handleImageEditorSave}
                onAddSketch={handleAddSketch}
            />
        )}


        {mattingModalImage && (
            <React.Suspense fallback={<ModalChunkFallback />}>
                <MattingModal
                    imageUrl={mattingModalImage}
                    onClose={() => setMattingModalImage(null)}
                    onSubmit={handleMatting}
                    isProcessing={isMattingProcessing}
                />
            </React.Suspense>
        )}


        {showFusionModal && (
            <React.Suspense fallback={<ModalChunkFallback />}>
                <ImageFusionModal
                    generatedImages={currentGeneratedImages}
                    onClose={() => setShowFusionModal(false)}
                    onSubmit={handleImageFusion}
                    isProcessing={isFusionProcessing}
                />
            </React.Suspense>
        )}


        {showStoryboardToolModal && (
            <React.Suspense fallback={<ModalChunkFallback />}>
                <StoryboardToolModal
                    generatedImages={currentGeneratedImages}
                    materialImages={Object.values(materialLibrary).flat().map(m => ({ url: m.url, name: (m as any).name || m.id }))}
                    onClose={() => setShowStoryboardToolModal(false)}
                    onPanorama360={handlePanorama360}
                    onPanoramaFusion={handlePanoramaFusion}
                    onAutoStoryboard={handleAutoStoryboard}
                    onMultiGridStoryboard={handleMultiGridStoryboardSubmit}
                    isProcessing={isStoryboardToolProcessing}
                />
            </React.Suspense>
        )}

        {showMaterialPicker && (
          <ProjectMaterialPicker
            {...materialPicker}
            references={references}
            isLoadingOtherShotImages={isLoadingOtherShotImages}
            handleMaterialPickerFilterChange={handleMaterialPickerFilterChange}
            handleAddProjectMaterial={handleAddProjectMaterial}
            handleAddOtherStoryboardImage={handleAddOtherStoryboardImage}
            onClose={() => setShowMaterialPicker(false)}
          />
        )}

      </div>
  );
};

interface CameraAngleModalProps {
    imageUrl: string;
    onClose: () => void;
    onSubmit: (imageUrl: string, params: {
        rotate: number;
        move: number;
        vertical: number;
        wideAngle: boolean;
        customPrompt?: string;
        seed: number;
    }) => void;
    onMirror: (imageUrl: string) => void;
    isProcessing: boolean;
    isMirroring: boolean;
    clusterNodes: ClusterNodeOption[];
    clusterNodesLoading: boolean;
    selectedClusterNodeId: string;
    clusterNodeMessage: string;
    onSelectClusterNode: (nodeId: string) => void;
    onRefreshClusterNodes: () => void;
}

const CameraAngleModal: React.FC<CameraAngleModalProps> = ({
    imageUrl,
    onClose,
    onSubmit,
    onMirror,
    isProcessing,
    isMirroring,
    clusterNodes,
    clusterNodesLoading,
    selectedClusterNodeId,
    clusterNodeMessage,
    onSelectClusterNode,
    onRefreshClusterNodes,
}) => {
    const [rotate, setRotate] = useState(0);
    const [move, setMove] = useState(0);
    const [vertical, setVertical] = useState(0);
    const [wideAngle, setWideAngle] = useState(false);
    const [customPrompt, setCustomPrompt] = useState('');
    const [seed, setSeed] = useState(() => Math.floor(Math.random() * 900000000000000) + 100000000000000);

    const promptExamples = [
        "将镜头向前移动（Move the camera forward.）",
        "将镜头向左移动（Move the camera left.）",
        "将镜头向右移动（Move the camera right.）",
        "将镜头向下移动（Move the camera down.）",
        "将镜头转为俯视（Turn the camera to a top-down view.）",
        "将镜头转为广角镜头（Turn the camera to a wide-angle lens.）",
        "将镜头转为特写镜头（Turn the camera to a close-up.）"
    ];

    const handleSubmit = () => {
        onSubmit(imageUrl, {
            rotate,
            move,
            vertical,
            wideAngle,
            customPrompt: customPrompt.trim() || undefined,
            seed
        });
    };

    const DiscreteSlider: React.FC<{
        label: string;
        values: number[];
        value: number;
        onChange: (val: number) => void;
    }> = ({ label, values, value, onChange }) => {
        const currentIndex = values.indexOf(value);
        const displayIndex = currentIndex === -1 ? 0 : currentIndex;

        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-n300">
                    <span>{label}</span>
                    <span className="font-semibold text-n800">{value}</span>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="range"
                        min={0}
                        max={values.length - 1}
                        step={1}
                        value={displayIndex}
                        onChange={(e) => onChange(values[Number(e.target.value)])}
                        className="flex-1 accent-primary"
                    />
                </div>
                <div className="flex justify-between text-[9px] text-n100">
                    {values.map((v, i) => (
                        <span key={i} className={value === v ? 'text-primary font-semibold' : ''}>{v}</span>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[130]" onClick={onClose}>
            <div className="relative max-h-[calc(100vh-2rem)] w-full max-w-4xl space-y-6 overflow-y-auto rounded-2xl border border-n40 bg-n0 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>


                {isProcessing && (
                    <div className="absolute inset-0 bg-n0 backdrop-blur-sm rounded-2xl z-50 flex flex-col items-center justify-center">
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="收起窗口并在后台继续生成新角度"
                            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-n40 bg-n0 text-n300 shadow-sm transition-colors hover:border-primary hover:bg-primary-light hover:text-primary"
                        >
                            <X className="h-5 w-5" />
                        </button>
                        <div className="relative">
                            <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4"></div>
                        </div>
                        <h4 className="text-lg font-bold text-n800 mb-2">正在生成新角度...</h4>
                        <p className="text-sm text-n300 mb-2">请稍候，AI正在重建镜头</p>
                        <p className="mb-4 text-xs text-n300">可以收起此窗口，任务会在后台继续，完成后自动保存。</p>
                        <div className="flex items-center gap-2 text-xs text-primary">
                            <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                            <span>处理中</span>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="mt-6 rounded-lg border border-primary/30 bg-primary-light px-4 py-2 text-xs font-semibold text-primary transition-colors hover:border-primary hover:bg-primary/10"
                        >
                            收起窗口
                        </button>
                    </div>
                )}

                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-n800">角度调整</h3>
                        <p className="text-xs text-n300 mt-1">基于现有图片重建镜头角度，保持画面一致性。</p>
                    </div>
                    <button onClick={onClose} className="text-n300 hover:text-n800" disabled={isProcessing}>
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div className="relative rounded-2xl overflow-hidden border border-n40 h-80 bg-n30 flex items-center justify-center">
                            <img src={imageUrl} loading="lazy" decoding="async" className="w-full h-full object-contain" alt="预览" />
                        </div>
                        <div className="rounded-md border border-n40 bg-n20 p-3">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-semibold text-n700">处理集群节点</span>
                                <button
                                    type="button"
                                    onClick={onRefreshClusterNodes}
                                    disabled={clusterNodesLoading || isProcessing}
                                    className="inline-flex items-center gap-1 text-[10px] text-primary disabled:opacity-50"
                                >
                                    <RefreshCw className={`h-3 w-3 ${clusterNodesLoading ? 'animate-spin' : ''}`} />
                                    刷新
                                </button>
                            </div>
                            <select
                                value={selectedClusterNodeId}
                                onChange={(event) => onSelectClusterNode(event.target.value)}
                                disabled={clusterNodesLoading || clusterNodes.length === 0 || isProcessing}
                                className="h-9 w-full rounded border border-n40 bg-n0 px-2 text-xs text-n700 outline-none focus:border-primary disabled:bg-n20 disabled:text-n100"
                            >
                                {clusterNodes.length === 0 && (
                                    <option value={DEFAULT_GPU_NODE_NAME}>{formatProcessingNodeName(DEFAULT_GPU_NODE_NAME)} · offline</option>
                                )}
                                {clusterNodes.map((node) => (
                                    <option key={node.id} value={clusterNodePreferenceId(node)} disabled={!isClusterNodeUsable(node)}>
                                        {node.name} · {node.status}
                                        {formatClusterNodeQueue(node) ? ` · ${formatClusterNodeQueue(node)}` : ''}
                                    </option>
                                ))}
                            </select>
                            <p className="mt-1.5 text-[10px] leading-4 text-n300">
                                输出保持原图比例。所选节点不可用时优先由处理节点1接管，再由其他在线低负载节点处理。
                                {clusterNodeMessage ? ` ${clusterNodeMessage}` : ''}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-5">
                        <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-n700">
                            <strong className="block text-primary">单视角精确调整</strong>
                            仅生成 1 张指定镜头角度；需要一次获得 14 个身份一致视角时，请使用“多角度人物生成”。
                        </div>
                        <div className="space-y-3 bg-n20 border border-n40 rounded-md p-4">
                            <h4 className="text-xs font-bold text-n300 uppercase">镜头控制</h4>
                            <DiscreteSlider
                                label="水平旋转 (°)"
                                values={[-90, -45, 0, 45, 90]}
                                value={rotate}
                                onChange={setRotate}
                            />
                            <DiscreteSlider
                                label="推进距离"
                                values={[0, 5, 10]}
                                value={move}
                                onChange={setMove}
                            />
                            <DiscreteSlider
                                label="垂直角度"
                                values={[-1, 0, 1]}
                                value={vertical}
                                onChange={setVertical}
                            />
                            <label className="flex items-center gap-2 text-xs text-n700">
                                <input type="checkbox" checked={wideAngle} onChange={(e) => setWideAngle(e.target.checked)} />
                                启用广角透视
                            </label>
                        </div>

                        <div className="space-y-2">
                            <span className="text-[11px] font-bold text-n100 uppercase">自定义提示词 (可覆盖镜头设定)</span>
                            <textarea
                                rows={3}
                                value={customPrompt}
                                onChange={(e) => setCustomPrompt(e.target.value)}
                                className="w-full bg-n0 border border-n40 rounded-lg text-sm text-n800 p-3 focus:outline-none focus:border-primary resize-none"
                                placeholder="输入更详细的场景描述或留空使用自动提示..."
                            />
                            <div className="flex flex-wrap gap-1 mt-2">
                                {promptExamples.map((example, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setCustomPrompt(example)}
                                        className="text-[10px] px-2 py-1 bg-n0 hover:bg-primary text-n300 hover:text-n800 rounded border border-n40 hover:border-primary transition-colors"
                                    >
                                        {example.split('（')[0]}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-n700">
                            <div className="flex items-center gap-2">
                                <span>随机种子</span>
                                <input
                                    type="number"
                                    value={seed}
                                    onChange={(e) => setSeed(Number(e.target.value))}
                                    className="w-32 bg-n0 border border-n40 rounded px-2 py-1 focus:outline-none focus:border-primary"
                                />
                            </div>
                            <button
                                onClick={() => setSeed(Math.floor(Math.random() * 900000000000000) + 100000000000000)}
                                className="px-2 py-1 rounded border border-n40 hover:border-primary hover:text-n800 transition-colors"
                            >
                                随机
                            </button>
                        </div>

                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-n40">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20" disabled={isProcessing || isMirroring}>取消</button>
                    <button
                        type="button"
                        onClick={() => onMirror(imageUrl)}
                        disabled={isProcessing || isMirroring}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary-light px-4 py-2 text-xs font-semibold text-primary hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <FlipHorizontal2 className="h-3.5 w-3.5" />
                        {isMirroring ? '镜像处理中...' : '水平镜像'}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isProcessing || isMirroring}
                        className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-blue-500 text-xs font-bold text-white shadow-lg shadow-emerald-900/30 hover:shadow-emerald-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isProcessing ? '生成中...' : '生成新角度'}
                    </button>
                </div>
            </div>
      </div>
  );
};

interface HumanMultiAngleModalProps {
    imageUrl: string;
    onClose: () => void;
    onSubmit: (imageUrl: string, seed: number, gpu: GpuNodeSelection) => void;
    isProcessing: boolean;
}

const HumanMultiAngleModal: React.FC<HumanMultiAngleModalProps> = ({ imageUrl, onClose, onSubmit, isProcessing }) => {
    const [seed, setSeed] = useState(() => Math.floor(Math.random() * 900000000000000) + 100000000000000);
    const [gpuSelection, setGpuSelection] = useState<GpuNodeSelection | null>(null);
    const creditParams = useMemo(() => designOperationCreditParams('human_multi_angle'), []);

    const handleSubmit = () => {
        if (!gpuSelection?.usable) return;
        onSubmit(imageUrl, seed, gpuSelection);
    };

    return (
        <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[130]" onClick={onClose}>
            <div className="relative max-h-[calc(100vh-2rem)] w-full max-w-4xl space-y-6 overflow-y-auto rounded-2xl border border-n40 bg-n0 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>


                {isProcessing && (
                    <div className="absolute inset-0 bg-n0 backdrop-blur-sm rounded-2xl z-50 flex flex-col items-center justify-center">
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="收起窗口并在后台继续生成多角度人物"
                            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-n40 bg-n0 text-n300 shadow-sm transition-colors hover:border-primary hover:bg-primary-light hover:text-primary"
                        >
                            <X className="h-5 w-5" />
                        </button>
                        <div className="relative">
                            <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4"></div>
                        </div>
                        <h4 className="text-lg font-bold text-n800 mb-2">正在生成多角度人物...</h4>
                        <p className="text-sm text-n300 mb-2">请稍候，AI正在生成多视角图像</p>
                        <p className="mb-4 text-xs text-n300">可以收起此窗口，任务会在后台继续，完成后自动保存。</p>
                        <div className="flex items-center gap-2 text-xs text-primary">
                            <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                            <span>处理中</span>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="mt-6 rounded-lg border border-primary/30 bg-primary-light px-4 py-2 text-xs font-semibold text-primary transition-colors hover:border-primary hover:bg-primary/10"
                        >
                            收起窗口
                        </button>
                    </div>
                )}

                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-n800">多角度人物生成</h3>
                        <p className="text-xs text-n300 mt-1">一次固定生成 14 个身份一致视角，适合建立完整人物视图库。</p>
                    </div>
                    <button onClick={onClose} className="text-n300 hover:text-n800" disabled={isProcessing}>
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <div className="space-y-4">

                        <div className="relative flex h-72 items-center justify-center overflow-hidden rounded-2xl border border-n40 bg-n30">
                            <img src={imageUrl} loading="lazy" decoding="async" className="h-full w-full object-contain" alt="选中的图片" />
                        </div>
                        <GpuNodeSelector
                            onSelectionChange={setGpuSelection}
                            disabled={isProcessing}
                        />
                    </div>

                    <div className="space-y-4">
                        <section className="rounded-md border border-n40 bg-n20 p-4">
                            <h4 className="text-xs font-bold text-n700">生成规格</h4>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                <div className="rounded-md border border-n40 bg-n0 p-3">
                                    <span className="block text-[10px] text-n300">输出数量</span>
                                    <strong className="mt-1 block text-n800">固定 14 个视角</strong>
                                </div>
                                <div className="rounded-md border border-n40 bg-n0 p-3">
                                    <span className="block text-[10px] text-n300">生成策略</span>
                                    <strong className="mt-1 block text-n800">保持人物身份一致</strong>
                                </div>
                                <div className="col-span-2 rounded-md border border-primary/20 bg-primary/5 p-3">
                                    <span className="block text-[10px] text-primary">与角度调整的区别</span>
                                    <strong className="mt-1 block text-n800">多角度生成 14 张；角度调整仅生成 1 张指定角度</strong>
                                </div>
                            </div>
                            <p className="mt-3 text-[11px] leading-5 text-n300">
                                系统使用固定多视角工作流生成正面、侧面、背面等人物视图，无需额外选择模型或角度。
                            </p>
                        </section>


                        <section className="rounded-md border border-n40 bg-n20 p-4">
                            <div className="flex items-end justify-between gap-3">
                                <label className="space-y-1">
                                    <span className="block text-[11px] font-bold uppercase text-n300">随机种子</span>
                                    <input
                                        type="number"
                                        value={seed}
                                        onChange={(e) => setSeed(Number(e.target.value))}
                                        className="w-48 rounded border border-n40 bg-n0 px-2 py-1.5 text-sm text-n800 focus:border-primary focus:outline-none"
                                    />
                                </label>
                                <button
                                    type="button"
                                    onClick={() => setSeed(Math.floor(Math.random() * 900000000000000) + 100000000000000)}
                                    disabled={isProcessing}
                                    className="rounded border border-n40 px-3 py-1.5 text-sm text-n300 transition-colors hover:border-primary hover:text-n800 disabled:opacity-50"
                                >
                                    随机
                                </button>
                            </div>
                            <p className="mt-2 text-[10px] leading-4 text-n300">
                                相同原图配合相同种子更容易复现相近结果；随机种子用于探索新的视角组合。
                            </p>
                        </section>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-n40 pt-4">
                    <InlineCreditEstimate
                        featureKey={DESIGN_CREDIT_FEATURES.multiAngleGeneration}
                        params={creditParams}
                        fallbackCost={DESIGN_CREDIT_DEFAULTS.multiAngleGeneration}
                    />
                    <div className="flex items-center gap-3">
                        <button onClick={onClose} className="rounded-lg border border-n40 px-4 py-2 text-xs text-n700 hover:bg-n20" disabled={isProcessing}>取消</button>
                        <button
                            onClick={handleSubmit}
                            disabled={isProcessing || !gpuSelection?.usable}
                            title={!gpuSelection?.usable ? '请先选择一个可用处理节点' : undefined}
                            className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-white shadow-lg hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isProcessing ? '生成中...' : '开始生成'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};


interface AroundAngleModalProps {
    imageUrl: string;
    onClose: () => void;
    onSubmit: (imageUrl: string, prompt: string, seed: number) => void;
    isProcessing: boolean;
}

const AroundAngleModal: React.FC<AroundAngleModalProps> = ({ imageUrl, onClose, onSubmit, isProcessing }) => {
    const [prompt, setPrompt] = useState('front view, eye level, medium shot');
    const [seed, setSeed] = useState(() => Math.floor(Math.random() * 900000000000000) + 100000000000000);
    const [rawValues, setRawValues] = useState({ horizontal: 0, vertical: 0, zoom: 5 });


    const handleControllerChange = useCallback((newPrompt: string, raw: { horizontal: number; vertical: number; zoom: number }) => {
        setPrompt(newPrompt);
        setRawValues(raw);
    }, []);

    const handleSubmit = () => {
        onSubmit(imageUrl, prompt, seed);
    };

    return (
        <div className="fixed inset-0 bg-n900/50 backdrop-blur-md flex items-center justify-center z-[130] p-6" onClick={onClose}>
            <div className="w-full h-full max-w-6xl max-h-[90vh] bg-n0 border border-cyan-500/30 rounded-2xl shadow-2xl flex flex-col relative" onClick={(e) => e.stopPropagation()}>


                {isProcessing && (
                    <div className="absolute inset-0 bg-n0 backdrop-blur-sm rounded-2xl z-50 flex flex-col items-center justify-center">
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="收起窗口并在后台继续生成全景角度"
                            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-n40 bg-n0 text-n300 shadow-sm transition-colors hover:border-cyan-500 hover:bg-cyan-500/10 hover:text-cyan-500"
                        >
                            <X className="h-5 w-5" />
                        </button>
                        <div className="relative">
                            <div className="w-20 h-20 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mb-4"></div>
                        </div>
                        <h4 className="text-xl font-bold text-n800 mb-2">正在生成全景角度...</h4>
                        <p className="text-sm text-n300 mb-2">请稍候，AI正在生成指定视角图像</p>
                        <p className="mb-4 text-xs text-n300">可以收起此窗口，任务会在后台继续，完成后自动保存。</p>
                        <div className="flex items-center gap-2 text-sm text-cyan-300">
                            <div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse"></div>
                            <span>处理中</span>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="mt-6 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-500 transition-colors hover:border-cyan-500 hover:bg-cyan-500/15"
                        >
                            收起窗口
                        </button>
                    </div>
                )}


                <div className="flex items-center justify-between px-6 py-3 border-b border-n40 shrink-0">
                    <div className="flex items-center gap-6">
                        <div>
                            <h3 className="text-lg font-bold text-n800 flex items-center gap-2">
                                <span className="text-cyan-400">◈</span>
                                全景角度生成
                                <span className="text-xs font-normal text-n100 ml-1">96种组合</span>
                            </h3>
                        </div>


                        <div className="flex items-center gap-4 ml-4">

                            <div className="flex items-center gap-2">
                                <span className="text-xs text-pink-400 font-medium">水平</span>
                                <input
                                    type="number"
                                    value={Math.round(rawValues.horizontal)}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value) || 0;
                                        const clamped = ((val % 360) + 360) % 360;
                                        setRawValues(prev => ({ ...prev, horizontal: clamped }));
                                    }}
                                    className="w-16 px-2 py-1 bg-n0 border border-pink-500/40 rounded text-pink-400 text-sm font-semibold text-center focus:outline-none focus:border-pink-500"
                                    min={0}
                                    max={360}
                                />
                                <span className="text-pink-400 text-xs">°</span>
                            </div>


                            <div className="flex items-center gap-2">
                                <span className="text-xs text-cyan-400 font-medium">垂直</span>
                                <input
                                    type="number"
                                    value={Math.round(rawValues.vertical)}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value) || 0;
                                        const clamped = Math.max(-30, Math.min(90, val));
                                        setRawValues(prev => ({ ...prev, vertical: clamped }));
                                    }}
                                    className="w-16 px-2 py-1 bg-n0 border border-cyan-500/40 rounded text-cyan-400 text-sm font-semibold text-center focus:outline-none focus:border-cyan-500"
                                    min={-30}
                                    max={90}
                                />
                                <span className="text-cyan-400 text-xs">°</span>
                            </div>


                            <div className="flex items-center gap-2">
                                <span className="text-xs text-yellow-400 font-medium">距离</span>
                                <input
                                    type="number"
                                    value={rawValues.zoom.toFixed(1)}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value) || 0;
                                        const clamped = Math.max(0, Math.min(10, val));
                                        setRawValues(prev => ({ ...prev, zoom: clamped }));
                                    }}
                                    className="w-16 px-2 py-1 bg-n0 border border-yellow-500/40 rounded text-yellow-400 text-sm font-semibold text-center focus:outline-none focus:border-yellow-500"
                                    min={0}
                                    max={10}
                                    step={0.1}
                                />
                            </div>


                            <button
                                onClick={() => setRawValues({ horizontal: 0, vertical: 0, zoom: 5 })}
                                className="px-2 py-1 text-n300 hover:text-n800 hover:bg-n20 rounded transition-colors text-sm"
                                title="重置角度"
                            >
                                ↺
                            </button>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-n300 hover:text-n800 p-2" disabled={isProcessing}>
                        <X className="w-6 h-6" />
                    </button>
                </div>


                <div className="flex-1 min-h-0 p-4">
                    <React.Suspense fallback={
                        <div className="w-full h-full min-h-[320px] rounded-lg border border-n40 bg-n20 flex items-center justify-center text-sm text-n300">
                            加载 3D 控制器...
                        </div>
                    }>
                        <MultiAngle3DController
                            imageUrl={imageUrl}
                            onChange={handleControllerChange}
                            initialValues={rawValues}
                        />
                    </React.Suspense>
                </div>


                <div className="flex items-center gap-4 px-6 py-4 border-t border-n40 bg-n20 shrink-0">

                    <div className="flex-1">
                        <input
                            type="text"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            className="w-full bg-n0 border border-n40 rounded-lg px-4 py-3 text-base focus:outline-none focus:border-cyan-500 text-cyan-300 font-mono"
                            placeholder="角度提示词（由上方控制器自动生成）"
                        />
                    </div>


                    <div className="flex items-center gap-2">
                        <span className="text-xs text-n100">种子:</span>
                        <input
                            type="number"
                            value={seed}
                            onChange={(e) => setSeed(Number(e.target.value))}
                            className="w-40 bg-n0 border border-n40 rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-cyan-500 text-n800"
                        />
                        <button
                            onClick={() => setSeed(Math.floor(Math.random() * 900000000000000) + 100000000000000)}
                            className="px-3 py-3 rounded-lg border border-n40 hover:border-cyan-500 hover:bg-n20 transition-colors text-lg"
                            title="随机种子"
                        >
                            🎲
                        </button>
                    </div>


                    <button onClick={onClose} className="px-6 py-3 rounded-lg border border-n40 text-sm text-n700 hover:bg-n20 transition-colors" disabled={isProcessing}>
                        取消
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isProcessing}
                        className="px-8 py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-sm font-bold text-white shadow-lg shadow-cyan-900/30 hover:shadow-cyan-900/50 hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isProcessing ? '生成中...' : '🚀 开始生成'}
                    </button>
                </div>
            </div>
        </div>
    );
};

interface ImageEditorModalProps {
    imageUrl: string;
    referenceId: string;
    onClose: () => void;
    onSave: (editedImageUrl: string, referenceId: string) => void;
    onAddSketch: (sketchImageUrl: string) => void;
}

type EditorTool = 'brush' | 'text' | 'arrow' | 'eraser';
type EditorMode = 'edit' | 'sketch';

const ImageEditorModal: React.FC<ImageEditorModalProps> = ({
    imageUrl,
    referenceId,
    onClose,
    onSave,
    onAddSketch
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sketchCanvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [tool, setTool] = useState<EditorTool>('brush');
    const [mode, setMode] = useState<EditorMode>('edit');
    const [brushColor, setBrushColor] = useState('#ff0000');
    const [brushSize, setBrushSize] = useState(3);
    const [textInput, setTextInput] = useState('');
    const [textPosition, setTextPosition] = useState<{x: number, y: number} | null>(null);
    const [arrowStart, setArrowStart] = useState<{x: number, y: number} | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const lastPosRef = useRef<{x: number, y: number} | null>(null);


    useEffect(() => {
        const canvas = canvasRef.current;
        const sketchCanvas = sketchCanvasRef.current;
        if (!canvas || !sketchCanvas) return;

        const ctx = canvas.getContext('2d');
        const sketchCtx = sketchCanvas.getContext('2d');
        if (!ctx || !sketchCtx) return;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {

            const maxWidth = 800;
            const maxHeight = 600;
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = (maxWidth / width) * height;
                width = maxWidth;
            }
            if (height > maxHeight) {
                width = (maxHeight / height) * width;
                height = maxHeight;
            }

            canvas.width = width;
            canvas.height = height;
            sketchCanvas.width = width;
            sketchCanvas.height = height;


            ctx.drawImage(img, 0, 0, width, height);


            sketchCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            sketchCtx.fillRect(0, 0, width, height);
            sketchCtx.globalAlpha = 0.15;
            sketchCtx.drawImage(img, 0, 0, width, height);
            sketchCtx.globalAlpha = 1.0;

            setImageLoaded(true);
        };
        img.src = imageUrl;
    }, [imageUrl]);

    const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {

        const canvas = e.currentTarget;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();


        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const coords = getCanvasCoords(e);

        if (tool === 'text') {
            setTextPosition(coords);
            return;
        }

        if (tool === 'arrow') {
            setArrowStart(coords);
            return;
        }

        setIsDrawing(true);
        lastPosRef.current = coords;
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing) return;


        const canvas = e.currentTarget;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const coords = getCanvasCoords(e);
        const lastPos = lastPosRef.current;

        if (!lastPos) {
            lastPosRef.current = coords;
            return;
        }

        ctx.beginPath();
        ctx.moveTo(lastPos.x, lastPos.y);
        ctx.lineTo(coords.x, coords.y);

        if (tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
            ctx.lineWidth = brushSize * 3;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = mode === 'sketch' ? '#000000' : brushColor;
            ctx.lineWidth = brushSize;
        }

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        lastPosRef.current = coords;
    };

    const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (tool === 'arrow' && arrowStart) {

            const canvas = e.currentTarget;
            if (canvas) {
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    const coords = getCanvasCoords(e);
                    drawArrow(ctx, arrowStart.x, arrowStart.y, coords.x, coords.y);
                }
            }
            setArrowStart(null);
        }
        setIsDrawing(false);
        lastPosRef.current = null;
    };

    const drawArrow = (ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number) => {
        const headLen = 15;
        const dx = toX - fromX;
        const dy = toY - fromY;
        const angle = Math.atan2(dy, dx);

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.strokeStyle = mode === 'sketch' ? '#000000' : brushColor;
        ctx.lineWidth = brushSize;
        ctx.stroke();


        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
    };

    const handleAddText = () => {
        if (!textPosition || !textInput.trim()) return;

        const canvas = mode === 'edit' ? canvasRef.current : sketchCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.font = `${brushSize * 6}px Arial`;
        ctx.fillStyle = mode === 'sketch' ? '#000000' : brushColor;
        ctx.fillText(textInput, textPosition.x, textPosition.y);

        setTextInput('');
        setTextPosition(null);
    };

    const handleSaveEdit = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dataUrl = canvas.toDataURL('image/png');
        onSave(dataUrl, referenceId);
    };

    const handleAddSketchAsRef = () => {
        const canvas = sketchCanvasRef.current;
        if (!canvas) return;


        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;


        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);


        tempCtx.drawImage(canvas, 0, 0);

        const dataUrl = tempCanvas.toDataURL('image/png');
        onAddSketch(dataUrl);
    };

    const handleReset = () => {
        const canvas = mode === 'edit' ? canvasRef.current : sketchCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (mode === 'edit') {

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
            img.src = imageUrl;
        } else {

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.globalAlpha = 0.15;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                ctx.globalAlpha = 1.0;
            };
            img.src = imageUrl;
        }
    };

    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff', '#000000'];

    return (
        <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[140]" onClick={onClose}>
            <div className="w-full max-w-5xl bg-n0 border border-n40 rounded-2xl shadow-2xl p-6 relative" onClick={(e) => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-n800">图片编辑器</h3>
                        <p className="text-xs text-n300">画笔涂鸦、添加文字和箭头标注</p>
                    </div>
                    <button onClick={onClose} className="text-n300 hover:text-n800">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Mode Tabs */}
                <div className="flex gap-2 mb-4">
                    <button
                        onClick={() => setMode('edit')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
                            mode === 'edit'
                                ? 'bg-primary text-white'
                                : 'bg-n0 text-n300 hover:bg-n20'
                        }`}
                    >
                        <Pencil className="w-4 h-4" />
                        编辑底图
                    </button>
                    <button
                        onClick={() => setMode('sketch')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
                            mode === 'sketch'
                                ? 'bg-blue-500 text-white'
                                : 'bg-n0 text-n300 hover:bg-n20'
                        }`}
                    >
                        <Layers className="w-4 h-4" />
                        绘制线稿
                    </button>
                </div>

                <div className="grid grid-cols-[1fr_200px] gap-4">
                    {/* Canvas Area */}
                    <div className="relative bg-n20 rounded-md overflow-hidden flex items-center justify-center min-h-[400px]">
                        {!imageLoaded && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                            </div>
                        )}
                        <canvas
                            ref={canvasRef}
                            className={`max-w-full max-h-[500px] cursor-crosshair ${mode === 'edit' ? 'block' : 'hidden'}`}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                        />
                        <canvas
                            ref={sketchCanvasRef}
                            className={`max-w-full max-h-[500px] cursor-crosshair ${mode === 'sketch' ? 'block' : 'hidden'}`}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                        />
                    </div>

                    {/* Tools Panel */}
                    <div className="bg-n20 rounded-md p-4 space-y-4">
                        <div>
                            <span className="text-[10px] font-bold text-n300 uppercase block mb-2">工具</span>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setTool('brush')}
                                    className={`p-2 rounded-lg flex flex-col items-center gap-1 transition-all ${
                                        tool === 'brush' ? 'bg-primary text-white' : 'bg-n0 text-n300 hover:bg-n20'
                                    }`}
                                >
                                    <Pencil className="w-4 h-4" />
                                    <span className="text-[9px]">画笔</span>
                                </button>
                                <button
                                    onClick={() => setTool('text')}
                                    className={`p-2 rounded-lg flex flex-col items-center gap-1 transition-all ${
                                        tool === 'text' ? 'bg-primary text-white' : 'bg-n0 text-n300 hover:bg-n20'
                                    }`}
                                >
                                    <Type className="w-4 h-4" />
                                    <span className="text-[9px]">文字</span>
                                </button>
                                <button
                                    onClick={() => setTool('arrow')}
                                    className={`p-2 rounded-lg flex flex-col items-center gap-1 transition-all ${
                                        tool === 'arrow' ? 'bg-primary text-white' : 'bg-n0 text-n300 hover:bg-n20'
                                    }`}
                                >
                                    <MoveRight className="w-4 h-4" />
                                    <span className="text-[9px]">箭头</span>
                                </button>
                                <button
                                    onClick={() => setTool('eraser')}
                                    className={`p-2 rounded-lg flex flex-col items-center gap-1 transition-all ${
                                        tool === 'eraser' ? 'bg-primary text-white' : 'bg-n0 text-n300 hover:bg-n20'
                                    }`}
                                >
                                    <Eraser className="w-4 h-4" />
                                    <span className="text-[9px]">橡皮</span>
                                </button>
                            </div>
                        </div>

                        {mode === 'edit' && (
                            <div>
                                <span className="text-[10px] font-bold text-n300 uppercase block mb-2">颜色</span>
                                <div className="grid grid-cols-4 gap-1">
                                    {colors.map(color => (
                                        <button
                                            key={color}
                                            onClick={() => setBrushColor(color)}
                                            className={`w-8 h-8 rounded-lg border-2 transition-all ${
                                                brushColor === color ? 'border-white scale-110' : 'border-transparent'
                                            }`}
                                            style={{ backgroundColor: color }}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        <div>
                            <span className="text-[10px] font-bold text-n300 uppercase block mb-2">
                                笔刷大小: {brushSize}px
                            </span>
                            <input
                                type="range"
                                min="1"
                                max="20"
                                value={brushSize}
                                onChange={(e) => setBrushSize(Number(e.target.value))}
                                className="w-full accent-primary"
                            />
                        </div>

                        {tool === 'text' && textPosition && (
                            <div>
                                <span className="text-[10px] font-bold text-n300 uppercase block mb-2">输入文字</span>
                                <input
                                    type="text"
                                    value={textInput}
                                    onChange={(e) => setTextInput(e.target.value)}
                                    className="w-full bg-n0 border border-n40 rounded px-2 py-1.5 text-xs text-n800 mb-2"
                                    placeholder="输入文字..."
                                    autoFocus
                                />
                                <button
                                    onClick={handleAddText}
                                    className="w-full py-1.5 bg-primary hover:bg-primary-hover text-white rounded text-xs font-bold"
                                >
                                    添加文字
                                </button>
                            </div>
                        )}

                        <button
                            onClick={handleReset}
                            className="w-full py-2 bg-n0 hover:bg-n20 text-n700 rounded-lg text-xs font-bold flex items-center justify-center gap-2"
                        >
                            <RotateCcw className="w-3 h-3" />
                            重置
                        </button>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-n40">
                    <p className="text-[10px] text-n100">
                        {mode === 'edit' ? '编辑模式：修改会改变底图' : '线稿模式：在透明层上绘制，生成白底黑线参考图'}
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20"
                        >
                            取消
                        </button>
                        {mode === 'sketch' && (
                            <button
                                onClick={handleAddSketchAsRef}
                                className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-xs font-bold text-white flex items-center gap-2"
                            >
                                <Layers className="w-3 h-3" />
                                添加为参考图
                            </button>
                        )}
                        {mode === 'edit' && (
                            <button
                                onClick={handleSaveEdit}
                                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-xs font-bold text-white flex items-center gap-2"
                            >
                                <Save className="w-3 h-3" />
                                保存修改
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
