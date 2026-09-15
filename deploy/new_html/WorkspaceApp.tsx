

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { v4 as uuidv4 } from 'uuid';
import { FileText, ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Header } from './components/Header';
import { SkeletonScreen } from './components/SkeletonScreen';
import { ProjectFile, FileStatus, StoryboardItem, FileVersion, AppView, MaterialLibrary, Material, AiModel, TaskNotification, ScriptSegment, ScriptGenerationStageState, ScriptConversation, ScriptStoryboardVersion } from './types';
import {
  combineVideoScriptOutputs,
  ensureVideoScriptPromptLengths,
  formatHierarchicalShotNumber,
  normalizeGeneratedVideoScript,
  parseHierarchicalShotNumber,
  parseVideoScriptGroups,
} from './utils/scriptPipelineParsers';
import { parseStreamingBlocks, convertToStoryboardItem, removeControlCharacters, segmentInputContent, countShots } from './utils/storyboardParser';
import { deriveScriptStagesFromPersisted } from './utils/scriptStageDerivation';
import { listEpisodeScripts, createEpisodeScript, updateEpisodeScriptById, deleteEpisodeScript, listEpisodeScriptSegments, batchSaveScriptSegments, getScriptConversation, createScriptMessage, updateScriptMessage, createScriptVersion, selectScriptVersion, confirmScriptVersion, rejectScriptVersion, updateScriptVersionMetadata } from './services/scriptTimelineService';
import { assertEnoughCredits, consumeCredits, estimateTextTokens } from './services/creditService';
import { exportScript, deleteStoryboardItem } from './services/storyboardMutationService';
import { batchCreateStoryboardItems, getEpisodeScript, updateEpisodeScript, getStoryboardItems, syncStoryboardItems, updateStoryboardItem } from './services/episodeDataService';
import { useScriptModelOptions } from './hooks/useScriptModelOptions';
import {
  formatScriptModelDisplay,
  getScriptModelBillingKey,
  getScriptModelOption,
  type ScriptModelOption,
} from './services/scriptModelCatalogService';
import { buildDefaultBindingSnapshot, storyboardItemToDbUpdate } from './utils/episodeAdapters';
import {
  buildScriptVersionChainContext,
  ensureStoryboardCutSeparators,
  selectScriptIterationBaseVersion,
  stabilizeScriptIterationResult,
} from './utils/scriptIteration';
import {
  buildStoryboardSegmentGroups,
  normalizePositiveIntegerSeconds,
  normalizeStoryboardItemsForWorkflow,
  serializeStoryboardItemsWithSegments,
  synchronizeStoryboardSegmentVideoPrompts,
} from './utils/storyboardSegments';
import {
  STORYBOARD_SNAPSHOTS_METADATA_KEY,
  cloneStoryboardSnapshot,
  collectConversationStoryboardSnapshots,
  createStoryboardSnapshot,
  getVersionStoryboardSnapshots,
  mergeStoryboardSnapshots,
  resolvePersistableStoryboardVersion,
} from './utils/storyboardSnapshots';
import {
  readScriptWorkspaceMode,
  writeScriptWorkspaceMode,
  type ScriptWorkspaceMode,
} from './utils/scriptWorkspaceMode';
import { clearCreateIdeaSeed, readCreateIdeaSeed } from './utils/createIdeaSeed';
import { ScriptWorkspaceModeSwitch } from './components/ScriptWorkspaceModeSwitch';
import { useProject } from './contexts/ProjectContext';
import { projectDefaultAspectRatio } from './utils/projectCreationPreferences';
import { buildScriptAssetDescriptionRows } from './utils/scriptAssetDescriptions';
import { getCurrentAdminSession } from './services/adminAccessService';
import { generateStorySummary, sha256Text } from './services/storyTextGenerationService';

const loadAiModelService = () => import('./services/aiModelService');
const loadScriptThreeStageService = () => import('./services/scriptThreeStageService');

const WORKSPACE_INITIAL_STORYBOARD_COUNT = 10;
const BACKUP_STORYBOARD_PAGE_SIZE = 200;
const WORKING_HISTORY_SCOPE = 'working';

function buildVersionHistoryScopeKey(fileId: string, versionId?: string): string {
  return `${fileId}::${versionId || WORKING_HISTORY_SCOPE}`;
}

type ProjectFileHistory = {
  past: ProjectFile[];
  future: ProjectFile[];
};

type HistoryUpdateOptions = {
  recordHistory?: boolean;
  resetHistory?: boolean;
  versionId?: string;
};

const FileColumn = React.lazy(() => import('./components/FileColumn').then(m => ({ default: m.FileColumn })));
const ScriptConversationPane = React.lazy(() => import('./components/ScriptConversationPane').then(m => ({ default: m.ScriptConversationPane })));
const QuickScriptSourceColumn = React.lazy(() => import('./components/QuickScriptSourceColumn').then(m => ({ default: m.QuickScriptSourceColumn })));
const QuickScriptVersionColumn = React.lazy(() => import('./components/QuickScriptVersionColumn').then(m => ({ default: m.QuickScriptVersionColumn })));
const VideoReversePage = React.lazy(() => import('./pages/VideoReversePage').then(m => ({ default: m.VideoReversePage })));
const StoryboardScriptColumn = React.lazy(() => import('./components/StoryboardScriptColumn').then(m => ({ default: m.StoryboardScriptColumn })));
const StoryboardColumn = React.lazy(() => import('./components/StoryboardColumn').then(m => ({ default: m.StoryboardColumn })));
const LegacyMaterialPage = React.lazy(() => import('./components/MaterialPage').then(m => ({ default: m.MaterialPage })));
const LegacyGenerationPage = React.lazy(() => import('./components/GenerationPage').then(m => ({ default: m.GenerationPage })));
const LegacyVideoPage = React.lazy(() => import('./components/VideoPage').then(m => ({ default: m.VideoPage })));
const LegacyAdminPage = React.lazy(() => import('@runtime/AdminPage').then(m => ({ default: m.AdminPage })));

function summarizePipelineError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '未知错误');
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return '未知错误';
  if (/存在缺失或非正整数镜头时长|累计\d+(?:\.\d+)?秒，超过15秒上限/.test(normalized)) {
    return '当前分镜脚本时长未通过校验，请重新生成视频脚本后再生成镜头设计';
  }
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function buildScriptSegmentPayload(segments: ScriptSegment[]) {
  return segments.map((s, idx) => ({
    segment_id: s.id && !s.id.startsWith('seg_local_') ? s.id : undefined,
    segment_order: idx,
    source_text: s.sourceText || '',
    estimated_duration_sec: s.estimatedDurationSec,
    video_script: s.videoScript || '',
    status: s.status || 'pending',
    error_message: s.errorMessage || '',
  }));
}

function numericCreditCost(value: unknown): number {
  const cost = Number(value || 0);
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

function getStoryboardVersionTotalCreditCost(version?: ScriptStoryboardVersion): number {
  const metadata = version?.metadata || {};
  return numericCreditCost(metadata.creditCost) + numericCreditCost(metadata.storyboardDesignCreditCost);
}
const LegacyHistoryPage = React.lazy(() => import('./components/HistoryPage').then(m => ({ default: m.HistoryPage })));

function buildBoundAssetTags(item: Partial<StoryboardItem>): string[] {
  const activeNames = new Set([
    ...(item.characters || []),
    ...(item.scene ? [item.scene] : []),
    ...(item.props || []),
  ]);
  const preservedSelections = (item.boundAssetTokens || []).filter(token => {
    if (token.startsWith('nosel:')) return activeNames.has(token.slice('nosel:'.length));
    if (!token.startsWith('sel:')) return false;
    const rest = token.slice('sel:'.length);
    const separator = rest.indexOf(':');
    return separator > 0 && activeNames.has(rest.slice(0, separator));
  });
  const currentSelections = Object.entries(item.materialSelections || {})
    .filter(([tagName, materialId]) => activeNames.has(tagName) && Boolean(materialId))
    .map(([tagName, materialId]) => `sel:${tagName}:${materialId}`);
  return Array.from(new Set([
    'meta:bindings-initialized',
    ...((item.characters || []).map((c: string) => `char:${c}`)),
    ...(item.scene ? [`scene:${item.scene}`] : []),
    ...((item.props || []).map((p: string) => `prop:${p}`)),
    ...buildDefaultBindingSnapshot(item.characters || [], item.scene || '', item.props || []),
    ...preservedSelections,
    ...currentSelections,
  ]));
}

function buildStoryboardDbPayload(items: StoryboardItem[]): any[] {
  return items
    .filter(item => !item.isPlaceholder)
    .map((item, index) => {
      const rawImage = ((item as any).generatedImage || (item as any).generated_image_url || '').toString();
      const cleanImage = rawImage.split('?')[0];
      const persistedImage = cleanImage.startsWith('http') || cleanImage.startsWith('/') ? cleanImage : '';
      return {
        item_id: item.id,
        sort_order: index,
        scene_heading: item.originalText || item.scene || '',
        action_text: item.scriptSegment || '',
        dialogue: item.dialogue || '',
        camera_movement: item.cameraMovement || '',
        image_prompt: item.imagePrompt || '',
        video_prompt: item.videoPrompt || '',
        generated_image_url: persistedImage,
        planned_duration_ms: item.plannedDurationMs || null,
        bound_assets: buildBoundAssetTags(item),
        configured_references: item.configuredReferences || [],
        reference_config_initialized: Boolean(
          item.referenceConfigInitialized || item.configuredReferences?.length
        ),
        script_segment_id: item.scriptSegmentId || null,
        source_video_shot_no: item.sourceVideoShotNo || '',
        video_script_block: item.videoScriptBlock || '',
        shot_size: item.shotSize || '',
        camera_angle: item.cameraAngle || '',
      };
    });
}

const LegacyViewFallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="h-full w-full flex items-center justify-center text-sm text-n300">
    Loading {label}...
  </div>
);

const LegacyColumnFallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="h-full w-full flex items-center justify-center bg-n10 text-xs text-n300">
    Loading {label}...
  </div>
);

function mapWorkspaceStoryboardRowsToItems(rows: any[]): StoryboardItem[] {
  return rows.map((r: any, idx: number) => {
    const boundAssets: string[] = Array.isArray(r.bound_assets ?? r.boundAssets)
      ? (r.bound_assets ?? r.boundAssets)
      : [];
    const imageUrl = r.generated_image_url ?? r.generatedImageUrl ?? null;
    const imageId = `img_${r.item_id ?? r.itemId ?? idx}`;
    const rawPlannedDurationMs = r.planned_duration_ms ?? r.plannedDurationMs ?? null;
    const plannedDurationSeconds = normalizePositiveIntegerSeconds(
      rawPlannedDurationMs ? rawPlannedDurationMs / 1000 : null,
    );
    return {
      id: r.item_id ?? r.itemId ?? uuidv4(),
      shotNumber: r.source_video_shot_no ?? r.sourceVideoShotNo ?? idx + 1,
      originalText: r.scene_heading ?? r.sceneHeading ?? '',
      scriptSegment: r.action_text ?? r.actionText ?? '',
      dialogue: r.dialogue ?? '',
      cameraMovement: r.camera_movement ?? r.cameraMovement ?? '',
      imagePrompt: r.image_prompt ?? r.imagePrompt ?? '',
      videoPrompt: r.video_prompt ?? r.videoPrompt ?? '',
      generatedImageUrl: imageUrl,
      generatedImage: imageUrl ?? undefined,
      generatedImages: imageUrl ? [{ id: imageId, url: imageUrl, thumbnail: imageUrl, timestamp: Date.now() }] : [],
      selectedImageId: imageUrl ? imageId : undefined,
      configuredReferences: Array.isArray(r.configured_references ?? r.configuredReferences)
        ? (r.configured_references ?? r.configuredReferences)
        : [],
      referenceConfigInitialized: Boolean(
        r.reference_config_initialized
        ?? r.referenceConfigInitialized
        ?? (Array.isArray(r.configured_references ?? r.configuredReferences)
          && (r.configured_references ?? r.configuredReferences).length > 0)
      ),
      characters: boundAssets.filter((a: string) => a.startsWith('char:')).map((a: string) => a.replace('char:', '')),
      scene: boundAssets.find((a: string) => a.startsWith('scene:'))?.replace('scene:', '') || '',
      props: boundAssets.filter((a: string) => a.startsWith('prop:')).map((a: string) => a.replace('prop:', '')),
      boundAssetTokens: boundAssets,
      bindingsInitialized: boundAssets.includes('meta:bindings-initialized'),
      plannedDurationMs: plannedDurationSeconds ? plannedDurationSeconds * 1000 : null,
      duration: plannedDurationSeconds ? `${plannedDurationSeconds}秒` : undefined,
      scriptSegmentId: r.script_segment_id ?? r.scriptSegmentId ?? undefined,
      sourceVideoShotNo: r.source_video_shot_no ?? r.sourceVideoShotNo ?? '',
      videoScriptBlock: r.video_script_block ?? r.videoScriptBlock ?? '',
      shotSize: r.shot_size ?? r.shotSize ?? '',
      cameraAngle: r.camera_angle ?? r.cameraAngle ?? '',
      timestamp: Date.now(),
    };
  });
}

function normalizeVersionStoryboardItems(rows: any[]): StoryboardItem[] {
  const normalized = (rows || []).map((row: any, index: number) => {
    if (row?.originalText !== undefined || row?.scriptSegment !== undefined) {
      return { ...row, id: row.id || uuidv4(), shotNumber: row.shotNumber ?? index + 1 } as StoryboardItem;
    }
    return mapWorkspaceStoryboardRowsToItems([row])[0];
  });
  return normalizeStoryboardItemsForWorkflow(normalized);
}

function buildLocalScriptVersionStoryboardItems(file: ProjectFile): StoryboardItem[] {
  if (file.scriptContent?.trim()) {
    const parsedItems = parseStoryboardVersionContent(file.scriptContent);
    if (parsedItems.length > 0) return parsedItems;
  }
  return file.storyboard?.items || [];
}

function buildLocalScriptConversation(file: ProjectFile): ScriptConversation {
  const now = Date.now();
  const fallbackVersion: ScriptStoryboardVersion | undefined = file.scriptContent ? {
    id: `legacy_${file.id}`,
    scriptId: file.id,
    versionNo: 1,
    content: file.scriptContent,
    storyboardItems: buildLocalScriptVersionStoryboardItems(file),
    source: 'legacy',
    status: 'ready',
    modelAlias: '历史版本',
    provider: 'legacy',
    modelName: 'legacy',
    createdAt: file.lastUpdated || now,
    updatedAt: file.lastUpdated || now,
    messageId: `legacy_assistant_${file.id}`,
  } : undefined;
  return {
    scriptId: file.id,
    currentVersionId: fallbackVersion?.id,
    messages: [
      ...(file.originalContent ? [{
        id: `legacy_user_${file.id}`,
        role: 'user' as const,
        content: file.originalContent,
        status: 'completed' as const,
        createdAt: file.lastUpdated || now,
        updatedAt: file.lastUpdated || now,
      }] : []),
      ...(fallbackVersion ? [{
        id: fallbackVersion.messageId!,
        role: 'assistant' as const,
        content: fallbackVersion.content,
        status: 'completed' as const,
        modelAlias: '历史版本',
        modelName: 'legacy',
        createdAt: file.lastUpdated || now,
        updatedAt: file.lastUpdated || now,
      }] : []),
    ],
    versions: fallbackVersion ? [fallbackVersion] : [],
  };
}

function normalizeScriptContentForCompare(content?: string | null): string {
  return (content || '').trim().replace(/\r\n/g, '\n');
}

function mergeScriptConversationWithLocalFile(
  file: ProjectFile | undefined,
  conversation?: ScriptConversation,
): ScriptConversation | undefined {
  const localContent = normalizeScriptContentForCompare(file?.scriptContent);
  if (!file || !localContent) return conversation;

  const localConversation = buildLocalScriptConversation(file);
  const localVersion = localConversation.versions[0];
  if (!localVersion) return conversation;
  if (!conversation) return localConversation;

  const existingVersions = conversation.versions || [];
  const matchingVersion = [...existingVersions].reverse().find(
    version => normalizeScriptContentForCompare(version.content) === localContent,
  );

  if (matchingVersion && !matchingVersion.id.startsWith('legacy_')) {
    return {
      ...conversation,
      currentVersionId: matchingVersion.id,
    };
  }

  const maxVersionNo = existingVersions.reduce(
    (max, version) => Math.max(max, Number(version.versionNo) || 0),
    0,
  );
  const localVersionNo = matchingVersion?.versionNo
    || Math.max(localVersion.versionNo || 1, maxVersionNo + 1);
  const mergedLocalVersion: ScriptStoryboardVersion = {
    ...localVersion,
    versionNo: localVersionNo,
    createdAt: matchingVersion?.createdAt || localVersion.createdAt,
    updatedAt: Math.max(matchingVersion?.updatedAt || 0, localVersion.updatedAt || 0),
  };
  const localAssistantMessage = localConversation.messages.find(
    message => message.id === localVersion.messageId,
  );
  const localUserMessage = localConversation.messages.find(
    message => message.id === `legacy_user_${file.id}`,
  );
  const hasUserMessage = conversation.messages.some(message => message.role === 'user');
  const messagesWithoutLocal = conversation.messages.filter(
    message => message.id !== localVersion.messageId && message.id !== `legacy_user_${file.id}`,
  );

  return {
    ...conversation,
    currentVersionId: localVersion.id,
    messages: [
      ...(localUserMessage && !hasUserMessage ? [localUserMessage] : []),
      ...messagesWithoutLocal,
      ...(localAssistantMessage
        ? [{
            ...localAssistantMessage,
            content: mergedLocalVersion.content,
            createdAt: mergedLocalVersion.createdAt,
            updatedAt: mergedLocalVersion.updatedAt,
          }]
        : []),
    ],
    versions: [
      ...existingVersions.filter(version => version.id !== localVersion.id),
      mergedLocalVersion,
    ],
  };
}

function mergePersistedScriptConversation(
  file: ProjectFile | undefined,
  persisted: ScriptConversation,
  cached?: ScriptConversation,
): ScriptConversation {
  if (!cached) return mergeScriptConversationWithLocalFile(file, persisted) || persisted;

  const persistedMessageIds = new Set(persisted.messages.map(message => message.id));
  const persistedVersionIds = new Set(persisted.versions.map(version => version.id));
  const persistedHasRealVersions = persisted.versions.some(version => !version.id.startsWith('legacy_'));
  const persistedHasUserMessage = persisted.messages.some(message => message.role === 'user');
  const cachedOnlyMessages = cached.messages.filter(message => (
    !persistedMessageIds.has(message.id)
      && !(persistedHasRealVersions && message.id.startsWith('legacy_assistant_'))
      && !(persistedHasUserMessage && message.id.startsWith('legacy_user_'))
  ));
  const cachedOnlyVersions = cached.versions.filter(version => (
    !persistedVersionIds.has(version.id)
      && !(persistedHasRealVersions && version.id.startsWith('legacy_'))
  ));
  const cachedCurrentIsNewer = Boolean(
    cached.currentVersionId && !persistedVersionIds.has(cached.currentVersionId),
  );
  const combined: ScriptConversation = {
    ...cached,
    ...persisted,
    currentVersionId: cachedCurrentIsNewer
      ? cached.currentVersionId
      : (persisted.currentVersionId || cached.currentVersionId),
    defaultModel: persisted.defaultModel || cached.defaultModel,
    messages: [...persisted.messages, ...cachedOnlyMessages],
    versions: [...persisted.versions, ...cachedOnlyVersions]
      .sort((left, right) => left.versionNo - right.versionNo || left.createdAt - right.createdAt),
  };
  return mergeScriptConversationWithLocalFile(file, combined) || combined;
}

function parseStoryboardVersionContent(content: string): StoryboardItem[] {
  if (!content.trim()) return [];
  const separated = ensureStoryboardCutSeparators(content);
  const normalized = separated.endsWith('---CUT---') ? separated : `${separated}\n---CUT---`;
  const parsed = parseStreamingBlocks(normalized);
  const groupPrompts = new Map(
    parseVideoScriptGroups(content).map(group => [group.groupNo, group.sharedVideoPrompt]),
  );
  const items = parsed.completedBlocks.map(convertToStoryboardItem).map((item) => {
    const parsedShotNumber = parseHierarchicalShotNumber(String(item.shotNumber || ''));
    const segmentNo = parsedShotNumber?.segmentNo
      || Number.parseInt(String(item.scriptSegmentId || '').match(/(\d+)$/)?.[1] || '', 10)
      || 1;
    const videoPrompt = groupPrompts.get(segmentNo) || item.videoPrompt;
    return videoPrompt ? { ...item, videoPrompt } : item;
  });
  return synchronizeStoryboardSegmentVideoPrompts(
    normalizeStoryboardItemsForWorkflow(items),
  );
}

function exportStoryboardVersionCsv(file: ProjectFile, version: ScriptStoryboardVersion): void {
  const normalizedItems = normalizeVersionStoryboardItems(version.storyboardItems);
  const segmentGroups = buildStoryboardSegmentGroups(normalizedItems);
  const segmentByItemId = new Map(segmentGroups.flatMap(group => group.entries.map(entry => [entry.item.id, {
    segmentNo: group.segmentNo,
    localShotNo: entry.localShotNo,
  }] as const)));
  const headers = ['分段', '段内镜头', '全局序号', '时长', '画面描述', '人物', '场景', '道具', '生图 Prompt', '视频 Prompt', '人物台词'];
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = normalizedItems.map((item, index) => [
    segmentByItemId.get(item.id)?.segmentNo || 1,
    segmentByItemId.get(item.id)?.localShotNo || index + 1,
    index + 1,
    item.duration || '',
    item.scriptSegment || item.originalText || '',
    (item.characters || []).join('、'),
    item.scene || '',
    (item.props || []).join('、'),
    item.imagePrompt || '',
    item.videoPrompt || '',
    item.dialogue || '',
  ].map(escape).join(','));
  const blob = new Blob([`\ufeff${[headers.map(escape).join(','), ...rows].join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${file.name.replace(/\.[^.]+$/, '')}-分镜脚本-V${version.versionNo}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getScriptModelInfo(model: AiModel, options: readonly ScriptModelOption[]) {
  const option = getScriptModelOption(model, options);
  return {
    alias: formatScriptModelDisplay(option),
    provider: 'script-writing',
    runtime: option.runtime,
    billingModel: getScriptModelBillingKey(option),
  };
}















interface WorkspaceAppProps {
  hideHeader?: boolean;
  episodeId: string;
  initialScriptId?: string | null;
  activeScriptId?: string | null;
  onActivateScript?: (scriptId: string) => Promise<void> | void;
  onAfterExport?: () => Promise<void> | void;
}

const WorkspaceApp: React.FC<WorkspaceAppProps> = ({
  hideHeader = false,
  episodeId: propEpisodeId,
  initialScriptId,
  activeScriptId,
  onActivateScript,
  onAfterExport,
}) => {
  const { project, projectId } = useProject();
  const projectAspectRatio = projectDefaultAspectRatio(project?.settings, '16:9');
  const projectOrientation = projectAspectRatio === '9:16' ? 'portrait' : 'landscape';
  const scriptModelOptions = useScriptModelOptions();
  const scriptWorkspaceUsername = localStorage.getItem('username');
  const [scriptWorkspaceMode, setScriptWorkspaceMode] = useState<ScriptWorkspaceMode>(
    () => readScriptWorkspaceMode(localStorage, scriptWorkspaceUsername),
  );

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [storyboardTotalsByFileId, setStoryboardTotalsByFileId] = useState<Record<string, number>>({});
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [checkedFileIds, setCheckedFileIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const urlProjectId = (() => {
    const segs = window.location.pathname.split('/');
    const idx = segs.indexOf('projects');
    return idx >= 0 && segs[idx + 1] ? segs[idx + 1] : null;
  })();
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);


  const [isShotExtracting, setIsShotExtracting] = useState(false);
  const [shotGenerationProgress, setShotGenerationProgress] = useState<{current: number; total: number} | null>(null);
  const [processingType, setProcessingType] = useState<'rewrite' | 'generate-shots' | null>(null);


  const [taskNotifications, setTaskNotifications] = useState<TaskNotification[]>([]);
  const [hasAdminAccess, setHasAdminAccess] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void getCurrentAdminSession().then(session => {
      if (alive) setHasAdminAccess(Boolean(session));
    });
    return () => { alive = false; };
  }, []);




  const stopProcessingRef = useRef<boolean>(false);


  const addTaskNotification = useCallback((notification: Omit<TaskNotification, 'id' | 'timestamp'>) => {
    const newNotification: TaskNotification = {
      ...notification,
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };
    setTaskNotifications(prev => [newNotification, ...prev]);
    return newNotification.id;
  }, []);


  const updateTaskNotification = useCallback((id: string, updates: Partial<TaskNotification>) => {
    setTaskNotifications(prev => prev.map(n =>
      n.id === id ? { ...n, ...updates } : n
    ));
  }, []);


  const dismissTaskNotification = useCallback((id: string) => {
    setTaskNotifications(prev => prev.filter(n => n.id !== id));
  }, []);


  const location = useLocation();
  const routerNavigate = useNavigate();

  const getViewFromPath = (): AppView => {
    const segments = location.pathname.split('/');
    const page = segments[segments.length - 1]?.toLowerCase();
    const viewMap: Record<string, AppView> = {
      'editor': AppView.Editor,
      'materials': AppView.Materials,
      'generation': AppView.Generation,
      'video': AppView.Video,
      'history': AppView.History,
      'admin': AppView.Admin
    };
    return viewMap[page] || AppView.Editor;
  };

  const [currentView, setCurrentView] = useState<AppView>(getViewFromPath());


  const [mountedViews, setMountedViews] = useState<Set<AppView>>(new Set([getViewFromPath()]));


  useEffect(() => {
    const newView = getViewFromPath();
    if (newView !== currentView) {
      setCurrentView(newView);
    }
  }, [location.pathname]);

  useEffect(() => {
    setMountedViews(prev => {
      if (prev.has(currentView)) return prev;
      return new Set(prev).add(currentView);
    });
  }, [currentView]);

  const [isViewLoading, setIsViewLoading] = useState(false);


  const [loadedViews, setLoadedViews] = useState<Set<AppView>>(new Set());
  const [isPreloading, setIsPreloading] = useState(false);


  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [materialLibrary, setMaterialLibrary] = useState<MaterialLibrary>({});


  const filesRef = useRef<ProjectFile[]>(files);
  const materialLibraryRef = useRef<MaterialLibrary>(materialLibrary);
  const savedScriptSignaturesRef = useRef<Record<string, string>>({});


  useEffect(() => {
    filesRef.current = files;
    materialLibraryRef.current = materialLibrary;
  }, [files, materialLibrary]);

  const getScriptPersistenceSignature = useCallback((file: ProjectFile) => JSON.stringify([
    file.name,
    file.originalContent,
    file.scriptContent ?? null,
  ]), []);

  const activateWorkflowScript = useCallback(async (scriptId: string) => {
    if (!onActivateScript || scriptId === activeScriptId) return;
    await onActivateScript(scriptId);
  }, [activeScriptId, onActivateScript]);

  // Undo/Redo history is isolated by file and storyboard version.
  const [fileHistory, setFileHistory] = useState<Record<string, ProjectFileHistory>>({});

  const [highlightedScriptSegments, setHighlightedScriptSegments] = useState<Set<string>>(new Set());
  const [highlightedStoryboardItemIds, setHighlightedStoryboardItemIds] = useState<Set<string>>(new Set());

  const [colWidths, setColWidths] = useState<number[]>([15, 25, 30, 30]);
  const [visibleColumns, setVisibleColumns] = useState<boolean[]>([true, true, true, true]);
  const [aiModel, setAiModel] = useState<AiModel>(AiModel.MinimaxM3);
  const [scriptConversations, setScriptConversations] = useState<Record<string, ScriptConversation>>({});
  const [quickSelectedVersionIds, setQuickSelectedVersionIds] = useState<Record<string, string>>({});
  const [conversationLoadingId, setConversationLoadingId] = useState<string | null>(null);
  const [conversationSendingId, setConversationSendingId] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [storyboardDrawerOpen, setStoryboardDrawerOpen] = useState(false);
  const loadedConversationKeysRef = useRef<Set<string>>(new Set());
  const conversationRequestsRef = useRef<Map<string, Promise<ScriptConversation>>>(new Map());
  const appliedConversationModelRef = useRef<string>('');

  const containerRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef<number | null>(null);

  const refreshScriptConversationForWriting = useCallback(async (fileId: string) => {
    const persistedConversation = await getScriptConversation(propEpisodeId, fileId);
    const latestFile = filesRef.current.find(item => item.id === fileId);
    loadedConversationKeysRef.current.add(`${propEpisodeId}:${fileId}`);
    setScriptConversations(prev => ({
      ...prev,
      [fileId]: mergePersistedScriptConversation(latestFile, persistedConversation, prev[fileId]),
    }));

    const mergedPersistedConversation = mergeScriptConversationWithLocalFile(
      latestFile,
      persistedConversation,
    ) || persistedConversation;
    const persistedSnapshots = collectConversationStoryboardSnapshots(mergedPersistedConversation);
    setFiles(prev => {
      const next = prev.map(file => (
        file.id === fileId
          ? { ...file, versions: mergeStoryboardSnapshots(file.versions || [], persistedSnapshots) }
          : file
      ));
      filesRef.current = next;
      return next;
    });
  }, [propEpisodeId]);

  const handleScriptWorkspaceModeChange = useCallback((mode: ScriptWorkspaceMode) => {
    writeScriptWorkspaceMode(localStorage, scriptWorkspaceUsername, mode);
    setScriptWorkspaceMode(mode);
    if (mode !== 'writing') setStoryboardDrawerOpen(false);
    if (mode === 'writing' && selectedFileId && !selectedFileId.startsWith('local_')) {
      setConversationLoadingId(selectedFileId);
      setConversationError(null);
      void refreshScriptConversationForWriting(selectedFileId)
        .catch(error => {
          console.error('切换写作版同步版本历史失败:', error);
          setConversationError('版本历史同步失败，已保留当前缓存；请稍后重试。');
        })
        .finally(() => {
          setConversationLoadingId(current => current === selectedFileId ? null : current);
        });
    }
  }, [refreshScriptConversationForWriting, scriptWorkspaceUsername, selectedFileId]);

  const selectedFile = files.find(f => f.id === selectedFileId);
  const rawSelectedConversation = selectedFileId ? scriptConversations[selectedFileId] : undefined;
  const selectedConversation = useMemo(
    () => mergeScriptConversationWithLocalFile(selectedFile, rawSelectedConversation),
    [rawSelectedConversation, selectedFile],
  );
  const selectedConversationVersion = selectedConversation?.versions.find(
    version => version.id === selectedConversation.currentVersionId,
  ) || selectedConversation?.versions[selectedConversation.versions.length - 1];
  const selectedConversationVersionCreditCost = getStoryboardVersionTotalCreditCost(selectedConversationVersion);
  const fallbackQuickVersion = selectedFile?.scriptContent ? buildLocalScriptConversation(selectedFile).versions[0] : undefined;
  const quickAvailableVersions = selectedConversation?.versions?.length
    ? selectedConversation.versions
    : (fallbackQuickVersion ? [fallbackQuickVersion] : []);
  const quickSelectedVersionId = selectedFileId ? quickSelectedVersionIds[selectedFileId] : undefined;
  const quickPipelineVersion = quickAvailableVersions.find(version => version.id === quickSelectedVersionId)
    || selectedConversationVersion
    || fallbackQuickVersion;
  const selectedHistoryScopeKey = selectedFileId
    ? buildVersionHistoryScopeKey(selectedFileId, selectedConversationVersion?.id)
    : null;
  const selectedStoryboardItemCount = (selectedFile?.storyboard?.items || [])
    .filter(item => !item.isPlaceholder).length;
  const handleQuickSelectVersion = useCallback((versionId: string) => {
    if (!selectedFileId) return;
    setQuickSelectedVersionIds(prev => ({ ...prev, [selectedFileId]: versionId }));
  }, [selectedFileId]);

  const syncScriptConversationFromFile = useCallback((fileId: string) => {
    const file = filesRef.current.find(item => item.id === fileId);
    if (!file) return;
    setScriptConversations(prev => {
      const merged = mergeScriptConversationWithLocalFile(file, prev[fileId]);
      if (!merged) return prev;
      return { ...prev, [fileId]: merged };
    });
  }, []);
  useEffect(() => {
    if (!selectedFileId || selectedFileId.startsWith('local_')) return;
    const cacheKey = `${propEpisodeId}:${selectedFileId}`;
    if (loadedConversationKeysRef.current.has(cacheKey)) {
      setConversationLoadingId(current => current === selectedFileId ? null : current);
      return;
    }
    let cancelled = false;
    const localFile = filesRef.current.find(item => item.id === selectedFileId);
    if (!scriptConversations[selectedFileId] && localFile) {
      const fallbackConversation = buildLocalScriptConversation(localFile);
      setScriptConversations(prev => prev[selectedFileId]
        ? prev
        : { ...prev, [selectedFileId]: fallbackConversation });
    }
    setConversationLoadingId(selectedFileId);
    setConversationError(null);
    let request = conversationRequestsRef.current.get(cacheKey);
    if (!request) {
      request = getScriptConversation(propEpisodeId, selectedFileId);
      conversationRequestsRef.current.set(cacheKey, request);
    }
    request
      .then(conversation => {
        if (cancelled) return;
        loadedConversationKeysRef.current.add(cacheKey);
        const latestFile = filesRef.current.find(item => item.id === selectedFileId);
        const mergedConversation = mergeScriptConversationWithLocalFile(latestFile, conversation) || conversation;
        setScriptConversations(prev => ({
          ...prev,
          [selectedFileId]: mergePersistedScriptConversation(latestFile, conversation, prev[selectedFileId]),
        }));
        const persistedSnapshots = collectConversationStoryboardSnapshots(mergedConversation);
        setFiles(prev => {
          const next = prev.map(file => (
            file.id === selectedFileId
              ? {
                  ...file,
                  versions: mergeStoryboardSnapshots(file.versions || [], persistedSnapshots),
                }
              : file
          ));
          filesRef.current = next;
          return next;
        });
      })
      .catch(error => {
        if (cancelled) return;
        console.error('加载剧本对话失败:', error);
        const file = filesRef.current.find(item => item.id === selectedFileId);
        if (file) {
          setScriptConversations(prev => ({
            ...prev,
            [file.id]: prev[file.id] || buildLocalScriptConversation(file),
          }));
        }
        setConversationError('对话历史暂时无法从服务器加载，已显示当前剧本内容。');
      })
      .finally(() => {
        if (conversationRequestsRef.current.get(cacheKey) === request) {
          conversationRequestsRef.current.delete(cacheKey);
        }
        if (!cancelled) setConversationLoadingId(null);
      });
    return () => { cancelled = true; };
  }, [propEpisodeId, selectedFileId]);

  useEffect(() => {
    const selectionKey = selectedFileId || '';
    if (!selectedFileId || appliedConversationModelRef.current === selectionKey) return;
    appliedConversationModelRef.current = selectionKey;
    setAiModel(AiModel.MinimaxM3);
  }, [selectedFileId]);


  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);






  const loadEpisodeData = async (preferredScriptId?: string) => {
    if (!propEpisodeId) return;
    setIsLoadingProjects(true);
    try {
      const [scriptsRes, segRes] = await Promise.all([
        listEpisodeScripts(propEpisodeId).catch(() => ({ success: false, scripts: [] })),
        listEpisodeScriptSegments(propEpisodeId).catch(() => ({ success: false, segments: [] })),
      ]);

      const scripts: any[] = scriptsRes.success ? (scriptsRes.scripts || []) : [];
      const pendingCreateIdea = readCreateIdeaSeed(sessionStorage, propEpisodeId);
      let pendingCreateIdeaHandled = false;
      if (pendingCreateIdea && scripts.length > 0) {
        const firstScript = scripts[0];
        const firstScriptId = firstScript.script_id ?? firstScript.scriptId;
        const currentSource = firstScript.original_content ?? firstScript.originalContent ?? '';
        if (currentSource.trim()) {
          pendingCreateIdeaHandled = true;
        } else if (firstScriptId) {
          try {
            await updateEpisodeScriptById(propEpisodeId, firstScriptId, {
              original_content: pendingCreateIdea.sentence,
            });
            firstScript.original_content = pendingCreateIdea.sentence;
            pendingCreateIdeaHandled = true;
          } catch (error) {
            console.warn('保存新建作品的一句话创意失败，将在下次进入时重试:', error);
          }
        }
      }
      const requestedScriptId = preferredScriptId || initialScriptId;
      const initialStoryboardScriptId = (
        requestedScriptId && scripts.some((script: any) => (script.script_id ?? script.scriptId) === requestedScriptId)
      )
        ? requestedScriptId
        : (scripts[0]?.script_id ?? scripts[0]?.scriptId ?? undefined);
      const sbRes = await getStoryboardItems(propEpisodeId, initialStoryboardScriptId, {
        limit: WORKSPACE_INITIAL_STORYBOARD_COUNT,
        includeTotal: true,
      }).catch(() => ({ success: false, items: [] }));
      const dbItems: any[] = sbRes.success ? (sbRes.items || []) : [];

      const itemsByScript = new Map<string | null, any[]>();
      for (const r of dbItems) {
        const sid = r.script_id ?? r.scriptId ?? null;
        if (!itemsByScript.has(sid)) itemsByScript.set(sid, []);
        itemsByScript.get(sid)!.push(r);
      }


      const allSegments: any[] = segRes.success ? ((segRes as any).segments || []) : [];
      const segsByScript = new Map<string | null, ScriptSegment[]>();
      for (const r of allSegments) {
        const sid = r.script_id ?? r.scriptId ?? null;
        if (!segsByScript.has(sid)) segsByScript.set(sid, []);
        segsByScript.get(sid)!.push({
          id: r.segment_id ?? r.segmentId,
          order: r.segment_order ?? r.segmentOrder ?? 0,
          sourceText: r.source_text ?? r.sourceText ?? '',
          estimatedDurationSec: r.estimated_duration_sec ?? r.estimatedDurationSec ?? null,
          videoScript: r.video_script ?? r.videoScript ?? '',
          status: r.status ?? 'done',
          errorMessage: r.error_message ?? r.errorMessage ?? '',
        });
      }
      for (const list of segsByScript.values()) {
        list.sort((a, b) => a.order - b.order);
      }

      let projectFiles: ProjectFile[];

      if (scripts.length > 0) {
        projectFiles = scripts.map((script: any, idx: number) => {
          const sid = script.script_id ?? script.scriptId;
          const matchedRows = itemsByScript.get(sid) || [];
          const orphanRows = idx === 0 ? (itemsByScript.get(null) || []) : [];
          const fileItems = mapWorkspaceStoryboardRowsToItems([...matchedRows, ...orphanRows]);
          const fileSegments = segsByScript.get(sid) || (idx === 0 ? (segsByScript.get(null) || []) : []);
          const adaptedScript = script.adapted_script ?? script.adaptedScript ?? null;
          const file: ProjectFile = {
            id: sid,
            name: script.file_name ?? script.fileName ?? `文件${idx + 1}`,
            originalContent: script.original_content ?? script.originalContent ?? '',
            scriptContent: adaptedScript,
            storyboard: fileItems.length > 0 ? { items: fileItems } : null,
            extractedCharacters: [],
            extractedScenes: [],
            extractedProps: [],
            status: FileStatus.Idle,
            lastUpdated: Date.now(),
            versions: [],
            scriptSegments: fileSegments,

            generationStages: deriveScriptStagesFromPersisted(fileSegments, adaptedScript, fileItems),
          };
          if (fileItems.length > 0) {
            const chars = new Set<string>();
            const scenes = new Set<string>();
            const props = new Set<string>();
            fileItems.forEach(item => {
              (item.characters || []).forEach((c: string) => { if (c) chars.add(c); });
              if (item.scene) scenes.add(item.scene);
              (item.props || []).forEach((p: string) => { if (p) props.add(p); });
            });
            file.extractedCharacters = Array.from(chars);
            file.extractedScenes = Array.from(scenes);
            file.extractedProps = Array.from(props);
          }
          return file;
        });
      } else {
        const created = await createEpisodeScript(propEpisodeId, {
          file_name: '分集剧本',
          original_content: pendingCreateIdea?.sentence || '',
        }).catch(() => null);
        const newId = created?.script?.script_id || `local_${uuidv4()}`;
        pendingCreateIdeaHandled = Boolean(pendingCreateIdea && created?.script?.script_id);
        const allItems = mapWorkspaceStoryboardRowsToItems(dbItems);
        projectFiles = [{
          id: newId,
          name: '分集剧本',
          originalContent: pendingCreateIdea?.sentence || '',
          scriptContent: null,
          storyboard: allItems.length > 0 ? { items: allItems } : null,
          extractedCharacters: [],
          extractedScenes: [],
          extractedProps: [],
          status: FileStatus.Idle,
          lastUpdated: Date.now(),
          versions: [],
          scriptSegments: segsByScript.get(newId) || segsByScript.get(null) || [],
        }];
      }

      const restoreId = requestedScriptId && projectFiles.some(f => f.id === requestedScriptId)
        ? requestedScriptId
        : projectFiles[0]?.id || null;
      const storyboardTotal = typeof (sbRes as any).total === 'number'
        ? (sbRes as any).total
        : dbItems.length;
      setStoryboardTotalsByFileId(restoreId ? { [restoreId]: storyboardTotal } : {});
      savedScriptSignaturesRef.current = Object.fromEntries(
        projectFiles
          .filter(file => !file.id.startsWith('local_'))
          .map(file => [file.id, getScriptPersistenceSignature(file)]),
      );
      filesRef.current = projectFiles;
      setFiles(projectFiles);
      setSelectedFileId(restoreId);
      if (pendingCreateIdeaHandled) clearCreateIdeaSeed(sessionStorage);
      if (!activeScriptId && restoreId) {
        void activateWorkflowScript(restoreId).catch(err => {
          console.error('设置本集采用剧本失败:', err);
        });
      }
      setLoadedViews(new Set([AppView.Editor, AppView.Materials, AppView.Generation]));
      setIsDataLoaded(true);
    } catch (error) {
      console.error('❌ 加载分集数据失败:', error);
      setIsDataLoaded(true);
    } finally {
      setIsLoadingProjects(false);
    }
  };




  const saveEpisodeToBackend = useCallback(async () => {

    const currentFiles = filesRef.current;
    if (!propEpisodeId || currentFiles.length === 0 || isLoadingProjects) return;
    try {
      for (const file of currentFiles) {
        if (file.id.startsWith('local_')) continue;
        const signature = getScriptPersistenceSignature(file);
        if (savedScriptSignaturesRef.current[file.id] === signature) continue;
        try {
          await updateEpisodeScriptById(propEpisodeId, file.id, {
            file_name: file.name,
            original_content: file.originalContent,
            adapted_script: file.scriptContent,
          });
          savedScriptSignaturesRef.current[file.id] = signature;
        } catch (err) {
          console.error(`保存文件 ${file.name} 失败:`, err);
        }
      }


      for (const file of currentFiles) {
        if (!file.id || file.id.startsWith('local_')) continue;
        if (!file.scriptSegments || file.scriptSegments.length === 0) continue;
        const segPayload = file.scriptSegments.map((s, idx) => ({
          segment_id: s.id && !s.id.startsWith('seg_local_') ? s.id : undefined,
          segment_order: idx,
          source_text: s.sourceText || '',
          estimated_duration_sec: s.estimatedDurationSec ?? null,
          video_script: s.videoScript || '',
          status: s.status || 'done',
          error_message: s.errorMessage || '',
        }));
        await batchSaveScriptSegments(propEpisodeId, file.id, segPayload).catch(err =>
          console.warn(`保存分段失败 (${file.id}):`, err)
        );
      }

      for (const file of currentFiles) {
        if (!file.id || file.id.startsWith('local_')) continue;
        if (!file.storyboard?.items?.length) continue;

        const realItems = file.storyboard.items.filter(i => !i.isPlaceholder);
        if (realItems.length === 0) continue;
        const persistedItemCount = Math.max(
          storyboardTotalsByFileId[file.id] ?? 0,
          realItems.length,
        );

        const dbItems = realItems.map((item: StoryboardItem, idx: number) => {

          const rawImg = ((item as any).generatedImage || (item as any).generated_image_url || '').toString();
          const cleanImg = rawImg.split('?')[0];
          const persistImg = (cleanImg.startsWith('http') || cleanImg.startsWith('/')) ? cleanImg : '';
          return ({
          item_id: item.id,
          sort_order: idx,
          scene_heading: item.originalText || item.scene || '',
          action_text: item.scriptSegment || '',
          dialogue: item.dialogue || '',
          camera_movement: item.cameraMovement || '',
          image_prompt: item.imagePrompt || '',
          video_prompt: item.videoPrompt || '',
          generated_image_url: persistImg,
          planned_duration_ms: item.plannedDurationMs || null,
          bound_assets: buildBoundAssetTags(item),
          script_segment_id: item.scriptSegmentId || null,
          source_video_shot_no: item.sourceVideoShotNo || '',
          video_script_block: item.videoScriptBlock || '',
          shot_size: item.shotSize || '',
          camera_angle: item.cameraAngle || '',
        });
        });

        // Reconcile by persisted identity; UUID-shaped ids can already exist.
        // Sync the full loaded sequence so split children and retained shots share one order.
        const result: any = await syncStoryboardItems(propEpisodeId, dbItems, file.id);
        if (result?.success && Array.isArray(result.items)) {
          const newIds: string[] = result.items.map((r: any) => r.item_id ?? r.itemId);
          const applyCreatedIds = (sourceFiles: ProjectFile[]) => sourceFiles.map(f => {
            if (f.id !== file.id || !f.storyboard) return f;
            const createdIds = new Map(realItems.map((item, index) => [item.id, newIds[index]]));
            const updatedItems = f.storyboard.items.map(it => {
              if (it.isPlaceholder) return it;
              const newId = createdIds.get(it.id);
              return newId ? { ...it, id: newId } : it;
            });
            return { ...f, storyboard: { ...f.storyboard, items: updatedItems } };
          });
          setFiles(applyCreatedIds);
          filesRef.current = applyCreatedIds(filesRef.current);
          setStoryboardTotalsByFileId(prev => ({
            ...prev,
            [file.id]: Math.max(prev[file.id] ?? 0, persistedItemCount, newIds.length),
          }));
        }
      }
    } catch (error) {
      console.error('❌ 保存分集数据失败:', error);
    }
  }, [propEpisodeId, isLoadingProjects, getScriptPersistenceSignature, storyboardTotalsByFileId]);

  const handleExportProject = async () => {
    try {
      await saveEpisodeToBackend();
      const exportedAt = new Date();
      const currentFiles = filesRef.current;
      const storyboardRows: any[] = [];
      let storyboardTotal: number | null = null;

      do {
        const response = await getStoryboardItems(propEpisodeId, undefined, {
          limit: BACKUP_STORYBOARD_PAGE_SIZE,
          offset: storyboardRows.length,
          includeTotal: storyboardRows.length === 0,
        });
        if (!response?.success || !Array.isArray(response.items)) {
          throw new Error('无法读取完整镜头数据');
        }
        storyboardRows.push(...response.items);
        if (typeof response.total === 'number') storyboardTotal = response.total;
        if (response.items.length < BACKUP_STORYBOARD_PAGE_SIZE) break;
      } while (storyboardTotal === null || storyboardRows.length < storyboardTotal);

      const rowsByScriptId = new Map<string | null, any[]>();
      storyboardRows.forEach(row => {
        const scriptId = row.script_id ?? row.scriptId ?? null;
        const rows = rowsByScriptId.get(scriptId) || [];
        rows.push(row);
        rowsByScriptId.set(scriptId, rows);
      });
      const firstPersistedFileIndex = currentFiles.findIndex(file => !file.id.startsWith('local_'));
      const exportedFiles = currentFiles.map((file, fileIndex) => {
        if (file.id.startsWith('local_')) return file;
        const persistedRows = [
          ...(rowsByScriptId.get(file.id) || []),
          ...(fileIndex === firstPersistedFileIndex ? (rowsByScriptId.get(null) || []) : []),
        ];
        const persistedItems = mapWorkspaceStoryboardRowsToItems(persistedRows);
        const currentItems = (file.storyboard?.items || []).filter(item => !item.isPlaceholder);
        const currentItemsById = new Map(currentItems.map(item => [item.id, item]));
        const persistedIds = new Set(persistedItems.map(item => item.id));
        const mergedItems = normalizeStoryboardItemsForWorkflow([
          ...persistedItems.map(item => currentItemsById.get(item.id) || item),
          ...currentItems.filter(item => !persistedIds.has(item.id)),
        ], file.scriptSegments || []);
        return {
          ...file,
          storyboard: mergedItems.length > 0
            ? { ...(file.storyboard || {}), items: mergedItems }
            : file.storyboard,
        };
      });

      const exportedConversations: Record<string, ScriptConversation> = { ...scriptConversations };
      await Promise.all(currentFiles
        .filter(file => !file.id.startsWith('local_'))
        .map(async file => {
          try {
            exportedConversations[file.id] = await getScriptConversation(propEpisodeId, file.id);
          } catch (error) {
            console.warn(`无法刷新剧本“${file.name}”的对话记录，使用当前已加载内容。`, error);
          }
        }));

      const payload = {
        format: 'ostory-project-backup',
        version: 1,
        exported_at: exportedAt.toISOString(),
        project_id: urlProjectId,
        episode_id: propEpisodeId,
        workflow: {
          active_script_id: activeScriptId || null,
          selected_file_id: selectedFileId,
        },
        files: exportedFiles,
        material_library: materialLibraryRef.current,
        script_conversations: exportedConversations,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = exportedAt.toISOString().replace(/[:.]/g, '-');
      link.href = objectUrl;
      link.download = `ostory-project-${urlProjectId || 'unknown'}-episode-${propEpisodeId}-${timestamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      console.error('下载项目备份失败:', error);
      window.alert(`下载项目备份失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };




  useEffect(() => {
    loadEpisodeData().catch(err => {
      console.error('❌ 分集初始化失败:', err);
      setIsDataLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (initialScriptId && files.some(file => file.id === initialScriptId)) {
      setSelectedFileId(initialScriptId);
    }
  }, [initialScriptId, files.length]);




  useEffect(() => {

    try {
      localStorage.setItem('last_view', currentView);
    } catch (e) {
      console.warn('保存当前视图失败:', e);
    }


    if (loadedViews.has(currentView)) {
      return;
    }


    setLoadedViews(prev => new Set(prev).add(currentView));


    loadViewData(currentView).catch(err => {
      console.error(`❌ 加载视图失败:`, err);
    });


    schedulePreloadNextView(currentView);
  }, [currentView]);









  const debouncedSaveToBackend = useCallback(() => {

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }


    saveTimerRef.current = setTimeout(() => {
      console.log('💾 自动保存触发（防抖5秒）');
      saveToBackend();
    }, 5000);
  }, []);

  const saveToBackend = useCallback(async () => {
    return saveEpisodeToBackend();
  }, [saveEpisodeToBackend]);




  const hasUserEditedRef = useRef(false);
  useEffect(() => {
    if (files.length > 0 && !isLoadingProjects) {
      if (!hasUserEditedRef.current) {
        hasUserEditedRef.current = true;
        return;
      }
      const timer = setTimeout(() => {
        saveToBackend();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [files, materialLibrary, saveToBackend, isLoadingProjects]);





  const selectedFileIdRef = useRef(selectedFileId);
  selectedFileIdRef.current = selectedFileId;

  useEffect(() => {
    const handler = () => {
      saveToBackend();
    };
    window.addEventListener('generation-save-trigger', handler);
    return () => window.removeEventListener('generation-save-trigger', handler);
  }, [saveToBackend]);




  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (files.length > 0 && !isLoadingProjects) {
        saveToBackend().catch(() => {});
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && files.length > 0 && !isLoadingProjects) {
        saveToBackend().catch(() => {});
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [files, isLoadingProjects, saveToBackend]);




  const resolveHistoryScopeKey = (fileId: string, versionId?: string) => {
      if (versionId) return buildVersionHistoryScopeKey(fileId, versionId);
      const conversation = scriptConversations[fileId];
      const currentVersion = conversation?.versions.find(item => item.id === conversation.currentVersionId)
          || conversation?.versions[conversation.versions.length - 1];
      return buildVersionHistoryScopeKey(fileId, currentVersion?.id);
  };

  const pushToHistory = (historyScopeKey: string, currentFile: ProjectFile) => {
      setFileHistory(prev => {
          const history = prev[historyScopeKey] || { past: [], future: [] };
          const newPast = [...history.past, currentFile].slice(-10);
          return {
              ...prev,
              [historyScopeKey]: { past: newPast, future: [] }
          };
      });
  };

  const resetHistory = (historyScopeKey: string) => {
      setFileHistory(prev => {
          if (!prev[historyScopeKey]) return prev;
          const next = { ...prev };
          delete next[historyScopeKey];
          return next;
      });
  };

  const handleUndo = () => {
      if (!selectedFileId || !selectedHistoryScopeKey) return;
      const history = fileHistory[selectedHistoryScopeKey];
      if (!history || history.past.length === 0) return;

      const previous = history.past[history.past.length - 1];
      const current = files.find(f => f.id === selectedFileId);

      if (current && previous) {
          setFileHistory(prev => ({
              ...prev,
              [selectedHistoryScopeKey]: {
                  past: history.past.slice(0, -1),
                  future: [current, ...history.future].slice(0, 10)
              }
          }));
          setFiles(prev => prev.map(f => f.id === selectedFileId ? previous : f));
      }
  };

  const handleRedo = () => {
      if (!selectedFileId || !selectedHistoryScopeKey) return;
      const history = fileHistory[selectedHistoryScopeKey];
      if (!history || history.future.length === 0) return;

      const next = history.future[0];
      const current = files.find(f => f.id === selectedFileId);

      if (current && next) {
          setFileHistory(prev => ({
              ...prev,
              [selectedHistoryScopeKey]: {
                  past: [...history.past, current].slice(-10),
                  future: history.future.slice(1)
              }
          }));
          setFiles(prev => prev.map(f => f.id === selectedFileId ? next : f));
      }
  };

  const canUndo = !!(selectedHistoryScopeKey && fileHistory[selectedHistoryScopeKey]?.past.length > 0);
  const canRedo = !!(selectedHistoryScopeKey && fileHistory[selectedHistoryScopeKey]?.future.length > 0);

  // Helper to update file with history tracking
  const updateFileWithHistory = (
      fileId: string,
      updateFn: (file: ProjectFile) => ProjectFile,
      options: HistoryUpdateOptions = {},
  ) => {
      const historyScopeKey = resolveHistoryScopeKey(fileId, options.versionId);
      setFiles(prev => {
          const fileIndex = prev.findIndex(f => f.id === fileId);
          if (fileIndex === -1) return prev;

          const currentFile = prev[fileIndex];
          if (options.resetHistory) {
              resetHistory(historyScopeKey);
          } else if (options.recordHistory !== false) {
              pushToHistory(historyScopeKey, currentFile);
          }

          const newFile = updateFn(currentFile);
          const newFiles = [...prev];
          newFiles[fileIndex] = newFile;


          filesRef.current = newFiles;

          return newFiles;
      });
  };


  const persistStoryboardSnapshot = useCallback(async (
    fileId: string,
    options: {
      name?: string;
      source: 'auto' | 'manual';
      version?: ScriptStoryboardVersion;
      waitForRemote?: boolean;
    },
  ): Promise<FileVersion> => {
    const file = filesRef.current.find(item => item.id === fileId);
    if (!file?.storyboard?.items?.some(item => !item.isPlaceholder)) {
      throw new Error('当前没有可保存的镜头设计');
    }

    let conversation = scriptConversations[fileId];
    let targetVersion = resolvePersistableStoryboardVersion(conversation, options.version);
    if (!targetVersion && !fileId.startsWith('local_')) {
      const cacheKey = `${propEpisodeId}:${fileId}`;
      let request = conversationRequestsRef.current.get(cacheKey);
      if (!request) {
        request = getScriptConversation(propEpisodeId, fileId);
        conversationRequestsRef.current.set(cacheKey, request);
      }
      try {
        const remoteConversation = await request;
        const latestFile = filesRef.current.find(item => item.id === fileId);
        conversation = mergeScriptConversationWithLocalFile(latestFile, remoteConversation)
          || remoteConversation;
        loadedConversationKeysRef.current.add(cacheKey);
        setScriptConversations(prev => ({ ...prev, [fileId]: conversation! }));
        const persistedSnapshots = collectConversationStoryboardSnapshots(conversation);
        setFiles(prev => {
          const next = prev.map(item => item.id === fileId ? {
            ...item,
            versions: mergeStoryboardSnapshots(item.versions || [], persistedSnapshots),
          } : item);
          filesRef.current = next;
          return next;
        });
        targetVersion = resolvePersistableStoryboardVersion(conversation, options.version);
      } finally {
        if (conversationRequestsRef.current.get(cacheKey) === request) {
          conversationRequestsRef.current.delete(cacheKey);
        }
      }
    }
    if (!targetVersion || fileId.startsWith('local_')) {
      throw new Error('剧本版本尚未完成服务器同步，暂时无法创建持久存档，请稍后重试');
    }
    const timestamp = Date.now();
    const snapshot = createStoryboardSnapshot(file, {
      id: uuidv4(),
      timestamp,
      name: options.name || `${options.source === 'auto' ? '自动存档' : '镜头存档'} · ${new Date(timestamp).toLocaleString('zh-CN')}`,
      source: options.source,
      scriptVersionId: targetVersion?.id,
    });

    const applyLocalSnapshot = () => {
      setFiles(prev => {
        const next = prev.map(item => (
          item.id === fileId
            ? { ...item, versions: mergeStoryboardSnapshots(item.versions || [], [snapshot]) }
            : item
        ));
        filesRef.current = next;
        return next;
      });
    };

    const persistRemoteSnapshot = async () => {
      const snapshots = mergeStoryboardSnapshots(
        getVersionStoryboardSnapshots(targetVersion),
        [snapshot],
      );
      const updatedVersion = await updateScriptVersionMetadata(
        propEpisodeId,
        fileId,
        targetVersion.id,
        { [STORYBOARD_SNAPSHOTS_METADATA_KEY]: snapshots },
      );
      setScriptConversations(prev => prev[fileId] ? ({
        ...prev,
        [fileId]: {
          ...prev[fileId],
          versions: prev[fileId].versions.map(version => (
            version.id === updatedVersion.id ? updatedVersion : version
          )),
        },
      }) : prev);
    };

    if (options.waitForRemote === false) {
      applyLocalSnapshot();
      void persistRemoteSnapshot().catch(error => {
        console.warn('后台同步镜头设计存档失败:', error);
      });
      return snapshot;
    }

    await persistRemoteSnapshot();
    applyLocalSnapshot();
    return snapshot;
  }, [propEpisodeId, scriptConversations]);

  const handleSaveVersion = useCallback(async (id: string, customName?: string) => {
    await persistStoryboardSnapshot(id, {
      name: customName,
      source: 'manual',
    });
  }, [persistStoryboardSnapshot]);

  const handleRestoreVersion = (fileId: string, version: FileVersion) => {
      updateFileWithHistory(fileId, (f) => ({
          ...f,
          ...version.data,
          versions: f.versions
      }), { recordHistory: false, resetHistory: true });
  };

  const handleRestoreStoryboard = (fileId: string, version: FileVersion) => {
      if (!version.data.storyboard) {
          alert("该版本没有分镜数据");
          return;
      }
      const restoredVersion = cloneStoryboardSnapshot(version);
      updateFileWithHistory(fileId, (f) => ({
          ...f,
          storyboard: restoredVersion.data.storyboard
      }), { recordHistory: false, resetHistory: true });
  };

  const handleDeleteVersion = useCallback(async (fileId: string, versionId: string) => {
    const file = filesRef.current.find(item => item.id === fileId);
    const snapshot = file?.versions?.find(version => version.id === versionId);
    if (!snapshot) return;

    const conversation = scriptConversations[fileId];
    const targetVersion = conversation?.versions.find(version => (
      version.id === snapshot.scriptVersionId
      || getVersionStoryboardSnapshots(version).some(item => item.id === versionId)
    ));
    if (targetVersion && !targetVersion.id.startsWith('legacy_') && !fileId.startsWith('local_')) {
      const remaining = getVersionStoryboardSnapshots(targetVersion)
        .filter(version => version.id !== versionId);
      const updatedVersion = await updateScriptVersionMetadata(
        propEpisodeId,
        fileId,
        targetVersion.id,
        { [STORYBOARD_SNAPSHOTS_METADATA_KEY]: remaining },
      );
      setScriptConversations(prev => prev[fileId] ? ({
        ...prev,
        [fileId]: {
          ...prev[fileId],
          versions: prev[fileId].versions.map(version => (
            version.id === updatedVersion.id ? updatedVersion : version
          )),
        },
      }) : prev);
    }

    setFiles(prev => {
      const next = prev.map(item => item.id === fileId ? {
        ...item,
        versions: (item.versions || []).filter(version => version.id !== versionId),
      } : item);
      filesRef.current = next;
      return next;
    });
  }, [propEpisodeId, scriptConversations]);



  const loadWorkspaceStoryboardPage = useCallback(async (
    fileId: string,
    count: number,
  ): Promise<StoryboardItem[]> => {
    if (!propEpisodeId || !fileId) return [];
    const targetCount = Math.max(WORKSPACE_INITIAL_STORYBOARD_COUNT, count || WORKSPACE_INITIAL_STORYBOARD_COUNT);
    const currentFile = filesRef.current.find(f => f.id === fileId);
    const currentItems = (currentFile?.storyboard?.items || []).filter(item => !item.isPlaceholder);
    if (fileId.startsWith('local_') || targetCount <= currentItems.length) return currentItems;

    const res: any = await getStoryboardItems(propEpisodeId, fileId, {
      limit: targetCount,
      includeTotal: true,
    });
    if (!res?.success) {
      throw new Error(res?.error || '镜头设计数据加载失败');
    }
    const items = normalizeStoryboardItemsForWorkflow(
      mapWorkspaceStoryboardRowsToItems(res.items || []),
    );
    setFiles(prev => {
      const next = prev.map(f => (
        f.id === fileId
          ? { ...f, storyboard: items.length > 0 ? { items } : null }
          : f
      ));
      filesRef.current = next;
      return next;
    });
    const total = typeof res.total === 'number' ? res.total : items.length;
    setStoryboardTotalsByFileId(prev => ({ ...prev, [fileId]: total }));
    return items;
  }, [propEpisodeId]);

  const handleWorkspaceVisibleShotCountChange = useCallback((count: number) => {
    if (!selectedFileId) return;
    void loadWorkspaceStoryboardPage(selectedFileId, count).catch(err => {
      console.warn('Workspace storyboard page load failed:', err);
    });
  }, [loadWorkspaceStoryboardPage, selectedFileId]);

  const ensureActiveStoryboardItemsLoaded = useCallback(async (fileId: string): Promise<StoryboardItem[]> => {
    const currentFile = filesRef.current.find(file => file.id === fileId);
    const currentItems = (currentFile?.storyboard?.items || []).filter(item => !item.isPlaceholder);
    const knownTotal = Math.max(storyboardTotalsByFileId[fileId] ?? 0, currentItems.length);
    if (!fileId.startsWith('local_') && knownTotal > currentItems.length) {
      const loadedItems = await loadWorkspaceStoryboardPage(fileId, knownTotal);
      return loadedItems.filter(item => !item.isPlaceholder);
    }
    return currentItems;
  }, [loadWorkspaceStoryboardPage, storyboardTotalsByFileId]);

  const archiveActiveStoryboardIfPresent = useCallback(async (
    fileId: string,
    options: {
      name?: string;
      source?: 'auto' | 'manual';
      version?: ScriptStoryboardVersion;
    } = {},
  ): Promise<FileVersion | null> => {
    const activeItems = await ensureActiveStoryboardItemsLoaded(fileId);
    if (activeItems.length === 0) return null;
    return persistStoryboardSnapshot(fileId, {
      source: options.source || 'auto',
      version: options.version,
      name: options.name || `自动历史 · 当前镜头设计 · ${new Date().toLocaleString('zh-CN')}`,
    });
  }, [ensureActiveStoryboardItemsLoaded, persistStoryboardSnapshot]);

  const replaceActiveStoryboardDesign = useCallback(async (
    fileId: string,
    items: StoryboardItem[],
    options: {
      archiveName?: string;
      versionId?: string;
      openDrawer?: boolean;
    } = {},
  ): Promise<StoryboardItem[]> => {
    const normalizedItems = normalizeStoryboardItemsForWorkflow(items);
    if (normalizedItems.filter(item => !item.isPlaceholder).length === 0) {
      throw new Error('镜头设计生成成功，但没有可保存的镜头');
    }
    await archiveActiveStoryboardIfPresent(fileId, { name: options.archiveName });
    const persisted = await batchCreateStoryboardItems(
      propEpisodeId,
      buildStoryboardDbPayload(normalizedItems),
      fileId,
    );
    if (!persisted?.success || !Array.isArray(persisted.items) || persisted.items.length === 0) {
      throw new Error('镜头设计生成成功，但正式镜头链路保存失败');
    }
    const persistedItems = normalizeStoryboardItemsForWorkflow(
      mapWorkspaceStoryboardRowsToItems(persisted.items),
    );
    flushSync(() => {
      updateFileWithHistory(fileId, current => ({
        ...current,
        storyboard: { items: persistedItems },
        status: FileStatus.Completed,
        lastUpdated: Date.now(),
      }), {
        recordHistory: false,
        resetHistory: true,
        versionId: options.versionId,
      });
      setStoryboardTotalsByFileId(prev => ({ ...prev, [fileId]: persistedItems.length }));
      setHighlightedScriptSegments(new Set());
      setHighlightedStoryboardItemIds(new Set());
      if (options.openDrawer) setStoryboardDrawerOpen(true);
    });
    return persistedItems;
  }, [archiveActiveStoryboardIfPresent, propEpisodeId, updateFileWithHistory]);

  const clearActiveStoryboardDesign = useCallback(async (
    fileId: string,
    options: { archiveName?: string; versionId?: string } = {},
  ): Promise<void> => {
    await archiveActiveStoryboardIfPresent(fileId, { name: options.archiveName });
    await batchCreateStoryboardItems(propEpisodeId, [], fileId);
    flushSync(() => {
      updateFileWithHistory(fileId, current => ({
        ...current,
        storyboard: null,
        lastUpdated: Date.now(),
      }), {
        recordHistory: false,
        resetHistory: true,
        versionId: options.versionId,
      });
      setStoryboardTotalsByFileId(prev => ({ ...prev, [fileId]: 0 }));
      setHighlightedScriptSegments(new Set());
      setHighlightedStoryboardItemIds(new Set());
    });
  }, [archiveActiveStoryboardIfPresent, propEpisodeId, updateFileWithHistory]);

  const handleExportNext = async (data: any) => {
    try {
      const selectedItems: string[] = data.items.map((item: any) => item.shotId);

      if (selectedItems.length === 0) {
        alert('没有可导出的分镜');
        return;
      }

      const projectId = urlProjectId;
      if (!projectId) {
        alert('未找到项目ID，无法导出。');
        return;
      }

      const username = localStorage.getItem('username') || 'guest';
      const storageKey = `anime-current-project-id-${username}`;
      localStorage.setItem(storageKey, projectId);

      const { exportToVideo } = await import('./services/projectWorkflowService');

      try {
        const result = await exportToVideo(projectId, selectedItems);
        console.log(`✅ 导出成功: ${result.exported_count} 个镜头`);
        setCurrentView(AppView.Video);
      } catch (err) {
        console.error('❌ 导出失败:', err);
        alert('导出失败: ' + (err as Error).message + '\n\n请重试或联系管理员');
      }

    } catch (error) {
      console.error('❌ 导出失败:', error);
      alert('导出失败: ' + (error as Error).message);
    }
  };


  const toggleColumnVisibility = (index: number) => {
    setVisibleColumns(prev => {
      const newVis = [...prev];
      newVis[index] = !newVis[index];

      if (newVis.every(v => !v)) return prev;
      return newVis;
    });
  };

  const startResizing = (index: number) => {
    isResizing.current = index;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const stopResizing = useCallback(() => {
    isResizing.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleResize = useCallback((e: MouseEvent) => {
    if (isResizing.current === null || !containerRef.current) return;
    if (visibleColumns.some(v => !v)) return;

    const containerWidth = containerRef.current.clientWidth;
    const deltaPx = e.movementX;
    const deltaPercent = (deltaPx / containerWidth) * 100;
    const index = isResizing.current;

    setColWidths(prev => {
      const newWidths = [...prev];
      const newCurrent = newWidths[index] + deltaPercent;
      const newNext = newWidths[index + 1] - deltaPercent;
      if (newCurrent > 5 && newNext > 5) {
        newWidths[index] = newCurrent;
        newWidths[index + 1] = newNext;
        return newWidths;
      }
      return prev;
    });
  }, [visibleColumns]);

  useEffect(() => {
    window.addEventListener('mousemove', handleResize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', handleResize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [handleResize, stopResizing]);





  const handleFileUpload = (fileList: FileList) => {
    Array.from(fileList).forEach(file => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const text = e.target?.result as string;
        try {
          const sourceHash = await sha256Text(text);
          const res = await createEpisodeScript(propEpisodeId, {
            file_name: file.name,
            original_content: text,
            metadata: {
              story_summary_source_sha256: sourceHash,
              story_summary_status: 'pending',
            },
          });
          if (res?.success && res.script) {
            const newFile: ProjectFile = {
              id: res.script.script_id,
              name: file.name,
              originalContent: text,
              scriptContent: null,
              storyboard: null,
              extractedCharacters: [],
              extractedScenes: [],
              extractedProps: [],
              status: FileStatus.Idle,
              lastUpdated: Date.now(),
              versions: [],
            };
            savedScriptSignaturesRef.current[newFile.id] = getScriptPersistenceSignature(newFile);
            setFiles(prev => {
              const next = [...prev, newFile];
              filesRef.current = next;
              return next;
            });
            setSelectedFileId(newFile.id);
            if (!activeScriptId) {
              void activateWorkflowScript(newFile.id).catch(err => {
                console.error('设置本集采用剧本失败:', err);
              });
            }
            try {
              const summary = await generateStorySummary(text, {
                operation: 'script_story_summary',
                displayName: '生成故事概要',
                projectId,
                episodeId: propEpisodeId,
                sourcePage: 'script_import',
                sourceItemId: newFile.id,
                entityType: 'episode_script',
                entityId: newFile.id,
              });
              await updateEpisodeScriptById(propEpisodeId, newFile.id, {
                metadata: {
                  ...(res.script.metadata || {}),
                  story_summary: summary,
                  story_summary_source_sha256: sourceHash,
                  story_summary_status: 'ready',
                },
              });
            } catch (summaryError) {
              console.error('故事概要生成失败:', summaryError);
              await updateEpisodeScriptById(propEpisodeId, newFile.id, {
                metadata: {
                  ...(res.script.metadata || {}),
                  story_summary_source_sha256: sourceHash,
                  story_summary_status: 'failed',
                },
              }).catch(() => undefined);
              setConversationError(`《${file.name}》已导入，但故事概要生成失败；可在配乐页重试。`);
            }
          }
        } catch (err) {
          console.error('上传文件失败:', err);
        }
      };
      reader.readAsText(file);
    });
  };




  const handleCreateBlankFile = async () => {
    try {
      const res = await createEpisodeScript(propEpisodeId, {
        file_name: `新文件 ${files.length + 1}`,
      });
      if (res?.success && res.script) {
        const newFile: ProjectFile = {
          id: res.script.script_id,
          name: res.script.file_name || `新文件 ${files.length + 1}`,
          originalContent: '',
          scriptContent: null,
          storyboard: null,
          extractedCharacters: [],
          extractedScenes: [],
          extractedProps: [],
          status: FileStatus.Idle,
          lastUpdated: Date.now(),
          versions: [],
        };
        savedScriptSignaturesRef.current[newFile.id] = getScriptPersistenceSignature(newFile);
        setFiles(prev => {
          const next = [...prev, newFile];
          filesRef.current = next;
          return next;
        });
        setSelectedFileId(newFile.id);
        if (!activeScriptId) {
          void activateWorkflowScript(newFile.id).catch(err => {
            console.error('设置本集采用剧本失败:', err);
          });
        }
      }
    } catch (err) {
      console.error('创建空白文件失败:', err);
    }
  };

  const handleUpdateContent = (id: string, newContent: string) => {
      updateFileWithHistory(id, (f) => ({ ...f, originalContent: newContent }));
  };

  const handleIterateScript = useCallback(async (
    currentScript: string,
    instruction: string,
    conversationContext: string,
    onStream?: (chunk: string) => void,
  ): Promise<string> => {
    if (!currentScript.trim()) throw new Error('当前文件没有可修改的剧本内容');
    if (!instruction.trim()) throw new Error('请输入本轮修改意见');
    const { aiIterateFullScript } = await loadAiModelService();
    return await aiIterateFullScript(
      aiModel,
      currentScript,
      instruction,
      conversationContext,
      onStream,
      {
        operation: 'script_rewrite',
        displayName: '剧本修改',
        projectId: urlProjectId,
        episodeId: propEpisodeId,
        sourcePage: 'script',
        sourceItemId: selectedFileId || undefined,
        entityType: 'episode_script',
        entityId: selectedFileId || undefined,
      },
    );
  }, [aiModel, propEpisodeId, selectedFileId, urlProjectId]);

  const handleConversationSend = useCallback(async (content: string) => {
    const fileId = selectedFileId;
    const file = filesRef.current.find(item => item.id === fileId);
    if (!fileId || !file) throw new Error('请先选择剧本任务');
    if (fileId.startsWith('local_')) throw new Error('剧本任务尚未保存，请稍后重试');

    const conversation = mergeScriptConversationWithLocalFile(file, scriptConversations[fileId]) || {
      scriptId: fileId,
      messages: [],
      versions: [],
    };
    const modelInfo = getScriptModelInfo(aiModel, scriptModelOptions);
    const requestId = `script_turn_${uuidv4()}`;
    const isFirstTurn = conversation.versions.length === 0;
    const currentVersion = selectScriptIterationBaseVersion(conversation);
    const conversationContext = buildScriptVersionChainContext(conversation, currentVersion);
    const billingInput = isFirstTurn
      ? content
      : [currentVersion?.content || file.scriptContent || file.originalContent, content, conversationContext].join('\n');
    const forecastOutputTokens = Math.max(
      1000,
      estimateTextTokens(currentVersion?.content || file.scriptContent || content) * (isFirstTurn ? 3 : 1),
    );
    setConversationSendingId(fileId);
    setConversationError(null);

    let assistantMessageId: string | null = null;
    let streamedContent = '';
    let estimatedCreditCost = 0;
    let chargedCreditCost = 0;
    let pipelineInputTexts: string[] = [];
    let pipelineOutputTexts: string[] = [];
    try {
      const creditQuote = await assertEnoughCredits('script_model_call', {
        input_tokens: estimateTextTokens(billingInput),
        output_tokens: forecastOutputTokens,
        model: modelInfo.billingModel,
      });
      estimatedCreditCost = Number(creditQuote.estimated_cost || 0);
      const userMessage = await createScriptMessage(propEpisodeId, fileId, {
        role: 'user',
        content,
        status: 'completed',
        modelAlias: modelInfo.alias,
        provider: modelInfo.provider,
        modelName: modelInfo.billingModel,
        requestId: `${requestId}_user`,
      });
      setScriptConversations(prev => ({
        ...prev,
        [fileId]: {
          ...(prev[fileId] || conversation),
          messages: [...(prev[fileId]?.messages || conversation.messages), userMessage],
        },
      }));

      if (isFirstTurn) {
        updateFileWithHistory(fileId, current => ({ ...current, originalContent: content }));
        await updateEpisodeScriptById(propEpisodeId, fileId, { original_content: content });
      }

      const assistantMessage = await createScriptMessage(propEpisodeId, fileId, {
        role: 'assistant',
        content: '',
        status: 'streaming',
        modelAlias: modelInfo.alias,
        provider: modelInfo.provider,
        modelName: modelInfo.billingModel,
        replyToMessageId: userMessage.id,
        requestId: `${requestId}_assistant`,
        metadata: {
          requestId,
          estimatedCreditCost,
          creditCharged: false,
        },
      });
      assistantMessageId = assistantMessage.id;
      setScriptConversations(prev => ({
        ...prev,
        [fileId]: {
          ...(prev[fileId] || conversation),
          messages: [...(prev[fileId]?.messages || [...conversation.messages, userMessage]), assistantMessage],
        },
      }));

      let result = '';
      const replaceStreamContent = (nextContent: string) => {
        streamedContent = nextContent;
        setScriptConversations(prev => {
          const current = prev[fileId];
          if (!current) return prev;
          return {
            ...prev,
            [fileId]: {
              ...current,
              messages: current.messages.map(message => message.id === assistantMessage.id
                ? { ...message, content: streamedContent, status: 'streaming', updatedAt: Date.now() }
                : message),
            },
          };
        });
      };
      const appendStreamChunk = (chunk: string) => replaceStreamContent(`${streamedContent}${chunk}`);
      const taskContext = {
        projectId: urlProjectId,
        episodeId: propEpisodeId,
        sourcePage: 'script',
        sourceItemId: fileId,
        entityType: 'episode_script',
        entityId: fileId,
      };
      const generationSource = isFirstTurn
        ? content
        : currentVersion?.content || file.scriptContent || file.originalContent;
      const generationRequirements = isFirstTurn ? '' : content;
      if (isFirstTurn) {
        const { aiGenerateStoryboardScript } = await loadAiModelService();
        result = await aiGenerateStoryboardScript(
          aiModel,
          generationSource,
          generationRequirements,
          appendStreamChunk,
          taskContext,
          projectOrientation,
        );
      } else {
        result = await handleIterateScript(
          generationSource,
          generationRequirements,
          conversationContext,
          appendStreamChunk,
        );
      }
      pipelineInputTexts = [generationSource, generationRequirements, ...(isFirstTurn ? [] : [conversationContext])].filter(Boolean);
      pipelineOutputTexts = [result];

      const rawFinalContent = (result || streamedContent).trim();
      if (!rawFinalContent) throw new Error('模型未返回内容，请稍后重试');
      const normalizedCandidate = normalizeGeneratedVideoScript(rawFinalContent);
      const finalContent = isFirstTurn
        ? normalizedCandidate
        : stabilizeScriptIterationResult(generationSource, normalizedCandidate, generationRequirements);
      const parsedItems = parseStoryboardVersionContent(finalContent);
      replaceStreamContent(finalContent);
      const billingParams = {
        input_tokens: estimateTextTokens(pipelineInputTexts.join('\n')),
        output_tokens: estimateTextTokens(pipelineOutputTexts.join('\n') || finalContent),
        model: modelInfo.billingModel,
      };
      const credit = await consumeCredits({
        featureKey: 'script_model_call',
        taskId: requestId,
        params: billingParams,
        projectId: urlProjectId,
        metadata: { episode_id: propEpisodeId, script_id: fileId, operation: isFirstTurn ? 'create' : 'iterate' },
      });
      chargedCreditCost = Number(credit.charged_credits || 0);
      const billingMetadata = {
        requestId,
        estimatedCreditCost,
        creditCharged: true,
        creditCost: chargedCreditCost,
        creditTransactionId: credit.transaction_id,
        creditFeatureKey: credit.feature_key,
        creditUsage: billingParams,
      };
      const versionMetadata = {
        ...billingMetadata,
        scriptPipeline: {
          version: 3,
          stage: 'directStoryboardScript',
          shotNumberFormat: 'segment-local',
          sourceVersionId: isFirstTurn ? undefined : currentVersion?.id,
          sourceVersionNo: isFirstTurn ? undefined : currentVersion?.versionNo,
          inheritsVersionChain: !isFirstTurn,
        },
      };
      const completedMessage = await updateScriptMessage(
        propEpisodeId,
        fileId,
        assistantMessage.id,
        { content: finalContent, status: 'completed', metadata: billingMetadata },
      );
      const version = await createScriptVersion(propEpisodeId, fileId, {
        messageId: assistantMessage.id,
        baseVersionId: isFirstTurn ? undefined : currentVersion?.id,
        content: finalContent,
        storyboardItems: parsedItems,
        source: 'ai',
        status: isFirstTurn ? 'ready' : 'draft',
        modelAlias: modelInfo.alias,
        provider: modelInfo.provider,
        modelName: modelInfo.billingModel,
        metadata: versionMetadata,
        setCurrent: isFirstTurn,
      });
      if (isFirstTurn) {
        await updateEpisodeScriptById(propEpisodeId, fileId, {
          adapted_script: finalContent,
        });
        updateFileWithHistory(fileId, current => ({
          ...current,
          originalContent: content,
          scriptContent: finalContent,
          status: FileStatus.Completed,
          lastUpdated: Date.now(),
        }), { recordHistory: false });
      }
      setScriptConversations(prev => {
        const current = prev[fileId] || conversation;
        return {
          ...prev,
          [fileId]: {
            ...current,
            currentVersionId: isFirstTurn ? version.id : current.currentVersionId,
            defaultModel: modelInfo.billingModel,
            messages: current.messages.map(message => message.id === assistantMessage.id ? completedMessage : message),
            versions: [...current.versions.filter(item => item.id !== version.id), version],
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成分镜脚本失败';
      setConversationError(assistantMessageId ? null : message);
      if (assistantMessageId) {
        const failedMetadata = {
          requestId,
          error: message,
          estimatedCreditCost,
          creditCharged: chargedCreditCost > 0,
          creditCost: chargedCreditCost,
        };
        await updateScriptMessage(propEpisodeId, fileId, assistantMessageId, {
          content: streamedContent,
          status: 'failed',
          metadata: failedMetadata,
        }).catch(() => undefined);
        setScriptConversations(prev => {
          const current = prev[fileId];
          if (!current) return prev;
          return {
            ...prev,
            [fileId]: {
              ...current,
              messages: current.messages.map(item => item.id === assistantMessageId
                ? { ...item, content: streamedContent, status: 'failed', metadata: failedMetadata, updatedAt: Date.now() }
                : item),
            },
          };
        });
      }
      throw error;
    } finally {
      setConversationSendingId(null);
    }
  }, [aiModel, handleIterateScript, projectOrientation, propEpisodeId, scriptConversations, scriptModelOptions, selectedFileId, updateFileWithHistory, urlProjectId]);

  const handleConversationConfirmVersion = useCallback(async (version: ScriptStoryboardVersion) => {
    const fileId = selectedFileId;
    if (!fileId) return;
    setConversationSendingId(fileId);
    setConversationError(null);
    try {
      const confirmed = await confirmScriptVersion(propEpisodeId, fileId, version.id);
      updateFileWithHistory(fileId, current => ({
        ...current,
        scriptContent: confirmed.content,
        status: FileStatus.Completed,
        lastUpdated: Date.now(),
      }), { recordHistory: false });
      setScriptConversations(prev => {
        const current = prev[fileId];
        if (!current) return prev;
        return {
          ...prev,
          [fileId]: {
            ...current,
            currentVersionId: confirmed.id,
            versions: current.versions.map(item => item.id === confirmed.id ? confirmed : item),
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '确认剧本版本失败';
      setConversationError(message);
      throw error;
    } finally {
      setConversationSendingId(null);
    }
  }, [propEpisodeId, selectedFileId, updateFileWithHistory]);

  const handleConversationRejectVersion = useCallback(async (version: ScriptStoryboardVersion) => {
    const fileId = selectedFileId;
    if (!fileId) return;
    setConversationSendingId(fileId);
    setConversationError(null);
    try {
      const rejection = await rejectScriptVersion(propEpisodeId, fileId, version.id);
      const rejected = rejection.version;
      if (rejection.outcome === 'already_confirmed' && rejection.currentVersionId === rejected.id) {
        updateFileWithHistory(fileId, current => ({
          ...current,
          scriptContent: rejected.content,
          status: FileStatus.Completed,
          lastUpdated: Date.now(),
        }), { recordHistory: false });
      }
      setScriptConversations(prev => {
        const current = prev[fileId];
        if (!current) return prev;
        return {
          ...prev,
          [fileId]: {
            ...current,
            currentVersionId: rejection.currentVersionId || current.currentVersionId,
            versions: current.versions.map(item => item.id === rejected.id ? rejected : item),
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '拒绝剧本版本失败';
      setConversationError(message);
      throw error;
    } finally {
      setConversationSendingId(null);
    }
  }, [propEpisodeId, selectedFileId, updateFileWithHistory]);

  const handleConversationEditVersion = useCallback(async (
    sourceVersion: ScriptStoryboardVersion,
    content: string,
  ) => {
    const fileId = selectedFileId;
    if (!fileId) return;
    const normalizedContent = content.trim();
    if (!normalizedContent) throw new Error('分镜脚本内容不能为空');
    const parsedItems = parseStoryboardVersionContent(normalizedContent);
    const storyboardItems = parsedItems.length > 0 ? parsedItems : normalizeVersionStoryboardItems(sourceVersion.storyboardItems);
    const metadata = {
      sourceVersionId: sourceVersion.id,
      scriptPipeline: {
        ...(sourceVersion.metadata?.scriptPipeline || {}),
        version: 3,
        stage: 'videoScript',
        shotNumberFormat: 'segment-local',
        sourceVersionId: sourceVersion.id,
      },
    };
    const message = await createScriptMessage(propEpisodeId, fileId, {
      role: 'assistant',
      content: normalizedContent,
      status: 'completed',
      modelAlias: '手动编辑',
      provider: 'manual',
      modelName: 'manual',
      requestId: `manual_${uuidv4()}`,
      metadata,
    });
    const version = await createScriptVersion(propEpisodeId, fileId, {
      messageId: message.id,
      baseVersionId: sourceVersion.id,
      content: normalizedContent,
      storyboardItems,
      source: 'manual',
      status: 'ready',
      modelAlias: '手动编辑',
      provider: 'manual',
      modelName: 'manual',
      metadata,
      setCurrent: true,
    });
    await updateEpisodeScriptById(propEpisodeId, fileId, { adapted_script: normalizedContent });
    updateFileWithHistory(fileId, current => ({
      ...current,
      scriptContent: normalizedContent,
      status: FileStatus.Completed,
      lastUpdated: Date.now(),
    }), { recordHistory: false });
    setScriptConversations(prev => {
      const current = prev[fileId] || { scriptId: fileId, messages: [], versions: [] };
      return {
        ...prev,
        [fileId]: {
          ...current,
          currentVersionId: version.id,
          messages: [...current.messages, message],
          versions: [...current.versions, version],
        },
      };
    });
  }, [propEpisodeId, selectedFileId, updateFileWithHistory]);

  const handleConversationGenerateDesign = useCallback(async (
    version: ScriptStoryboardVersion,
    options: { autoSnapshot?: boolean; openDrawer?: boolean } = {},
  ) => {
    const fileId = selectedFileId;
    if (!fileId) return;
    setConversationError(null);
    setConversationSendingId(fileId);
    try {
      const selectedVersion = version.source === 'legacy' && version.id.startsWith('legacy_')
        ? version
        : await selectScriptVersion(propEpisodeId, fileId, version.id);


      if (options.autoSnapshot === false) {
        const localSnapshots = filesRef.current
          .find(item => item.id === fileId)
          ?.versions.filter(snapshot => snapshot.scriptVersionId === selectedVersion.id) || [];
        const snapshots = mergeStoryboardSnapshots(
          getVersionStoryboardSnapshots(selectedVersion),
          localSnapshots,
        );
        const latestSnapshot = snapshots[snapshots.length - 1];
        const items = latestSnapshot?.data.storyboard?.items
          ? normalizeVersionStoryboardItems(latestSnapshot.data.storyboard.items)
          : [];
        if (items.length === 0) {
          throw new Error(`分镜脚本 V${selectedVersion.versionNo} 尚无镜头设计历史，请在对话中点击“生成镜头设计”`);
        }
        flushSync(() => {
          updateFileWithHistory(fileId, current => ({
            ...current,
            scriptContent: selectedVersion.content,
            storyboard: { items },
            status: FileStatus.Completed,
            lastUpdated: Date.now(),
          }), {
            recordHistory: false,
            resetHistory: true,
            versionId: selectedVersion.id,
          });
          setScriptConversations(prev => prev[fileId] ? ({
            ...prev,
            [fileId]: { ...prev[fileId], currentVersionId: selectedVersion.id },
          }) : prev);
          if (options.openDrawer !== false) setStoryboardDrawerOpen(true);
        });
        await updateEpisodeScriptById(propEpisodeId, fileId, { adapted_script: selectedVersion.content });
        return;
      }

      const modelInfo = getScriptModelInfo(aiModel, scriptModelOptions);
      const sourceItems = parseStoryboardVersionContent(selectedVersion.content);
      if (sourceItems.length === 0) {
        throw new Error('当前分镜脚本版本没有可生成的镜头内容');
      }
      const billingTaskId = `storyboard_design_${uuidv4()}`;
      await assertEnoughCredits('storyboard_design_generation', {
        shot_count: sourceItems.length,
        input_tokens: estimateTextTokens(selectedVersion.content),
        output_tokens: Math.max(500, sourceItems.length * 500),
        model: modelInfo.billingModel,
      });

      const pipelineService = await loadScriptThreeStageService();
      const designResult = await pipelineService.generateStoryboardDesignForVersion(
        aiModel,
        selectedVersion.content,
        {
          orientation: projectOrientation,
          taskContext: {
            projectId: urlProjectId,
            episodeId: propEpisodeId,
            sourcePage: 'script',
            sourceItemId: fileId,
            entityType: 'episode_script_version',
            entityId: selectedVersion.id,
          },
          onProgress: progress => {
            setShotGenerationProgress({ current: progress.completed, total: progress.total });
          },
        },
      );
      const persistedItems = await replaceActiveStoryboardDesign(
        fileId,
        designResult.items,
        {
          archiveName: `自动历史 · 生成分镜脚本 V${selectedVersion.versionNo} 镜头设计前 · ${new Date().toLocaleString('zh-CN')}`,
          versionId: selectedVersion.id,
          openDrawer: options.openDrawer !== false,
        },
      );
      await updateEpisodeScriptById(propEpisodeId, fileId, { adapted_script: selectedVersion.content });

      flushSync(() => {
        updateFileWithHistory(fileId, current => ({
          ...current,
          scriptContent: selectedVersion.content,
          status: FileStatus.Completed,
          lastUpdated: Date.now(),
        }), {
          recordHistory: false,
          versionId: selectedVersion.id,
        });
        setScriptConversations(prev => prev[fileId] ? ({
          ...prev,
          [fileId]: { ...prev[fileId], currentVersionId: selectedVersion.id },
        }) : prev);
      });

      await persistStoryboardSnapshot(fileId, {
        source: 'auto',
        version: selectedVersion,
        name: `自动存档 · 分镜脚本 V${selectedVersion.versionNo} · ${new Date().toLocaleString('zh-CN')}`,
        waitForRemote: false,
      });

      const billingParams = {
        shot_count: persistedItems.length,
        input_tokens: estimateTextTokens(designResult.inputTexts.join('\n')),
        output_tokens: estimateTextTokens(designResult.outputTexts.join('\n')),
        model: modelInfo.billingModel,
      };
      const credit = await consumeCredits({
        featureKey: 'storyboard_design_generation',
        taskId: billingTaskId,
        params: billingParams,
        projectId: urlProjectId,
        metadata: {
          episode_id: propEpisodeId,
          script_id: fileId,
          script_version_id: selectedVersion.id,
          operation: 'extract_storyboard_design',
        },
      });
      if (!selectedVersion.id.startsWith('legacy_')) {
        const previousBillings = Array.isArray(selectedVersion.metadata?.storyboardDesignBillings)
          ? selectedVersion.metadata.storyboardDesignBillings
          : [];
        const updatedVersion = await updateScriptVersionMetadata(propEpisodeId, fileId, selectedVersion.id, {
          storyboardDesignCreditCost: credit.charged_credits,
          storyboardDesignCreditTransactionId: credit.transaction_id,
          storyboardDesignCreditTaskId: billingTaskId,
          storyboardDesignUsage: billingParams,
          storyboardDesignGeneratedAt: Date.now(),
          storyboardDesignBillings: [
            ...previousBillings,
            {
              taskId: billingTaskId,
              cost: credit.charged_credits,
              usage: billingParams,
              createdAt: Date.now(),
            },
          ].slice(-20),
        });
        setScriptConversations(prev => prev[fileId] ? ({
          ...prev,
          [fileId]: {
            ...prev[fileId],
            versions: prev[fileId].versions.map(item => item.id === updatedVersion.id ? updatedVersion : item),
          },
        }) : prev);
      }
      window.alert(`生成镜头设计完成，已拆为 ${persistedItems.length} 个镜头`);
    } catch (error) {
      const message = summarizePipelineError(error);
      console.error('生成镜头设计失败:', error);
      setConversationError(`生成镜头设计失败：${message}`);
    } finally {
      setConversationSendingId(null);
      setShotGenerationProgress(null);
    }
  }, [
    aiModel,
    persistStoryboardSnapshot,
    projectOrientation,
    propEpisodeId,
    replaceActiveStoryboardDesign,
    scriptModelOptions,
    selectedFileId,
    updateFileWithHistory,
    urlProjectId,
  ]);

  const handleOpenStoryboardDrawer = useCallback(async () => {
    if (!selectedFileId) return;
    setConversationError(null);
    const file = filesRef.current.find(item => item.id === selectedFileId);
    const existingItems = (file?.storyboard?.items || []).filter(item => !item.isPlaceholder);
    if (existingItems.length > 0) {
      setStoryboardDrawerOpen(true);
      return;
    }
    try {
      const knownTotal = storyboardTotalsByFileId[selectedFileId] ?? WORKSPACE_INITIAL_STORYBOARD_COUNT;
      const loadedItems = await loadWorkspaceStoryboardPage(selectedFileId, knownTotal);
      if (loadedItems.some(item => !item.isPlaceholder)) {
        setStoryboardDrawerOpen(true);
        return;
      }
      setConversationError('当前还没有可展示的镜头设计，请先生成镜头设计。');
    } catch (error) {
      console.warn('Workspace storyboard drawer load failed:', error);
      setConversationError(`镜头设计加载失败：${summarizePipelineError(error)}`);
    }
  }, [
    loadWorkspaceStoryboardPage,
    selectedFileId,
    storyboardTotalsByFileId,
  ]);

  const handleConversationExportVersion = useCallback((version: ScriptStoryboardVersion) => {
    const file = filesRef.current.find(item => item.id === selectedFileId);
    if (!file) return;
    exportStoryboardVersionCsv(file, {
      ...version,
      storyboardItems: normalizeVersionStoryboardItems(version.storyboardItems),
    });
  }, [selectedFileId]);

  const handleFileSelect = (id: string) => {
      setSelectedFileId(id);
      setStoryboardDrawerOpen(false);
    const file = filesRef.current.find(f => f.id === id);
    if (!file?.storyboard?.items?.length && storyboardTotalsByFileId[id] !== 0) {
      void loadWorkspaceStoryboardPage(id, WORKSPACE_INITIAL_STORYBOARD_COUNT).catch(err => {
        console.warn('Workspace storyboard page load failed:', err);
      });
    }
    setHighlightedScriptSegments(new Set());
    setHighlightedStoryboardItemIds(new Set());
  };

  const handleFileCheck = (id: string, checked: boolean) => {
    setCheckedFileIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleCheckAll = (checked: boolean) => {
    if (checked) {
      setCheckedFileIds(new Set(files.map(f => f.id)));
    } else {
      setCheckedFileIds(new Set());
    }
  };

  const handleRenameFile = (id: string, newName: string) => {
    updateFileWithHistory(id, (f) => ({ ...f, name: newName }));
  };

  const handleDownloadFile = (id: string) => {
    const file = files.find(f => f.id === id);
    if (!file) return;

    const blob = new Blob([file.originalContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDeleteFile = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (files.length <= 1) {
      window.alert('每个分集至少需要保留一个剧本文件，最后一个剧本不能删除。请先新建或上传另一个剧本。');
      return;
    }
    try {
      await deleteEpisodeScript(propEpisodeId, id);
      delete savedScriptSignaturesRef.current[id];
      const remainingFiles = files.filter(file => file.id !== id);
      if (activeScriptId === id && remainingFiles.length > 0) {
        await activateWorkflowScript(remainingFiles[0].id);
      }
      setFiles(prev => {
        const newFiles = prev.filter(f => f.id !== id);
        filesRef.current = newFiles;
        if (selectedFileId === id && newFiles.length > 0) {
          setSelectedFileId(newFiles[0].id);
        }
        return newFiles;
      });
    } catch (err) {
      console.error('删除文件失败:', err);
    }
  };

  const handleMoveFile = (e: React.MouseEvent, id: string, direction: 'up' | 'down') => {
    setFiles(prev => {
      const index = prev.findIndex(f => f.id === id);
      if (index === -1) return prev;
      const newFiles = [...prev];
      if (direction === 'up' && index > 0) {
        [newFiles[index], newFiles[index - 1]] = [newFiles[index - 1], newFiles[index]];
      } else if (direction === 'down' && index < newFiles.length - 1) {
        [newFiles[index], newFiles[index + 1]] = [newFiles[index + 1], newFiles[index]];
      }
      return newFiles;
    });
  };


  const handleReorderFiles = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;

    setFiles(prev => {
      const newFiles = [...prev];
      const [movedFile] = newFiles.splice(fromIndex, 1);
      newFiles.splice(toIndex, 0, movedFile);
      console.log(`📎 文件排序: ${movedFile.name} 从位置 ${fromIndex + 1} 移动到 ${toIndex + 1}`);
      return newFiles;
    });
  }, []);

  const updateFileStatus = (id: string, status: FileStatus) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status } : f));
  };

  const getTargetIds = (targetFileId?: string) => {
      if (targetFileId) return [targetFileId];
      if (checkedFileIds.size > 0) return Array.from(checkedFileIds);
      if (selectedFileId) return [selectedFileId];
      return [];
  };


  const handleScriptSelectionChange = (selection: string | null) => {
    if (!selection || !selectedFile?.storyboard) {
        setHighlightedStoryboardItemIds(new Set());
        setHighlightedScriptSegments(new Set());
        return;
    }

    const matchedIds = new Set<string>();
    const matchedSegments = new Set<string>();



    const safeShotNumStr = (sn: string | number | undefined | null): string => {
        if (sn === undefined || sn === null) return '';
        return typeof sn === 'string' ? sn : String(sn);
    };


    const seln = selection.trim();
    if (seln.length >= 3) {
        selectedFile.storyboard.items.forEach(item => {
            const blk = item.videoScriptBlock;
            if (blk && blk.trim() && (blk.includes(seln) || seln.includes(blk.trim()))) {
                matchedIds.add(item.id);
                matchedSegments.add(blk);
            }
        });
    }


    const shotMatch = selection.match(/镜头\s*\d+(?:\s*[-－—]\s*\d+)?/);
    if (matchedIds.size === 0 && shotMatch) {
        const selectedShotNo = parseHierarchicalShotNumber(shotMatch[0]);
        selectedFile.storyboard.items.forEach(item => {
            const itemShotNo = parseHierarchicalShotNumber(safeShotNumStr(item.shotNumber));
            const matches = selectedShotNo && itemShotNo
              && selectedShotNo.localShotNo === itemShotNo.localShotNo
              && (
                selectedShotNo.segmentNo === null
                || itemShotNo.segmentNo === null
                || selectedShotNo.segmentNo === itemShotNo.segmentNo
              );
            if (matches) {
                matchedIds.add(item.id);
                matchedSegments.add(safeShotNumStr(item.shotNumber) || item.scriptSegment);
            }
        });
    }


    if (matchedIds.size === 0 && selectedFile.scriptContent) {
        const content = selectedFile.scriptContent;
        const selectionIndex = content.indexOf(selection);
        if (selectionIndex !== -1) {

            const beforeText = content.substring(0, selectionIndex);
            const shotMatches = [...beforeText.matchAll(/镜头\s*\d+(?:\s*[-－—]\s*\d+)?/g)];
            if (shotMatches.length > 0) {
                const lastMatch = shotMatches[shotMatches.length - 1];
                const selectedShotNo = parseHierarchicalShotNumber(lastMatch[0]);
                selectedFile.storyboard.items.forEach(item => {
                    const itemShotNo = parseHierarchicalShotNumber(safeShotNumStr(item.shotNumber));
                    const matches = selectedShotNo && itemShotNo
                      && selectedShotNo.localShotNo === itemShotNo.localShotNo
                      && (
                        selectedShotNo.segmentNo === null
                        || itemShotNo.segmentNo === null
                        || selectedShotNo.segmentNo === itemShotNo.segmentNo
                      );
                    if (matches) {
                        matchedIds.add(item.id);
                        matchedSegments.add(safeShotNumStr(item.shotNumber) || item.scriptSegment);
                    }
                });
            }
        }
    }


    if (matchedIds.size === 0) {
        selectedFile.storyboard.items.forEach(item => {
            const originalText = item.originalText || item.scriptSegment;
            if (originalText && originalText.includes(selection)) {
                matchedIds.add(item.id);
                matchedSegments.add(originalText);
            }
        });
    }

    setHighlightedStoryboardItemIds(matchedIds);
    setHighlightedScriptSegments(matchedSegments);
  };

  const handleStoryboardSelectionChange = (selectedIds: Set<string>) => {
      setHighlightedStoryboardItemIds(selectedIds);

      if (!selectedFile?.storyboard) return;

      const segments = new Set<string>();
      selectedFile.storyboard.items.forEach(item => {
          if (selectedIds.has(item.id)) {

              segments.add(item.scriptSegment);


              if (item.dialogue && item.dialogue.trim()) {
                  segments.add(item.dialogue.trim());
              }
          }
      });
      setHighlightedScriptSegments(segments);

  };


  const handleUpdateScript = (newContent: string) => {
      if (!selectedFileId) return;
      updateFileWithHistory(selectedFileId, (f) => ({ ...f, scriptContent: newContent }));
  };


  const handleUpdateStoryboardItems = (items: StoryboardItem[]) => {
      if (!selectedFileId) return;
      updateFileWithHistory(selectedFileId, (f) => ({
        ...f,
        storyboard: { ...f.storyboard, items }
      }));
  };

  const updateStoryboardItemRef = useRef<
    (itemId: string, updates: Partial<StoryboardItem> | ((item: StoryboardItem) => Partial<StoryboardItem>)) => void
  >(undefined);

  updateStoryboardItemRef.current = (itemId, updates) => {
      if (!selectedFileId) return;
      const currentFile = files.find(f => f.id === selectedFileId);
      const currentItem = currentFile?.storyboard?.items.find(i => i.id === itemId);

      updateFileWithHistory(selectedFileId, (f) => {
          if (!f.storyboard) return f;
          const newItems = f.storyboard.items.map(item => {
              if (item.id !== itemId) return item;
              const actualUpdates = typeof updates === 'function' ? updates(item) : updates;
              return { ...item, ...actualUpdates };
          });
          return { ...f, storyboard: { ...f.storyboard, items: newItems } };
      });

      if (currentItem) {
          const actualUpdates = typeof updates === 'function' ? updates(currentItem) : updates;
          const dbUpdates = storyboardItemToDbUpdate(actualUpdates);
          if ('characters' in actualUpdates || 'scene' in actualUpdates || 'props' in actualUpdates) {
              const updatedItem = { ...currentItem, ...actualUpdates };
              dbUpdates.bound_assets = buildBoundAssetTags(updatedItem);
          }
          if (Object.keys(dbUpdates).length > 0) {
              updateStoryboardItem(itemId, dbUpdates).catch(err => {
                  console.error('❌ 保存分镜更新失败:', err);
              });
          }
      }
  };

  const handleUpdateStoryboardItem = useCallback(
      (itemId: string, updates: Partial<StoryboardItem> | ((item: StoryboardItem) => Partial<StoryboardItem>)) => {
          flushSync(() => {
              updateStoryboardItemRef.current?.(itemId, updates);
          });
      },
      []
  );


  const handleBindMaterial = (shotId: string, tagName: string, materialId: string) => {
    if (!selectedFileId || !selectedFile?.storyboard) return;

    updateFileWithHistory(selectedFileId, (f) => {
      if (!f.storyboard) return f;

      const currentShotIndex = f.storyboard.items.findIndex(i => i.id === shotId);
      if (currentShotIndex === -1) return f;

      const newItems = [...f.storyboard.items];

      for (let i = currentShotIndex; i < newItems.length; i++) {
        const item = newItems[i];
        // If this shot contains the tag (Character, Scene or Prop)
        if ((item.characters || []).includes(tagName) || item.scene === tagName || (item.props || []).includes(tagName)) {
           newItems[i] = {
             ...item,
             materialSelections: {
               ...(item.materialSelections || {}),
               [tagName]: materialId
             }
           };
        }
      }

      return {
        ...f,
        storyboard: { items: newItems }
      };
    });
  };

  const handleUnbindMaterial = (shotId: string, tagName: string) => {
    if (!selectedFileId || !selectedFile?.storyboard) return;

    updateFileWithHistory(selectedFileId, (f) => {
      if (!f.storyboard) return f;

      const currentShotIndex = f.storyboard.items.findIndex(i => i.id === shotId);
      if (currentShotIndex === -1) return f;

      const newItems = [...f.storyboard.items];

      // Delete forward: from current shot to end
      for (let i = currentShotIndex; i < newItems.length; i++) {
        const item = newItems[i];
        if ((item.characters || []).includes(tagName) || item.scene === tagName || (item.props || []).includes(tagName)) {
           const newSelections = { ...(item.materialSelections || {}) };
           delete newSelections[tagName];

           newItems[i] = {
             ...item,
             materialSelections: newSelections
           };
        }
      }

      return {
        ...f,
        storyboard: { items: newItems }
      };
    });
  };


  const handleAppendStoryboard = useCallback((sourceFileIds: string[]) => {
    if (!selectedFileId || sourceFileIds.length === 0) return;

    const targetFileIndex = files.findIndex(f => f.id === selectedFileId);
    const targetFile = files[targetFileIndex];

    if (!targetFile) {
      console.warn('目标文件不存在');
      return;
    }


    const sortedSourceFiles = sourceFileIds
      .map(id => ({ id, index: files.findIndex(f => f.id === id) }))
      .filter(({ index }) => index !== -1)
      .sort((a, b) => a.index - b.index)
      .map(({ id }) => files.find(f => f.id === id)!)
      .filter(f => f.storyboard?.items?.length);

    if (sortedSourceFiles.length === 0) {
      console.warn('没有可追加的镜头');
      return;
    }

    console.log(`📎 批量追加分镜: ${sortedSourceFiles.map(f => f.name).join(', ')} → ${targetFile.name}`);


    const frontFiles = sortedSourceFiles.filter(f => files.findIndex(sf => sf.id === f.id) < targetFileIndex);
    const backFiles = sortedSourceFiles.filter(f => files.findIndex(sf => sf.id === f.id) > targetFileIndex);


    const frontItems: StoryboardItem[] = frontFiles.flatMap(sourceFile =>
      sourceFile.storyboard!.items.map(item => ({
        ...item,
        id: uuidv4(),
        sourceFileId: sourceFile.id,
        sourceFileName: sourceFile.name,
        materialSelections: item.materialSelections ? { ...item.materialSelections } : undefined
      }))
    );


    const backItems: StoryboardItem[] = backFiles.flatMap(sourceFile =>
      sourceFile.storyboard!.items.map(item => ({
        ...item,
        id: uuidv4(),
        sourceFileId: sourceFile.id,
        sourceFileName: sourceFile.name,
        materialSelections: item.materialSelections ? { ...item.materialSelections } : undefined
      }))
    );

    console.log(`   前置镜头数: ${frontItems.length}, 追加镜头数: ${backItems.length}`);
    console.log(`   目标文件原镜头数: ${targetFile.storyboard?.items?.length || 0}`);

    updateFileWithHistory(selectedFileId, (f) => {
      const existingItems = f.storyboard?.items || [];
      const combinedItems = [...frontItems, ...existingItems, ...backItems];

      console.log(`   合并后镜头数: ${combinedItems.length}`);

      return {
        ...f,
        storyboard: { items: combinedItems },
        lastUpdated: Date.now()
      };
    });


    const allCharacters = sortedSourceFiles.flatMap(f => f.extractedCharacters || []);
    const allScenes = sortedSourceFiles.flatMap(f => f.extractedScenes || []);
    const allProps = sortedSourceFiles.flatMap(f => f.extractedProps || []);

    if (allCharacters.length || allScenes.length || allProps.length) {
      setFiles(prev => prev.map(f => {
        if (f.id === selectedFileId) {
          const newCharacters = [...new Set([...(f.extractedCharacters || []), ...allCharacters])];
          const newScenes = [...new Set([...(f.extractedScenes || []), ...allScenes])];
          const newProps = [...new Set([...(f.extractedProps || []), ...allProps])];
          return {
            ...f,
            extractedCharacters: newCharacters,
            extractedScenes: newScenes,
            extractedProps: newProps
          };
        }
        return f;
      }));
    }

    console.log(`✅ 批量追加完成: ${sortedSourceFiles.length} 个文件的镜头已追加到 ${targetFile.name}`);
  }, [selectedFileId, files, updateFileWithHistory]);


  const handleRemoveAppendedStoryboard = useCallback((sourceFileId?: string) => {
    if (!selectedFileId) return;

    updateFileWithHistory(selectedFileId, (f) => {
      if (!f.storyboard?.items) return f;

      let newItems: StoryboardItem[];

      if (sourceFileId) {

        newItems = f.storyboard.items.filter(item => item.sourceFileId !== sourceFileId);
        console.log(`🗑️ 移除来自 ${sourceFileId} 的追加镜头`);
      } else {

        newItems = f.storyboard.items.filter(item => !item.sourceFileId);
        console.log(`🗑️ 移除所有追加的镜头`);
      }

      return {
        ...f,
        storyboard: { items: newItems },
        lastUpdated: Date.now()
      };
    });
  }, [selectedFileId, updateFileWithHistory]);


  const handleLockItem = (id: string) => {
      if (!selectedFileId) return;
      updateFileWithHistory(selectedFileId, (f) => {
          if (!f.storyboard) return f;
          return {
              ...f,
              storyboard: {
                  items: f.storyboard.items.map(item => item.id === id ? { ...item, isLocked: !item.isLocked } : item)
              }
          };
      });
  };

  const handleDeleteStoryboardItem = (id: string) => {
      if (!selectedFileId || !selectedFile?.storyboard) return;


      const itemToDelete = selectedFile.storyboard.items.find(item => item.id === id);
      if (!itemToDelete) return;

      const originalText = itemToDelete.originalText || itemToDelete.scriptSegment;


      const sameTextItems = selectedFile.storyboard.items.filter(item => {
          const itemOriginalText = item.originalText || item.scriptSegment;
          return itemOriginalText === originalText && item.id !== id && !item.isPlaceholder;
      });

      const isPersistedId = typeof id === 'string' && id.startsWith('sb_');
      const willHardDelete = sameTextItems.length > 0;

      updateFileWithHistory(selectedFileId, (f) => {
          if (!f.storyboard) return f;

          if (willHardDelete) {
          return {
              ...f,
              storyboard: {
                      items: f.storyboard.items.filter(item => item.id !== id)
                  }
              };
          }

          return {
              ...f,
              storyboard: {
                  items: f.storyboard.items.map(item =>
                      item.id === id ? { ...item, isPlaceholder: true } : item
                  )
              }
          };
      });

      if (isPersistedId) {
          deleteStoryboardItem(id).catch(err => {
              console.error('❌ 删除分镜失败:', err);
          });
      }
  };

  const handleRegenerateItem = async (id: string, instruction?: string) => {
      if (!selectedFileId || !selectedFile?.storyboard) return;

      const itemToRegen = selectedFile.storyboard.items.find(i => i.id === id);
      if (!itemToRegen || itemToRegen.isLocked) return;

      setIsProcessing(true);
      try {
        const { aiRegenerateSingleShot } = await loadAiModelService();
        const newData = await aiRegenerateSingleShot(aiModel, itemToRegen.scriptSegment, instruction);

          updateFileWithHistory(selectedFileId, (f) => {
              if (!f.storyboard) return f;
              return {
                  ...f,
                  storyboard: {
                      items: f.storyboard.items.map(item =>
                          item.id === id ? { ...item, ...newData, isPlaceholder: false } : item
                      )
                  }
              };
          });
      } catch (e) {
          console.error("Single Regen Failed", e);
          alert("单镜头重绘失败: 可能是网络繁忙，请稍后再试。");
      } finally {
          setIsProcessing(false);
      }
  };


  const handleInsertShot = async (position: number, shotData: Omit<StoryboardItem, 'id'>) => {
    if (!selectedFileId || !selectedFile?.storyboard) return;

    const adjacentItem = position > 0
      ? selectedFile.storyboard.items[position - 1]
      : selectedFile.storyboard.items[position];
    const newItem: StoryboardItem = {
      ...shotData,
      scriptSegmentId: shotData.scriptSegmentId || adjacentItem?.scriptSegmentId,
      id: uuidv4()
    };

    updateFileWithHistory(selectedFileId, (f) => {
      if (!f.storyboard) return f;
      const newItems = [...f.storyboard.items];
      newItems.splice(position, 0, newItem);
      return {
        ...f,
        storyboard: {
          items: normalizeStoryboardItemsForWorkflow(newItems, f.scriptSegments || [])
        }
      };
    });
  };


  const handleInsertShotWithAI = async (position: number, originalText: string) => {
    if (!selectedFileId || !selectedFile?.storyboard) return;

    setIsProcessing(true);
    try {

      const items = selectedFile.storyboard.items;
      const prevItem = position > 0 ? items[position - 1] : null;
      const nextItem = position < items.length ? items[position] : null;

      let contextPrompt = `请基于以下原文段落生成分镜信息：\n\n原文：${originalText}\n\n`;
      if (prevItem) {
        contextPrompt += `前一个镜头场景描述：${prevItem.scriptSegment}\n`;
      }
      if (nextItem) {
        contextPrompt += `后一个镜头场景描述：${nextItem.scriptSegment}\n`;
      }
      contextPrompt += '\n请返回新镜头的 scriptSegment, imagePrompt, videoPrompt, dialogue, characters, scene';

      const { aiRegenerateSingleShot } = await loadAiModelService();
      const newData = await aiRegenerateSingleShot(aiModel, originalText, contextPrompt);

      const newItem: StoryboardItem = {
        ...newData,
        originalText,
        scriptSegmentId: prevItem?.scriptSegmentId || nextItem?.scriptSegmentId,
        id: uuidv4()
      };

      updateFileWithHistory(selectedFileId, (f) => {
        if (!f.storyboard) return f;
        const newItems = [...f.storyboard.items];
        newItems.splice(position, 0, newItem);
        return {
          ...f,
          storyboard: {
            items: normalizeStoryboardItemsForWorkflow(newItems, f.scriptSegments || [])
          }
        };
      });
    } catch (e) {
      console.error("AI Insert Shot Failed", e);
      alert("AI生成分镜失败: 可能是网络繁忙，请稍后再试。");
      } finally {
          setIsProcessing(false);
      }
  };





  const loadViewData = useCallback(async (view: AppView) => {

  }, []);




  const schedulePreloadNextView = useCallback((currentView: AppView) => {
  }, []);




  const handleViewSwitch = useCallback((targetView: AppView) => {
    setCurrentView(targetView);

    const segments = location.pathname.split('/');
    const projIdx = segments.indexOf('projects');
    if (projIdx >= 0 && segments[projIdx + 1]) {
      const pid = segments[projIdx + 1];
      const pageMap: Record<string, string> = {
        [AppView.Editor]: 'editor',
        [AppView.Materials]: 'materials',
        [AppView.Generation]: 'generation',
        [AppView.Video]: 'video',
        [AppView.History]: 'history',
        [AppView.Admin]: 'admin',
        [AppView.PostProcess]: 'postprocess',
      };
      const page = pageMap[targetView] || 'editor';
      routerNavigate(`/projects/${pid}/${page}`, { replace: true });
    }
  }, [location.pathname, routerNavigate]);

  const handleExportStoryboards = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const pathSegments = location.pathname.split('/');
      const epIdx = pathSegments.indexOf('ep');
      if (epIdx >= 0 && pathSegments[epIdx + 1]) {
        const projIdx = pathSegments.indexOf('projects');
        const pid = projIdx >= 0 ? pathSegments[projIdx + 1] : '';
        const eid = pathSegments[epIdx + 1];
        const exportFileId = selectedFileId || activeScriptId;
        const workflowFile = filesRef.current.find(file => file.id === exportFileId);
        if (pid && eid && workflowFile) {
          const exportableItems = (workflowFile.storyboard?.items || []).filter(item => !item.isPlaceholder);
          if (exportableItems.length === 0) {
            alert('当前没有可导出的镜头设计，请先生成镜头设计。');
            return;
          }
          if (exportFileId && exportFileId !== activeScriptId) {
            await activateWorkflowScript(exportFileId);
          }
          await saveEpisodeToBackend();



          await syncStoryboardItems(
            eid,
            buildStoryboardDbPayload(exportableItems),
            workflowFile.id,
          );


          const charSet = new Set<string>();
          const sceneSet = new Set<string>();
          const propSet = new Set<string>();
          if (exportableItems.length) {
            for (const item of exportableItems) {
              if (item.characters) item.characters.forEach(c => { if (c) charSet.add(c); });
              if (item.scene) sceneSet.add(item.scene);
              if (item.props) item.props.forEach(p => { if (p) propSet.add(p); });
            }
          }
          const charNames = Array.from(charSet);
          const sceneNames = Array.from(sceneSet);
          const propNames = Array.from(propSet);

          const assetDescriptionScript = [
            workflowFile.scriptContent || '',
            workflowFile.originalContent || '',
          ].filter(Boolean).join('\n');
          const characterRows = buildScriptAssetDescriptionRows(
            'character',
            charNames,
            exportableItems,
            assetDescriptionScript,
          );
          const sceneRows = buildScriptAssetDescriptionRows(
            'scene',
            sceneNames,
            exportableItems,
            assetDescriptionScript,
          );
          const propRows = buildScriptAssetDescriptionRows(
            'prop',
            propNames,
            exportableItems,
            assetDescriptionScript,
          );

          try {
            await exportScript(eid, {
              project_id: pid,
              original_content: workflowFile.originalContent || '',
              script_content: workflowFile.scriptContent || '',
              storyboard_items: [],
              characters: characterRows,
              scenes: sceneRows,
              props: propRows,
              script_id: workflowFile.id,
              preserve_existing_storyboards: true,
            });
            console.log(`✅ 本集采用剧本导出完成: ${workflowFile.storyboard?.items?.length || 0} 个分镜`);
          } catch (e) {
            console.error('导出失败:', e);
            alert('导出失败: ' + (e instanceof Error ? e.message : '未知错误'));
            return;
          }
          try { await onAfterExport?.(); } catch (e) { console.warn('export 后置刷新失败:', e); }
          routerNavigate(`/projects/${pid}/ep/${eid}/workflow/design`);
          return;
        }
      }
      handleViewSwitch(AppView.Materials);
    } finally {
      setIsExporting(false);
    }
  };









  const handleRewrite = useCallback(async (targetFileId?: string) => {
    setIsProcessing(true);
    setProcessingType('rewrite');
    const idsToProcess = getTargetIds(targetFileId);


    const renumberItem = (item: StoryboardItem, segmentNo: number, localShotNo: number): StoryboardItem => {
        const newShotId = formatHierarchicalShotNumber(segmentNo, localShotNo);
        const rewrittenOriginal = (item.originalText || '').replace(/^镜头\s*\d+(?:\s*[-－—]\s*\d+)?/, newShotId);
        return {
            ...item,
            shotNumber: newShotId,
            originalText: rewrittenOriginal || newShotId,
        };
    };





    const buildPreviousShotsSummary = (items: StoryboardItem[]): string => {
        if (items.length === 0) return '';
        const recent = items.slice(-10);
        return recent.map(item => {
            const desc = (item.scriptSegment || item.imagePrompt || item.videoPrompt || '')
                .replace(/\s+/g, ' ')
                .trim();
            const snippet = desc.length > 80 ? desc.substring(0, 80) + '…' : desc;
            return `${item.shotNumber}：${snippet}`;
        }).join('\n');
    };

    for (const id of idsToProcess) {
        updateFileStatus(id, FileStatus.Processing);
        try {
            const currentFile = files.find(f => f.id === id);
            if (!currentFile) continue;


            const totalShots = countShots(currentFile.originalContent);
            console.log(`📊 输入内容包含 ${totalShots} 个镜头标识`);


            const segments = segmentInputContent(currentFile.originalContent, 10, 0);
            console.log(`📎 分成 ${segments.length} 段进行处理`);


            let allParsedItems: StoryboardItem[] = [];
            let allDisplayText = '';
            const { aiGenerateStoryboardScript, aiContinueStoryboardScript } = await loadAiModelService();


            for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
                const segment = segments[segmentIndex];
                console.log(`🎬 处理第 ${segmentIndex + 1}/${segments.length} 段...`);


                let streamBuffer = '';
                let displayText = '';
                let parsedItems: StoryboardItem[] = [];
                let fullAccumulatedScript = '';


                const handleStreamChunk = (chunk: string) => {
                    streamBuffer += chunk;
                    fullAccumulatedScript += chunk;


                    const { completedBlocks, displayText: newDisplayText, remainingBuffer } =
                        parseStreamingBlocks(streamBuffer);


                    if (completedBlocks.length > 0) {
                        const baseIdx = parsedItems.length;
                        const newItems = completedBlocks.map((block, idx) =>
                            renumberItem(convertToStoryboardItem(block), segmentIndex + 1, baseIdx + idx + 1)
                        );
                        parsedItems = [...parsedItems, ...newItems];
                        streamBuffer = remainingBuffer;


                        displayText += newDisplayText + '\n\n';
                    }


                    const currentDisplay = allDisplayText + removeControlCharacters(displayText + remainingBuffer);
                    const currentItems = [...allParsedItems, ...parsedItems];
                    setFiles(prevFiles => prevFiles.map(f =>
                        f.id === id ? {
                            ...f,
                            scriptContent: currentDisplay,
                            storyboard: { items: currentItems }
                        } : f
                    ));
                };


                const finalizeCurrentBuffer = () => {
                    if (streamBuffer.trim()) {
                        const { completedBlocks, displayText: finalDisplayText } =
                            parseStreamingBlocks(streamBuffer + '---CUT---');

                        if (completedBlocks.length > 0) {
                            const baseIdx = parsedItems.length;
                            const finalItems = completedBlocks.map((block, idx) =>
                                renumberItem(convertToStoryboardItem(block), segmentIndex + 1, baseIdx + idx + 1)
                            );
                            parsedItems = [...parsedItems, ...finalItems];
                            displayText += finalDisplayText;
                        }
                        streamBuffer = '';
                    }
                };


                await aiGenerateStoryboardScript(
                    aiModel,
                    segment,
                    '',
                    handleStreamChunk,
                    undefined,
                    projectOrientation,
                );


                finalizeCurrentBuffer();








                const detectContinueMarker = (text: string): string | null => {
                    const m = text.match(/<<<CONTINUE_FROM\s+(镜头\d+(?:-\d+)?)>>>/);
                    return m ? m[1] : null;
                };





                const MAX_CONTINUATIONS_PER_SEGMENT = 3;
                let continuationCount = 0;
                let nextShotId = detectContinueMarker(fullAccumulatedScript);
                while (nextShotId && continuationCount < MAX_CONTINUATIONS_PER_SEGMENT) {
                    continuationCount++;
                    console.log(`🔄 第 ${segmentIndex + 1} 段第 ${continuationCount} 次续写：从 ${nextShotId} 开始`);
                    const beforeContinue = parsedItems.length;
                    streamBuffer = '';
                    fullAccumulatedScript = '';
                    try {


                        const previousContext = buildPreviousShotsSummary([...allParsedItems, ...parsedItems]);
                        await aiContinueStoryboardScript(aiModel, nextShotId, segment, previousContext, handleStreamChunk);
                        finalizeCurrentBuffer();
                    } catch (err) {
                        console.error(`❌ 续写失败 (第 ${segmentIndex + 1} 段第 ${continuationCount} 次):`, err);
                        break;
                    }


                    const newCount = parsedItems.length - beforeContinue;
                    if (newCount === 0) {
                        console.log(`✋ 第 ${segmentIndex + 1} 段第 ${continuationCount} 次续写零产出，停止续写循环`);
                        break;
                    }

                    nextShotId = detectContinueMarker(fullAccumulatedScript);
                }
                if (continuationCount >= MAX_CONTINUATIONS_PER_SEGMENT && nextShotId) {
                    console.warn(`⚠️ 第 ${segmentIndex + 1} 段达到最大续写次数 ${MAX_CONTINUATIONS_PER_SEGMENT}，仍有未生成内容（${nextShotId}）`);
                }


                parsedItems = parsedItems.filter(item => {
                    const hasContent = (item.imagePrompt && item.imagePrompt.trim()) ||
                                       (item.videoPrompt && item.videoPrompt.trim()) ||
                                       (item.scriptSegment && item.scriptSegment.trim());
                    if (!hasContent) {
                        console.log(`🗑️ 过滤空镜头: ${item.shotNumber}`);
                    }
                    return hasContent;
                });


                parsedItems = parsedItems.map((item, idx) =>
                    renumberItem(item, segmentIndex + 1, idx + 1)
                );






                allParsedItems = [...allParsedItems, ...parsedItems];
                allDisplayText += displayText + '\n\n';

                console.log(`✅ 第 ${segmentIndex + 1} 段完成: ${parsedItems.length} 个镜头，累计: ${allParsedItems.length} 个`);
            }


            if (totalShots === 0) {
                const narrativeMax = Math.max(50, segments.length * 40);
                if (allParsedItems.length > narrativeMax) {
                    console.warn(`⚠️ 叙事文本生成了 ${allParsedItems.length} 个镜头，按兜底上限截到 ${narrativeMax} 个`);
                    allParsedItems = allParsedItems.slice(0, narrativeMax);
                }
            }


            const finalDisplayText = removeControlCharacters(allDisplayText);
            updateFileWithHistory(id, (f) => ({
                ...f,
                scriptContent: finalDisplayText,
                storyboard: { items: allParsedItems },
                status: FileStatus.Idle
            }));

            console.log(`✅ 生成完成：${allParsedItems.length} 个镜头（${segments.length} 段）`);

        } catch (error) {
            console.error(`Error processing file ${id}:`, error);
            updateFileStatus(id, FileStatus.Error);
        }
    }
    setIsProcessing(false);
    setProcessingType(null);
  }, [files, checkedFileIds, selectedFileId, aiModel, projectOrientation]);




  const handleExtractShots = useCallback(async () => {
    if (!selectedFile?.scriptContent) {
      alert('请先生成剧本内容');
      return;
    }

    setIsShotExtracting(true);
    try {
      console.log('📤 开始提取分镜...');


      const { aiExtractShotsFromScript } = await loadAiModelService();
      const result = await aiExtractShotsFromScript(aiModel, selectedFile.scriptContent);

      console.log('✅ 提取成功，分镜数量:', result.items.length);


      const storyboardItems: StoryboardItem[] = result.items.map((item, index) => ({
        id: uuidv4(),
        shotNumber: index + 1,
        originalText: item.originalText,
        scriptSegment: item.scriptSegment,
        timestamp: Date.now(),

        imagePrompt: undefined,
        videoPrompt: undefined,
        dialogue: undefined,
        characters: undefined,
        scene: undefined
      }));


      updateFileWithHistory(selectedFile.id, (f) => ({
        ...f,
        storyboard: { items: storyboardItems }
      }));

      console.log('✅ 分镜已保存到状态');

    } catch (error) {
      console.error('❌ 提取分镜失败:', error);
      alert(`提取分镜失败: ${(error as Error).message}`);
    } finally {
      setIsShotExtracting(false);
    }
  }, [selectedFile, aiModel, updateFileWithHistory]);



  const setStage = useCallback((
    fileId: string,
    stage: 'split' | 'videoScript' | 'storyboardPrompt',
    patch: Partial<ScriptGenerationStageState>,
  ) => {
    setFiles(prev => {
      const next = prev.map(f => {
        if (f.id !== fileId) return f;
        const stages = { ...(f.generationStages || {}) };
        stages[stage] = { status: 'idle', ...(stages[stage] || {}), ...patch, updatedAt: Date.now() };
        return { ...f, generationStages: stages };
      });
      filesRef.current = next;
      return next;
    });
  }, []);


  const handleSplitScript = useCallback(async (targetFileId?: string) => {

    const file = filesRef.current.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return false;
    if (!file.originalContent?.trim()) { alert('请先在左栏粘贴原文文案'); return false; }

    setStage(file.id, 'split', { status: 'running', errorMessage: '' });
    try {
      const pipelineService = await loadScriptThreeStageService();
      const segments = await pipelineService.splitScriptIntoValidatedSegments(aiModel, file.originalContent, {
        taskContext: {
          projectId: urlProjectId,
          episodeId: propEpisodeId,
          sourcePage: 'script',
          sourceItemId: file.id,
          entityType: 'episode_script',
          entityId: file.id,
        },
        onProgress: progress => {
          if (progress.stage === 'split') {
            setStage(file.id, 'split', {
              status: 'running',
              total: progress.total,
              completed: progress.completed,
              errorMessage: '',
            });
          }
        },
      });
      if (segments.length === 0) {
        throw new Error('模型未返回可用的剧本分段');
      }
      const now = Date.now();
      const applySegs = (arr: ProjectFile[]): ProjectFile[] => arr.map((f): ProjectFile => {
        if (f.id !== file.id) return f;
        return {
          ...f,
          scriptSegments: segments.map(segment => ({
            ...segment,
            videoScript: '',
            status: 'done' as const,
            errorMessage: '',
          })),
          generationStages: {
            ...(f.generationStages || {}),
            split: { status: 'done' as const, total: segments.length, completed: segments.length, updatedAt: now },
            videoScript: { status: 'idle' as const, total: segments.length, completed: 0, errorMessage: '', updatedAt: now },
            storyboardPrompt: { status: 'idle' as const, total: 0, completed: 0, errorMessage: '', updatedAt: now },
          },
        };
      });
      setFiles(applySegs);
      filesRef.current = applySegs(filesRef.current);
      setStage(file.id, 'split', { status: 'done', total: segments.length, completed: segments.length });
      await batchSaveScriptSegments(propEpisodeId, file.id, segments.map((s, idx) => ({
        segment_order: idx, source_text: s.sourceText,
        estimated_duration_sec: s.estimatedDurationSec, status: 'done',
      }))).catch(e => console.warn('保存分段失败:', e));
      return true;
    } catch (e) {
      setStage(file.id, 'split', { status: 'error', errorMessage: (e as Error).message });
      throw e;
    }
  }, [selectedFileId, aiModel, propEpisodeId, setStage, urlProjectId]);


  const handleGenerateVideoScript = useCallback(async (targetFileId?: string) => {
    const file = filesRef.current.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return false;
    const segs = file.scriptSegments || [];
    if (segs.length === 0) { alert('请先拆分剧本'); return false; }

    const pipelineService = await loadScriptThreeStageService();
    const ordered = pipelineService.prepareVideoScriptSegments(file.originalContent, segs);
    const modelInfo = getScriptModelInfo(aiModel, scriptModelOptions);
    const requestId = `quick_video_script_${uuidv4()}`;
    const forecastInputText = [
      file.originalContent,
      ordered.map(segment => [
        segment.sourceText,
        segment.estimatedDurationSec === null ? '' : `时长：${segment.estimatedDurationSec}秒`,
      ].filter(Boolean).join('\n')).join('\n---\n'),
    ].join('\n\n');
    let estimatedCreditCost = 0;
    try {
      const creditQuote = await assertEnoughCredits('script_model_call', {
        input_tokens: estimateTextTokens(forecastInputText),
        output_tokens: Math.max(1000, estimateTextTokens(file.originalContent) * 3, ordered.length * 700),
        model: modelInfo.billingModel,
      });
      estimatedCreditCost = Number(creditQuote.estimated_cost || 0);
    } catch (error) {
      alert(error instanceof Error ? error.message : '创作点数校验失败');
      return false;
    }

    setStage(file.id, 'videoScript', { status: 'running', total: ordered.length, completed: 0, errorMessage: '' });
    try {
      const result = await pipelineService.generateVideoScriptForSegments(
        aiModel,
        file.originalContent,
        ordered,
        {
          orientation: projectOrientation,
          taskContext: {
            projectId: urlProjectId,
            episodeId: propEpisodeId,
            sourcePage: 'script',
            sourceItemId: file.id,
            entityType: 'episode_script',
            entityId: file.id,
          },
          onProgress: progress => {
            if (progress.stage === 'videoScript') {
              setStage(file.id, 'videoScript', { status: 'running', total: progress.total, completed: progress.completed });
            }
          },
        },
      );
      const fullScript = normalizeGeneratedVideoScript(result.content);
      const parsedItems = parseStoryboardVersionContent(fullScript);
      const billingParams = {
        input_tokens: estimateTextTokens(result.inputTexts.join('\n')),
        output_tokens: estimateTextTokens(result.outputTexts.join('\n') || fullScript),
        model: modelInfo.billingModel,
      };
      const credit = await consumeCredits({
        featureKey: 'script_model_call',
        taskId: requestId,
        params: billingParams,
        projectId: urlProjectId,
        metadata: {
          episode_id: propEpisodeId,
          script_id: file.id,
          operation: 'quick_video_script',
        },
      });
      const metadata = {
        requestId,
        estimatedCreditCost,
        creditCharged: true,
        creditCost: Number(credit.charged_credits || 0),
        creditTransactionId: credit.transaction_id,
        creditFeatureKey: credit.feature_key,
        creditUsage: billingParams,
        scriptPipeline: {
          version: 3,
          mode: 'quick',
          stage: 'videoScript',
          shotNumberFormat: 'segment-local',
          sourceSegmentCount: ordered.length,
        },
      };
      const message = await createScriptMessage(propEpisodeId, file.id, {
        role: 'assistant',
        content: fullScript,
        status: 'completed',
        modelAlias: modelInfo.alias,
        provider: modelInfo.provider,
        modelName: modelInfo.billingModel,
        requestId,
        metadata,
      });
      const draftVersion = await createScriptVersion(propEpisodeId, file.id, {
        messageId: message.id,
        content: fullScript,
        storyboardItems: parsedItems,
        source: 'ai',
        status: 'ready',
        modelAlias: modelInfo.alias,
        provider: modelInfo.provider,
        modelName: modelInfo.billingModel,
        metadata,
        setCurrent: false,
      });
      await clearActiveStoryboardDesign(file.id, {
        archiveName: `自动历史 · 生成分镜脚本 V${draftVersion.versionNo} 前 · ${new Date().toLocaleString('zh-CN')}`,
        versionId: draftVersion.id,
      });
      const selectedVersion = await selectScriptVersion(propEpisodeId, file.id, draftVersion.id);
      const updated = result.segments.map(segment => ({
        ...segment,
        status: 'done' as const,
        errorMessage: '',
      }));
      const applyDone = (arr: ProjectFile[]) => arr.map(f => f.id === file.id
        ? {
            ...f,
            scriptSegments: updated,
            scriptContent: fullScript,
            storyboard: null,
            status: FileStatus.Completed,
            lastUpdated: Date.now(),
          }
        : f);
      setFiles(applyDone);
      filesRef.current = applyDone(filesRef.current);
      setScriptConversations(prev => {
        const current = prev[file.id] || { scriptId: file.id, messages: [], versions: [] };
        return {
          ...prev,
          [file.id]: {
            ...current,
            currentVersionId: selectedVersion.id,
            defaultModel: modelInfo.billingModel,
            messages: [...current.messages.filter(item => item.id !== message.id), message],
            versions: [...current.versions.filter(item => item.id !== selectedVersion.id), selectedVersion],
          },
        };
      });
      setQuickSelectedVersionIds(prev => ({ ...prev, [file.id]: selectedVersion.id }));
      setStage(file.id, 'videoScript', { status: 'done', total: updated.length, completed: updated.length });
      await updateEpisodeScriptById(propEpisodeId, file.id, { adapted_script: fullScript }).catch(() => {});
      await batchSaveScriptSegments(propEpisodeId, file.id, buildScriptSegmentPayload(updated)).catch(() => {});
      return selectedVersion;
    } catch (e) {
      const errorSummary = summarizePipelineError(e);
      setStage(file.id, 'videoScript', { status: 'error', errorMessage: errorSummary });
      throw new Error(errorSummary);
    }
  }, [
    aiModel,
    clearActiveStoryboardDesign,
    projectOrientation,
    propEpisodeId,
    scriptModelOptions,
    selectedFileId,
    setStage,
    urlProjectId,
  ]);


  const handleExtractStoryboardPrompts = useCallback(async (
    targetFileId?: string,
    options: { sourceVersion?: ScriptStoryboardVersion } = {},
  ) => {
    const file = filesRef.current.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return false;
    const segs = (file.scriptSegments || []).filter(s => s.videoScript);
    if (segs.length === 0) { alert('请先生成视频脚本'); return false; }
    const conversation = mergeScriptConversationWithLocalFile(file, scriptConversations[file.id]);
    const sourceVersion = options.sourceVersion
      || conversation?.versions.find(version => version.id === conversation.currentVersionId)
      || conversation?.versions[conversation.versions.length - 1];
    const videoScript = sourceVersion?.content || file.scriptContent || combineVideoScriptOutputs(segs.map(segment => segment.videoScript || ''));
    if (!videoScript.trim()) { alert('请先生成视频脚本'); return false; }

    const groups = parseVideoScriptGroups(videoScript);
    const sourceShotCount = groups.reduce((total, group) => total + group.blocks.length, 0);
    if (sourceShotCount === 0) { alert('未能从视频脚本解析出分镜'); return false; }

    const modelInfo = getScriptModelInfo(aiModel, scriptModelOptions);
    const billingTaskId = `storyboard_design_${uuidv4()}`;
    try {
      await assertEnoughCredits('storyboard_design_generation', {
        shot_count: sourceShotCount,
        input_tokens: estimateTextTokens(videoScript),
        output_tokens: Math.max(500, sourceShotCount * 500),
        model: modelInfo.billingModel,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : '创作点数校验失败');
      return false;
    }

    setStage(file.id, 'storyboardPrompt', { status: 'running', total: sourceShotCount, completed: 0, errorMessage: '' });
    try {
      const pipelineService = await loadScriptThreeStageService();
      const designResult = await pipelineService.generateStoryboardDesignForVersion(
        aiModel,
        videoScript,
        {
          orientation: projectOrientation,
          taskContext: {
            projectId: urlProjectId,
            episodeId: propEpisodeId,
            sourcePage: 'script',
            sourceItemId: file.id,
            entityType: sourceVersion ? 'episode_script_version' : 'episode_script',
            entityId: sourceVersion?.id || file.id,
          },
          onProgress: progress => {
            setStage(file.id, 'storyboardPrompt', {
              status: 'running',
              total: progress.total,
              completed: progress.completed,
            });
          },
        },
      );
      const persistedItems = await replaceActiveStoryboardDesign(
        file.id,
        designResult.items,
        {
          archiveName: sourceVersion
            ? `自动历史 · 生成分镜脚本 V${sourceVersion.versionNo} 镜头设计前 · ${new Date().toLocaleString('zh-CN')}`
            : `自动历史 · 生成镜头设计前 · ${new Date().toLocaleString('zh-CN')}`,
          versionId: sourceVersion?.id,
          openDrawer: false,
        },
      );
      if (sourceVersion && !sourceVersion.id.startsWith('legacy_')) {
        setScriptConversations(prev => prev[file.id] ? ({
          ...prev,
          [file.id]: { ...prev[file.id], currentVersionId: sourceVersion.id },
        }) : prev);
        setQuickSelectedVersionIds(prev => ({ ...prev, [file.id]: sourceVersion.id }));
      }
      try {
        await persistStoryboardSnapshot(file.id, {
          source: 'auto',
          version: sourceVersion,
          name: sourceVersion
            ? `自动存档 · 分镜脚本 V${sourceVersion.versionNo} · ${new Date().toLocaleString('zh-CN')}`
            : `自动存档 · 快速版镜头设计 · ${new Date().toLocaleString('zh-CN')}`,
          waitForRemote: false,
        });
      } catch (snapshotError) {
        console.error('自动保存镜头设计失败:', snapshotError);
        throw new Error(`镜头设计已生成，但自动存档失败：${summarizePipelineError(snapshotError)}`);
      }

      const billingParams = {
        shot_count: persistedItems.length,
        input_tokens: estimateTextTokens(designResult.inputTexts.join('\n')),
        output_tokens: estimateTextTokens(designResult.outputTexts.join('\n')),
        model: modelInfo.billingModel,
      };
      const credit = await consumeCredits({
        featureKey: 'storyboard_design_generation',
        taskId: billingTaskId,
        params: billingParams,
        projectId: urlProjectId,
        metadata: {
          episode_id: propEpisodeId,
          script_id: file.id,
          script_version_id: sourceVersion?.id,
          operation: 'quick_extract_storyboard_design',
        },
      });
      if (sourceVersion && !sourceVersion.id.startsWith('legacy_')) {
        const previousBillings = Array.isArray(sourceVersion.metadata?.storyboardDesignBillings)
          ? sourceVersion.metadata.storyboardDesignBillings
          : [];
        const updatedVersion = await updateScriptVersionMetadata(propEpisodeId, file.id, sourceVersion.id, {
          storyboardDesignCreditCost: credit.charged_credits,
          storyboardDesignCreditTransactionId: credit.transaction_id,
          storyboardDesignCreditTaskId: billingTaskId,
          storyboardDesignUsage: billingParams,
          storyboardDesignGeneratedAt: Date.now(),
          storyboardDesignBillings: [
            ...previousBillings,
            { taskId: billingTaskId, cost: credit.charged_credits, usage: billingParams, createdAt: Date.now() },
          ].slice(-20),
        });
        setScriptConversations(prev => prev[file.id] ? ({
          ...prev,
          [file.id]: {
            ...prev[file.id],
            versions: prev[file.id].versions.map(version => version.id === updatedVersion.id ? updatedVersion : version),
          },
        }) : prev);
      }
      setStage(file.id, 'storyboardPrompt', { status: 'done', total: sourceShotCount, completed: sourceShotCount });
      window.alert(`生成镜头设计完成，已拆为 ${persistedItems.length} 个镜头`);
      return true;
    } catch (shotErr) {
      const errorSummary = summarizePipelineError(shotErr);
      setStage(file.id, 'storyboardPrompt', { status: 'error', errorMessage: errorSummary });
      setConversationError(`生成镜头设计失败：${errorSummary}`);
      throw new Error(errorSummary);
    }
  }, [
    aiModel,
    persistStoryboardSnapshot,
    projectOrientation,
    propEpisodeId,
    replaceActiveStoryboardDesign,
    scriptConversations,
    scriptModelOptions,
    selectedFileId,
    setStage,
    urlProjectId,
  ]);


  const handleRunThreeStagePipeline = useCallback(async (targetFileId?: string) => {
    const file = filesRef.current.find(f => f.id === (targetFileId || selectedFileId));
    if (!file) return;
    const hasSegments = (file.scriptSegments?.length || 0) > 0;
    const hasVideoScript = !!file.scriptContent && (file.scriptSegments || []).some(s => s.videoScript);
    const hasStoryboard = (file.storyboard?.items?.length || 0) > 0;

    if (hasSegments && hasVideoScript && hasStoryboard) {
      if (!confirm('三步均已完成，确定要全量重跑吗？')) return;
    }


    const splitOk = await handleSplitScript(file.id);
    if (!splitOk) return;
    const videoScriptVersion = await handleGenerateVideoScript(file.id);
    if (!videoScriptVersion) return;
    await handleExtractStoryboardPrompts(file.id, { sourceVersion: videoScriptVersion });
  }, [selectedFileId, handleSplitScript, handleGenerateVideoScript, handleExtractStoryboardPrompts]);




  const handleGenerateStoryboard = useCallback(async (fileId: string) => {
    const file = files.find(f => f.id === fileId);

    if (!file?.storyboard?.items || file.storyboard.items.length === 0) {
      alert('请先提取分镜和场景描述');
      return;
    }

    const billingTaskId = `storyboard_design_${uuidv4()}`;
    const forecastInputTokens = file.storyboard.items.reduce(
      (total, item) => total + estimateTextTokens(`${item.originalText || ''}\n${item.scriptSegment || ''}`),
      0,
    );
    const modelInfo = getScriptModelInfo(aiModel, scriptModelOptions);
    try {
      await assertEnoughCredits('storyboard_design_generation', {
        shot_count: file.storyboard.items.length,
        input_tokens: forecastInputTokens,
        output_tokens: Math.max(500, file.storyboard.items.length * 500),
        model: modelInfo.billingModel,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : '创作点数校验失败');
      return;
    }

    setIsProcessing(true);
    setProcessingType('generate-shots');
    setShotGenerationProgress({ current: 0, total: file.storyboard.items.length });

    try {
      const updatedItems: StoryboardItem[] = [];
      let billingSuccessfulShots = 0;
      let billingInputTokens = 0;
      let billingOutputTokens = 0;


      for (let i = 0; i < file.storyboard.items.length; i++) {
        const item = file.storyboard.items[i];

        console.log(`🎬 正在生成第 ${i + 1}/${file.storyboard.items.length} 个分镜...`);

        try {

          const { aiGenerateShotDetails } = await loadAiModelService();
          const details = await aiGenerateShotDetails(
            aiModel,
            item.originalText,
            item.scriptSegment

          );


          const completeItem: StoryboardItem = {
            ...item,
            ...details,
            timestamp: Date.now()
          };
          billingSuccessfulShots += 1;
          billingInputTokens += estimateTextTokens(`${item.originalText || ''}\n${item.scriptSegment || ''}`);
          billingOutputTokens += estimateTextTokens(JSON.stringify(details));

          updatedItems.push(completeItem);


          updateFileWithHistory(fileId, (f) => ({
                 ...f,
            storyboard: { items: updatedItems }
          }));


          setShotGenerationProgress({ current: i + 1, total: file.storyboard.items.length });

          console.log(`✅ 第 ${i + 1} 个分镜生成完成`);

        } catch (error) {
          console.error(`❌ 第 ${i + 1} 个分镜生成失败:`, error);

          updatedItems.push(item);
        }
      }

      console.log('🎉 所有分镜生成完成！');
      if (billingSuccessfulShots === 0) {
        throw new Error('所有镜头详情均生成失败，本次未扣除创作点数');
      }
      const billingParams = {
        shot_count: billingSuccessfulShots,
        input_tokens: billingInputTokens,
        output_tokens: billingOutputTokens,
        model: modelInfo.billingModel,
      };
      const credit = await consumeCredits({
        featureKey: 'storyboard_design_generation',
        taskId: billingTaskId,
        params: billingParams,
        projectId: urlProjectId,
        metadata: { episode_id: propEpisodeId, script_id: fileId, operation: 'generate_shot_details' },
      });
      const conversation = scriptConversations[fileId];
      const currentVersion = conversation?.versions.find(version => version.id === conversation.currentVersionId)
        || conversation?.versions[conversation.versions.length - 1];
      let snapshotVersion = currentVersion;
      if (currentVersion && !currentVersion.id.startsWith('legacy_')) {
        const previousBillings = Array.isArray(currentVersion.metadata?.storyboardDesignBillings)
          ? currentVersion.metadata.storyboardDesignBillings
          : [];
        const updatedVersion = await updateScriptVersionMetadata(propEpisodeId, fileId, currentVersion.id, {
          storyboardDesignCreditCost: credit.charged_credits,
          storyboardDesignCreditTransactionId: credit.transaction_id,
          storyboardDesignCreditTaskId: billingTaskId,
          storyboardDesignUsage: billingParams,
          storyboardDesignGeneratedAt: Date.now(),
          storyboardDesignBillings: [
            ...previousBillings,
            { taskId: billingTaskId, cost: credit.charged_credits, usage: billingParams, createdAt: Date.now() },
          ].slice(-20),
        });
        snapshotVersion = updatedVersion;
        setScriptConversations(prev => prev[fileId] ? ({
          ...prev,
          [fileId]: {
            ...prev[fileId],
            versions: prev[fileId].versions.map(version => version.id === updatedVersion.id ? updatedVersion : version),
          },
        }) : prev);
      }
      try {
        await persistStoryboardSnapshot(fileId, {
          source: 'auto',
          version: snapshotVersion,
          name: `自动存档 · 镜头详情 · ${new Date().toLocaleString('zh-CN')}`,
          waitForRemote: false,
        });
      } catch (error) {
        console.error('自动保存镜头详情失败:', error);
        alert(`镜头详情已生成，但自动存档失败：${summarizePipelineError(error)}`);
      }

    } catch (error) {
      console.error('❌ 批量生成失败:', error);
      alert(`生成失败: ${(error as Error).message}`);
    } finally {
      setIsProcessing(false);
      setProcessingType(null);
      setShotGenerationProgress(null);
    }
  }, [aiModel, files, persistStoryboardSnapshot, propEpisodeId, scriptConversations, scriptModelOptions, updateFileWithHistory, urlProjectId]);

  const handleExtractMetadata = useCallback(async (targetFileId?: string) => {
    setIsProcessing(true);
    const idsToProcess = getTargetIds(targetFileId);
    for (const id of idsToProcess) {
        updateFileStatus(id, FileStatus.Processing);
        try {
             const currentFile = files.find(f => f.id === id);
             if (!currentFile || !currentFile.scriptContent) continue;
             const { aiExtractScriptMetadata } = await loadAiModelService();
             const metadata = await aiExtractScriptMetadata(aiModel, currentFile.scriptContent);

             updateFileWithHistory(id, (f) => ({
                 ...f,
                 extractedCharacters: metadata.characters,
                 extractedScenes: metadata.scenes,
                 extractedProps: metadata.props || [],
                 status: FileStatus.Idle
             }));
        } catch (error) {
            console.error(error);
            updateFileStatus(id, FileStatus.Error);
        }
    }
    setIsProcessing(false);
  }, [files, checkedFileIds, selectedFileId, aiModel]);

  // Simple Refine (Text Only)
  const handleRefineScript = useCallback(async (selection: string, instruction: string) => {
    if (!selectedFileId || !selectedFile?.scriptContent) return;
    setIsProcessing(true);
    try {
        const { aiRefineScriptSegment } = await loadAiModelService();
        const newSegment = await aiRefineScriptSegment(aiModel, selection, instruction, selectedFile.scriptContent);
        const newScriptContent = selectedFile.scriptContent.replace(selection, newSegment);

        updateFileWithHistory(selectedFileId, (f) => ({ ...f, scriptContent: newScriptContent }));
    } catch (error) {
        console.error("Script refinement failed", error);
        alert("AI润色失败，请重试。");
    } finally {
        setIsProcessing(false);
    }
  }, [selectedFileId, selectedFile, aiModel]);

  // Complex Restructure (Split/Merge Storyboards + Text)

  const handleRestructure = useCallback(async (selection: string, instruction: string, type: 'split' | 'merge') => {
      if (!selectedFileId || !selectedFile?.scriptContent || !selectedFile.storyboard) return;

      setIsProcessing(true);
      try {
          const items = selectedFile.storyboard.items;
          const matchedIndices: number[] = [];

          const cleanSelection = selection.trim();

          items.forEach((item, index) => {
              const cleanItemSegment = (item.scriptSegment || '').trim();
              const cleanOriginalText = (item.originalText || '').trim();


              if (cleanSelection && (

                 (cleanItemSegment && (cleanSelection.includes(cleanItemSegment) || cleanItemSegment.includes(cleanSelection))) ||

                 (cleanOriginalText && (cleanSelection.includes(cleanOriginalText) || cleanOriginalText.includes(cleanSelection)))
              )) {
                  matchedIndices.push(index);
              }
          });

          if (matchedIndices.length === 0) {
              const confirmRefine = window.confirm("未找到完全匹配的现有分镜。是否仅对剧本文字进行修改？\n(如果不关联分镜，可能导致剧本与现有分镜不一致)");
              if (confirmRefine) {
                  await handleRefineScript(selection, instruction);
              }
              return;
          }

          const startIndex = Math.min(...matchedIndices);
          const endIndex = Math.max(...matchedIndices);
          const count = endIndex - startIndex + 1;

          const { aiRestructureShot } = await loadAiModelService();
          const result = await aiRestructureShot(aiModel, selection, instruction, type);


          const newItems = result.newStoryboardItems.map((item: any) => ({
              id: uuidv4(),
              shotNumber: item.shotNumber || item.shotId,
              originalText: item.originalText || selection,
              scriptSegment: item.scriptSegment || '',
              imagePrompt: item.imagePrompt,
              videoPrompt: item.videoPrompt,
              dialogue: item.dialogue,
              characters: item.characters,
              scene: item.scene,
              props: item.props || [],
              timestamp: Date.now()
          }));

          // Strict Logic: If Split, DO NOT modify script content.
          let newScriptContent = selectedFile.scriptContent;
          if (type !== 'split') {
              newScriptContent = selectedFile.scriptContent.replace(selection, result.newScriptSegment);
          }

          const newStoryboardList = [...items];
          newStoryboardList.splice(startIndex, count, ...newItems);

          updateFileWithHistory(selectedFileId, (f) => ({
              ...f,
              scriptContent: newScriptContent,
              storyboard: { items: newStoryboardList }
          }));

      } catch (error) {
          console.error("Restructure failed", error);
          alert("AI拆分/合并失败: 可能是模型繁忙，请稍后重试。");
      } finally {
          setIsProcessing(false);
      }
  }, [selectedFileId, selectedFile, handleRefineScript, aiModel]);

  const handleGlobalBatchProcess = useCallback(async () => {
      stopProcessingRef.current = false;
      setIsProcessing(true);
      setProcessingType('generate-shots');
      const idsToProcess = checkedFileIds.size > 0 ? Array.from(checkedFileIds) : files.map(f => f.id);

      for (const id of idsToProcess) {

          if (stopProcessingRef.current) {
              console.log('⏸️ 用户手动停止处理');
              break;
          }

          try {
              updateFileStatus(id, FileStatus.Processing);
              let currentFile = files.find(f => f.id === id);
              if (!currentFile) continue;

              console.log(`🎬 开始处理文件: ${currentFile.name || id}`);


              let script = currentFile.scriptContent;
              if (!script) {
                  console.log('📝 步骤1: 改写小说为剧本...');
                  let streamedContent = '';
                  const { aiRewriteNovelToScript } = await loadAiModelService();
                  script = await aiRewriteNovelToScript(
                      aiModel,
                      currentFile.originalContent,
                      '',
                      (chunk) => {
                      streamedContent += chunk;
                      setFiles(prevFiles => prevFiles.map(f =>
                          f.id === id ? { ...f, scriptContent: streamedContent } : f
                      ));
                      }
                  );
                  updateFileWithHistory(id, (f) => ({ ...f, scriptContent: script }));
                  currentFile = { ...currentFile, scriptContent: script };
                  console.log('✅ 步骤1完成: 剧本改写完成');
              }

              const contentToUse = script || currentFile.scriptContent!;
              if (!contentToUse) continue;


              console.log('🎬 步骤2: 提取分镜段落...');
              const { aiExtractShotsFromScript } = await loadAiModelService();
              const shotsResult = await aiExtractShotsFromScript(aiModel, contentToUse);

              const storyboardItems: StoryboardItem[] = shotsResult.items.map((item, index) => ({
                  id: `${Date.now()}_${index}`,
                  shotNumber: index + 1,
                  originalText: item.originalText,
                  scriptSegment: item.scriptSegment,
                  timestamp: Date.now(),
                  imagePrompt: '',
                  videoPrompt: '',
                  dialogue: '',
                  characters: [],
                  scene: ''
              }));

              console.log(`✅ 步骤2完成: 提取了 ${storyboardItems.length} 个分镜段落`);


              updateFileWithHistory(id, (f) => ({
                  ...f,
                  storyboard: { items: storyboardItems }
              }));


              console.log('🎨 步骤3: 开始生成镜头设计...');
              setShotGenerationProgress({ current: 0, total: storyboardItems.length });

              const updatedItems: StoryboardItem[] = [];

              for (let i = 0; i < storyboardItems.length; i++) {
                  const item = storyboardItems[i];
                  console.log(`🎬 生成第 ${i + 1}/${storyboardItems.length} 个分镜...`);

                  try {
                      const { aiGenerateShotDetails } = await loadAiModelService();
                      const details = await aiGenerateShotDetails(
                          aiModel,
                          item.originalText,
                          item.scriptSegment

                      );

                      const completeItem: StoryboardItem = {
                          ...item,
                          ...details,
                          timestamp: Date.now()
                      };

                      updatedItems.push(completeItem);


                      updateFileWithHistory(id, (f) => ({
                          ...f,
                          storyboard: { items: updatedItems }
                      }));

                      setShotGenerationProgress({ current: i + 1, total: storyboardItems.length });
                      console.log(`✅ 第 ${i + 1} 个分镜生成完成`);

                  } catch (error) {
                      console.error(`❌ 第 ${i + 1} 个分镜生成失败:`, error);
                      updatedItems.push(item);
                  }
              }

              console.log('✅ 步骤3完成: 所有分镜设计已生成');


              updateFileWithHistory(id, (f) => ({
                  ...f,
                  storyboard: { items: updatedItems },
                  status: FileStatus.Completed
              }));

              console.log(`🎉 文件处理完成: ${currentFile.name || id}`);

          } catch (error) {
              console.error(`❌ 全流程处理失败: ${id}`, error);
              updateFileStatus(id, FileStatus.Error);
              alert(`处理失败: ${(error as Error).message}`);
          }
      }

      setIsProcessing(false);
      setProcessingType(null);
      setShotGenerationProgress(null);
      stopProcessingRef.current = false;
      console.log('🎉 全部文件处理完成！');
  }, [files, checkedFileIds, aiModel, updateFileWithHistory]);


  const handleStopProcessing = useCallback(() => {
    stopProcessingRef.current = true;
    console.log('🛑 设置停止标志');
  }, []);

  const isFullView = visibleColumns.every(v => v);
  const renderAllViews = () => {
      return (
        <>

          {mountedViews.has(AppView.Editor) && (
            <div style={{ display: currentView === AppView.Editor ? 'contents' : 'none' }}>
              {scriptWorkspaceMode === 'reverse' ? (
                <div
                  className="workflow-stage-layout relative flex h-full min-h-0 w-full min-w-0 overflow-hidden"
                  data-testid="video-reverse-workspace"
                >
                  <div className="workflow-stage-sidebar relative h-full w-[280px] flex-shrink-0 overflow-hidden border-r border-n40">
                    <React.Suspense fallback={<LegacyColumnFallback label="files" />}>
                      <FileColumn
                        files={files}
                        selectedFileId={selectedFileId}
                        activeFileId={activeScriptId || null}
                        checkedFileIds={checkedFileIds}
                        onFileSelect={handleFileSelect}
                        onActivateFile={activateWorkflowScript}
                        onFileCheck={handleFileCheck}
                        onCheckAll={handleCheckAll}
                        onFileUpload={handleFileUpload}
                        onCreateBlankFile={handleCreateBlankFile}
                        onRenameFile={handleRenameFile}
                        onDeleteFile={handleDeleteFile}
                        onDownloadFile={handleDownloadFile}
                        onMoveFile={handleMoveFile}
                        onSaveVersion={handleSaveVersion}
                        onRestoreVersion={handleRestoreVersion}
                        isExpanded={false}
                        onToggleExpand={() => {}}
                        onReorderFiles={handleReorderFiles}
                        onExportProject={handleExportProject}
                      />
                    </React.Suspense>
                  </div>

                  <div className="workflow-stage-canvas flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-n20">
                    <header className="workflow-stage-toolbar relative flex h-12 flex-shrink-0 items-center gap-3 border-b border-n40 bg-n0 px-4">
                      <FileText className="h-4 w-4 flex-shrink-0 text-primary" />
                      <div className="max-w-[32%] truncate text-sm font-semibold text-n800">
                        {selectedFile?.name || '请选择剧本任务'}
                      </div>
                      <div
                        className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
                        data-testid="script-workspace-mode-switch-anchor"
                      >
                        <ScriptWorkspaceModeSwitch
                          mode={scriptWorkspaceMode}
                          onChange={handleScriptWorkspaceModeChange}
                        />
                      </div>
                      <span className="ml-auto text-[10px] text-n200">上传视频并生成可导入的候选剧本</span>
                    </header>
                    <div className="min-h-0 flex-1 bg-n20 p-3">
                      <div className="h-full overflow-hidden rounded-md border border-n40 bg-n0 shadow-card">
                        <React.Suspense fallback={<LegacyViewFallback label="video-reverse" />}>
                          <VideoReversePage
                            embedded
                            onCandidateCreated={async (scriptId) => {
                              loadedConversationKeysRef.current.delete(`${propEpisodeId}:${scriptId}`);
                              await loadEpisodeData(scriptId);
                              handleScriptWorkspaceModeChange('writing');
                            }}
                          />
                        </React.Suspense>
                      </div>
                    </div>
                  </div>
                </div>
              ) : scriptWorkspaceMode === 'writing' ? (
                <>
                <div className="workflow-stage-sidebar relative h-full w-[280px] flex-shrink-0 overflow-hidden border-r border-n40">
                    <React.Suspense fallback={<LegacyColumnFallback label="files" />}>
                    <FileColumn
                    files={files}
                    selectedFileId={selectedFileId}
                    activeFileId={activeScriptId || null}
                    checkedFileIds={checkedFileIds}
                    onFileSelect={handleFileSelect}
                    onActivateFile={activateWorkflowScript}
                    onFileCheck={handleFileCheck}
                    onCheckAll={handleCheckAll}
                    onFileUpload={handleFileUpload}
                    onCreateBlankFile={handleCreateBlankFile}
                    onRenameFile={handleRenameFile}
                    onDeleteFile={handleDeleteFile}
                    onDownloadFile={handleDownloadFile}
                    onMoveFile={handleMoveFile}
                    onSaveVersion={handleSaveVersion}
                    onRestoreVersion={handleRestoreVersion}
                    isExpanded={false}
                    onToggleExpand={() => {}}
                    onReorderFiles={handleReorderFiles}
                    onExportProject={handleExportProject}
                    />
                    </React.Suspense>
                </div>

                <div className="workflow-stage-canvas relative flex h-full min-w-0 flex-1 overflow-hidden">
                    <React.Suspense fallback={<LegacyColumnFallback label="conversation" />}>
                    <ScriptConversationPane
                        selectedFile={selectedFile}
                        conversation={selectedConversation}
                        aiModel={aiModel}
                        modelOptions={scriptModelOptions}
                        onChangeModel={setAiModel}
                        isWorkflowScript={selectedFileId === activeScriptId}
                        isLoading={conversationLoadingId === selectedFileId}
                        isSending={conversationSendingId === selectedFileId}
                        error={conversationError}
                        onDismissError={() => setConversationError(null)}
                        onSend={handleConversationSend}
                        onGenerateDesign={handleConversationGenerateDesign}
                        onConfirmVersion={handleConversationConfirmVersion}
                        onRejectVersion={handleConversationRejectVersion}
                        onEditVersion={handleConversationEditVersion}
                        onExportVersion={handleConversationExportVersion}
                        onOpenStoryboard={handleOpenStoryboardDrawer}
                        storyboardItemCount={Math.max(
                          selectedStoryboardItemCount,
                          selectedFileId ? (storyboardTotalsByFileId[selectedFileId] ?? 0) : 0,
                        )}
                        workspaceMode={scriptWorkspaceMode}
                        onWorkspaceModeChange={handleScriptWorkspaceModeChange}
                    />
                    </React.Suspense>

                    <aside
                      className={`absolute inset-0 z-40 w-full overflow-x-auto overflow-y-hidden border-l border-n40 bg-n0 shadow-bottom transition-transform duration-200 ${storyboardDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
                      data-testid="storyboard-workspace-drawer"
                      aria-hidden={!storyboardDrawerOpen}
                    >
                    <div className="grid h-full min-h-0 min-w-[860px] grid-cols-[minmax(360px,1.2fr)_minmax(420px,1fr)] overflow-hidden">
                      <React.Suspense fallback={<LegacyColumnFallback label="storyboard-script" />}>
                        <StoryboardScriptColumn
                          selectedFile={selectedFile}
                          highlightedItemIds={highlightedStoryboardItemIds}
                          onSelectItemIds={handleStoryboardSelectionChange}
                        />
                      </React.Suspense>
                      <React.Suspense fallback={<LegacyColumnFallback label="storyboard" />}>
                      <StoryboardColumn
                        selectedFile={selectedFile}
                        onGenerateStoryboard={handleGenerateStoryboard}
                        isProcessing={isProcessing}
                        generationProgress={shotGenerationProgress}
                        processingType={processingType}
                        aiModel={aiModel}
                        isExpanded={false}
                        onToggleExpand={() => {}}
                        onClose={() => setStoryboardDrawerOpen(false)}
                        onHighlightScript={handleStoryboardSelectionChange}
                        highlightedItemIds={highlightedStoryboardItemIds}
                        onLockItem={handleLockItem}
                        onDeleteItem={handleDeleteStoryboardItem}
                        onRegenerateItem={handleRegenerateItem}
                        onUpdateItem={handleUpdateStoryboardItem}
                        onInsertShot={handleInsertShot}
                        onInsertShotWithAI={handleInsertShotWithAI}
                        onExport={handleExportStoryboards}
                        isExporting={isExporting}
                        isWorkflowScript={selectedFileId === activeScriptId}
                        onUndo={handleUndo}
                        onRedo={handleRedo}
                        canUndo={canUndo}
                        canRedo={canRedo}
                        onSaveVersion={(name) => selectedFileId && handleSaveVersion(selectedFileId, name)}
                        onRestoreStoryboard={(version) => selectedFileId && handleRestoreStoryboard(selectedFileId, version)}
                        onDeleteVersion={(versionId) => selectedFileId && handleDeleteVersion(selectedFileId, versionId)}
                        scriptVersions={selectedConversation?.versions || []}
                        currentScriptVersionId={selectedConversation?.currentVersionId}
                        generationCreditCost={selectedConversationVersionCreditCost}
                        onRestoreScriptVersion={(version) => handleConversationGenerateDesign(version, { autoSnapshot: false })}
                      />
                      </React.Suspense>
                    </div>
                    </aside>

                </div>
                </>
              ) : (
                <div
                  className="workflow-stage-layout relative flex h-full min-h-0 w-full min-w-0 overflow-hidden"
                  data-testid="quick-script-workspace"
                >
                  <div className="workflow-stage-sidebar relative h-full w-[280px] flex-shrink-0 overflow-hidden border-r border-n40">
                    <React.Suspense fallback={<LegacyColumnFallback label="files" />}>
                      <FileColumn
                        files={files}
                        selectedFileId={selectedFileId}
                        activeFileId={activeScriptId || null}
                        checkedFileIds={checkedFileIds}
                        onFileSelect={handleFileSelect}
                        onActivateFile={activateWorkflowScript}
                        onFileCheck={handleFileCheck}
                        onCheckAll={handleCheckAll}
                        onFileUpload={handleFileUpload}
                        onCreateBlankFile={handleCreateBlankFile}
                        onRenameFile={handleRenameFile}
                        onDeleteFile={handleDeleteFile}
                        onDownloadFile={handleDownloadFile}
                        onMoveFile={handleMoveFile}
                        onSaveVersion={handleSaveVersion}
                        onRestoreVersion={handleRestoreVersion}
                        isExpanded={false}
                        onToggleExpand={() => {}}
                        onReorderFiles={handleReorderFiles}
                        onExportProject={handleExportProject}
                      />
                    </React.Suspense>
                  </div>

                  <div
                    className="workflow-stage-canvas flex min-h-0 min-w-0 max-w-none flex-col overflow-hidden"
                    data-testid="quick-script-canvas"
                    style={{ width: 0, flex: '1 1 0%' }}
                  >
                    <header className="workflow-stage-toolbar relative flex h-11 flex-shrink-0 items-center gap-3 border-b border-n40 bg-n0 px-4">
                      <FileText className="h-4 w-4 flex-shrink-0 text-primary" />
                      <div className="max-w-[32%] truncate text-sm font-semibold text-n800">
                        {selectedFile?.name || '请选择剧本任务'}
                      </div>
                      <div
                        className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
                        data-testid="script-workspace-mode-switch-anchor"
                      >
                        <ScriptWorkspaceModeSwitch
                          mode={scriptWorkspaceMode}
                          onChange={handleScriptWorkspaceModeChange}
                        />
                      </div>
                      <span className="ml-auto text-[10px] text-n200">
                        四列使用同一生成、版本、创作点数与镜头数据
                      </span>
                    </header>

                    <div className="min-h-0 w-full min-w-0 max-w-none flex-1 overflow-x-auto overflow-y-hidden">
                      <div
                        className="flex h-full w-full min-w-[900px] max-w-none gap-2 overflow-hidden bg-n20 p-2"
                        data-testid="quick-script-columns"
                      >

                      <div
                        style={{ flex: `${colWidths[1]} 0 0%` }}
                        className="relative h-full min-w-0 overflow-hidden rounded-md border border-n40 bg-n0 shadow-card"
                        data-testid="quick-script-card-panel"
                        data-panel="source"
                      >
                        <React.Suspense fallback={<LegacyColumnFallback label="source-script" />}>
                          <QuickScriptSourceColumn
                            selectedFile={selectedFile}
                            aiModel={aiModel}
                            modelOptions={scriptModelOptions}
                            isLoading={conversationLoadingId === selectedFileId}
                            isSending={conversationSendingId === selectedFileId}
                            error={conversationError}
                            onDismissError={() => setConversationError(null)}
                            onChangeModel={setAiModel}
                            onUpdateSource={handleUpdateContent}
                            onSplitScript={handleSplitScript}
                             onGenerateVideoScript={handleGenerateVideoScript}
                             onExtractStoryboardPrompts={handleExtractStoryboardPrompts}
                             onRunThreeStage={handleRunThreeStagePipeline}
                             actualCreditCost={selectedConversationVersionCreditCost}
                           />
                        </React.Suspense>
                      </div>

                      {isFullView && (
                        <div
                          onMouseDown={() => startResizing(1)}
                          className="z-20 -mx-1 w-2 flex-shrink-0 cursor-col-resize rounded-full bg-transparent transition-colors hover:bg-primary/20"
                        />
                      )}

                      <div
                        style={{ flex: `${colWidths[2]} 0 0%` }}
                        className="relative h-full min-w-0 overflow-hidden rounded-md border border-n40 bg-n0 shadow-card"
                        data-testid="quick-script-card-panel"
                        data-panel="version"
                      >
                        <React.Suspense fallback={<LegacyColumnFallback label="video-script" />}>
                          <QuickScriptVersionColumn
                            selectedFile={selectedFile}
                            version={quickPipelineVersion}
                            versions={quickAvailableVersions}
                            currentVersionId={quickPipelineVersion?.id}
                            designItems={selectedFile?.storyboard?.items || []}
                            isSending={conversationSendingId === selectedFileId}
                            error={conversationError}
                            highlightedItemIds={highlightedStoryboardItemIds}
                            onDismissError={() => setConversationError(null)}
                            onSelectItemIds={handleStoryboardSelectionChange}
                            onSelectVersion={handleQuickSelectVersion}
                            onEditVersion={handleConversationEditVersion}
                            onGenerateDesign={(version) => handleConversationGenerateDesign(version, { openDrawer: false })}
                            onExportVersion={handleConversationExportVersion}
                          />
                        </React.Suspense>
                      </div>

                      {isFullView && (
                        <div
                          onMouseDown={() => startResizing(2)}
                          className="z-20 -mx-1 w-2 flex-shrink-0 cursor-col-resize rounded-full bg-transparent transition-colors hover:bg-primary/20"
                        />
                      )}

                      <div
                        style={{ flex: `${colWidths[3]} 0 0%` }}
                        className="relative h-full min-w-0 overflow-hidden rounded-md border border-n40 bg-n0 shadow-card"
                        data-testid="quick-script-card-panel"
                        data-panel="design"
                      >
                        <React.Suspense fallback={<LegacyColumnFallback label="storyboard" />}>
                          <StoryboardColumn
                            selectedFile={selectedFile}
                            onGenerateStoryboard={handleGenerateStoryboard}
                            isProcessing={isProcessing}
                            generationProgress={shotGenerationProgress}
                            processingType={processingType}
                            aiModel={aiModel}
                            isExpanded={false}
                            onToggleExpand={() => {}}
                            onHighlightScript={handleStoryboardSelectionChange}
                            highlightedItemIds={highlightedStoryboardItemIds}
                            onLockItem={handleLockItem}
                            onDeleteItem={handleDeleteStoryboardItem}
                            onRegenerateItem={handleRegenerateItem}
                            onUpdateItem={handleUpdateStoryboardItem}
                            onInsertShot={handleInsertShot}
                            onInsertShotWithAI={handleInsertShotWithAI}
                            onExport={handleExportStoryboards}
                            isExporting={isExporting}
                            isWorkflowScript={selectedFileId === activeScriptId}
                            onUndo={handleUndo}
                            onRedo={handleRedo}
                            canUndo={canUndo}
                            canRedo={canRedo}
                            onSaveVersion={(name) => selectedFileId && handleSaveVersion(selectedFileId, name)}
                            onRestoreStoryboard={(version) => selectedFileId && handleRestoreStoryboard(selectedFileId, version)}
                            onDeleteVersion={(versionId) => selectedFileId && handleDeleteVersion(selectedFileId, versionId)}
                            scriptVersions={selectedConversation?.versions || []}
                            currentScriptVersionId={selectedConversation?.currentVersionId}
                            generationCreditCost={selectedConversationVersionCreditCost}
                            cardMode
                            onRestoreScriptVersion={(version) => handleConversationGenerateDesign(
                              version,
                              { autoSnapshot: false, openDrawer: false },
                            )}
                          />
                        </React.Suspense>
                      </div>
                    </div>
                  </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Materials */}
          {mountedViews.has(AppView.Materials) && (
            <div style={{ display: currentView === AppView.Materials ? 'contents' : 'none' }}>
              {!isDataLoaded ? <SkeletonScreen message="正在加载素材库..." /> : (
                <React.Suspense fallback={<LegacyViewFallback label="materials" />}>
                <LegacyMaterialPage
                    files={files}
                    selectedFileId={selectedFileId}
                    materialLibrary={materialLibrary}
                    onUpdateLibrary={setMaterialLibrary}
                    onBindMaterial={handleBindMaterial}
                    onUnbindMaterial={handleUnbindMaterial}
                    onNextStep={() => handleViewSwitch(AppView.Generation)}
                    onSaveVersion={(name) => selectedFileId && handleSaveVersion(selectedFileId, name)}
                    onRestoreVersion={(version) => selectedFileId && handleRestoreVersion(selectedFileId, version)}
                    onDeleteVersion={(versionId) => selectedFileId && handleDeleteVersion(selectedFileId, versionId)}
                    onAppendStoryboard={handleAppendStoryboard}
                    onRemoveAppendedStoryboard={handleRemoveAppendedStoryboard}
                />
                </React.Suspense>
              )}
            </div>
          )}


          {mountedViews.has(AppView.Generation) && (
            <div style={{ display: currentView === AppView.Generation ? 'contents' : 'none' }}>
              {!isDataLoaded ? <SkeletonScreen message="正在加载分镜数据..." /> : (
                  <React.Suspense fallback={<LegacyViewFallback label="generation" />}>
                  <LegacyGenerationPage
                      files={files}
                      selectedFileId={selectedFileId}
                      episodeId={propEpisodeId}
                      defaultImageRatio={projectAspectRatio}
                      materialLibrary={materialLibrary}
                      shotPageSize={WORKSPACE_INITIAL_STORYBOARD_COUNT}
                      totalShotCount={selectedFileId ? (storyboardTotalsByFileId[selectedFileId] ?? selectedFile?.storyboard?.items?.length ?? 0) : 0}
                      onVisibleShotCountChange={handleWorkspaceVisibleShotCountChange}
                      onUpdateStoryboardItem={handleUpdateStoryboardItem}
                      onSaveVersion={(name) => selectedFileId && handleSaveVersion(selectedFileId, name)}
                      onRestoreVersion={(version) => selectedFileId && handleRestoreVersion(selectedFileId, version)}
                      onDeleteVersion={(versionId) => selectedFileId && handleDeleteVersion(selectedFileId, versionId)}
                      onForceSave={() => {
                          console.log('🚀 强制立即保存');
                          saveToBackend();
                      }}
                      onExportNext={handleExportNext}
                  />
                  </React.Suspense>
              )}
            </div>
          )}

          {/* Video */}
          {mountedViews.has(AppView.Video) && (
            <div style={{ display: currentView === AppView.Video ? 'contents' : 'none' }}>
                <React.Suspense fallback={<LegacyViewFallback label="video" />}>
                <LegacyVideoPage
                  onAddNotification={addTaskNotification}
                  onUpdateNotification={updateTaskNotification}
                  isActive={currentView === AppView.Video}
                  sessionScope={propEpisodeId || ''}
                  defaultAspectRatio={projectAspectRatio}
                />
                </React.Suspense>
            </div>
          )}

          {/* History */}
          {mountedViews.has(AppView.History) && (
            <div style={{ display: currentView === AppView.History ? 'contents' : 'none' }}>
                <React.Suspense fallback={<LegacyViewFallback label="history" />}>
                <LegacyHistoryPage />
                </React.Suspense>
            </div>
          )}

          {/* Admin */}
          {mountedViews.has(AppView.Admin) && (
            <div style={{ display: currentView === AppView.Admin ? 'contents' : 'none' }}>
              {hasAdminAccess === null ? (
                  <LegacyViewFallback label="admin access" />
              ) : !hasAdminAccess ? (
                  <div className="flex items-center justify-center h-full text-n100 w-full">
                      <div className="text-center">
                          <ShieldCheck className="w-16 h-16 mx-auto mb-4 opacity-20" />
                          <p className="text-xl font-bold mb-2">权限不足</p>
                          <p className="text-sm">此页面仅限管理员访问</p>
                      </div>
                  </div>
              ) : (
                  <React.Suspense fallback={<LegacyViewFallback label="admin" />}>
                  <LegacyAdminPage
                      files={files}
                      materialLibrary={materialLibrary}
                  />
                  </React.Suspense>
              )}
            </div>
          )}
        </>
      );
  }

  return (
    <div className={`layout-safe flex w-full min-w-0 flex-col ${hideHeader ? 'h-full flex-1' : 'h-screen'} overflow-hidden bg-n20 text-n800 font-sans`}>
      {!hideHeader && (
        <Header
          visibleColumns={visibleColumns}
          onToggleColumn={toggleColumnVisibility}
          onGlobalBatchProcess={handleGlobalBatchProcess}
          onStopProcessing={handleStopProcessing}
          isProcessing={isProcessing}
          fileCount={files.length}
          currentView={currentView}
          onChangeView={handleViewSwitch}
          aiModel={aiModel}
          modelOptions={scriptModelOptions}
          onChangeModel={setAiModel}
          notifications={taskNotifications}
          onDismissNotification={dismissTaskNotification}
        />
      )}

      <main className={`workspace-main relative flex-1 min-w-0 overflow-hidden ${currentView === AppView.Admin ? 'flex' : 'flex'}`} ref={containerRef}>
         <div className="workspace-view-frame flex h-full w-full min-w-0 flex-1 overflow-hidden">
         {renderAllViews()}
         </div>
      </main>
    </div>
  );
};

export default WorkspaceApp;
