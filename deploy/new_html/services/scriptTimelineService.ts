import { apiJson } from './httpClient';
import type {
  ScriptConversation,
  ScriptConversationMessage,
  ScriptConversationStatus,
  ScriptStoryboardVersion,
  StoryboardItem,
} from '../types';

const asEpoch = (value: unknown): number => {
  const parsed = value ? new Date(String(value)).getTime() : Date.now();
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const parseJsonValue = <T,>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const asRecord = (value: unknown): Record<string, any> => {
  const parsed = parseJsonValue<unknown>(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, any>
    : {};
};

const asArray = <T,>(value: unknown): T[] => {
  const parsed = parseJsonValue<unknown>(value, []);
  return Array.isArray(parsed) ? parsed as T[] : [];
};

const mapMessage = (row: any): ScriptConversationMessage => ({
  id: String(row?.message_id || row?.messageId || ''),
  role: row?.role || 'assistant',
  content: String(row?.content || ''),
  status: row?.status || 'completed',
  modelAlias: row?.model_alias || row?.modelAlias || undefined,
  provider: row?.provider || undefined,
  modelName: row?.model_name || row?.modelName || undefined,
  replyToMessageId: row?.reply_to_message_id || row?.replyToMessageId || undefined,
  requestId: row?.request_id || row?.requestId || undefined,
  metadata: asRecord(row?.metadata),
  createdAt: asEpoch(row?.created_at || row?.createdAt),
  updatedAt: asEpoch(row?.updated_at || row?.updatedAt),
});

const mapVersion = (row: any): ScriptStoryboardVersion => ({
  id: String(row?.version_id || row?.versionId || ''),
  scriptId: String(row?.script_id || row?.scriptId || ''),
  messageId: row?.message_id || row?.messageId || undefined,
  versionNo: Number(row?.version_no ?? row?.versionNo ?? 0),
  content: String(row?.content || ''),
  storyboardItems: asArray<StoryboardItem>(row?.storyboard_items ?? row?.storyboardItems),
  source: row?.source || 'ai',
  status: row?.status || 'ready',
  baseVersionId: row?.base_version_id || row?.baseVersionId || undefined,
  patch: Object.keys(asRecord(row?.patch)).length ? asRecord(row?.patch) as ScriptStoryboardVersion['patch'] : undefined,
  confirmedAt: row?.confirmed_at || row?.confirmedAt ? asEpoch(row?.confirmed_at || row?.confirmedAt) : undefined,
  rejectedAt: row?.rejected_at || row?.rejectedAt ? asEpoch(row?.rejected_at || row?.rejectedAt) : undefined,
  modelAlias: row?.model_alias || row?.modelAlias || undefined,
  provider: row?.provider || undefined,
  modelName: row?.model_name || row?.modelName || undefined,
  metadata: asRecord(row?.metadata),
  createdAt: asEpoch(row?.created_at || row?.createdAt),
  updatedAt: asEpoch(row?.updated_at || row?.updatedAt),
});

export interface CreateEpisodeScriptPayload {
  file_name?: string;
  original_content?: string;
  adapted_script?: string;
  sort_order?: number;
  metadata?: any;
  source_type?: string;
  source_id?: string;
}

export interface UpdateEpisodeScriptPayload {
  file_name?: string;
  original_content?: string;
  adapted_script?: string;
  metadata?: any;
}

export async function listEpisodeScripts(episodeId: string) {
  return apiJson<any>(`/api/episodes/${episodeId}/scripts`, { method: 'GET' }, 'listEpisodeScripts');
}

export async function createEpisodeScript(episodeId: string, data: CreateEpisodeScriptPayload) {
  return apiJson<any>(`/api/episodes/${episodeId}/scripts`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, 'createEpisodeScript');
}

export async function updateEpisodeScriptById(
  episodeId: string,
  scriptId: string,
  data: UpdateEpisodeScriptPayload,
) {
  return apiJson<any>(`/api/episodes/${episodeId}/scripts/${scriptId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateEpisodeScriptById');
}

export async function deleteEpisodeScript(episodeId: string, scriptId: string) {
  return apiJson<any>(
    `/api/episodes/${episodeId}/scripts/${scriptId}`,
    { method: 'DELETE' },
    'deleteEpisodeScript',
  );
}

export async function getWorkflowScript(episodeId: string) {
  return apiJson<any>(
    `/api/episodes/${episodeId}/workflow-script`,
    { method: 'GET' },
    'getWorkflowScript',
  );
}

export async function selectWorkflowScript(episodeId: string, scriptId: string) {
  return apiJson<any>(`/api/episodes/${episodeId}/workflow-script`, {
    method: 'PUT',
    body: JSON.stringify({ script_id: scriptId }),
  }, 'selectWorkflowScript');
}

export async function listEpisodeScriptSegments(episodeId: string, scriptId?: string) {
  const qs = scriptId ? `?script_id=${encodeURIComponent(scriptId)}` : '';
  return apiJson<any>(
    `/api/episodes/${episodeId}/script-segments${qs}`,
    { method: 'GET' },
    'listEpisodeScriptSegments',
  );
}

export async function batchSaveScriptSegments(
  episodeId: string,
  scriptId: string | null,
  segments: any[],
) {
  return apiJson<any>(`/api/episodes/${episodeId}/script-segments/batch`, {
    method: 'PUT',
    body: JSON.stringify({ script_id: scriptId, segments }),
  }, 'batchSaveScriptSegments');
}

export async function deleteScriptSegments(episodeId: string, scriptId?: string) {
  const qs = scriptId ? `?script_id=${encodeURIComponent(scriptId)}` : '';
  return apiJson<any>(
    `/api/episodes/${episodeId}/script-segments${qs}`,
    { method: 'DELETE' },
    'deleteScriptSegments',
  );
}

export async function getScriptConversation(
  episodeId: string,
  scriptId: string,
): Promise<ScriptConversation> {
  const response = await apiJson<any>(
    `/api/episodes/${episodeId}/scripts/${scriptId}/conversation`,
    { method: 'GET' },
    'getScriptConversation',
  );
  return {
    scriptId,
    currentVersionId: response?.current_version_id || response?.script?.current_version_id || undefined,
    defaultModel: response?.script?.default_model || undefined,
    messages: (response?.messages || []).map(mapMessage),
    versions: (response?.versions || []).map(mapVersion),
  };
}

export interface CreateScriptMessagePayload {
  role: 'user' | 'assistant' | 'system';
  content: string;
  status?: ScriptConversationStatus;
  modelAlias?: string;
  provider?: string;
  modelName?: string;
  replyToMessageId?: string;
  requestId?: string;
  metadata?: Record<string, any>;
}

export async function createScriptMessage(
  episodeId: string,
  scriptId: string,
  payload: CreateScriptMessagePayload,
): Promise<ScriptConversationMessage> {
  const response = await apiJson<any>(
    `/api/episodes/${episodeId}/scripts/${scriptId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        role: payload.role,
        content: payload.content,
        status: payload.status,
        model_alias: payload.modelAlias,
        provider: payload.provider,
        model_name: payload.modelName,
        reply_to_message_id: payload.replyToMessageId,
        request_id: payload.requestId,
        metadata: payload.metadata,
      }),
    },
    'createScriptMessage',
  );
  return mapMessage(response?.message);
}

export async function updateScriptMessage(
  episodeId: string,
  scriptId: string,
  messageId: string,
  payload: { content?: string; status?: ScriptConversationStatus; metadata?: Record<string, any> },
): Promise<ScriptConversationMessage> {
  const response = await apiJson<any>(
    `/api/episodes/${episodeId}/scripts/${scriptId}/messages/${messageId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    'updateScriptMessage',
  );
  return mapMessage(response?.message);
}

export interface CreateScriptVersionPayload {
  messageId?: string;
  baseVersionId?: string;
  content: string;
  storyboardItems: StoryboardItem[];
  source?: 'ai' | 'manual' | 'legacy';
  status?: 'draft' | 'ready' | 'failed';
  modelAlias?: string;
  provider?: string;
  modelName?: string;
  metadata?: Record<string, any>;
  setCurrent?: boolean;
}

const SCRIPT_VERSION_SELECT_RETRY_DELAYS_MS = [
  1000,
  2000,
  4000,
  8000,
  10000,
  10000,
  10000,
];

const SCRIPT_VERSION_CONFIRM_RETRY_DELAYS_MS = [300, 1000];

function isTransientScriptVersionSelectError(error: unknown): boolean {
  const status = Number((error as { status?: unknown } | null)?.status);
  if ([502, 503, 504].includes(status)) return true;
  if ((error as { name?: string } | null)?.name === 'AbortError') return false;
  const message = error instanceof Error ? error.message : String(error || '');
  return /(?:^|\D)(?:502|503|504)(?:\D|$)|failed to fetch|fetch failed|networkerror|network error|load failed|connection refused/i.test(message);
}

function waitForScriptVersionSelectRetry(delayMs: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, delayMs));
}

function isTransientScriptVersionConfirmError(error: unknown): boolean {
  const status = Number((error as { status?: unknown } | null)?.status);
  if ([500, 502, 503, 504].includes(status)) return true;
  if ((error as { name?: string } | null)?.name === 'AbortError') return false;
  const message = error instanceof Error ? error.message : String(error || '');
  return /(?:^|\D)(?:500|502|503|504)(?:\D|$)|internal server error|failed to fetch|fetch failed|networkerror|network error|load failed|connection refused/i.test(message);
}

export async function createScriptVersion(
  episodeId: string,
  scriptId: string,
  payload: CreateScriptVersionPayload,
): Promise<ScriptStoryboardVersion> {
  const response = await apiJson<any>(
    `/api/episodes/${episodeId}/scripts/${scriptId}/versions`,
    {
      method: 'POST',
      body: JSON.stringify({
        message_id: payload.messageId,
        base_version_id: payload.baseVersionId,
        content: payload.content,
        storyboard_items: payload.storyboardItems,
        source: payload.source || 'ai',
        status: payload.status || 'ready',
        model_alias: payload.modelAlias,
        provider: payload.provider,
        model_name: payload.modelName,
        metadata: payload.metadata,
        set_current: payload.setCurrent !== false,
      }),
    },
    'createScriptVersion',
  );
  return mapVersion(response?.version);
}

export async function selectScriptVersion(
  episodeId: string,
  scriptId: string,
  versionId: string,
): Promise<ScriptStoryboardVersion> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await apiJson<any>(
        `/api/episodes/${episodeId}/scripts/${scriptId}/versions/${versionId}/select`,
        { method: 'PUT' },
        'selectScriptVersion',
      );
      return mapVersion(response?.version);
    } catch (error) {
      const delayMs = SCRIPT_VERSION_SELECT_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined || !isTransientScriptVersionSelectError(error)) {
        throw error;
      }
      console.warn(
        `selectScriptVersion 暂时不可用，${delayMs}ms 后重试 (${attempt + 1}/${SCRIPT_VERSION_SELECT_RETRY_DELAYS_MS.length})`,
      );
      await waitForScriptVersionSelectRetry(delayMs);
    }
  }
}

export async function confirmScriptVersion(
  episodeId: string,
  scriptId: string,
  versionId: string,
): Promise<ScriptStoryboardVersion> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await apiJson<any>(
        `/api/episodes/${episodeId}/scripts/${scriptId}/versions/${versionId}/confirm`,
        { method: 'PUT' },
        'confirmScriptVersion',
      );
      return mapVersion(response?.version);
    } catch (error) {
      const delayMs = SCRIPT_VERSION_CONFIRM_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined || !isTransientScriptVersionConfirmError(error)) {
        throw error;
      }
      console.warn(
        `confirmScriptVersion 暂时不可用，${delayMs}ms 后重试 (${attempt + 1}/${SCRIPT_VERSION_CONFIRM_RETRY_DELAYS_MS.length})`,
      );
      await waitForScriptVersionSelectRetry(delayMs);
    }
  }
}

export async function rejectScriptVersion(
  episodeId: string,
  scriptId: string,
  versionId: string,
): Promise<{
  version: ScriptStoryboardVersion;
  outcome: 'rejected' | 'already_rejected' | 'already_confirmed' | 'not_rejectable';
  currentVersionId?: string;
}> {
  const response = await apiJson<any>(
    `/api/episodes/${episodeId}/scripts/${scriptId}/versions/${versionId}/reject`,
    { method: 'PUT' },
    'rejectScriptVersion',
  );
  return {
    version: mapVersion(response?.version),
    outcome: response?.outcome || 'rejected',
    currentVersionId: response?.current_version_id || undefined,
  };
}

export async function updateScriptVersionMetadata(
  episodeId: string,
  scriptId: string,
  versionId: string,
  metadata: Record<string, any>,
): Promise<ScriptStoryboardVersion> {
  const response = await apiJson<any>(
    `/api/episodes/${episodeId}/scripts/${scriptId}/versions/${versionId}/metadata`,
    { method: 'PATCH', body: JSON.stringify({ metadata }) },
    'updateScriptVersionMetadata',
  );
  return mapVersion(response?.version);
}

export async function getTimelineTracks(episodeId: string) {
  return apiJson<any>(`/api/episodes/${episodeId}/timeline-tracks`, { method: 'GET' }, 'getTimelineTracks');
}

export async function createTimelineTrack(episodeId: string, data: any) {
  return apiJson<any>(`/api/episodes/${episodeId}/timeline-tracks`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, 'createTimelineTrack');
}

export async function updateTimelineTrack(trackId: string, data: any) {
  return apiJson<any>(`/api/timeline-tracks/${trackId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, 'updateTimelineTrack');
}
