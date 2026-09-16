import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { SeedreamPurposeControl, type SeedreamPurpose } from '../components/SeedreamPurposeControl';
import { ImageSourceBadgeOverlay, SeedreamSourceBadge } from '../components/SeedreamSourceBadge';
import { useNavigate } from 'react-router-dom';
import { buildHorizontalCameraOrbitInstruction, CAMERA_ORBIT_HELP } from '../utils/cameraAnglePrompt';
import {
  User, Mountain, Sword, Plus, Trash2, Loader, Palette, ArrowRight, Check,
  Upload, ZoomIn, X, Sparkles, Camera, Maximize, Grid3X3,
  Wand2, Scissors, Layers, Square, CheckSquare, RefreshCw,
  ChevronDown, GripVertical, Pencil,
} from 'lucide-react';
import { useEpisode } from '../contexts/EpisodeContext';
import { useProject } from '../contexts/ProjectContext';
import {
  createAsset,
  deleteAsset,
  listSyncExistingAssetDesignCandidates,
  syncExistingAssetDesigns,
  updateAsset,
  type SyncExistingAssetCandidate,
} from '../services/assetMutationService';
import type { GeneratedFileResult } from '../services/doubaoService';
import { generateImageWithPreferredFallback } from '../services/preferredImageGenerationService';
import {
  ONLINE_IMAGE_OPERATION_BILLING_MODEL,
  ONLINE_IMAGE_OPERATION_LABEL,
  onlineImageOperationResolution,
  runOnlineImageOperation,
} from '../services/onlineImageOperationService';
import { callAI } from '../services/aiService';
import { crmConfirm, crmMessage } from '../admin/crmUI';
import { AiModel } from '../types';
import {
  IMAGE_QUALITY_SUFFIX,
  applyImageStylePreset,
  detectImageStylePreset,
  imageRefinementConstraints,
  stripImageStylePresets,
  validateRefinedImageAge,
} from '../prompts/imagePrompts';
import type { AssetItem } from '../types';
import { usePersistedPageState } from '../hooks/usePersistedPageState';
import { useScriptModelOptions } from '../hooks/useScriptModelOptions';
import { apiBlob, secureApiUrl } from '../services/httpClient';
import {
  getScriptModelBillingKey,
  getScriptModelOption,
  type ScriptModelOption,
} from '../services/scriptModelCatalogService';
import {
  isDesignAssetImageFileRole,
  isMaterialStageAssetImageFileRole,
} from '../utils/assetImageRoles';
import { filterAssetsForDesignScope } from '../utils/assetScope';
import {
  standardTurnaroundAspectRatio,
  standardTurnaroundLabel,
  supportsStandardTurnaround,
  withStandardTurnaround,
} from '../utils/assetGenerationStandards';
import { recommendDoubaoImageSize } from '../utils/doubaoImageSize';
import { assertEnoughCredits, consumeCredits } from '../services/creditService';
import { InlineCreditEstimate } from '../components/InlineCreditEstimate';
import { ImagePreviewLightbox } from '../components/ImagePreviewLightbox';
import { ModelPicker } from '../components/ModelPicker';
import {
  buildDesignImageModelPickerOptions,
  buildScriptModelPickerOptions,
} from '../components/modelPickerCatalogs';
import {
  DESIGN_IMAGE_BATCH_LIMIT,
  DESIGN_IMAGE_MODEL_OPTIONS,
  canUseDesignImageReferences,
  countDesignImageQuotaReferences,
  findDesignImageModel,
  isDesignImageReferenceQuotaExempt,
  maxDesignImageOutputCount,
  normalizeDesignImageResolution,
  trimDesignImageReferenceSelectionToQuota,
  type DesignImageEngine,
  type DesignImageReferenceSourceKind,
  type DesignImageResolution,
} from '../utils/designImageModels';
import {
  applyDesignAssetOrder,
  DESIGN_ASSET_ORDER_KEY,
  moveDesignAsset,
  reconcileDesignAssetOrder,
} from '../utils/designAssetOrder';
import {
  DESIGN_CREDIT_DEFAULTS,
  DESIGN_CREDIT_FEATURES,
  designImageCreditParams,
  designImageFallbackCost,
  designPromptRefinementCreditParams,
  designPromptRefinementFallbackCost,
  newDesignCreditUsageId,
} from '../utils/designCredits';
import { projectDefaultAspectRatio } from '../utils/projectCreationPreferences';

type AssetTab = 'character' | 'scene' | 'prop';
type MaterialAIEngine = DesignImageEngine;
interface ModalMaterial {
  id: string;
  url: string;
  thumbnail?: string;
  name?: string;
  sourceKind?: DesignImageReferenceSourceKind;
}
type AssetEntityFile = NonNullable<AssetItem['entityFiles']>[number];
type RawAssetImage = { key: string; rawUrl: string; fileId?: string };

const TAB_CONFIG: { key: AssetTab; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { key: 'character', label: '人物', Icon: User },
  { key: 'scene', label: '场景', Icon: Mountain },
  { key: 'prop', label: '道具', Icon: Sword },
];

const STYLE_PRESETS = [
  { id: 'anime', label: '动画', suffix: IMAGE_QUALITY_SUFFIX.anime },
  { id: 'realistic', label: '写实', suffix: IMAGE_QUALITY_SUFFIX.realistic },
  { id: 'watercolor', label: '水彩', suffix: IMAGE_QUALITY_SUFFIX.watercolor },
  { id: 'render3d', label: '3D渲染', suffix: IMAGE_QUALITY_SUFFIX.render3d },
  { id: 'highQuality', label: '高质量', suffix: IMAGE_QUALITY_SUFFIX.highQuality },
];

const LS = {
  get: (k: string, def: string) => { try { return localStorage.getItem(k) || def; } catch { return def; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
};
const savedEngine = () => LS.get('design_ai_engine', 'doubao') as MaterialAIEngine;
const savedGeminiModel = () => LS.get('design_ai_gemini_model', 'gemini-3-pro-image-preview');
const savedStyle = () => LS.get('design_ai_style', '');
const savedAspect = () => LS.get('design_ai_aspect_ratio', '1:1');
const savedResolution = () => LS.get('design_ai_resolution', '1K') as DesignImageResolution;
const savedRefineModel = () => LS.get('design_ai_refine_model', AiModel.DeepseekChat) as AiModel;

function savePrefs(p: { engine?: string; geminiModel?: string; style?: string; aspect?: string; resolution?: string; refineModel?: string }) {
  if (p.engine) LS.set('design_ai_engine', p.engine);
  if (p.geminiModel) LS.set('design_ai_gemini_model', p.geminiModel);
  if (p.style !== undefined) LS.set('design_ai_style', p.style);
  if (p.aspect) LS.set('design_ai_aspect_ratio', p.aspect);
  if (p.resolution) LS.set('design_ai_resolution', p.resolution);
  if (p.refineModel) LS.set('design_ai_refine_model', p.refineModel);
}

function safeArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}
function safeObj(val: unknown): Record<string, unknown> {
  if (val && typeof val === 'object' && !Array.isArray(val)) return val as Record<string, unknown>;
  if (typeof val === 'string') { try { const p = JSON.parse(val); return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {}; } catch { return {}; } }
  return {};
}

function secureMediaUrl(url: string | null): string | null {
  if (!url) return null;
  const normalized = /^(?:https?:|blob:|data:)/i.test(url)
    ? url
    : (url.startsWith('/') ? url : `/${url}`);
  return secureApiUrl(normalized, { absolute: true });
}

function isAssetNotFoundError(error: unknown): boolean {
  const err = error as { status?: number; message?: string } | null | undefined;
  const msg = err?.message || String(error || '');
  return err?.status === 404 || /(^|\D)404(\D|$)|资产不存在|not found/i.test(msg);
}

function getLegacyAssetImageUrls(asset: AssetItem): string[] {
  const materialStageUrls = new Set(
    (asset.entityFiles || [])
      .filter(file => isMaterialStageAssetImageFileRole(file.fileRole))
      .map(file => file.fileUrl)
      .filter(Boolean),
  );
  const urls = [...(asset.referenceImages || [])].filter(url => !materialStageUrls.has(url));
  if (
    asset.thumbnailUrl
    && !materialStageUrls.has(asset.thumbnailUrl)
    && !urls.includes(asset.thumbnailUrl)
  ) {
    urls.unshift(asset.thumbnailUrl);
  }
  return urls.filter(Boolean);
}

function getSortedAssetImageFiles(entityFiles: AssetEntityFile[] | undefined): AssetEntityFile[] {
  return (entityFiles || [])
    .filter(f => isDesignAssetImageFileRole(f.fileRole) && Boolean(f.fileUrl))
    .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
}

function collectAssetImages(assetId: string, entityFiles: AssetEntityFile[] | undefined, legacyImages: string[]): RawAssetImage[] {
  const images: RawAssetImage[] = [];
  const seenUrls = new Set<string>();
  const pushImage = (url: string | null | undefined, key: string, fileId?: string) => {
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    images.push({ key, rawUrl: url, fileId });
  };

  legacyImages.forEach((url, index) => pushImage(url, `${assetId}_legacy_${index}`));
  getSortedAssetImageFiles(entityFiles).forEach((file, index) => {
    pushImage(file.fileUrl, file.fileId || `${assetId}_entity_${index}`, file.fileId);
  });

  return images;
}

function assetHasDesignImages(asset: AssetItem): boolean {
  return collectAssetImages(asset.assetId, asset.entityFiles, getLegacyAssetImageUrls(asset)).length > 0;
}

async function ensureDataUrl(input: string): Promise<string> {
  if (!input) throw new Error('图片URL无效');
  if (input.startsWith('data:')) return input;
  const secured = secureMediaUrl(input) || input;
  const blob = await apiBlob(secured, { method: 'GET' }, '下载图片', {
    requireAuth: false,
    includeContentType: false,
  });
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onloadend = () => resolve(r.result as string); r.onerror = reject; r.readAsDataURL(blob); });
}

function assetToMaterials(asset: AssetItem): ModalMaterial[] {
  return collectAssetImages(asset.assetId, asset.entityFiles, getLegacyAssetImageUrls(asset))
    .map((img, index) => ({ id: `${asset.assetId}_${index}`, url: img.rawUrl, name: asset.name }));
}

function buildRefinePrompt(assetType: string, assetName: string, existingDesc: string, scriptText: string, style = '', turnaround = false): { system: string; user: string } {
  const typeLabel = assetType === 'character' ? '角色' : assetType === 'scene' ? '场景' : '道具';
  const system = `你是一位专业的${typeLabel}视觉设计师。根据剧本内容和${typeLabel}名称，生成一段详细的${typeLabel}外观设定（100-200字），包含外形特征、服饰/材质、色彩、风格、氛围等细节，适合直接作为AI绘画提示词。只输出设定文案，不要任何解释或标题。`;
  const hasDesc = existingDesc.trim().length > 0;
  const scriptExcerpt = scriptText.length > 3000 ? scriptText.substring(0, 3000) + '...' : scriptText;
  const user = hasDesc
    ? `${typeLabel}名称：${assetName}\n用户描述：${existingDesc}\n\n剧本内容（供参考）：\n${scriptExcerpt}\n\n请结合用户描述和剧本中关于"${assetName}"的信息，输出润色后的${typeLabel}设定文案：`
    : `${typeLabel}名称：${assetName}\n\n剧本内容：\n${scriptExcerpt}\n\n请根据剧本中对"${assetName}"的描写和上下文，推断并输出详细的${typeLabel}设定文案：`;
  return { system: `${system}\n${imageRefinementConstraints(style, assetType, turnaround)}`, user };
}

const AssetImageRow: React.FC<{
  assetId: string;
  entityFiles: AssetEntityFile[];
  legacyImages: string[];
  onLightbox: (images: string[], initialIndex: number) => void;
  onDeleteImage: (assetId: string, imageUrl: string, fileId?: string) => void;
  busy: boolean;
}> = ({ assetId, entityFiles, legacyImages, onLightbox, onDeleteImage, busy }) => {
  const images: { key: string; displayUrl: string; rawUrl: string; fileId?: string }[] = useMemo(() => {
    return collectAssetImages(assetId, entityFiles, legacyImages)
      .map(img => ({
        key: img.key,
        displayUrl: secureMediaUrl(img.rawUrl) || '',
        rawUrl: img.rawUrl,
        fileId: img.fileId,
      }))
      .filter(i => i.displayUrl);
  }, [assetId, entityFiles, legacyImages]);

  if (images.length === 0) return null;
  return (
    <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
      {images.map((img, index) => (
        <div key={img.key} className="shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-n40 hover:border-primary transition-colors group relative">
          <button type="button" onClick={() => onLightbox(images.map(item => item.displayUrl), index)} className="w-full h-full">
            <img src={img.displayUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center pointer-events-none"><ZoomIn size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" /></div>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDeleteImage(assetId, img.rawUrl, img.fileId); }}
            disabled={busy}
            className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-n900/50 text-danger hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
          >
            <X size={10} />
          </button>
          <div className="absolute bottom-0 inset-x-0 bg-white/95"><SeedreamSourceBadge reference={img.fileId || img.rawUrl} /></div>
        </div>
      ))}
    </div>
  );
};

export const DesignPage: React.FC = () => {
  const navigate = useNavigate();
  const scriptModelOptions = useScriptModelOptions();
  const { episodeId, projectId, selectedScriptId, assets, script, isLoading, error, forceReloadSlices } = useEpisode();
  useEffect(() => {

    forceReloadSlices('assets', 'script');
  }, [forceReloadSlices]);


  const [tab, setTab] = usePersistedPageState<AssetTab>({
    page: 'DesignPage:tab',
    episodeId,
    version: 1,
    defaultValue: 'character',
  });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; currentIndex: number } | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [syncingExisting, setSyncingExisting] = useState(false);
  const [syncSubmitting, setSyncSubmitting] = useState(false);
  const [syncCandidates, setSyncCandidates] = useState<SyncExistingAssetCandidate[]>([]);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [assetOrderByType, setAssetOrderByType] = useState<Record<AssetTab, string[]>>({
    character: [],
    scene: [],
    prop: [],
  });
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const [dragOverAssetId, setDragOverAssetId] = useState<string | null>(null);
  const [savingAssetOrder, setSavingAssetOrder] = useState(false);

  const [aiModal, setAiModal] = useState<{ asset: AssetItem } | null>(null);
  const [cameraModal, setCameraModal] = useState<{ asset: AssetItem; materials: ModalMaterial[] } | null>(null);
  const [processModal, setProcessModal] = useState<{ asset: AssetItem; materials: ModalMaterial[]; workflow: 'upscale_hd' | 'remove_watermark' } | null>(null);
  const [batchModal, setBatchModal] = useState(false);
  const [editAsset, setEditAsset] = useState<AssetItem | null>(null);

  const designAssets = useMemo(
    () => filterAssetsForDesignScope(assets, episodeId, selectedScriptId),
    [assets, episodeId, selectedScriptId],
  );
  const filtered = useMemo(() => designAssets.filter(a => a.assetType === tab), [designAssets, tab]);
  const orderedFiltered = useMemo(
    () => applyDesignAssetOrder(filtered, assetOrderByType[tab]),
    [assetOrderByType, filtered, tab],
  );
  const assetHasDesign = (a: AssetItem) => assetHasDesignImages(a);
  const totalDesignedCount = designAssets.filter(assetHasDesign).length;
  const tabDesignedCount = filtered.filter(assetHasDesign).length;
  const scriptText = script?.adaptedScript || script?.originalContent || '';

  useEffect(() => {
    const visibleIds = new Set(designAssets.map(asset => asset.assetId));
    setSelectedIds(prev => {
      const next = new Set(Array.from(prev).filter(id => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [designAssets]);

  useEffect(() => {
    setAssetOrderByType(previous => {
      const nextOrder = reconcileDesignAssetOrder(previous[tab], filtered);
      if (
        nextOrder.length === previous[tab].length
        && nextOrder.every((assetId, index) => assetId === previous[tab][index])
      ) {
        return previous;
      }
      return { ...previous, [tab]: nextOrder };
    });
  }, [filtered, tab]);

  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllFiltered = () => setSelectedIds(new Set(filtered.map(a => a.assetId)));
  const selectUndesigned = () => setSelectedIds(new Set(filtered.filter(a => !assetHasDesign(a)).map(a => a.assetId)));
  const isBusy = (id: string) => busyAssetId === id || uploadingId === id || deletingId === id;

  const handleDropAsset = useCallback(async (targetAssetId: string) => {
    const sourceAssetId = draggingAssetId;
    setDragOverAssetId(null);
    setDraggingAssetId(null);
    if (!sourceAssetId || sourceAssetId === targetAssetId || savingAssetOrder) return;

    const previousOrder = reconcileDesignAssetOrder(assetOrderByType[tab], filtered);
    const nextOrder = moveDesignAsset(previousOrder, sourceAssetId, targetAssetId);
    if (nextOrder.every((assetId, index) => assetId === previousOrder[index])) return;

    setAssetOrderByType(previous => ({ ...previous, [tab]: nextOrder }));
    setSavingAssetOrder(true);
    try {
      const assetById = new Map(filtered.map(asset => [asset.assetId, asset]));
      await Promise.all(nextOrder.map((assetId, index) => {
        const asset = assetById.get(assetId);
        if (!asset) return Promise.resolve();
        return updateAsset(assetId, {
          style_params: {
            ...(asset.styleParams || {}),
            [DESIGN_ASSET_ORDER_KEY]: index,
          },
        });
      }));
      await forceReloadSlices('assets');
      crmMessage.success('卡片顺序已保存');
    } catch (error: any) {
      setAssetOrderByType(previous => ({ ...previous, [tab]: previousOrder }));
      crmMessage.error(`保存卡片顺序失败：${error?.message || String(error)}`);
    } finally {
      setSavingAssetOrder(false);
    }
  }, [
    assetOrderByType,
    draggingAssetId,
    filtered,
    forceReloadSlices,
    savingAssetOrder,
    tab,
  ]);

  const handleSyncExistingDesigns = useCallback(async () => {
    if (!projectId || !episodeId) {
      crmMessage.error('缺少当前项目或分集信息');
      return;
    }
    setSyncingExisting(true);
    try {
      const result = await syncExistingAssetDesigns(projectId, {
        episode_id: episodeId,
        script_id: selectedScriptId || undefined,
        asset_types: ['character', 'scene', 'prop'],
      });
      await forceReloadSlices('assets');
      const synced = Number(result?.synced || 0);
      const copiedFiles = Number(result?.copied_files || 0);
      if (synced > 0) {
        crmMessage.success(`已同步 ${synced} 个已有设计${copiedFiles ? `，复制 ${copiedFiles} 个文件` : ''}`);
      } else if (Number(result?.skipped_existing || 0) > 0) {
        crmMessage.info('当前资产已有设计，无需同步');
      } else {
        crmMessage.warning('未找到可同步的同名设计');
      }
    } catch (err: any) {
      console.error('同步已有设计失败:', err);
      crmMessage.error(`同步已有设计失败：${err?.message || String(err)}`);
    } finally {
      setSyncingExisting(false);
    }
  }, [projectId, episodeId, selectedScriptId, forceReloadSlices]);

  const handleOpenSyncExistingDesigns = useCallback(async () => {
    if (!projectId || !episodeId) {
      crmMessage.error('缺少当前项目或分集信息');
      return;
    }
    setSyncingExisting(true);
    try {
      const result = await listSyncExistingAssetDesignCandidates(projectId, {
        episode_id: episodeId,
        script_id: selectedScriptId || undefined,
        asset_types: ['character', 'scene', 'prop'],
      });
      const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
      if (!candidates.length) {
        crmMessage.warning('未找到其他分集可同步的资产');
        return;
      }
      setSyncCandidates(candidates);
      setSyncModalOpen(true);
    } catch (err: any) {
      console.error('加载可同步资产失败:', err);
      crmMessage.error(`加载可同步资产失败：${err?.message || String(err)}`);
    } finally {
      setSyncingExisting(false);
    }
  }, [projectId, episodeId, selectedScriptId]);

  const handleConfirmSyncExistingDesigns = useCallback(async (sourceAssetIds: string[], overwrite: boolean) => {
    if (!projectId || !episodeId) {
      crmMessage.error('缺少当前项目或分集信息');
      return;
    }
    if (!sourceAssetIds.length) {
      crmMessage.error('请至少选择一个要同步的资产');
      return;
    }
    setSyncSubmitting(true);
    try {
      const result = await syncExistingAssetDesigns(projectId, {
        episode_id: episodeId,
        script_id: selectedScriptId || undefined,
        asset_types: ['character', 'scene', 'prop'],
        source_asset_ids: sourceAssetIds,
        overwrite,
      });
      await forceReloadSlices('assets');
      setSyncModalOpen(false);
      setSyncCandidates([]);
      const created = Number(result?.created || 0);
      const updated = Number(result?.updated || 0);
      const copiedFiles = Number(result?.copied_files || 0);
      const skippedExisting = Number(result?.skipped_existing || 0);
      if (created || updated || copiedFiles) {
        crmMessage.success(`已同步资产：新增 ${created}，更新 ${updated}${copiedFiles ? `，复制文件 ${copiedFiles}` : ''}`);
      } else if (skippedExisting > 0) {
        crmMessage.info('所选资产在当前集已有设计，未覆盖；如需替换请勾选覆盖同名设计');
      } else {
        crmMessage.warning('所选资产没有完成同步，请检查是否仍在其他分集中');
      }
    } catch (err: any) {
      console.error('同步已有设计失败:', err);
      crmMessage.error(`同步已有设计失败：${err?.message || String(err)}`);
    } finally {
      setSyncSubmitting(false);
    }
  }, [projectId, episodeId, selectedScriptId, forceReloadSlices]);

  const handleCreate = useCallback(async () => {
    setFormError(null);
    const n = name.trim();
    if (!n) { setFormError('请填写名称'); return; }
    if (!projectId) { setFormError('缺少项目信息'); return; }
    setIsCreating(true);
    try {
      const res = await createAsset({ project_id: projectId, asset_type: tab, name: n, episode_id: episodeId || undefined, script_id: selectedScriptId || undefined, description: description.trim() || undefined });
      if (!res?.success) { setFormError(typeof res?.detail === 'string' ? res.detail : '创建失败'); return; }
      setName(''); setDescription('');
      await forceReloadSlices('assets');
    } catch (e: unknown) { setFormError(e instanceof Error ? e.message : '创建失败'); }
    finally { setIsCreating(false); }
  }, [name, description, projectId, episodeId, selectedScriptId, tab, forceReloadSlices]);

  const handleDelete = useCallback(async (assetId: string) => {
    const asset = designAssets.find(item => item.assetId === assetId);
    if (!asset) return;
    const typeLabel = asset.assetType === 'character' ? '角色' : asset.assetType === 'scene' ? '场景' : '道具';
    const confirmed = await crmConfirm({
      title: `删除${typeLabel}素材`,
      message: `确定删除${typeLabel}“${asset.name}”吗？删除后，该素材及其设计图将从当前分集移除，且无法撤销。如需再次使用，需要从剧本分镜重新导入。`,
      type: 'danger',
      confirmText: '确认删除',
    });
    if (!confirmed) return;

    setDeletingId(assetId);
    try {
      const res = await deleteAsset(assetId);
      if (res?.success) await forceReloadSlices('assets');
    } catch (e) {
      if (isAssetNotFoundError(e)) {
        crmMessage.warning('该资产已不存在，已刷新列表');
        await forceReloadSlices('assets');
      } else {
        console.error(e);
        crmMessage.error(`删除失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    finally { setDeletingId(null); }
  }, [designAssets, forceReloadSlices]);

  const handleUpdateAssetDetails = useCallback(async (
    asset: AssetItem,
    nextName: string,
    nextDescription: string,
  ) => {
    const normalizedName = nextName.trim();
    if (!normalizedName) throw new Error('名称不能为空');
    const duplicate = designAssets.some(candidate => (
      candidate.assetId !== asset.assetId
      && candidate.assetType === asset.assetType
      && candidate.name.trim() === normalizedName
    ));
    if (duplicate) throw new Error(`当前分集已存在同名${asset.assetType === 'character' ? '角色' : asset.assetType === 'scene' ? '场景' : '道具'}`);
    await updateAsset(asset.assetId, {
      name: normalizedName,
      description: nextDescription.trim(),
    });
    await forceReloadSlices('assets');
    crmMessage.success('素材信息已保存');
  }, [designAssets, forceReloadSlices]);

  const handleUploadImage = useCallback(async (assetId: string, file: File) => {
    setUploadingId(assetId);
    try {
      const { uploadEntityFile } = await import('../services/entityFileService');
      await uploadEntityFile(file, 'asset', assetId, 'reference_image', episodeId);
      await forceReloadSlices('assets');
    } catch (err) { console.error('上传失败:', err); }
    finally { setUploadingId(null); }
  }, [episodeId, forceReloadSlices]);

  const handleDeleteImage = useCallback(async (assetId: string, imageUrl: string, fileId?: string) => {
    if (fileId) {
      const { deleteEntityFile } = await import('../services/entityFileService');
      try {
        await deleteEntityFile(fileId);
        await forceReloadSlices('assets');
      } catch (err) { console.error('删除图片失败:', err); }
      return;
    }
    const asset = designAssets.find(a => a.assetId === assetId);
    if (!asset) return;
    const newRefs = (asset.referenceImages || []).filter(u => u !== imageUrl);
    const newThumb = asset.thumbnailUrl === imageUrl ? (newRefs[0] || '') : asset.thumbnailUrl;
    try {
      await updateAsset(assetId, { reference_images: newRefs, thumbnail_url: newThumb });
      await forceReloadSlices('assets');
    } catch (err) { console.error('删除图片失败:', err); }
  }, [designAssets, forceReloadSlices]);

  const handleAIGeneration = useCallback(async (payload: {
    assetId: string; engine: MaterialAIEngine; geminiModel: string; prompt: string;
    references: string[]; aspectRatio: string; resolution: '1K' | '2K' | '4K';
    sequential: string; count: number; referencePurpose?: SeedreamPurpose;
  }) => {
    const generationModel = findDesignImageModel(payload.engine, payload.geminiModel);
    const requestedImageCount = payload.engine === 'doubao' && payload.sequential === 'auto'
      ? Math.max(1, payload.count)
      : 1;
    const model = generationModel.billingModel;
    const estimateParams = designImageCreditParams({
      imageCount: requestedImageCount,
      model,
      resolution: payload.resolution,
      aspectRatio: payload.aspectRatio,
    });
    try {
      await assertEnoughCredits(DESIGN_CREDIT_FEATURES.imageGeneration, estimateParams);
    } catch (err: any) {
      crmMessage.error(err?.message || '创作点数校验失败');
      return;
    }

    setAiModal(null);
    savePrefs({ engine: payload.engine, geminiModel: payload.geminiModel, aspect: payload.aspectRatio, resolution: payload.resolution });
    setBusyAssetId(payload.assetId); setBusyLabel('AI 生图中...');
    let generatedCount = 0;
    let actualBillingModel = model;
    let fallbackReason: string | undefined;
    try {
      const entityOpts = { entityType: 'asset' as const, entityId: payload.assetId, fileRole: 'reference_image' as const, episodeId: episodeId || undefined };
      const generation = await generateImageWithPreferredFallback({
        engine: payload.engine,
        model: generationModel.id,
        billingModel: generationModel.billingModel,
        count: requestedImageCount,
        doubao: {
          referencePurpose: payload.referencePurpose,
          prompt: payload.prompt,
          references: payload.references,
          size: recommendDoubaoImageSize(payload.aspectRatio, payload.resolution),
          sequential: payload.sequential as any,
          ...entityOpts,
        },
        gemini: {
          prompt: payload.prompt,
          references: payload.references,
          aspectRatio: payload.aspectRatio,
          imageSize: payload.resolution,
          ...entityOpts,
        },
      });
      const generated: GeneratedFileResult[] = generation.files;
      actualBillingModel = generation.actualBillingModel;
      fallbackReason = generation.fallbackReason;
      if (generated.length === 0) {
        throw new Error('生成接口未返回有效图片，本次不扣创作点数');
      }
      generatedCount = generated.length;
      const settlement = await consumeCredits({
        featureKey: DESIGN_CREDIT_FEATURES.imageGeneration,
        taskId: newDesignCreditUsageId('design-image'),
        params: designImageCreditParams({
          imageCount: generatedCount,
          model: actualBillingModel,
          resolution: payload.resolution,
          aspectRatio: payload.aspectRatio,
        }),
        projectId,
        metadata: {
          episode_id: episodeId || null,
          asset_id: payload.assetId,
          engine: generation.actualEngine,
          requested_model: generationModel.id,
          actual_model: generation.actualModel,
          fallback_reason: fallbackReason || null,
        },
      });
      await forceReloadSlices('assets');
      crmMessage.success(`${fallbackReason ? '豆包暂不可用，已由 Gemini 3.1 生成；' : ''}生成 ${generatedCount} 张图片，已扣除 ${settlement.charged_credits} 创作点数`);
    } catch (err: any) {
      console.error('AI生成失败:', err);
      if (generatedCount > 0) {
        await forceReloadSlices('assets').catch(() => undefined);
        crmMessage.warning(`图片已生成，但创作点数结算失败：${err?.message || String(err)}`);
      } else {
        crmMessage.error(err?.message || 'AI生成失败');
      }
    }
    finally { setBusyAssetId(null); }
  }, [episodeId, projectId, forceReloadSlices]);

  const handleCameraGenerate = useCallback(async (payload: { assetId: string; imageUrl: string; rotate: number; move: number; vertical: number; wideAngle: boolean; customPrompt?: string }) => {
    const resolution = onlineImageOperationResolution('angle_adjustment');
    const creditParams = designImageCreditParams({
      imageCount: 1,
      model: ONLINE_IMAGE_OPERATION_BILLING_MODEL,
      resolution,
      aspectRatio: 'auto',
    });
    try {
      await assertEnoughCredits(DESIGN_CREDIT_FEATURES.imageGeneration, creditParams);
    } catch (err: any) {
      crmMessage.error(err?.message || '创作点数校验失败');
      return;
    }

    setCameraModal(null);
    setBusyAssetId(payload.assetId); setBusyLabel('角度调整中...');
    try {
      const prompts: string[] = [];
      const orbit = buildHorizontalCameraOrbitInstruction(payload.rotate);
      if (orbit) prompts.push(orbit);
      if (payload.move > 0) prompts.push(`Move camera forward by ${payload.move} steps.`);
      if (payload.vertical === 1) prompts.push("Turn the camera to a worm's-eye view.");
      else if (payload.vertical === -1) prompts.push("Turn the camera to a bird's-eye view.");
      if (payload.wideAngle) prompts.push("Switch to a wide-angle lens.");
      const finalPrompt = payload.customPrompt?.trim() || prompts.join(' ') || '保持当前画面构图和内容。';
      const result = await runOnlineImageOperation({
        operation: 'angle_adjustment',
        sourceImage: payload.imageUrl,
        instruction: finalPrompt,
        entityType: 'asset',
        entityId: payload.assetId,
        fileRole: 'reference_image',
        projectId: projectId || undefined,
        episodeId: episodeId || undefined,
      });
      await forceReloadSlices('assets');
      try {
        const settlement = await consumeCredits({
          featureKey: DESIGN_CREDIT_FEATURES.imageGeneration,
          taskId: newDesignCreditUsageId('design-angle-online'),
          params: creditParams,
          projectId,
          metadata: {
            episode_id: episodeId || null,
            asset_id: payload.assetId,
            workflow: 'angle_adjustment',
            provider_model: ONLINE_IMAGE_OPERATION_BILLING_MODEL,
            file_id: result.fileId || null,
          },
        });
        crmMessage.success(`角度调整完成，已扣除 ${settlement.charged_credits} 创作点数`);
      } catch (err: any) {
        console.error('Online angle credit settlement failed', err);
        crmMessage.warning(`图片已保存，但创作点数结算失败：${err?.message || String(err)}`);
      }
    } catch (err: any) { console.error('角度调整失败:', err); crmMessage.error(err?.message || '角度调整失败'); }
    finally { setBusyAssetId(null); }
  }, [episodeId, projectId, forceReloadSlices]);

  const handleProcessSubmit = useCallback(async (payload: { materialUrl: string }) => {
    if (!processModal) return;
    const workflow = processModal.workflow;
    const resolution = onlineImageOperationResolution(workflow);
    const creditParams = designImageCreditParams({
      imageCount: 1,
      model: ONLINE_IMAGE_OPERATION_BILLING_MODEL,
      resolution,
      aspectRatio: 'auto',
    });
    try {
      await assertEnoughCredits(DESIGN_CREDIT_FEATURES.imageGeneration, creditParams);
    } catch (err: any) {
      crmMessage.error(err?.message || '创作点数校验失败');
      return;
    }

    setProcessModal(null);
    setBusyAssetId(processModal.asset.assetId); setBusyLabel(workflow === 'upscale_hd' ? '高清放大中...' : '去水印中...');
    try {
      const result = await runOnlineImageOperation({
        operation: workflow,
        sourceImage: payload.materialUrl,
        entityType: 'asset',
        entityId: processModal.asset.assetId,
        fileRole: 'reference_image',
        projectId: projectId || undefined,
        episodeId: episodeId || undefined,
      });
      await forceReloadSlices('assets');
      try {
        const settlement = await consumeCredits({
          featureKey: DESIGN_CREDIT_FEATURES.imageGeneration,
          taskId: newDesignCreditUsageId(`design-${workflow}-online`),
          params: creditParams,
          projectId,
          metadata: {
            episode_id: episodeId || null,
            asset_id: processModal.asset.assetId,
            workflow,
            provider_model: ONLINE_IMAGE_OPERATION_BILLING_MODEL,
            file_id: result.fileId || null,
          },
        });
        crmMessage.success(`${workflow === 'upscale_hd' ? '高清放大' : '去水印'}完成，已扣除 ${settlement.charged_credits} 创作点数`);
      } catch (err: any) {
        console.error('Online image operation credit settlement failed', err);
        crmMessage.warning(`图片已保存，但创作点数结算失败：${err?.message || String(err)}`);
      }
    } catch (err: any) { console.error('处理失败:', err); crmMessage.error(err?.message || '处理失败'); }
    finally { setBusyAssetId(null); }
  }, [processModal, episodeId, projectId, forceReloadSlices]);

  const handleBatchGenerate = useCallback(async (config: {
    assetIds: string[]; engine: MaterialAIEngine; geminiModel: string; style: string;
    aspectRatio: string; resolution: '1K' | '2K' | '4K'; threeView: boolean;
    refineModel: AiModel;
  }) => {
    const targets = designAssets.filter(a => config.assetIds.includes(a.assetId));
    const generationModel = findDesignImageModel(config.engine, config.geminiModel);
    const model = generationModel.billingModel;
    const estimateParams = designImageCreditParams({
      imageCount: targets.length,
      model,
      resolution: config.resolution,
      aspectRatio: config.aspectRatio,
    });
    try {
      await assertEnoughCredits(DESIGN_CREDIT_FEATURES.imageGeneration, estimateParams);
    } catch (err: any) {
      crmMessage.error(err?.message || '创作点数校验失败');
      return;
    }

    setBatchModal(false);
    savePrefs({ engine: config.engine, geminiModel: config.geminiModel, style: config.style, aspect: config.aspectRatio, resolution: config.resolution, refineModel: config.refineModel });
    let okCount = 0;
    let generatedCount = 0;
    const generatedCountsByModel = new Map<string, number>();
    const errors: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const asset = targets[i];
      setBusyAssetId(asset.assetId); setBusyLabel(`批量生成 ${i + 1}/${targets.length}...`);
      try {
        let desc = asset.description || '';
        if (!desc.trim()) {
          const p = buildRefinePrompt(asset.assetType, asset.name, '', scriptText, config.style, config.threeView);
          let result: any;
          try {
            result = await callAI(config.refineModel, { system: p.system, user: p.user });
          } catch (refineErr: any) {


            if (config.refineModel !== AiModel.DeepseekChat) {
              console.warn(`${asset.name} Gemini 推断被拦，回退 DeepSeek：`, refineErr?.message);
              result = await callAI(AiModel.DeepseekChat, { system: p.system, user: p.user });
            } else {
              throw refineErr;
            }
          }
          if (result && typeof result === 'string') {
            desc = result.trim();
            await updateAsset(asset.assetId, { description: desc });
          }
        }
        const prompt = withStandardTurnaround(
          applyImageStylePreset(desc, config.style),
          asset.assetType,
          config.threeView,
        );
        const aspectRatio = standardTurnaroundAspectRatio(
          asset.assetType,
          config.aspectRatio,
          config.threeView,
        );
        const entityOpts = { entityType: 'asset' as const, entityId: asset.assetId, fileRole: 'reference_image' as const, episodeId: episodeId || undefined };
        const generation = await generateImageWithPreferredFallback({
          engine: config.engine,
          model: generationModel.id,
          billingModel: generationModel.billingModel,
          count: 1,
          doubao: {
            prompt,
            references: [],
            size: recommendDoubaoImageSize(aspectRatio, config.resolution),
            ...entityOpts,
          },
          gemini: {
            prompt,
            references: [],
            aspectRatio,
            imageSize: config.resolution,
            ...entityOpts,
          },
        });
        const generated: GeneratedFileResult[] = generation.files;
        if (generated.length === 0) {
          throw new Error('生成接口未返回有效图片，本项不扣创作点数');
        }
        generatedCount += generated.length;
        generatedCountsByModel.set(
          generation.actualBillingModel,
          (generatedCountsByModel.get(generation.actualBillingModel) || 0) + generated.length,
        );
        okCount++;
      } catch (err: any) {

        errors.push(`${asset.name}：${err?.message || String(err)}`);
        console.error(`批量生成 ${asset.name} 失败:`, err);
      }
    }
    let chargedCredits = 0;
    if (generatedCount > 0) {
      try {
        for (const [actualModel, imageCount] of generatedCountsByModel) {
          const settlement = await consumeCredits({
            featureKey: DESIGN_CREDIT_FEATURES.imageGeneration,
            taskId: newDesignCreditUsageId('design-image-batch'),
            params: designImageCreditParams({
              imageCount,
              model: actualModel,
              resolution: config.resolution,
              aspectRatio: config.aspectRatio,
            }),
            projectId,
            metadata: {
              episode_id: episodeId || null,
              asset_ids: targets.map(asset => asset.assetId),
              requested_model: generationModel.id,
              actual_billing_model: actualModel,
              batch: true,
            },
          });
          chargedCredits += settlement.charged_credits;
        }
      } catch (err: any) {
        errors.push(`创作点数结算失败：${err?.message || String(err)}`);
      }
    }
    await forceReloadSlices('assets');
    setBusyAssetId(null); setBusyLabel('');
    if (!errors.length) {
      crmMessage.success(`批量生成完成：成功 ${okCount} 项，已扣除 ${chargedCredits} 创作点数`);
    } else if (okCount > 0) {
      crmMessage.warning(`批量生成：成功 ${okCount}，失败 ${errors.length}。首个失败 → ${errors[0]}`);
    } else {
      crmMessage.error(`批量生成全部失败（${errors.length} 项）。原因 → ${errors[0]}`);
    }
  }, [designAssets, scriptText, episodeId, projectId, forceReloadSlices]);

  const tabLabel = tab === 'character' ? '人物' : tab === 'scene' ? '场景' : '道具';

  return (
    <div className="workflow-stage-layout h-full min-h-0 bg-n20 text-n800 flex flex-col overflow-hidden">
      <header className="workflow-stage-toolbar shrink-0 min-h-[52px] bg-n0 border-b border-n40 flex items-stretch">
        <div className="w-80 shrink-0 px-4 py-2 border-r border-n40 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Grid3X3 size={16} className="text-primary shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-n700 truncate">设计列表</h1>
              <p className="text-[10px] text-n100 truncate">人物、场景与道具</p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] text-n100">已设计</div>
            <div className="text-xs font-semibold text-success">{totalDesignedCount}/{designAssets.length}</div>
          </div>
        </div>

        <div className="min-w-0 flex-1 px-4 py-2 flex flex-wrap items-center gap-3">
          <div className="flex items-baseline gap-2 shrink-0">
            <h2 className="text-sm font-bold text-n700">{tabLabel}设计</h2>
            <span className="text-[10px] text-n100">{tabDesignedCount}/{filtered.length}</span>
          </div>
          <div className="ui-tabs ui-tabs--compact" role="tablist" aria-label="设计分类">
            {TAB_CONFIG.map(({ key, label, Icon }) => {
              const active = tab === key; const count = designAssets.filter(a => a.assetType === key).length;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => { setTab(key); setSelectedIds(new Set()); }}
                  className="ui-tab"
                >
                  <Icon size={13} />
                  {label}
                  {count > 0 && (
                    <span className="ui-tab-count">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <div className="inline-flex overflow-hidden rounded-md border border-n40 bg-n0 shadow-sm" role="group" aria-label="批量选择">
              <button
                onClick={selectAllFiltered}
                className="h-8 px-3 text-xs font-medium text-n700 border-r border-n40 hover:bg-primary hover:text-white transition-colors"
              >
                全选
              </button>
              <button
                onClick={selectUndesigned}
                className="h-8 px-3 text-xs font-medium text-n700 border-r border-n40 hover:bg-primary hover:text-white transition-colors"
              >
                选未设计
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                disabled={selectedIds.size === 0}
                className="h-8 px-3 text-xs font-medium text-n700 hover:bg-primary hover:text-white transition-colors disabled:text-n100 disabled:hover:bg-n0"
              >
                清空
              </button>
            </div>
            <button
              onClick={handleOpenSyncExistingDesigns}
              disabled={syncingExisting || !projectId || !episodeId}
              className="h-8 flex items-center gap-1.5 px-3 bg-n0 hover:bg-n20 text-n700 text-xs rounded-md transition-colors border border-n40 disabled:opacity-50"
            >
              {syncingExisting ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              同步已有设计
            </button>
            <button
              onClick={() => setBatchModal(true)}
              className={`h-8 flex items-center gap-1.5 px-3 text-xs rounded-md transition-colors border ${
                selectedIds.size > 0
                  ? 'bg-primary hover:bg-primary-hover text-white border-primary'
                  : 'bg-n0 hover:bg-n20 text-n700 border-n40'
              }`}
            >
              <Layers size={13} />
              {selectedIds.size > 0 ? `批量生成 (${selectedIds.size})` : '批量生成'}
            </button>
            <button
              onClick={() => navigate(`/projects/${projectId}/ep/${episodeId}/workflow/materials`)}
              className="h-8 flex items-center gap-1.5 px-3 bg-primary hover:bg-primary-hover text-white text-xs rounded-md transition-colors"
            >
              导出到素材绑定 <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="shrink-0 mx-4 mt-3 px-4 py-3 rounded-lg bg-r50 border border-r75 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="workflow-stage-layout flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        <aside className="workflow-stage-sidebar workflow-stage-scroll w-full lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-n40 bg-n0 p-4 lg:overflow-y-auto custom-scrollbar">
          <div className="bg-n0 rounded-md p-5 border border-n40 shadow-card">
            <div className="flex items-center gap-2 mb-4"><Plus size={18} className="text-primary" /><span className="font-semibold text-sm">新建{tabLabel}</span></div>
            <label className="block text-xs text-n100 mb-1.5">名称</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="例如：主角 / 客厅 / 古剑"
              className="w-full px-3 py-2.5 rounded-lg bg-n0 border border-n40 text-n800 text-sm placeholder:text-n100 focus:outline-none focus:ring-2 focus:ring-primary/20 mb-4" />
            <label className="block text-xs text-n100 mb-1.5">描述</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="外观、风格、材质、色彩与氛围等" rows={7}
              className="w-full min-h-40 px-3 py-2.5 rounded-lg bg-n0 border border-n40 text-n800 text-sm leading-relaxed placeholder:text-n100 resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 mb-4" />
            {formError && <p className="text-xs text-danger mb-3">{formError}</p>}
            <button onClick={handleCreate} disabled={isCreating || !projectId}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-sm transition-all disabled:opacity-50 shadow-lg shadow-indigo-600/20">
              {isCreating && <Loader size={16} className="animate-spin" />} {isCreating ? '创建中...' : '创建'}
            </button>
          </div>
        </aside>

        <section className="workflow-stage-canvas workflow-stage-scroll flex-1 min-w-0 p-4 lg:overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-n100 text-sm"><Loader size={20} className="animate-spin" /> 加载资产...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 bg-n0 rounded-md border border-dashed border-n40 text-n100">
              <Palette size={40} className="mx-auto mb-3 opacity-40" /><p className="text-sm">暂无{tabLabel}资产</p>
              <p className="text-xs mt-1 text-n100">在左侧创建，或从剧本页导出</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orderedFiltered.map((asset) => {
                const hasDesign = assetHasDesign(asset);
                const legacyImgs = getLegacyAssetImageUrls(asset);
                const busy = isBusy(asset.assetId);
                const checked = selectedIds.has(asset.assetId);
                return (
                  <div
                    key={asset.assetId}
                    onDragOver={event => {
                      if (!draggingAssetId || draggingAssetId === asset.assetId) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDragOverAssetId(asset.assetId);
                    }}
                    onDragLeave={event => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDragOverAssetId(current => current === asset.assetId ? null : current);
                      }
                    }}
                    onDrop={event => {
                      event.preventDefault();
                      void handleDropAsset(asset.assetId);
                    }}
                    className={`bg-n0 rounded-md border transition-all duration-300 shadow-card hover:shadow-atlas ${
                      dragOverAssetId === asset.assetId ? 'border-primary ring-2 ring-primary/20' : hasDesign ? 'border-n40' : 'border-warning border-dashed'
                    } ${draggingAssetId === asset.assetId ? 'opacity-60' : ''}`}
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <span
                            role="button"
                            tabIndex={0}
                            draggable={!savingAssetOrder}
                            title="拖动调整卡片顺序"
                            aria-label={`拖动调整 ${asset.name} 的顺序`}
                            onDragStart={event => {
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('text/plain', asset.assetId);
                              setDraggingAssetId(asset.assetId);
                            }}
                            onDragEnd={() => {
                              setDraggingAssetId(null);
                              setDragOverAssetId(null);
                            }}
                            className={`shrink-0 mt-0.5 text-n100 hover:text-primary ${
                              savingAssetOrder ? 'cursor-wait opacity-40' : 'cursor-grab active:cursor-grabbing'
                            }`}
                          >
                            <GripVertical size={18} />
                          </span>
                          <button onClick={() => toggleSelect(asset.assetId)} className="shrink-0 mt-0.5">
                            {checked ? <CheckSquare size={18} className="text-primary" /> : <Square size={18} className="text-n100" />}
                          </button>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold truncate">{asset.name}</span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${hasDesign ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}>
                                {hasDesign ? '已设计' : '待设计'}
                              </span>
                              {busy && <span className="text-[10px] text-primary animate-pulse flex items-center gap-1"><Loader size={10} className="animate-spin" />{busyLabel}</span>}
                            </div>
                            {asset.description && <p className="text-[11px] text-n100 mt-1 line-clamp-2">{asset.description}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          <button
                            type="button"
                            onClick={() => setEditAsset(asset)}
                            disabled={busy}
                            title={`编辑${asset.assetType === 'character' ? '角色' : asset.assetType === 'scene' ? '场景' : '道具'}`}
                            className="p-1.5 rounded-lg text-[11px] border border-n40 bg-n0 text-n300 hover:border-primary hover:text-primary transition-all disabled:opacity-30"
                          >
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => handleDelete(asset.assetId)} disabled={busy}
                            className="p-1.5 rounded-lg text-[11px] border border-r75 bg-r50 text-danger hover:bg-r50 transition-all disabled:opacity-30">
                            {deletingId === asset.assetId ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </div>
                      </div>
                      <AssetImageRow
                        assetId={asset.assetId}
                        entityFiles={asset.entityFiles || []}
                        legacyImages={legacyImgs}
                        onLightbox={(images, currentIndex) => setLightbox({ images, currentIndex })}
                        onDeleteImage={handleDeleteImage}
                        busy={busy}
                      />
                      <div className="flex flex-wrap gap-1.5">
                        <button onClick={() => setAiModal({ asset })} disabled={busy}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-primary-light border border-primary text-primary hover:bg-primary-light transition-all disabled:opacity-30">
                          <Sparkles size={11} /> AI 生图
                        </button>
                        <label className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-n0 border border-n40 text-n300 hover:bg-n20 transition-all cursor-pointer ${busy ? 'opacity-30' : ''}`}>
                          <Upload size={11} /> 上传
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadImage(asset.assetId, f); e.target.value = ''; }} />
                        </label>
                        <button onClick={() => { const m = assetToMaterials(asset); if (!m.length) { crmMessage.error('请先上传或生成图片'); return; } setCameraModal({ asset, materials: m }); }} disabled={busy}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-n0 border border-n40 text-n300 hover:bg-n20 transition-all disabled:opacity-30">
                          <Camera size={11} /> 角度
                        </button>
                        <button onClick={() => { const m = assetToMaterials(asset); if (!m.length) { crmMessage.error('请先上传或生成图片'); return; } setProcessModal({ asset, materials: m, workflow: 'upscale_hd' }); }} disabled={busy}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-n0 border border-n40 text-n300 hover:bg-n20 transition-all disabled:opacity-30">
                          <Maximize size={11} /> 高清放大
                        </button>
                        <button onClick={() => { const m = assetToMaterials(asset); if (!m.length) { crmMessage.error('请先上传或生成图片'); return; } setProcessModal({ asset, materials: m, workflow: 'remove_watermark' }); }} disabled={busy}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-n0 border border-n40 text-n300 hover:bg-n20 transition-all disabled:opacity-30">
                          <Scissors size={11} /> 去水印
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {lightbox && (
        <ImagePreviewLightbox
          images={lightbox.images}
          currentIndex={lightbox.currentIndex}
          onIndexChange={currentIndex => setLightbox(current => current ? { ...current, currentIndex } : null)}
          onClose={() => setLightbox(null)}
        />
      )}

      {aiModal && <UnifiedAIModal asset={aiModal.asset} assets={designAssets} scriptText={scriptText} modelOptions={scriptModelOptions} projectId={projectId} episodeId={episodeId} onClose={() => setAiModal(null)} onSubmit={handleAIGeneration} />}
      {cameraModal && <CameraModal asset={cameraModal.asset} materials={cameraModal.materials} onClose={() => setCameraModal(null)} onSubmit={(p) => handleCameraGenerate({ ...p, assetId: cameraModal.asset.assetId })} />}
      {processModal && <ProcessModal asset={processModal.asset} materials={processModal.materials} workflow={processModal.workflow} onClose={() => setProcessModal(null)} onSubmit={handleProcessSubmit} />}
      {batchModal && <BatchGenerateModal assets={designAssets} selectedIds={selectedIds} scriptText={scriptText} modelOptions={scriptModelOptions} onClose={() => setBatchModal(false)} onSubmit={handleBatchGenerate} />}
      {editAsset && (
        <AssetEditModal
          asset={editAsset}
          onClose={() => setEditAsset(null)}
          onSubmit={handleUpdateAssetDetails}
        />
      )}
      {syncModalOpen && (
        <SyncExistingDesignModal
          candidates={syncCandidates}
          submitting={syncSubmitting}
          onClose={() => { if (!syncSubmitting) setSyncModalOpen(false); }}
          onSubmit={handleConfirmSyncExistingDesigns}
        />
      )}
    </div>
  );
};

const AssetEditModal: React.FC<{
  asset: AssetItem;
  onClose: () => void;
  onSubmit: (asset: AssetItem, name: string, description: string) => Promise<void>;
}> = ({ asset, onClose, onSubmit }) => {
  const [draftName, setDraftName] = useState(asset.name);
  const [draftDescription, setDraftDescription] = useState(asset.description || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const typeLabel = asset.assetType === 'character' ? '角色' : asset.assetType === 'scene' ? '场景' : '道具';

  const handleSubmit = async () => {
    setError('');
    setSaving(true);
    try {
      await onSubmit(asset, draftName, draftDescription);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] bg-black/45 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`编辑${typeLabel}`}
        className="w-full max-w-lg rounded-xl bg-n0 border border-n40 shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-n40">
          <div>
            <h3 className="text-base font-bold text-n800">编辑{typeLabel}</h3>
            <p className="text-xs text-n100 mt-1">名称修改后会同步更新现有镜头中的同名绑定。</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="p-1.5 rounded text-n100 hover:text-n700 hover:bg-n20 disabled:opacity-40">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <label className="block">
            <span className="block text-xs text-n300 mb-1.5">名称</span>
            <input
              autoFocus
              value={draftName}
              onChange={event => setDraftName(event.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-n40 text-sm text-n800 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-n300 mb-1.5">描述 / AI 提示词</span>
            <textarea
              rows={7}
              value={draftDescription}
              onChange={event => setDraftDescription(event.target.value)}
              placeholder={`补充${typeLabel}外观、材质、色彩与环境等细节`}
              className="w-full min-h-40 px-3 py-2.5 rounded-lg border border-n40 text-sm leading-relaxed text-n800 resize-y focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-n40">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-n40 text-sm text-n300 hover:bg-n20 disabled:opacity-40">取消</button>
          <button type="button" onClick={handleSubmit} disabled={saving || !draftName.trim()} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-hover disabled:opacity-40 inline-flex items-center gap-1.5">
            {saving && <Loader size={14} className="animate-spin" />}
            {saving ? '保存中...' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
};

const syncTypeLabel = (type: string) => type === 'character' ? '人物' : type === 'scene' ? '场景' : '道具';

const SyncExistingDesignModal: React.FC<{
  candidates: SyncExistingAssetCandidate[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (sourceAssetIds: string[], overwrite: boolean) => void;
}> = ({ candidates, submitting, onClose, onSubmit }) => {
  const [checked, setChecked] = useState<Set<string>>(() => {
    const preferred = candidates.filter(c => c.has_design && !c.target_has_design).map(c => c.asset_id);
    return new Set(preferred.length ? preferred : candidates.map(c => c.asset_id));
  });
  const [overwrite, setOverwrite] = useState(false);

  const grouped = useMemo(() => {
    const result: Record<'character' | 'scene' | 'prop', SyncExistingAssetCandidate[]> = {
      character: [],
      scene: [],
      prop: [],
    };
    candidates.forEach(candidate => {
      if (candidate.asset_type === 'character' || candidate.asset_type === 'scene' || candidate.asset_type === 'prop') {
        result[candidate.asset_type].push(candidate);
      }
    });
    return result;
  }, [candidates]);

  const selectedCount = checked.size;
  const designedCount = candidates.filter(c => c.has_design).length;
  const toggle = (assetId: string) => setChecked(prev => {
    const next = new Set(prev);
    next.has(assetId) ? next.delete(assetId) : next.add(assetId);
    return next;
  });

  const selectDesigned = () => setChecked(new Set(candidates.filter(c => c.has_design).map(c => c.asset_id)));
  const selectAll = () => setChecked(new Set(candidates.map(c => c.asset_id)));

  return (
    <div className="fixed inset-0 bg-n900/50 backdrop-blur-sm flex items-center justify-center z-[140] p-6" onClick={onClose}>
      <div className="w-full max-w-5xl bg-n0 border border-n40 rounded-2xl shadow-bottom max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-n40 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-n800">同步其他分集资产</h3>
            <p className="text-xs text-n100 mt-1">从项目其他分集中选择人物、场景或道具，确认后复制到当前分集。</p>
          </div>
          <button onClick={onClose} disabled={submitting} className="text-n300 hover:text-n800 disabled:opacity-40"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-3 border-b border-n40 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-n100">候选 {candidates.length} 个</span>
          <span className="text-success">已设计 {designedCount}</span>
          <span className="text-primary font-semibold">已选 {selectedCount}</span>
          <button onClick={selectDesigned} className="px-2.5 py-1 rounded border border-n40 hover:bg-n20 text-n700">只选已设计</button>
          <button onClick={selectAll} className="px-2.5 py-1 rounded border border-n40 hover:bg-n20 text-n700">全选</button>
          <button onClick={() => setChecked(new Set())} className="px-2.5 py-1 rounded border border-n40 hover:bg-n20 text-n700">清空</button>
          <label className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg border border-warning/40 bg-warning/10 text-warning">
            <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} className="accent-orange-500" />
            覆盖当前集同名已有设计
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {(['character', 'scene', 'prop'] as const).map(type => {
            const items = grouped[type];
            if (!items.length) return null;
            return (
              <section key={type} className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-n700">
                  <span>{syncTypeLabel(type)}</span>
                  <span className="text-n100 font-normal">{items.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {items.map(candidate => {
                    const selected = checked.has(candidate.asset_id);
                    const preview = secureMediaUrl(candidate.preview_url || candidate.thumbnail_url || null);
                    return (
                      <button
                        key={candidate.asset_id}
                        type="button"
                        onClick={() => toggle(candidate.asset_id)}
                        className={`w-full text-left rounded-lg border p-3 transition-all flex gap-3 ${selected ? 'border-primary bg-primary-light' : 'border-n40 bg-n0 hover:bg-n20'}`}
                      >
                        <div className="pt-1 shrink-0">
                          {selected ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} className="text-n100" />}
                        </div>
                        <div className="w-14 h-14 rounded-md overflow-hidden border border-n40 bg-n30 shrink-0 flex items-center justify-center">
                          {preview ? <img src={preview} alt="" className="w-full h-full object-cover" /> : <Palette size={18} className="text-n100" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-bold text-n800 truncate">{candidate.name}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${candidate.has_design ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
                              {candidate.has_design ? `已设计 ${candidate.image_count || 0}` : '待设计'}
                            </span>
                          </div>
                          <div className="text-[11px] text-n100 mt-1 truncate">来源：{candidate.source_episode_label || candidate.source_episode_id || '其他分集'}</div>
                          {candidate.description && <div className="text-[11px] text-n300 mt-1 line-clamp-2">{candidate.description}</div>}
                          {candidate.exists_in_target && (
                            <div className={`text-[11px] mt-1 ${candidate.target_has_design ? 'text-warning' : 'text-primary'}`}>
                              当前集已有同名资产{candidate.target_has_design ? '，默认不覆盖' : '，将补齐设计'}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-n40 flex justify-end gap-3">
          <button onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20 disabled:opacity-50">取消</button>
          <button
            onClick={() => onSubmit(Array.from(checked), overwrite)}
            disabled={submitting || selectedCount === 0}
            className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-xs font-bold text-white shadow-lg disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <Loader size={14} className="animate-spin" />}
            同步到当前集 ({selectedCount})
          </button>
        </div>
      </div>
    </div>
  );
};

const UnifiedAIModal: React.FC<{
  asset: AssetItem; assets: AssetItem[]; scriptText: string; modelOptions: readonly ScriptModelOption[]; projectId?: string | null; episodeId?: string | null; onClose: () => void;
  onSubmit: (p: { assetId: string; engine: MaterialAIEngine; geminiModel: string; prompt: string; references: string[]; aspectRatio: string; resolution: '1K' | '2K' | '4K'; sequential: string; count: number; referencePurpose?: SeedreamPurpose }) => void;
}> = ({ asset, assets, scriptText, modelOptions, projectId, episodeId, onClose, onSubmit }) => {
  const { forceReloadSlices } = useEpisode();
  const { project } = useProject();
  const defaultAspectRatio = projectDefaultAspectRatio(
    project?.settings,
    savedAspect() === '9:16' ? '9:16' : '16:9',
  );
  const storedPrompt = useMemo(
    () => (asset.styleParams?.ai_prompt as string) || asset.description || asset.name,
    [asset],
  );
  const initialPrompt = useMemo(
    () => stripImageStylePresets(storedPrompt),
    [storedPrompt],
  );
  const [engine, setEngine] = useState<MaterialAIEngine>(savedEngine());
  const [geminiModel, setGeminiModel] = useState(savedGeminiModel());
  const [prompt, setPrompt] = useState(initialPrompt);
  const [aspectRatio, setAspectRatio] = useState(() => standardTurnaroundAspectRatio(
    asset.assetType,
    defaultAspectRatio,
    supportsStandardTurnaround(asset.assetType),
  ));
  const [resolution, setResolution] = useState<DesignImageResolution>(() => (
    normalizeDesignImageResolution(
      findDesignImageModel(savedEngine(), savedGeminiModel()),
      savedResolution(),
    )
  ));
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [sequential, setSequential] = useState<'disabled' | 'auto'>('disabled');
  const [purpose, setPurpose] = useState<SeedreamPurpose>();
  const referencePurpose = engine === 'doubao' ? purpose : undefined;
  const [count, setCount] = useState(1);
  const [activeStyle, setActiveStyle] = useState(
    () => detectImageStylePreset(storedPrompt) || savedStyle(),
  );
  const [standardTurnaround, setStandardTurnaround] = useState(
    supportsStandardTurnaround(asset.assetType),
  );
  const [isRefining, setIsRefining] = useState(false);
  const [refineModel, setRefineModel] = useState(savedRefineModel());
  const [uploadingReferences, setUploadingReferences] = useState(false);
  const [uploadedReferenceMaterials, setUploadedReferenceMaterials] = useState<ModalMaterial[]>([]);
  const persistedPromptRef = useRef(storedPrompt.trim());
  const materials = useMemo(() => {
    const candidates: ModalMaterial[] = [
      ...assetToMaterials(asset).map(material => ({ ...material, sourceKind: 'current' as const })),
      ...uploadedReferenceMaterials,
    ];
    if (asset.assetType === 'scene') {
      assets
        .filter(candidate => candidate.assetType === 'scene' && candidate.assetId !== asset.assetId)
        .forEach(candidate => {
          candidates.push(...assetToMaterials(candidate).map(material => ({
            ...material,
            sourceKind: 'related-scene' as const,
          })));
        });
    }
    const seenUrls = new Set<string>();
    return candidates.filter(material => {
      if (!material.url || seenUrls.has(material.url)) return false;
      seenUrls.add(material.url);
      return true;
    });
  }, [asset, assets, uploadedReferenceMaterials]);
  const currentMaterials = materials.filter(material => material.sourceKind === 'current');
  const uploadedMaterials = materials.filter(material => material.sourceKind === 'external-upload');
  const relatedSceneMaterials = materials.filter(material => material.sourceKind === 'related-scene');
  const selectedQuotaReferenceCount = useMemo(
    () => countDesignImageQuotaReferences(selectedRefs, materials),
    [materials, selectedRefs],
  );
  const selectedRelatedSceneReferenceCount = selectedRefs.size - selectedQuotaReferenceCount;
  const generationModel = useMemo(
    () => findDesignImageModel(engine, geminiModel),
    [engine, geminiModel],
  );
  const refineModelOptions = modelOptions;
  const refineModelPickerOptions = useMemo(
    () => buildScriptModelPickerOptions(refineModelOptions, option => (
      `${option.hint} · ${designPromptRefinementFallbackCost(getScriptModelBillingKey(option))}创作点数`
    )),
    [refineModelOptions],
  );
  const generationModelPickerOptions = useMemo(
    () => buildDesignImageModelPickerOptions(),
    [],
  );
  const refinementModel = useMemo(
    () => getScriptModelOption(refineModel, refineModelOptions),
    [refineModel, refineModelOptions],
  );
  const refinementCreditParams = useMemo(
    () => designPromptRefinementCreditParams(getScriptModelBillingKey(refinementModel)),
    [refinementModel],
  );
  const refinementFallbackCost = designPromptRefinementFallbackCost(
    getScriptModelBillingKey(refinementModel),
  );
  const maxRefs = generationModel.maxReferences;
  const imageToImageEnabled = !referencePurpose && canUseDesignImageReferences(
    generationModel,
    sequential === 'auto',
  );
  const generatedImageCount = imageToImageEnabled ? count : 1;
  const finalAspectRatio = standardTurnaroundAspectRatio(asset.assetType, aspectRatio, standardTurnaround);
  const imageCreditParams = useMemo(() => designImageCreditParams({
    imageCount: generatedImageCount,
    model: generationModel.billingModel,
    resolution,
    aspectRatio: finalAspectRatio,
  }), [finalAspectRatio, generatedImageCount, generationModel.billingModel, resolution]);

  useEffect(() => {
    setResolution(current => normalizeDesignImageResolution(generationModel, current));
    if (!generationModel.supportsImageToImageBatch) {
      setSequential('disabled');
      setCount(1);
      setSelectedRefs(new Set());
    }
    setSelectedRefs(current => trimDesignImageReferenceSelectionToQuota(
      current,
      materials,
      generationModel.maxReferences,
    ));
  }, [generationModel, materials]);

  useEffect(() => {
    setCount(current => Math.min(current, maxDesignImageOutputCount(selectedQuotaReferenceCount)));
  }, [selectedQuotaReferenceCount]);

  const selectGenerationModel = (modelId: string) => {
    const nextModel = DESIGN_IMAGE_MODEL_OPTIONS.find(option => option.id === modelId);
    if (!nextModel) return;
    setEngine(nextModel.engine);
    setGeminiModel(nextModel.geminiModel);
    setResolution(current => normalizeDesignImageResolution(nextModel, current));
  };

  const toggleStandardTurnaround = (enabled: boolean) => {
    setStandardTurnaround(enabled);
    if (enabled) setAspectRatio('16:9');
  };

  const persistPrompt = useCallback(async (newPrompt: string) => {
    const text = stripImageStylePresets(newPrompt);
    if (!text || text === persistedPromptRef.current) return;
    try {
      await updateAsset(asset.assetId, {
        style_params: { ...(asset.styleParams || {}), ai_prompt: text },
      });
      persistedPromptRef.current = text;
      forceReloadSlices('assets').catch(() => { /* ignore */ });
    } catch (e) {
      console.warn('保存提示词失败:', e);
    }
  }, [asset, forceReloadSlices]);

  const handleClose = useCallback(() => {
    savePrefs({ style: activeStyle });
    persistPrompt(stripImageStylePresets(prompt));
    onClose();
  }, [activeStyle, persistPrompt, prompt, onClose]);

  const toggleRef = (id: string) => {
    if (!imageToImageEnabled) return;
    setSelectedRefs(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      const selectedMaterial = materials.find(material => material.id === id);
      const quotaExempt = isDesignImageReferenceQuotaExempt(selectedMaterial?.sourceKind);
      const quotaReferenceCount = countDesignImageQuotaReferences(next, materials);
      if (!quotaExempt && quotaReferenceCount >= maxRefs) {
        crmMessage.warning(`当前场景和上传参考图最多选择 ${maxRefs} 张`);
        return prev;
      }
      if (!quotaExempt && quotaReferenceCount + 1 + count > DESIGN_IMAGE_BATCH_LIMIT) {
        crmMessage.warning(`当前场景/上传参考图和生成图合计最多 ${DESIGN_IMAGE_BATCH_LIMIT} 张`);
        return prev;
      }
      next.add(id);
      return next;
    });
  };

  const toggleImageToImage = (enabled: boolean) => {
    if (!generationModel.supportsImageToImageBatch) return;
    setSequential(enabled ? 'auto' : 'disabled');
    if (!enabled) {
      setSelectedRefs(new Set());
      setCount(1);
    }
  };

  const handleReferenceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter(file => !file.type || file.type.startsWith('image/'));
    event.target.value = '';
    if (!files.length || uploadingReferences || !generationModel.supportsImageToImageBatch) return;

    setUploadingReferences(true);
    const uploaded: ModalMaterial[] = [];
    const failures: string[] = [];
    try {
      const { uploadEntityFile } = await import('../services/entityFileService');
      for (const file of files) {
        try {
          const saved = await uploadEntityFile(file, 'asset', asset.assetId, 'reference_image', episodeId || undefined);
          uploaded.push({
            id: `external_${saved.fileId}`,
            url: saved.fileUrl,
            name: file.name,
            sourceKind: 'external-upload',
          });
        } catch (error: any) {
          failures.push(`${file.name}：${error?.message || '上传失败'}`);
        }
      }

      if (uploaded.length) {
        setUploadedReferenceMaterials(current => [...uploaded, ...current]);
        setSequential('auto');
        setSelectedRefs(current => {
          const next = new Set(current);
          let quotaReferenceCount = countDesignImageQuotaReferences(next, materials);
          uploaded.forEach(material => {
            if (quotaReferenceCount < maxRefs && quotaReferenceCount + 1 + count <= DESIGN_IMAGE_BATCH_LIMIT) {
              next.add(material.id);
              quotaReferenceCount += 1;
            }
          });
          return next;
        });
        forceReloadSlices('assets').catch(() => { /* ignore */ });
        crmMessage.success(`已上传 ${uploaded.length} 张参考图${failures.length ? `，${failures.length} 张失败` : ''}`);
      }
      if (!uploaded.length && failures.length) crmMessage.error(failures[0]);
    } catch (error: any) {
      crmMessage.error(error?.message || '参考图上传失败');
    } finally {
      setUploadingReferences(false);
    }
  };

  const updateGenerationCount = (rawValue: string) => {
    const requested = Number(rawValue);
    const nextCount = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : 1;
    const allowed = maxDesignImageOutputCount(selectedQuotaReferenceCount);
    if (nextCount > allowed) {
      crmMessage.warning(`当前场景/上传参考图和生成图合计最多 ${DESIGN_IMAGE_BATCH_LIMIT} 张，当前最多可生成 ${allowed} 张`);
      setCount(allowed);
      return;
    }
    setCount(nextCount);
  };

  const appendStyle = (styleId: string) => {
    setActiveStyle(current => current === styleId ? '' : styleId);
  };

  const handleRefine = async () => {
    setIsRefining(true);
    try {
      await assertEnoughCredits(
        DESIGN_CREDIT_FEATURES.promptRefinement,
        refinementCreditParams,
      );
      const p = buildRefinePrompt(asset.assetType, asset.name, stripImageStylePresets(prompt), scriptText, activeStyle, standardTurnaround);
      const result = await callAI(refineModel, { system: p.system, user: p.user });
      if (result && typeof result === 'string') {
        const refined = result.trim();
        if (!refined) throw new Error('润色未返回内容，本次不扣创作点数');
        validateRefinedImageAge(prompt, refined);
        setPrompt(refined);
        savePrefs({ refineModel });
        await persistPrompt(refined);
        try {
          const settlement = await consumeCredits({
            featureKey: DESIGN_CREDIT_FEATURES.promptRefinement,
            taskId: newDesignCreditUsageId('design-prompt-refinement'),
            params: refinementCreditParams,
            projectId,
            metadata: {
              episode_id: episodeId || null,
              asset_id: asset.assetId,
              model: getScriptModelBillingKey(refinementModel),
              source: 'design_workspace',
            },
          });
          crmMessage.success(`润色完成，已扣除 ${settlement.charged_credits} 创作点数`);
        } catch (error: any) {
          console.error('Design prompt refinement credit settlement failed', error);
          crmMessage.warning(`润色已完成，但创作点数结算失败：${error?.message || String(error)}`);
        }
      } else {
        throw new Error('润色未返回内容，本次不扣创作点数');
      }
    } catch (err: any) { console.error('AI润色失败:', err); crmMessage.error(err?.message || 'AI润色失败，本次不扣创作点数'); }
    finally { setIsRefining(false); }
  };

  const handleGenerate = () => {
    if (!prompt.trim()) {
      crmMessage.error('请输入提示词');
      return;
    }
    if (imageToImageEnabled && selectedRefs.size === 0) {
      crmMessage.warning('启用图生图后，请至少选择 1 张参考图');
      return;
    }
    if (selectedQuotaReferenceCount + generatedImageCount > DESIGN_IMAGE_BATCH_LIMIT) {
      crmMessage.warning(`当前场景/上传参考图和生成图合计最多 ${DESIGN_IMAGE_BATCH_LIMIT} 张`);
      return;
    }
    const basePrompt = stripImageStylePresets(prompt);
    const styledPrompt = applyImageStylePreset(basePrompt, activeStyle);
    savePrefs({
      engine,
      geminiModel,
      style: activeStyle,
      aspect: aspectRatio,
      resolution,
    });
    persistPrompt(basePrompt);
    onSubmit({
      assetId: asset.assetId,
      referencePurpose,
      engine,
      geminiModel,
      prompt: referencePurpose ? styledPrompt : withStandardTurnaround(styledPrompt, asset.assetType, standardTurnaround),
      references: imageToImageEnabled
        ? materials.filter(material => selectedRefs.has(material.id)).map(material => material.url)
        : [],
      aspectRatio: finalAspectRatio,
      resolution,
      sequential: imageToImageEnabled ? 'auto' : 'disabled',
      count: imageToImageEnabled ? count : 1,
    });
  };

  const renderReferenceGroup = (label: string, group: ModalMaterial[]) => {
    if (!group.length) return null;
    return (
      <div className="space-y-1.5">
        <div className="text-[10px] font-medium text-n300">{label}</div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {group.map(material => {
            const active = selectedRefs.has(material.id);
            const sourceLabel = material.sourceKind === 'related-scene'
              ? `来源场景：${material.name || '未命名场景'}`
              : material.sourceKind === 'external-upload'
                ? `外部上传：${material.name || '参考图'}`
                : `当前场景：${asset.name}`;
            return (
              <button
                key={material.id}
                type="button"
                disabled={!imageToImageEnabled}
                onClick={() => toggleRef(material.id)}
                title={!imageToImageEnabled ? '请先启用图生图' : `${active ? '取消参考图' : '设为参考图'}；${sourceLabel}`}
                aria-label={sourceLabel}
                aria-pressed={active}
                className={`relative aspect-square overflow-hidden rounded-lg border transition-colors ${
                  active
                    ? 'border-success ring-2 ring-success/40'
                    : imageToImageEnabled
                      ? 'border-n40 hover:border-primary'
                      : 'cursor-not-allowed border-n40 opacity-55'
                }`}
              >
                <img
                  src={secureMediaUrl(material.thumbnail || material.url) || ''}
                  alt={sourceLabel}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <ImageSourceBadgeOverlay reference={material.url} />
                {material.sourceKind !== 'current' && (
                  <span className="absolute inset-x-0 bottom-0 truncate bg-n900/70 px-1 py-0.5 text-[9px] text-white">
                    {material.sourceKind === 'external-upload' ? '外部上传' : material.name || '其他场景'}
                  </span>
                )}
                {active && (
                  <span className="absolute inset-0 flex items-center justify-center bg-success/25">
                    <Check className="h-5 w-5 text-white drop-shadow" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-hidden bg-n900/50 p-3 backdrop-blur-sm sm:p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-bottom max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-2rem)]">
        <div className="flex shrink-0 items-center justify-between px-6 pt-6 pb-4">
          <div><h3 className="text-lg font-bold text-n800">AI 生成素材 - {asset.name}</h3><p className="text-xs text-n300 mt-1">基于剧本内容智能生成，支持风格预设和参考图。提示词会自动保存。</p></div>
          <button onClick={handleClose} className="text-n300 hover:text-n800"><X className="w-5 h-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5 space-y-5">
          {/* Existing generated images / references */}
          <section>
            <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-n100">
              <span className="font-bold uppercase">
                生成图 / 参考图（当前/上传最多 {maxRefs}）
                {!imageToImageEnabled && <span className="ml-2 font-normal normal-case text-n100">启用图生图后可选择</span>}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {generationModel.supportsImageToImageBatch && (
                  <label className={`inline-flex h-7 items-center gap-1 rounded-md border border-primary px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary-light ${uploadingReferences ? 'cursor-wait opacity-60' : 'cursor-pointer'}`}>
                    {uploadingReferences ? <Loader size={12} className="animate-spin" /> : <Upload size={12} />}
                    {uploadingReferences ? '上传中' : '上传参考图'}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={uploadingReferences}
                      className="hidden"
                      onChange={handleReferenceUpload}
                    />
                  </label>
                )}
                <span className={selectedQuotaReferenceCount > 0 ? 'font-semibold text-success' : ''}>{selectedQuotaReferenceCount}/{maxRefs}</span>
                {selectedRelatedSceneReferenceCount > 0 && (
                  <span className="whitespace-nowrap text-[10px] text-success">
                    其他场景已选 {selectedRelatedSceneReferenceCount}（不计额度）
                  </span>
                )}
              </div>
            </div>
            {materials.length === 0 ? (
              <div className="rounded-md border border-dashed border-n40 py-6 text-center text-xs text-n100">
                {generationModel.supportsImageToImageBatch ? '暂无素材，可上传外部图片作为参考图' : '暂无素材'}
              </div>
            ) : (
              <div className="max-h-52 space-y-3 overflow-y-auto pr-1">
                {renderReferenceGroup(asset.assetType === 'scene' ? '当前场景' : '当前素材', currentMaterials)}
                {renderReferenceGroup('本次外部上传', uploadedMaterials)}
                {renderReferenceGroup('其他场景参考图（不计参考图额度）', relatedSceneMaterials)}
              </div>
            )}
          </section>

          {/* Prompt + refine */}
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-n100 uppercase">提示词</span>
              <div className="flex items-center gap-1">
                <InlineCreditEstimate
                  featureKey={DESIGN_CREDIT_FEATURES.promptRefinement}
                  params={refinementCreditParams}
                  fallbackCost={refinementFallbackCost}
                  className="mr-2 whitespace-nowrap"
                />
                <button
                  type="button"
                  onClick={handleRefine}
                  disabled={isRefining}
                  className="flex h-8 items-center gap-1.5 rounded-l-md border border-primary bg-primary-light px-3 text-xs font-medium text-primary hover:bg-primary-light transition-all disabled:opacity-50"
                >
                  {isRefining ? <Loader size={12} className="animate-spin" /> : <Wand2 size={12} />}
                  AI 润色
                </button>
                <ModelPicker<AiModel>
                  value={refineModel}
                  options={refineModelPickerOptions}
                  onChange={setRefineModel}
                  disabled={isRefining}
                  compact
                  className="min-w-[210px]"
                  ariaLabel="选择润色模型"
                  title="润色模型"
                  kind="text"
                />
              </div>
            </div>
            <textarea
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              rows={5}
              className="w-full bg-n0 border border-n40 rounded-md text-sm text-n800 p-3 focus:outline-none focus:border-primary resize-y min-h-[132px]"
              placeholder="描述你想要生成的内容..."
            />
          </section>

          {/* Styles and generation parameters */}
          {engine === 'doubao' && <SeedreamPurposeControl value={referencePurpose} onChange={setPurpose} />}
          <section className="border-y border-n40 py-3">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
              <div className="min-w-0">
                <span className="mb-1.5 block text-[11px] font-bold text-n100 uppercase">风格</span>
                <div className="flex flex-wrap gap-1.5">
                  {STYLE_PRESETS.map(style => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => appendStyle(style.id)}
                      className={`h-8 px-3 rounded-md border text-xs transition-colors ${activeStyle === style.id ? 'bg-primary text-white border-primary' : 'bg-n0 text-n300 border-n40 hover:border-primary hover:text-n800'}`}
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-2 xl:w-[556px] xl:justify-end xl:justify-self-end">
                <div className="min-w-[350px]">
                  <span className="mb-1.5 block text-[10px] font-medium text-n300">生成模型</span>
                  <ModelPicker
                    value={generationModel.id}
                    options={generationModelPickerOptions}
                    onChange={selectGenerationModel}
                    fullWidth
                    className="min-w-[350px]"
                    ariaLabel="选择生成模型"
                    title="生成模型"
                    kind="image"
                  />
                </div>

                <label className="relative w-[100px]">
                  <span className="mb-1.5 block text-[10px] font-medium text-n300">比例</span>
                  <select
                    value={aspectRatio}
                    disabled={standardTurnaround && supportsStandardTurnaround(asset.assetType)}
                    onChange={event => setAspectRatio(event.target.value)}
                    title={standardTurnaround && supportsStandardTurnaround(asset.assetType) ? `${standardTurnaroundLabel(asset.assetType)}固定使用 16:9` : undefined}
                    className="h-9 w-full appearance-none rounded-md border border-n40 bg-n0 pl-3 pr-7 text-xs text-n700 outline-none hover:border-primary focus:border-primary disabled:cursor-not-allowed disabled:bg-n20 disabled:text-n100"
                  >
                    {['1:1', '3:4', '4:3', '9:16', '16:9'].map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 bottom-2.5 h-4 w-4 text-n300" />
                </label>

                <label className="relative w-[90px]">
                  <span className="mb-1.5 block text-[10px] font-medium text-n300">尺寸</span>
                  <select
                    value={resolution}
                    onChange={event => setResolution(event.target.value as DesignImageResolution)}
                    className="h-9 w-full appearance-none rounded-md border border-n40 bg-n0 pl-3 pr-7 text-xs text-n700 outline-none hover:border-primary focus:border-primary"
                  >
                    {generationModel.resolutions.map(size => <option key={size} value={size}>{size}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 bottom-2.5 h-4 w-4 text-n300" />
                </label>

              </div>
            </div>

            <div className="mt-3 grid min-h-[44px] gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
              <div>
                {supportsStandardTurnaround(asset.assetType) && (
                  <label className="inline-flex items-center gap-2 text-xs text-n700">
                    <input
                      type="checkbox"
                      checked={standardTurnaround}
                      onChange={event => toggleStandardTurnaround(event.target.checked)}
                      className="accent-primary"
                    />
                    {standardTurnaroundLabel(asset.assetType)}
                  </label>
                )}
              </div>

              <div className="grid items-center gap-2 xl:w-[556px] xl:grid-cols-[76px_minmax(0,1fr)] xl:justify-self-end">
                <label className={`inline-flex h-9 w-[76px] items-center justify-center gap-2 rounded-md border px-2 text-xs ${
                  generationModel.supportsImageToImageBatch
                    ? 'border-n40 text-n700'
                    : 'cursor-not-allowed border-n40 bg-n20 text-n100'
                }`}>
                  <input
                    type="checkbox"
                    checked={imageToImageEnabled}
                    disabled={!!referencePurpose || !generationModel.supportsImageToImageBatch}
                    onChange={event => toggleImageToImage(event.target.checked)}
                    className="accent-primary"
                  />
                  图生图
                </label>
                <div className="flex min-w-0 items-center gap-2">
                  <label className={`inline-flex h-9 items-center gap-1 text-xs text-n700 ${
                    imageToImageEnabled ? '' : 'invisible pointer-events-none'
                  }`}>
                    <span>生成张数</span>
                    <input
                      type="number"
                      min={1}
                      max={maxDesignImageOutputCount(selectedQuotaReferenceCount)}
                      value={count}
                      onChange={event => updateGenerationCount(event.target.value)}
                      className="h-9 w-16 rounded-md border border-n40 bg-n0 px-2 text-xs"
                    />
                  </label>
                  <span className="w-[116px] whitespace-nowrap text-[10px] text-n100">
                    {generationModel.supportsImageToImageBatch
                      ? '当前/上传参考图 + 生成图 ≤ 15'
                      : '当前模型不支持图生图'}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-n40 bg-n0 px-6 py-4">
          <InlineCreditEstimate
            featureKey={DESIGN_CREDIT_FEATURES.imageGeneration}
            params={imageCreditParams}
            fallbackCost={designImageFallbackCost(generationModel.billingModel, resolution, generatedImageCount)}
          />
          <div className="flex items-center gap-3">
            <button onClick={handleClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20">取消</button>
            <button onClick={handleGenerate}
              className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-xs font-bold text-white shadow-lg">开始生成</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const BatchGenerateModal: React.FC<{
  assets: AssetItem[]; selectedIds: Set<string>; scriptText: string; modelOptions: readonly ScriptModelOption[];
  onClose: () => void; onSubmit: (config: { assetIds: string[]; engine: MaterialAIEngine; geminiModel: string; style: string; aspectRatio: string; resolution: '1K' | '2K' | '4K'; threeView: boolean; refineModel: AiModel }) => void;
}> = ({ assets, selectedIds, scriptText, modelOptions, onClose, onSubmit }) => {
  const { project } = useProject();
  const defaultAspectRatio = projectDefaultAspectRatio(
    project?.settings,
    savedAspect() === '9:16' ? '9:16' : '16:9',
  );
  const [checked, setChecked] = useState<Set<string>>(() => selectedIds.size > 0 ? new Set(selectedIds) : new Set(assets.filter(a => !a.thumbnailUrl && !(a.referenceImages?.length > 0)).map(a => a.assetId)));
  const [engine, setEngine] = useState<MaterialAIEngine>(savedEngine());
  const [geminiModel, setGeminiModel] = useState(savedGeminiModel());
  const [style, setStyle] = useState(savedStyle());
  const [aspectRatio, setAspectRatio] = useState<string>(defaultAspectRatio);
  const [resolution, setResolution] = useState(savedResolution());
  const [threeView, setThreeView] = useState(true);
  const [refineModel, setRefineModel] = useState(savedRefineModel());
  const batchGenerationModel = useMemo(
    () => findDesignImageModel(engine, geminiModel),
    [engine, geminiModel],
  );
  const refineModelOptions = modelOptions;
  const refineModelPickerOptions = useMemo(
    () => buildScriptModelPickerOptions(refineModelOptions),
    [refineModelOptions],
  );
  const generationModelPickerOptions = useMemo(
    () => buildDesignImageModelPickerOptions(),
    [],
  );

  const toggle = (id: string) => setChecked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const charCount = assets.filter(a => a.assetType === 'character' && checked.has(a.assetId)).length;
  const sceneCount = assets.filter(a => a.assetType === 'scene' && checked.has(a.assetId)).length;
  const propCount = assets.filter(a => a.assetType === 'prop' && checked.has(a.assetId)).length;
  const batchCreditParams = useMemo(() => designImageCreditParams({
    imageCount: checked.size,
    model: batchGenerationModel.billingModel,
    resolution,
    aspectRatio,
  }), [aspectRatio, batchGenerationModel.billingModel, checked.size, resolution]);

  useEffect(() => {
    setResolution(current => normalizeDesignImageResolution(batchGenerationModel, current));
  }, [batchGenerationModel]);

  const selectBatchGenerationModel = (modelId: string) => {
    const nextModel = DESIGN_IMAGE_MODEL_OPTIONS.find(option => option.id === modelId);
    if (!nextModel) return;
    setEngine(nextModel.engine);
    setGeminiModel(nextModel.geminiModel);
    setResolution(current => normalizeDesignImageResolution(nextModel, current));
  };

  const grouped = useMemo(() => {
    const g: Record<string, AssetItem[]> = { character: [], scene: [], prop: [] };
    assets.forEach(a => { if (g[a.assetType]) g[a.assetType].push(a); });
    return g;
  }, [assets]);

  return (
    <div className="fixed inset-0 bg-n900/50 backdrop-blur-sm flex items-center justify-center z-[120]" onClick={onClose}>
      <div className="w-full max-w-5xl bg-n0 border border-n40 rounded-2xl shadow-bottom p-6 space-y-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div><h3 className="text-lg font-bold text-n800">批量生成</h3><p className="text-xs text-n300 mt-1">选择资产和统一配置，空描述的将由 AI 基于剧本自动推断。</p></div>
          <button onClick={onClose} className="text-n300 hover:text-n800"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3 border border-n40 rounded-md p-4 max-h-[50vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-n100 uppercase">选择资产</span>
              <div className="flex gap-2 text-[10px]">
                <button onClick={() => setChecked(new Set(assets.map(a => a.assetId)))} className="text-primary hover:text-primary-hover">全选</button>
                <button onClick={() => setChecked(new Set(assets.filter(a => !a.thumbnailUrl && !(a.referenceImages?.length > 0)).map(a => a.assetId)))} className="text-warning hover:text-warning">选未设计</button>
                <button onClick={() => setChecked(new Set())} className="text-n100 hover:text-n700">清空</button>
              </div>
            </div>
            {(['character', 'scene', 'prop'] as const).map(type => {
              const items = grouped[type];
              if (!items.length) return null;
              const label = type === 'character' ? '人物' : type === 'scene' ? '场景' : '道具';
              return (
                <div key={type}>
                  <span className="text-[10px] font-bold text-n100 uppercase">{label}</span>
                  {items.map(a => {
                    const hasDesign = !!(a.thumbnailUrl || a.referenceImages?.length);
                    const isChecked = checked.has(a.assetId);
                    return (
                      <button key={a.assetId} onClick={() => toggle(a.assetId)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-all ${isChecked ? 'bg-primary-light border border-primary' : 'hover:bg-n20 border border-transparent'}`}>
                        {isChecked ? <CheckSquare size={14} className="text-primary shrink-0" /> : <Square size={14} className="text-n100 shrink-0" />}
                        <span className="truncate flex-1">{a.name}</span>
                        <span className={`text-[10px] ${a.description ? 'text-n100' : 'text-warning'}`}>{a.description ? '有描述' : '空描述'}</span>
                        <span className={`text-[10px] ${hasDesign ? 'text-success' : 'text-n100'}`}>{hasDesign ? '已设计' : '待设计'}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="space-y-4 border border-n40 rounded-md p-4">
            <span className="text-[11px] font-bold text-n100 uppercase">统一配置</span>
            <div>
              <span className="mb-1.5 block text-[11px] text-n100">生成模型</span>
              <ModelPicker
                value={batchGenerationModel.id}
                options={generationModelPickerOptions}
                onChange={selectBatchGenerationModel}
                fullWidth
                ariaLabel="选择批量生成模型"
                title="生成模型"
                kind="image"
              />
            </div>
            <div>
              <span className="text-[11px] font-bold text-n100 uppercase block mb-1.5">风格</span>
              <div className="flex flex-wrap gap-1.5">{STYLE_PRESETS.map(s => (<button key={s.id} onClick={() => setStyle(style === s.id ? '' : s.id)} className={`text-[11px] px-2.5 py-1 rounded border ${style === s.id ? 'bg-primary text-white border-primary' : 'bg-n0 text-n300 border-n40 hover:text-n800'}`}>{s.label}</button>))}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-[11px] text-n100 block mb-1">比例</span><select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} className="w-full bg-n0 border border-n40 rounded-lg text-xs text-n800 px-2 py-1.5">{['1:1', '3:4', '4:3', '9:16', '16:9'].map(r => <option key={r} value={r}>{r}</option>)}</select></div>
              <div><span className="text-[11px] text-n100 block mb-1">分辨率</span><select value={resolution} onChange={e => setResolution(e.target.value as DesignImageResolution)} className="w-full bg-n0 border border-n40 rounded-lg text-xs text-n800 px-2 py-1.5">{batchGenerationModel.resolutions.map(size => <option key={size} value={size}>{size}</option>)}</select></div>
            </div>
            <div>
              <span className="mb-1 block text-[11px] text-n100">AI 推断模型</span>
              <ModelPicker<AiModel>
                value={refineModel}
                options={refineModelPickerOptions}
                onChange={setRefineModel}
                fullWidth
                ariaLabel="选择 AI 推断模型"
                title="AI 推断模型"
                kind="text"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-n700 p-3 bg-n30 rounded-lg border border-n40">
              <input type="checkbox" checked={threeView} onChange={e => setThreeView(e.target.checked)} className="accent-indigo-500" />
              人物/道具默认生成白底四视图
            </label>
            <div className="text-xs text-n100 bg-n30 rounded-lg p-3 border border-n40">
              已选 <strong className="text-n800">{checked.size}</strong> 项
              {charCount > 0 && <span className="ml-2 text-primary">{charCount} 人物</span>}
              {sceneCount > 0 && <span className="ml-2 text-success">{sceneCount} 场景</span>}
              {propCount > 0 && <span className="ml-2 text-warning">{propCount} 道具</span>}
              <br />空描述资产将由 AI 基于剧本自动推断外观。
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-n40">
          {checked.size > 0 ? (
            <InlineCreditEstimate
              featureKey={DESIGN_CREDIT_FEATURES.imageGeneration}
              params={batchCreditParams}
              fallbackCost={designImageFallbackCost(batchGenerationModel.billingModel, resolution, checked.size)}
            />
          ) : (
            <span className="text-xs text-n100">请选择要生成的资产</span>
          )}
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20">取消</button>
            <button onClick={() => { if (!checked.size) { crmMessage.error('请至少选择一个资产'); return; } onSubmit({ assetIds: Array.from(checked), engine, geminiModel, style, aspectRatio, resolution, threeView, refineModel }); }}
              disabled={!checked.size} className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-xs font-bold text-white shadow-lg disabled:opacity-50">
              开始批量生成 ({checked.size} 项)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const OperationMaterialPicker: React.FC<{
  materials: ModalMaterial[];
  selectedId?: string;
  onSelect: (id: string) => void;
  emptyLabel?: string;
}> = ({ materials, selectedId, onSelect, emptyLabel = '暂无可用素材' }) => {
  const selected = materials.find(material => material.id === selectedId) || materials[0];

  return (
    <div className="space-y-3">
      <div className="relative h-64 overflow-hidden rounded-2xl border border-n40 bg-n30 flex items-center justify-center">
        {selected && <ImageSourceBadgeOverlay reference={selected.url} />}
        {selected ? (
          <img
            src={secureMediaUrl(selected.url) || ''}
            alt={selected.name || '当前素材'}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="text-xs text-n100">{emptyLabel}</span>
        )}
      </div>
      {materials.length > 0 && (
        <div>
          <span className="mb-2 block text-[11px] font-semibold text-n300">选择素材</span>
          <div className="grid max-h-28 grid-cols-5 gap-2 overflow-y-auto p-0.5">
            {materials.map(material => {
              const active = selected?.id === material.id;
              return (
                <button
                  key={material.id}
                  type="button"
                  aria-label={`选择素材 ${material.name || material.id}`}
                  aria-pressed={active}
                  onClick={() => onSelect(material.id)}
                  className={`relative aspect-square min-w-0 overflow-hidden rounded-lg border-2 bg-n30 transition-colors ${
                    active
                      ? 'border-success ring-2 ring-success/30'
                      : 'border-n40 hover:border-n100'
                  }`}
                >
                  <img
                    src={secureMediaUrl(material.thumbnail || material.url) || ''}
                    alt={material.name || '素材缩略图'}
                    className="h-full w-full object-cover"
                  />
                  <ImageSourceBadgeOverlay reference={material.url} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const DiscreteChoiceControl: React.FC<{
  label: string;
  value: number;
  options: Array<{ value: number; label: string; title?: string }>;
  onChange: (value: number) => void;
}> = ({ label, value, options, onChange }) => (
  <div className="space-y-2">
    <span className="block text-[11px] font-semibold text-n300">{label}</span>
    <div
      className="grid overflow-hidden rounded-lg border border-n40 bg-n0"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`min-h-9 px-2 text-[11px] font-medium transition-colors ${
              index > 0 ? 'border-l border-n40' : ''
            } ${
              active
                ? 'bg-primary text-white'
                : 'bg-n0 text-n500 hover:bg-n20 hover:text-n800'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  </div>
);

const CameraModal: React.FC<{
  asset: AssetItem; materials: ModalMaterial[]; onClose: () => void;
  onSubmit: (p: { imageUrl: string; rotate: number; move: number; vertical: number; wideAngle: boolean; customPrompt?: string }) => void;
}> = ({ asset, materials, onClose, onSubmit }) => {
  const [selId, setSelId] = useState(materials[0]?.id);
  const [rotate, setRotate] = useState(0);
  const [move, setMove] = useState(0);
  const [vertical, setVertical] = useState(0);
  const [wideAngle, setWideAngle] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const cur = materials.find(m => m.id === selId) || materials[0];
  const creditParams = useMemo(() => designImageCreditParams({
    imageCount: 1,
    model: ONLINE_IMAGE_OPERATION_BILLING_MODEL,
    resolution: onlineImageOperationResolution('angle_adjustment'),
    aspectRatio: 'auto',
  }), []);
  const promptExamples = ["镜头向前移动", "镜头向左移动", "转为俯视", "转为广角", "转为特写"];
  return (
    <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[130]" onClick={onClose}>
      <div className="w-full max-w-5xl bg-n0 border border-n40 rounded-2xl shadow-bottom p-6 space-y-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><div><h3 className="text-lg font-bold text-n800">角度调整 - {asset.name}</h3></div><button onClick={onClose} className="text-n300 hover:text-n800"><X className="w-5 h-5" /></button></div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <OperationMaterialPicker materials={materials} selectedId={cur?.id} onSelect={setSelId} />
            <div className="rounded-lg border border-primary/20 bg-primary-light px-3 py-2 text-xs leading-5 text-primary">
              由{ONLINE_IMAGE_OPERATION_LABEL}在线处理，无需选择本地节点。
            </div>
          </div>
          <div className="space-y-4">
            <div className="bg-n30 border border-n40 rounded-lg p-4 space-y-4">
              <DiscreteChoiceControl
                label="水平环绕机位 (°)"
                value={rotate}
                onChange={setRotate}
                options={[
                  { value: -90, label: '左绕 90°' },
                  { value: -45, label: '左绕 45°' },
                  { value: 0, label: '原机位' },
                  { value: 45, label: '右绕 45°' },
                  { value: 90, label: '右绕 90°' },
                ]}
              />
              <p className="text-[11px] leading-5 text-n300">{CAMERA_ORBIT_HELP}</p>
              <DiscreteChoiceControl
                label="推进距离"
                value={move}
                onChange={setMove}
                options={[
                  { value: 0, label: '不推进' },
                  { value: 5, label: '推进 5' },
                  { value: 10, label: '推进 10' },
                ]}
              />
              <DiscreteChoiceControl
                label="垂直视角"
                value={vertical}
                onChange={setVertical}
                options={[
                  { value: -1, label: '俯视' },
                  { value: 0, label: '平视' },
                  { value: 1, label: '仰视' },
                ]}
              />
              <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-n40 bg-n0 px-3 text-xs text-n700 hover:bg-n20">
                <input type="checkbox" checked={wideAngle} onChange={e => setWideAngle(e.target.checked)} className="accent-primary" />
                使用广角镜头
              </label>
            </div>
            <textarea rows={2} value={customPrompt} onChange={e => setCustomPrompt(e.target.value)} className="w-full bg-n0 border border-n40 rounded-lg text-sm text-n800 p-3 resize-none" placeholder="自定义提示词..." />
            <div className="flex flex-wrap gap-1">{promptExamples.map((ex, i) => (<button key={i} onClick={() => setCustomPrompt(ex)} className="text-[10px] px-2 py-1 bg-n0 text-n300 rounded border border-n40 hover:bg-primary hover:text-white">{ex}</button>))}</div>
            <p className="text-[11px] leading-5 text-n100">在线模型会保留主体身份、画面风格和未指定变化的内容，并把结果保存为新的候选图片。</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-n40">
          <InlineCreditEstimate
            featureKey={DESIGN_CREDIT_FEATURES.imageGeneration}
            params={creditParams}
            fallbackCost={DESIGN_CREDIT_DEFAULTS.onlineImageOperation}
          />
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20">取消</button>
            <button
              onClick={() => { if (!cur) return; onSubmit({ imageUrl: cur.url, rotate, move, vertical, wideAngle, customPrompt: customPrompt.trim() || undefined }); }}
              disabled={!cur}
              className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-xs font-bold text-white shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >生成新角度</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ProcessModal: React.FC<{
  asset: AssetItem; materials: ModalMaterial[]; workflow: 'upscale_hd' | 'remove_watermark'; onClose: () => void; onSubmit: (payload: { materialUrl: string }) => void;
}> = ({ asset, materials, workflow, onClose, onSubmit }) => {
  const [selId, setSelId] = useState(materials[0]?.id);
  const cur = materials.find(m => m.id === selId) || materials[0];
  const info = workflow === 'upscale_hd'
    ? { title: '高清放大', desc: '在线参考图模型重建为 4K 画面' }
    : { title: '去水印', desc: '在线参考图模型重绘遮挡区域' };
  const creditParams = useMemo(() => designImageCreditParams({
    imageCount: 1,
    model: ONLINE_IMAGE_OPERATION_BILLING_MODEL,
    resolution: onlineImageOperationResolution(workflow),
    aspectRatio: 'auto',
  }), [workflow]);
  return (
    <div className="fixed inset-0 bg-n900/50 backdrop-blur flex items-center justify-center z-[130]" onClick={onClose}>
      <div className="w-full max-w-5xl bg-n0 border border-n40 rounded-2xl shadow-bottom p-6 space-y-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><div><h3 className="text-lg font-bold text-n800">{info.title} - {asset.name}</h3><p className="text-xs text-n300 mt-1">{info.desc}</p></div><button onClick={onClose} className="text-n300 hover:text-n800"><X className="w-5 h-5" /></button></div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <OperationMaterialPicker materials={materials} selectedId={cur?.id} onSelect={setSelId} />
          <div className="space-y-4">
            <div className="rounded-lg border border-n40 bg-n30 p-4">
              <h4 className="text-xs font-bold text-n700">{info.title}</h4>
              <p className="mt-2 text-xs leading-5 text-n300">
                {workflow === 'upscale_hd'
                  ? '对左侧选中的素材进行高清重建和细节增强，输出结果将作为新的素材版本保存。'
                  : '仅处理您拥有或已获授权的图片。模型会重绘水印覆盖区域，输出结果将作为新的素材版本保存。'}
              </p>
            </div>
            <div className="rounded-lg border border-primary/20 bg-primary-light px-3 py-2 text-xs leading-5 text-primary">
              由{ONLINE_IMAGE_OPERATION_LABEL}在线处理，无需选择本地节点。
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-n40">
          <InlineCreditEstimate
            featureKey={DESIGN_CREDIT_FEATURES.imageGeneration}
            params={creditParams}
            fallbackCost={DESIGN_CREDIT_DEFAULTS.onlineImageOperation}
          />
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-n40 text-xs text-n700 hover:bg-n20">取消</button>
            <button
              onClick={() => { if (!cur) return; onSubmit({ materialUrl: cur.url }); }}
              disabled={!cur}
              className={`px-5 py-2 rounded-lg text-xs font-bold text-white shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${workflow === 'upscale_hd' ? 'bg-primary hover:bg-primary-hover' : 'bg-primary hover:bg-primary-hover'}`}
            >开始处理</button>
          </div>
        </div>
      </div>
    </div>
  );
};
