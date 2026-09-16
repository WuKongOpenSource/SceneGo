

export enum FileStatus {
  Idle = 'Idle',
  Processing = 'Processing',
  Completed = 'Completed',
  Error = 'Error'
}

export interface GeneratedImage {
  id: string;
  url: string;
  thumbnail?: string;
  timestamp: number;
  isLocal?: boolean;

  fileId?: string | null;
  isSelected?: boolean;
  qualityReview?: StoryboardQualityReview;
  generationModel?: string;
  fallbackReason?: string;
  source?: string;
  generationAttempt?: number;
}

export interface CharacterQualityScore {
  name: string;
  score: number;
  issues: string[];
}

export interface StoryboardQualityReview {
  status: 'passed' | 'failed' | 'unverified';
  characterConsistencyScore: number;
  scriptComplianceScore: number;
  visualQualityScore: number;
  overallScore: number;
  characterScores: CharacterQualityScore[];
  issues: string[];
  retryPrompt: string;
  reviewedAt: string;
  reviewerModel?: string;
  attempt?: number;
}

export interface StoryboardItem {
  id: string;
  shotNumber?: string | number;
  duration?: string;


  originalText: string;
  scriptSegment: string;


  imagePrompt?: string;
  videoPrompt?: string;
  dialogue?: string;
  characters?: string[];
  scene?: string;
  props?: string[];
  cameraMovement?: string;
  plannedDurationMs?: number | null;


  isLocked?: boolean;
  isPlaceholder?: boolean;


  boundCharNames?: string[];
  boundSceneName?: string;
  boundPropNames?: string[];

  boundAssetTokens?: string[];

  bindingsInitialized?: boolean;
  materialSelections?: Record<string, string>;


  generatedImages?: GeneratedImage[];
  selectedImageId?: string;
  isConfigConfirmed?: boolean;
  configuredReferences?: GenerationReference[];
  referenceConfigInitialized?: boolean;


  timestamp?: number;


  sourceFileId?: string;
  sourceFileName?: string;


  scriptSegmentId?: string;
  sourceVideoShotNo?: string;
  videoScriptBlock?: string;
  shotSize?: string;
  cameraAngle?: string;


  generatedImage?: string;
}

export interface StoryboardData {
  items: StoryboardItem[];
}



export type ScriptStageStatus = 'idle' | 'running' | 'done' | 'error';

export interface ScriptGenerationStageState {
  status: ScriptStageStatus;
  total?: number;
  completed?: number;
  errorMessage?: string;
  updatedAt?: number;
}

export interface ScriptSegment {
  id: string;
  order: number;
  sourceText: string;
  estimatedDurationSec: number | null;
  videoScript?: string;
  status?: 'pending' | 'running' | 'done' | 'error';
  errorMessage?: string;
}


export interface VideoScriptBlock {
  shotNo: string;
  durationSec: number | null;
  rawBlock: string;
}


export interface VideoScriptGroup {
  groupNo: number;
  blocks: VideoScriptBlock[];
  visualStyle: string;
  stabilityConstraint: string;
  sharedVideoPrompt: string;
  rawGroup: string;
}


export interface ExtractedStoryboardPrompt {
  shotNo: string;
  shotSize: string;
  sceneDescription: string;
  characters: string[];
  scene: string;
  props: string[];
  imagePrompt: string;
  cameraAngle: string;
  cameraMove: string;
  dialogue: string;
  durationSec: number | null;
}

export interface FileVersion {
  id: string;
  timestamp: number;
  name: string;
  source?: 'auto' | 'manual';
  scriptVersionId?: string;
  data: Omit<ProjectFile, 'id' | 'versions' | 'status'>;
}

export interface ProjectFile {
  id: string;
  name: string;
  originalContent: string;
  scriptContent: string | null;
  storyboard: StoryboardData | null;
  extractedCharacters: string[];
  extractedScenes: string[];
  extractedProps?: string[];
  status: FileStatus;
  lastUpdated: number;
  versions: FileVersion[];

  scriptSegments?: ScriptSegment[];
  generationStages?: {
    split?: ScriptGenerationStageState;
    videoScript?: ScriptGenerationStageState;
    storyboardPrompt?: ScriptGenerationStageState;
  };
}

export interface GeminiResponse<T> {
  data: T | null;
  error?: string;
}

export interface RestructureResponse {
  newScriptSegment: string;
  newStoryboardItems: Omit<StoryboardItem, 'id'>[];
}

export enum AppView {
  ProjectHub = 'ProjectHub',
  EpisodeHub = 'EpisodeHub',
  Editor = 'Editor',
  Design = 'Design',
  Materials = 'Materials',
  AudioStage = 'AudioStage',
  Generation = 'Generation',
  Video = 'Video',
  Enhance = 'Enhance',
  PostProcess = 'PostProcess',
  History = 'History',
  Canvas = 'Canvas',
  Admin = 'Admin'
}

export enum AiModel {
  MinimaxM3 = 'minimax-m3',
  Gemini = 'gemini',
  Deepseek = 'deepseek',
  DeepseekChat = 'deepseek-chat'
}

export interface Material {
  id: string;
  url: string; // Blob URL or Base64
  thumbnail?: string;
  type: 'image';
  source: string;
  timestamp: number;
  name?: string;
  assetId?: string;
  fileId?: string;
  assetType?: 'character' | 'scene' | 'prop';
  description?: string;
  styleParams?: Record<string, any>;
  isIdentityReference?: boolean;
}

export type ScriptConversationRole = 'user' | 'assistant' | 'system';
export type ScriptConversationStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled';

export interface ScriptConversationMessage {
  id: string;
  role: ScriptConversationRole;
  content: string;
  status: ScriptConversationStatus;
  modelAlias?: string;
  provider?: string;
  modelName?: string;
  replyToMessageId?: string;
  requestId?: string;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface ScriptStoryboardVersion {
  id: string;
  scriptId: string;
  messageId?: string;
  versionNo: number;
  content: string;
  storyboardItems: StoryboardItem[];
  source: 'ai' | 'manual' | 'legacy';
  status: 'draft' | 'ready' | 'failed' | 'rejected';
  baseVersionId?: string;
  patch?: {
    format: string;
    baseHash: string;
    candidateHash: string;
    summary: {
      added: number;
      deleted: number;
      changed: number;
      operationCount: number;
    };
    operations: Array<{
      op: 'add' | 'delete' | 'change';
      baseStart: number;
      baseEnd: number;
      candidateStart: number;
      candidateEnd: number;
      before: string[];
      after: string[];
    }>;
  };
  confirmedAt?: number;
  rejectedAt?: number;
  modelAlias?: string;
  provider?: string;
  modelName?: string;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface ScriptConversation {
  scriptId: string;
  currentVersionId?: string;
  defaultModel?: string;
  messages: ScriptConversationMessage[];
  versions: ScriptStoryboardVersion[];
}

// Key is the tag name (e.g., "Main Character", "Living Room")
export type MaterialLibrary = Record<string, Material[]>;

export type ReferenceType = 'character' | 'scene' | 'pose' | 'prop' | 'effect';

export interface GenerationReference {
  id: string;
  url: string;
  type: ReferenceType;
  name?: string;
  assetId?: string;
  fileId?: string;
  description?: string;
  source?: 'identity_anchor' | 'material_binding' | 'manual';
  isLocked?: boolean;
}

export interface CharacterIdentityAnchor {
  age?: string;
  face?: string;
  hair?: string;
  outfit?: string;
  distinguishingFeatures?: string;
  forbiddenChanges?: string;
}

export interface UserPermissions {
  accessMode: 'inherit' | 'restricted' | 'blocked';
  allowedModels: string[];
  priority: 'low' | 'normal' | 'high';
  canExport: boolean;
}

export interface UserAccount {
  id: string;
  username: string;
  email: string;
  role: 'user' | 'admin' | 'super_admin';
  isActive: boolean;
  isOnline: boolean;
  lastActiveAt: number;
  lastLogin: number;
  creationPoints: {
    available: number;
    account: number;
    gift: number;
  };
  permissions: UserPermissions;
  stats: {
    todayCount: number;
    totalCount: number;
    byModel: Record<string, number>;
  };
}

export interface GenerationLog {
  id: string;
  userId: string;
  username: string;
  timestamp: number;
  type: 'text' | 'image' | 'video';
  model: string;
  status: 'success' | 'failed';
  prompt: string;
  params: string;
  executionTimeMs: number;
  queueTimeMs: number;
  resultPreview?: string;
  resultVideo?: string;
  resultText?: string;
}

export interface ServerNode {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'maintenance';
  ip: string;
  storageUsed: number;
  storageTotal: number;
  gpuUsage: number;
  sshConfig?: {
    host: string;
    port: number;
    user: string;
    keyPath: string;
    password?: string;
  };
}



export type ProjectRole = 'owner' | 'admin' | 'member' | 'readonly';

export type Responsibility = 'text' | 'materials' | 'generation' | 'video' | 'all';

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  role: ProjectRole;
  responsibility: Responsibility;
  joinedAt: number;
}

export interface ProjectInfo {
  projectId: string;
  projectName: string;
  description: string;
  coverUrl?: string;
  tags: string[];
  ownerId: string;
  ownerName: string;
  memberCount: number;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt?: number;
  episodeCount?: number;

  memberRole?: string;
  visibility?: 'private' | 'org-default' | string;
  groupId?: string | null;
  groupName?: string | null;
  settings?: Record<string, any>;
}

export interface Episode {
  episodeId: string;
  projectId: string;
  episodeNumber: number;
  episodeName: string;
  description: string;
  status: 'draft' | 'in_progress' | 'completed' | 'published';
  settings: Record<string, any>;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}



export type TaskCategory = 'api_text' | 'api_image' | 'api_video' | 'comfyui';

export type GlobalTaskStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';



export type SourcePage =
  | 'editor'
  | 'script'
  | 'design'
  | 'materials'
  | 'audio'
  | 'storyboard'
  | 'generation'
  | 'video'
  | 'enhance'
  | 'postprocess'
  | 'canvas'
  | 'history'
  | 'media-library'
  | 'final'
  | 'video-reverse'
  | 'image-upscale'
  | 'global';



export type TaskKind =

  | 'seedance' | 'seedance-fast' | 'seedance-mini' | 'seedance-1.5' | 'jimeng'
  | 'wan2' | 'wan2-fast'
  | 'kling' | 'vidu' | 'happyhorse'
  | 'sora2' | 'veo'
  | 'video-i2v' | 'video-comfy'

  | 'comfyui-image'
  | 'gemini-image' | 'doubao-image'
  | 'nanobanana' | 'qwen-image' | 'qwen-lora' | 'kontext'

  | 'matting' | 'angle-adjust'
  | 'human-multi-angle' | 'around-angle'
  | 'image-fusion' | 'panorama-360' | 'panorama-fusion'
  | 'auto-storyboard' | 'multi-grid-storyboard'
  | 'image-upscale'

  | 'minimax-tts' | 'gemini-tts' | 'audio-mix'

  | 'video-enhance' | 'video-upscale'
  | 'video-voice' | 'video-edit' | 'video-crop'

  | 'prompt-rewrite' | 'script-segment'
  | 'other';








export interface RegisteredTask {

  taskId: string;

  notificationId?: string;

  kind: TaskKind;

  title: string;
  status: GlobalTaskStatus;

  progress?: number;

  queuePosition?: number;

  createdAt: number;

  startedAt?: number;

  completedAt?: number;

  targetPage: SourcePage;

  targetEntityType?: string;

  targetEntityId?: string;

  targetItemId?: string;

  targetProjectId?: string;

  episodeId?: string;

  fileRole?: string;

  error?: string;

  resultUrls?: string[];






  metadata?: Record<string, unknown>;
}

export interface GlobalTask {
  cancelDeadline?: number;
  canCancel?: boolean;
  id: string;
  category: TaskCategory;
  taskType?: string;
  status: GlobalTaskStatus;
  displayName: string;
  projectId: string;
  sourcePage: SourcePage;
  sourceItemId?: string;
  entityType?: string;
  entityId?: string;
  fileRole?: string;
  episodeId?: string;
  provider?: string;
  modelName?: string;
  progress?: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: any;
  error?: string;
}


export interface TaskNotification {
  id: string;
  type: 'video' | 'image' | 'material' | 'text';
  status: 'running' | 'completed' | 'failed';
  message: string;
  targetView: AppView;
  targetProjectId?: string;
  targetPage?: SourcePage;
  targetItemId?: string;
  timestamp: number;
  taskId?: string;
  taskType?: string;
  entityType?: string;
  entityId?: string;
  fileRole?: string;
  episodeId?: string;
  provider?: string;
  modelName?: string;
}



export type CanvasNodeType = 'text' | 'image' | 'video' | 'storyboard' | 'prompt' | 'group';

export interface CanvasNode {
  id: string;
  boardId: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  data: Record<string, any>;
  zIndex: number;
  isLocked: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasConnection {
  id: string;
  boardId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort?: string;
  targetPort?: string;
  label?: string;
}

export interface CanvasBoard {
  id: string;
  projectId: string;
  episodeId?: string;
  name: string;
  description?: string;
  viewport: { x: number; y: number; zoom: number };
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  createdAt: number;
  updatedAt: number;
}



export interface AssetItem {
  assetId: string;
  projectId: string;
  episodeId: string | null;
  scriptId?: string | null;
  assetType: 'character' | 'scene' | 'prop';
  name: string;
  description: string;
  thumbnailUrl: string | null;
  referenceImages: string[];
  styleParams: Record<string, any>;
  tags: string[];
  createdBy: string;
  createdAt: string;
  entityFiles?: Array<{
    fileId: string;
    fileUrl: string;
    fileType: string;
    fileRole: string;
    isSelected: boolean;
    createdAt: string;
  }>;
}

export interface StoryboardItemDB {
  itemId: string;
  lineageId?: string;
  episodeId: string;
  sortOrder: number;
  scriptSegmentId?: string;
  sourceVideoShotNo?: string;
  sceneHeading: string;
  actionText: string;
  dialogue: string;
  cameraMovement: string;
  imagePrompt: string;
  videoPrompt: string;
  generatedImageUrl: string | null;
  boundAssets: string[];
  configuredReferences: GenerationReference[];
  referenceConfigInitialized?: boolean;
  status: string;
  dialogueAudioUrl: string | null;
  narrationAudioUrl: string | null;
  sfxAudioUrl: string | null;
  mixedAudioUrl?: string | null;
  audioDurationMs: number | null;
  plannedDurationMs: number | null;
  audioSegments?: StoryboardAudioSegment[];
  videoScriptBlock?: string;
}

export interface VideoSegment {
  segmentId: string;
  episodeId: string;
  storyboardItemId: string | null;
  sortOrder: number;
  generationMode: string;
  model: string;
  inputParams: Record<string, any>;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationMs: number | null;
  taskId: string | null;
  status: string;
}

export interface AudioTrack {
  trackId: string;
  episodeId: string;
  trackType: 'bgm' | 'sfx_global' | 'narration_global';
  name: string;
  audioUrl: string | null;
  durationMs: number | null;
  startItemId: string | null;
  endItemId: string | null;
  generationParams: Record<string, any>;
}

export interface EpisodeScript {
  scriptId: string;
  episodeId: string;
  originalContent: string;
  adaptedScript: string;
  metadata: Record<string, any>;
}

export interface TimelineTrack {
  trackId: string;
  episodeId: string;
  trackType: 'video' | 'audio' | 'subtitle';
  trackName: string;
  sortOrder: number;
  items: any[];
}

export interface CharacterVoice {
  voiceId: string;
  projectId: string;
  assetId: string | null;
  characterName: string;
  voiceProvider: string | null;
  voiceModelId: string | null;
  voiceName: string | null;
  voiceParams: Record<string, any>;
  sampleAudioUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoVoiceReference {
  referenceId: string;
  projectId: string;
  episodeId: string | null;
  storyboardItemId: string | null;
  videoSegmentId: string | null;
  characterName: string;
  sourceVideoUrl: string;
  referenceAudioUrl: string;
  videoModel: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export type VoiceSourceType = 'system' | 'clone' | 'design';

export interface VoiceDesignSetting {
  voice_type: 'male' | 'female';
  emotion: 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';
  speed: number;
  pitch: number;
}

export interface AudioClipInfo {
  clipId: string;
  itemId: string;
  lineageId?: string;
  sortOrder: number;
  sequenceIndex: number;
  type: 'narration' | 'dialogue';
  text: string;
  characterName: string;
  audioUrl: string | null;
  durationMs: number | null;
  voiceId: string | null;
}

export interface StoryboardAudioSegment {
  segmentId: string;
  kind: 'speech' | 'silence';
  sequenceIndex: number;
  speaker?: string;
  text?: string;
  label?: string;
  audioUrl?: string | null;
  durationMs?: number | null;
  voiceId?: string | null;
}

export interface ClipOverride {
  emotion?: string;
  speed?: number;
  pitch?: number;
  text?: string;
  speaker?: string;
}

export interface TimelineItem {
  id: string;
  sortOrder: number;
  label: string;
  type: 'narration' | 'dialogue' | 'bgm';
  audioUrl: string | null;
  durationMs: number;
  imageUrl?: string | null;
  characterName?: string;
}
