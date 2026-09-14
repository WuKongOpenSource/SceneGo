import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Film,
  Copy,
  Coins,
  Download,
  FileText,
  GripHorizontal,
  History,
  Layers3,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Send,
  Upload,
  User,
  X,
} from 'lucide-react';
import {
  AiModel,
  ProjectFile,
  ScriptConversation,
  ScriptConversationMessage,
  ScriptStoryboardVersion,
} from '../types';
import { estimateCredits, estimateTextTokens } from '../services/creditService';
import {
  buildStoryboardSegmentGroups,
  cleanStoryboardShotCardText,
  cleanStoryboardDisplayText,
  mergeStoryboardDisplayItems,
} from '../utils/storyboardSegments';
import { parseVideoScriptGroups } from '../utils/scriptPipelineParsers';
import {
  buildScriptVersionChainContext,
  selectScriptIterationBaseVersion,
} from '../utils/scriptIteration';
import { SegmentPromptCards } from './SegmentPromptCards';
import {
  DEFAULT_SCRIPT_MODEL_OPTIONS,
  formatScriptModelHistoryLabel,
  getScriptModelBillingKey,
  getScriptModelOption,
  type ScriptModelOption,
} from '../services/scriptModelCatalogService';
import type { ScriptWorkspaceMode } from '../utils/scriptWorkspaceMode';
import { ScriptWorkspaceModeSwitch } from './ScriptWorkspaceModeSwitch';
import { ModelPicker } from './ModelPicker';
import { buildScriptModelPickerOptions } from './modelPickerCatalogs';

export const SCRIPT_MODEL_OPTIONS = DEFAULT_SCRIPT_MODEL_OPTIONS;

interface ScriptConversationPaneProps {
  selectedFile?: ProjectFile;
  conversation?: ScriptConversation;
  aiModel: AiModel;
  modelOptions?: readonly ScriptModelOption[];
  isWorkflowScript: boolean;
  isLoading: boolean;
  isSending: boolean;
  error?: string | null;
  onDismissError?: () => void;
  onChangeModel: (model: AiModel) => void;
  onSend: (content: string) => Promise<void>;
  onGenerateDesign: (version: ScriptStoryboardVersion) => Promise<void> | void;
  onConfirmVersion?: (version: ScriptStoryboardVersion) => Promise<void> | void;
  onRejectVersion?: (version: ScriptStoryboardVersion) => Promise<void> | void;
  onEditVersion: (version: ScriptStoryboardVersion, content: string) => Promise<void>;
  onExportVersion: (version: ScriptStoryboardVersion) => void;
  onOpenStoryboard: () => void;
  storyboardItemCount: number;
  workspaceMode?: ScriptWorkspaceMode;
  onWorkspaceModeChange?: (mode: ScriptWorkspaceMode) => void;
}

const formatTime = (value: number) => new Date(value).toLocaleString('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const ScriptPatchPreview: React.FC<{ version: ScriptStoryboardVersion }> = ({ version }) => {
  const patch = version.patch;
  if (!patch) return null;
  const operations = patch.operations || [];
  const summary = patch.summary || { added: 0, deleted: 0, changed: 0, operationCount: 0 };
  return (
    <div className="mt-4 rounded-lg border border-warning/30 bg-warning-light/40 p-3" data-testid={`script-patch-${version.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-n700">
        <ArrowLeftRight className="h-3.5 w-3.5 text-warning" />
        AI 修改待确认
        <span className="font-normal text-n300">
          新增 {summary.added} 行 · 删除 {summary.deleted} 行 · 修改 {summary.changed} 行
        </span>
      </div>
      {operations.length > 0 && (
        <div className="font-document mt-2 max-h-64 space-y-2 overflow-y-auto rounded border border-n40 bg-n0 p-2 text-[11px] leading-5">
          {operations.slice(0, 20).map((operation, index) => (
            <div key={`${operation.op}-${operation.baseStart}-${operation.candidateStart}-${index}`}>
              <div className="mb-1 text-[10px] text-n100">
                {operation.op === 'add' ? '新增' : operation.op === 'delete' ? '删除' : '修改'} · 原稿 {operation.baseStart}-{operation.baseEnd || operation.baseStart} 行
              </div>
              {operation.before.slice(0, 8).map((line, lineIndex) => (
                <div key={`before-${lineIndex}`} className="break-all bg-danger-light px-2 text-danger">- {line || ' '}</div>
              ))}
              {operation.after.slice(0, 8).map((line, lineIndex) => (
                <div key={`after-${lineIndex}`} className="break-all bg-success-light px-2 text-success">+ {line || ' '}</div>
              ))}
            </div>
          ))}
          {operations.length > 20 && <div className="text-n100">其余 {operations.length - 20} 处差异已折叠</div>}
        </div>
      )}
    </div>
  );
};

export interface ConversationTurn {
  id: string;
  anchorMessageId: string;
  number: number;
  preview: string;
  isInitial?: boolean;
  versionNo?: number;
}

const buildTurnPreview = (content: string, fallback: string) => (
  content.replace(/\s+/g, ' ').trim().slice(0, 42) || fallback
);

export const buildConversationTurns = (
  messages: ScriptConversationMessage[],
  versions: ScriptStoryboardVersion[],
  fallbackInitialContent = '',
): ConversationTurn[] => {
  const fallbackAnchorMessageId = messages[0]?.id || '';
  const messagesById = new Map(messages.map(message => [message.id, message]));
  const firstUserMessage = messages.find(message => message.role === 'user');
  const realVersions = versions.filter(version => !version.id.startsWith('legacy_'));
  const orderedVersions = [...(realVersions.length > 0 ? realVersions : versions)].sort((left, right) => (
    left.versionNo - right.versionNo
      || left.createdAt - right.createdAt
      || left.id.localeCompare(right.id)
  ));
  const turns: ConversationTurn[] = [];
  const initialContent = firstUserMessage?.content || fallbackInitialContent;

  if (initialContent.trim()) {
    turns.push({
      id: `initial-${firstUserMessage?.id || 'script'}`,
      anchorMessageId: firstUserMessage?.id || fallbackAnchorMessageId,
      number: 0,
      preview: buildTurnPreview(initialContent, '初始剧本'),
      isInitial: true,
    });
  }

  if (orderedVersions.length > 0) {
    turns.push(...orderedVersions.map((version, index) => {
      const versionMessage = version.messageId ? messagesById.get(version.messageId) : undefined;
      return {
        id: `version-${version.id}`,
        anchorMessageId: versionMessage?.id || fallbackAnchorMessageId,
        number: index + 1,
        preview: buildTurnPreview(version.content || versionMessage?.content || '', '分镜脚本'),
        versionNo: version.versionNo,
      };
    }));
    return turns;
  }

  if (turns.length > 0) return turns;

  turns.push(...messages
    .filter(message => message.role === 'user')
    .map((message, index) => ({
      id: `turn-${message.id}`,
      anchorMessageId: message.id,
      number: index + 1,
      preview: buildTurnPreview(message.content, '未命名对话'),
    })));

  if (turns.length === 0) {
    const firstAssistantMessage = messages.find(message => message.role === 'assistant');
    if (firstAssistantMessage) {
      turns.push({
        id: `turn-${firstAssistantMessage.id}`,
        anchorMessageId: firstAssistantMessage.id,
        number: 1,
        preview: buildTurnPreview(firstAssistantMessage.content, '分镜脚本'),
      });
    }
  }

  return turns;
};






export const orderConversationMessages = (
  messages: ScriptConversationMessage[],
  versions: ScriptStoryboardVersion[],
  fallbackInitialContent = '',
): ScriptConversationMessage[] => {
  if (!messages.length && !versions.length) return [];

  const sourceOrder = new Map(messages.map((message, index) => [message.id, index]));
  const messagesById = new Map(messages.map(message => [message.id, message]));
  const realVersions = versions.filter(version => !version.id.startsWith('legacy_'));
  const orderedVersions = [...(realVersions.length > 0 ? realVersions : versions)].sort((left, right) => (
    left.versionNo - right.versionNo
      || left.createdAt - right.createdAt
      || left.id.localeCompare(right.id)
  ));
  const result: ScriptConversationMessage[] = [];
  const added = new Set<string>();
  const append = (message?: ScriptConversationMessage) => {
    if (!message || added.has(message.id)) return;
    added.add(message.id);
    result.push(message);
  };

  const normalizedInitialContent = fallbackInitialContent.trim().replace(/\r\n/g, '\n');
  const firstVersionMessage = orderedVersions[0]?.messageId
    ? messagesById.get(orderedVersions[0].messageId as string)
    : undefined;
  const firstVersionRequest = firstVersionMessage?.replyToMessageId
    ? messagesById.get(firstVersionMessage.replyToMessageId)
    : undefined;
  const matchingInitialMessage = normalizedInitialContent
    ? messages.find(message => (
        message.role === 'user'
          && message.content.trim().replace(/\r\n/g, '\n') === normalizedInitialContent
      ))
    : undefined;


  // Imported history may start with an AI reply and omit the original user row.
  // Project source text is a read-only reference, never a new persisted message.
  const sourceReference: ScriptConversationMessage | undefined = normalizedInitialContent && !matchingInitialMessage ? {
    id: 'original-script-content', role: 'user', status: 'completed', content: fallbackInitialContent,
    createdAt: 0, updatedAt: 0, metadata: { sourceReference: true },
  } : undefined;
  append(
    matchingInitialMessage || sourceReference
      || (firstVersionRequest?.role === 'user' ? firstVersionRequest : undefined)
      || messages.find(message => message.role === 'user'),
  );

  orderedVersions.forEach(version => {
    const versionMessage = version.messageId ? messagesById.get(version.messageId) : undefined;
    if (versionMessage?.replyToMessageId) {
      append(messagesById.get(versionMessage.replyToMessageId));
    }
    append(versionMessage);
  });

  messages
    .filter(message => !added.has(message.id))
    .sort((left, right) => (
      left.createdAt - right.createdAt
        || (sourceOrder.get(left.id) || 0) - (sourceOrder.get(right.id) || 0)
    ))
    .forEach(append);

  return result;
};

export const setCollapsedEntry = (
  current: Set<string>,
  key: string,
  shouldCollapse: boolean,
): Set<string> => {
  const alreadyCollapsed = current.has(key);
  if (alreadyCollapsed === shouldCollapse) return current;

  const next = new Set(current);
  if (shouldCollapse) next.add(key);
  else next.delete(key);
  return next;
};

export const StoryboardVersionBody: React.FC<{ version: ScriptStoryboardVersion }> = ({ version }) => {
  const content = String(version.content || '').trim();
  const fallbackContent = useMemo(
    () => cleanStoryboardDisplayText(content),
    [content],
  );
  const displayItems = useMemo(
    () => mergeStoryboardDisplayItems(content, version.storyboardItems || []),
    [content, version.storyboardItems],
  );
  const groups = useMemo(
    () => buildStoryboardSegmentGroups(displayItems),
    [displayItems],
  );
  const promptGroupsByNo = useMemo(
    () => new Map(parseVideoScriptGroups(fallbackContent).map(group => [group.groupNo, group])),
    [fallbackContent],
  );
  if (groups.length === 0) {
    return (
      <div
        className="whitespace-pre-wrap break-words text-sm leading-7 text-n700"
        data-testid={version.source === 'legacy' ? `legacy-storyboard-version-body-${version.id}` : undefined}
      >
        {fallbackContent}
      </div>
    );
  }

  return (
    <div
      className="space-y-4"
      data-testid={version.source === 'legacy' ? `legacy-storyboard-version-body-${version.id}` : undefined}
    >
      {groups.map(group => {
        const promptGroup = promptGroupsByNo.get(group.segmentNo);
        return (
          <section key={group.key} className="overflow-hidden rounded-md border border-n40 bg-n0">
            <header className="flex items-center gap-2 border-b border-n40 bg-n20 px-3 py-2">
              <span className="text-xs font-semibold text-n500">分段</span>
              <span className="font-mono text-sm font-bold text-warning">{String(group.segmentNo).padStart(2, '0')}</span>
              <span className="text-[10px] text-n100">{group.entries.length} 个分镜 · 约 {Number(group.estimatedDurationSec.toFixed(1))} 秒</span>
            </header>
            <div className="space-y-3 p-3">
              {group.entries.map(entry => (
                <article
                  key={entry.item.id}
                  className="rounded-md border border-n40 bg-n20/60 px-3 py-3"
                  data-testid={`segment-${group.segmentNo}-shot-${entry.localShotNo}-card`}
                >
                  <div className="mb-1 text-xs font-semibold text-primary">{entry.localShotLabel.replace(/^镜头/, '分镜')}</div>
                  <div className="font-document whitespace-pre-wrap break-words text-sm leading-7 text-n700">
                    {cleanStoryboardShotCardText(
                      entry.item.originalText || entry.item.videoScriptBlock || entry.item.scriptSegment,
                    )}
                  </div>
                </article>
              ))}
              <SegmentPromptCards
                segmentNo={group.segmentNo}
                visualStyle={promptGroup?.visualStyle}
                stabilityConstraint={promptGroup?.stabilityConstraint}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
};

export const ScriptConversationPane: React.FC<ScriptConversationPaneProps> = ({
  selectedFile,
  conversation,
  aiModel,
  modelOptions = SCRIPT_MODEL_OPTIONS,
  isWorkflowScript,
  isLoading,
  isSending,
  error,
  onDismissError,
  onChangeModel,
  onSend,
  onGenerateDesign,
  onConfirmVersion = () => undefined,
  onRejectVersion = () => undefined,
  onEditVersion,
  onExportVersion,
  onOpenStoryboard,
  storyboardItemCount,
  workspaceMode,
  onWorkspaceModeChange,
}) => {
  const [draft, setDraft] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingVersion, setEditingVersion] = useState<ScriptStoryboardVersion | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isReferenceScriptCollapsed, setIsReferenceScriptCollapsed] = useState(false);
  const [isReferenceScriptOnLeft, setIsReferenceScriptOnLeft] = useState(true);
  const [isComposerFullscreen, setIsComposerFullscreen] = useState(false);
  const [composerHeight, setComposerHeight] = useState(132);
  const [isResizingComposer, setIsResizingComposer] = useState(false);
  const [scrollControls, setScrollControls] = useState({ canScrollUp: false, canScrollDown: false });
  const [messageScrollControls, setMessageScrollControls] = useState<Record<string, {
    canJumpTop: boolean;
    canJumpBottom: boolean;
  }>>({});
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [estimatedCreditCost, setEstimatedCreditCost] = useState<number | null>(null);
  const [isEstimatingCredits, setIsEstimatingCredits] = useState(false);
  const [dismissedFailureIds, setDismissedFailureIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLElement>>(new Map());
  const composerFileInputRef = useRef<HTMLInputElement>(null);
  const composerResizeOriginRef = useRef({ y: 0, height: 132 });
  const composerHeightRef = useRef(composerHeight);
  const keepLatestVisibleOnResizeRef = useRef(true);
  const initializedScriptRef = useRef<string | null>(null);
  composerHeightRef.current = composerHeight;
  const selectedModelOption = getScriptModelOption(aiModel, modelOptions);
  const selectedModelHint = selectedModelOption.hint.trim();
  const modelPickerOptions = useMemo(
    () => buildScriptModelPickerOptions(modelOptions),
    [modelOptions],
  );

  const versionByMessageId = useMemo(() => new Map(
    (conversation?.versions || [])
      .filter(version => version.messageId)
      .map(version => [version.messageId as string, version]),
  ), [conversation?.versions]);
  const orderedConversationMessages = useMemo(() => orderConversationMessages(
    conversation?.messages || [],
    conversation?.versions || [],
    selectedFile?.originalContent || '',
  ), [conversation?.messages, conversation?.versions, selectedFile?.originalContent]);
  const firstUserMessageId = useMemo(
    () => orderedConversationMessages.find(message => message.role === 'user')?.id,
    [orderedConversationMessages],
  );
  const initialScriptContent = useMemo(() => {
    const firstUserMessage = orderedConversationMessages.find(message => (
      message.role === 'user' && message.content.trim()
    ));
    return firstUserMessage?.content || selectedFile?.originalContent || '';
  }, [orderedConversationMessages, selectedFile?.originalContent]);
  const conversationTurns = useMemo(() => buildConversationTurns(
    orderedConversationMessages,
    conversation?.versions || [],
    selectedFile?.originalContent || '',
  ), [conversation?.versions, orderedConversationMessages, selectedFile?.originalContent]);
  const creditEstimateParams = useMemo(() => {
    if (!selectedFile) return null;
    const versions = conversation?.versions || [];
    const isFirstTurn = versions.length === 0;
    const currentVersion = conversation
      ? selectScriptIterationBaseVersion(conversation)
      : undefined;
    const conversationContext = conversation
      ? buildScriptVersionChainContext(conversation, currentVersion)
      : '';
    const billingInput = isFirstTurn
      ? `${draft}\n${draft}`
      : [currentVersion?.content || selectedFile.scriptContent || selectedFile.originalContent, draft, conversationContext].join('\n');
    const forecastOutputTokens = Math.max(
      1000,
      estimateTextTokens(currentVersion?.content || selectedFile.scriptContent || draft) * (isFirstTurn ? 3 : 1),
    );
    const model = getScriptModelBillingKey(getScriptModelOption(aiModel, modelOptions));
    return {
      input_tokens: estimateTextTokens(billingInput),
      output_tokens: forecastOutputTokens,
      model,
    };
  }, [aiModel, conversation?.currentVersionId, conversation?.versions, draft, modelOptions, orderedConversationMessages, selectedFile]);

  useEffect(() => {
    setCollapsed(new Set());
  }, [selectedFile?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!creditEstimateParams || isSending) {
      setEstimatedCreditCost(null);
      setIsEstimatingCredits(false);
      return undefined;
    }
    setIsEstimatingCredits(true);
    const timer = window.setTimeout(() => {
      void estimateCredits('script_model_call', creditEstimateParams)
        .then(result => {
          if (!cancelled) setEstimatedCreditCost(result.enabled ? result.estimated_cost : 0);
        })
        .catch(() => {
          if (!cancelled) setEstimatedCreditCost(null);
        })
        .finally(() => {
          if (!cancelled) setIsEstimatingCredits(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [creditEstimateParams, isSending]);

  useEffect(() => {
    if (!selectedFile) {
      setDraft('');
      initializedScriptRef.current = null;
      return;
    }
    const initialContent = selectedFile.originalContent || '';
    const hasHistory = (conversation?.messages?.length || 0) > 0;
    if (initializedScriptRef.current !== selectedFile.id) {
      initializedScriptRef.current = selectedFile.id;
      setDraft(hasHistory ? '' : initialContent);
      return;
    }
    if (hasHistory) {
      setDraft(current => current === initialContent ? '' : current);
    }
  }, [selectedFile?.id, selectedFile?.originalContent, conversation?.messages?.length]);

  const latestMessage = orderedConversationMessages[orderedConversationMessages.length - 1];

  const updateScrollControls = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    const nodeRect = node.getBoundingClientRect();
    const threshold = nodeRect.top + Math.min(180, node.clientHeight * 0.35);
    let visibleTurnId = conversationTurns[0]?.id || null;
    for (const turn of conversationTurns) {
      const element = messageRefs.current.get(turn.anchorMessageId);
      if (!element || element.getBoundingClientRect().top > threshold) break;
      visibleTurnId = turn.id;
    }
    if (node.scrollTop >= maxScrollTop - 4 && conversationTurns.length > 0) {
      visibleTurnId = conversationTurns[conversationTurns.length - 1].id;
    }
    setActiveTurnId(current => current === visibleTurnId ? current : visibleTurnId);
    setScrollControls({
      canScrollUp: node.scrollTop > 4,
      canScrollDown: node.scrollTop < maxScrollTop - 4,
    });

    const visibleTop = nodeRect.top + 28;
    const visibleBottom = nodeRect.bottom - composerHeightRef.current - 44;
    const nextMessageControls: Record<string, { canJumpTop: boolean; canJumpBottom: boolean }> = {};
    messageRefs.current.forEach((element, messageId) => {
      const rect = element.getBoundingClientRect();
      nextMessageControls[messageId] = {
        canJumpTop: rect.top < visibleTop - 36,
        canJumpBottom: rect.bottom > visibleBottom + 36,
      };
    });
    setMessageScrollControls(current => {
      const currentIds = Object.keys(current);
      const nextIds = Object.keys(nextMessageControls);
      const unchanged = currentIds.length === nextIds.length && nextIds.every(messageId => (
        current[messageId]?.canJumpTop === nextMessageControls[messageId].canJumpTop
        && current[messageId]?.canJumpBottom === nextMessageControls[messageId].canJumpBottom
      ));
      return unchanged ? current : nextMessageControls;
    });
  }, [conversationTurns]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
      updateScrollControls();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedFile?.id, latestMessage?.id, latestMessage?.content, latestMessage?.status, isSending, updateScrollControls]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !keepLatestVisibleOnResizeRef.current) return;
    node.scrollTop = node.scrollHeight;
    updateScrollControls();
  }, [composerHeight, updateScrollControls]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(updateScrollControls);
    return () => window.cancelAnimationFrame(frame);
  }, [collapsed, conversation?.messages?.length, selectedFile?.id, updateScrollControls]);

  const scrollConversationTo = (position: 'top' | 'bottom') => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({
      top: position === 'top' ? 0 : node.scrollHeight,
      behavior: 'smooth',
    });
  };

  const scrollToTurn = (turn: ConversationTurn) => {
    const node = scrollRef.current;
    const target = messageRefs.current.get(turn.anchorMessageId);
    if (!node || !target) return;
    const top = node.scrollTop + target.getBoundingClientRect().top - node.getBoundingClientRect().top - 12;
    setActiveTurnId(turn.id);
    node.scrollTo({ top, behavior: 'smooth' });
  };

  const scrollMessageBoundary = (messageId: string, boundary: 'top' | 'bottom') => {
    const node = scrollRef.current;
    const target = messageRefs.current.get(messageId);
    if (!node || !target) return;

    const nodeRect = node.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetTop = node.scrollTop + targetRect.top - nodeRect.top;
    const composerReserve = composerHeight + 48;
    const top = boundary === 'top'
      ? targetTop - 12
      : targetTop + target.offsetHeight - node.clientHeight + composerReserve;

    node.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  useEffect(() => {
    if (!isResizingComposer) return;
    const handlePointerMove = (event: PointerEvent) => {
      const delta = composerResizeOriginRef.current.y - event.clientY;
      setComposerHeight(Math.min(360, Math.max(112, composerResizeOriginRef.current.height + delta)));
    };
    const handlePointerUp = () => setIsResizingComposer(false);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isResizingComposer]);

  const submit = async (): Promise<boolean> => {
    const content = draft.trim();
    if (!content || isSending || !selectedFile) return false;
    setDraft('');
    try {
      await onSend(content);
      return true;
    } catch {
      setDraft(content);
      return false;
    }
  };

  const handleComposerFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = loadEvent => {
      const text = loadEvent.target?.result;
      if (typeof text === 'string') setDraft(text);
    };
    reader.onerror = () => window.alert('读取文本文件失败，请确认文件格式后重试。');
    reader.readAsText(file);
  };

  const setMessageCollapsed = (key: string, shouldCollapse: boolean) => {
    setCollapsed(current => setCollapsedEntry(current, key, shouldCollapse));
  };

  const openEditor = (version: ScriptStoryboardVersion) => {
    setEditingVersion(version);
    setEditValue(version.content);
    setIsReferenceScriptCollapsed(false);
    setIsReferenceScriptOnLeft(true);
  };

  const saveEdit = async () => {
    if (!editingVersion || !editValue.trim()) return;
    setIsSavingEdit(true);
    try {
      await onEditVersion(editingVersion, editValue.trim());
      setEditingVersion(null);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const renderMessage = (message: ScriptConversationMessage) => {
    const version = versionByMessageId.get(message.id);
    const isAssistant = message.role === 'assistant';
    const collapseKey = version
      ? `${selectedFile?.id || 'file'}:version:${version.id}`
      : `${selectedFile?.id || 'file'}:message:${message.id}`;
    const isCollapsed = collapsed.has(collapseKey);
    const canCollapse = (version?.content || message.content).length > 240;
    const creditCost = Number(message.metadata?.creditCost || 0);
    const failureMessage = String(message.metadata?.error || '生成未完成，请重新发送');
    const creditCharged = message.metadata?.creditCharged === true;
    const versionSegmentCount = version ? buildStoryboardSegmentGroups(version.storyboardItems || []).length : 0;
    const messageModelLabel = isAssistant
      ? formatScriptModelHistoryLabel(message.modelName, message.modelAlias, modelOptions)
      : '';
    const messageControls = messageScrollControls[message.id] || {
      canJumpTop: false,
      canJumpBottom: false,
    };
    return (
      <article
        key={message.id}
        ref={element => {
          if (element) messageRefs.current.set(message.id, element);
          else messageRefs.current.delete(message.id);
        }}
        className={`w-full scroll-mt-4 rounded-lg border border-n40 px-4 py-5 shadow-sm ${isAssistant ? 'bg-n0' : 'bg-n20'}`}
      >
        <div className="flex items-start gap-3">
          <div className="flex w-7 flex-shrink-0 self-stretch flex-col items-center">
            <div className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded ${isAssistant ? 'bg-primary text-white' : 'border border-n40 bg-n0 text-n500'}`}>
              {isAssistant ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex min-h-6 flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-n800">
                {isAssistant ? '分镜脚本' : message.id === firstUserMessageId ? '输入文字剧本' : '修改要求'}
              </span>
              {isAssistant && messageModelLabel && (
                <span className="rounded border border-n40 bg-n20 px-1.5 py-0.5 text-[10px] text-n300">
                  {messageModelLabel}
                </span>
              )}
              {version && (
                <span className="rounded border border-primary/30 bg-primary-light px-1.5 py-0.5 text-[10px] text-primary">
                  V{version.versionNo} · {versionSegmentCount} 个分段 · {version.storyboardItems.length} 个分镜
                </span>
              )}
              {version && isWorkflowScript && conversation?.currentVersionId === version.id && (
                <span className="inline-flex items-center gap-1 rounded border border-success/30 bg-success-light px-1.5 py-0.5 text-[10px] font-medium text-success">
                  <Check className="h-3 w-3" /> 本集采用
                </span>
              )}
              {version?.status === 'draft' && (
                <span className="rounded border border-warning/30 bg-warning-light px-1.5 py-0.5 text-[10px] font-medium text-warning">待确认</span>
              )}
              {version?.status === 'rejected' && (
                <span className="rounded border border-n40 bg-n20 px-1.5 py-0.5 text-[10px] text-n300">已拒绝</span>
              )}
              {message.status === 'streaming' && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />}
              {message.status === 'failed' && <span className="text-[10px] text-danger">生成失败</span>}
              <span className="ml-auto flex items-center gap-2">
                {canCollapse && (
                  <button
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      setMessageCollapsed(collapseKey, !isCollapsed);
                    }}
                    aria-expanded={!isCollapsed}
                    aria-controls={`script-message-content-${message.id}`}
                    data-testid={`script-message-collapse-top-${message.id}`}
                    className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] text-n300 hover:bg-n20 hover:text-primary"
                  >
                    {isCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                    {isCollapsed ? '展开内容' : '折叠内容'}
                  </button>
                )}
                <span className="text-[10px] text-n100">{message.metadata?.sourceReference ? '原始文件内容' : formatTime(message.createdAt)}</span>
              </span>
            </div>
            {version?.status === 'draft' && <ScriptPatchPreview version={version} />}
            <div
              id={`script-message-content-${message.id}`}
              data-testid={`script-message-content-${message.id}`}
              className={`whitespace-pre-wrap break-words text-sm leading-7 text-n700 ${isCollapsed ? 'max-h-28 overflow-hidden' : ''}`}
            >
              {version && message.status === 'completed'
                ? <StoryboardVersionBody version={version} />
                : message.content || (message.status === 'streaming' ? '正在生成分镜脚本…' : message.status === 'failed' ? failureMessage : '')}
            </div>
            {message.status === 'failed' && !dismissedFailureIds.has(message.id) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-danger/20 bg-danger-light px-3 py-2 text-xs text-danger">
                <span>{failureMessage}</span>
                <span className="ml-auto font-medium">
                  {creditCharged ? `已扣除 ${creditCost} 创作点数` : '本次未扣创作点数'}
                </span>
                <button
                  type="button"
                  onClick={() => setDismissedFailureIds(current => new Set(current).add(message.id))}
                  title="关闭错误提示"
                  aria-label="关闭错误提示"
                  className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-danger/10"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {canCollapse && (
              <button
                type="button"
                onClick={event => {
                  event.stopPropagation();
                  setMessageCollapsed(collapseKey, !isCollapsed);
                }}
                aria-expanded={!isCollapsed}
                aria-controls={`script-message-content-${message.id}`}
                data-testid={`script-message-collapse-bottom-${message.id}`}
                className="mt-2 inline-flex h-7 items-center gap-1 text-xs text-primary hover:text-primary-hover"
              >
                {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                {isCollapsed ? '展开完整内容' : '收起内容'}
              </button>
            )}
            {isAssistant && version?.status === 'draft' && message.status === 'completed' && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-warning/20 pt-3">
                <button
                  type="button"
                  onClick={() => onConfirmVersion(version)}
                  disabled={isSending}
                  className="inline-flex h-8 items-center gap-1.5 rounded bg-success px-3 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {isSending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  确认并采用修改
                </button>
                <button
                  type="button"
                  onClick={() => onRejectVersion(version)}
                  disabled={isSending}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-danger/30 bg-n0 px-3 text-xs text-danger hover:bg-danger-light disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" /> 拒绝本次修改
                </button>
                <span className="text-[10px] text-n100">确认前不会覆盖当前正式剧本，也不会触发下游重新生成</span>
              </div>
            )}
            {isAssistant && version?.status === 'ready' && message.status === 'completed' && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-n40 pt-3">
                <button
                  type="button"
                  onClick={() => onGenerateDesign(version)}
                  disabled={isSending}
                  className="inline-flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-xs font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSending
                    ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    : <PanelRightOpen className="h-3.5 w-3.5" />}
                  {isSending ? '处理中…' : '生成镜头设计'}
                </button>
                <button
                  type="button"
                  onClick={() => openEditor(version)}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-n40 bg-n0 px-3 text-xs text-n700 hover:border-primary hover:text-primary"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  编辑分镜脚本
                </button>
                <button
                  type="button"
                  onClick={() => onExportVersion(version)}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-n40 bg-n0 px-3 text-xs text-n700 hover:border-primary hover:text-primary"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出 Excel
                </button>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(version.content)}
                  title="复制分镜脚本"
                  aria-label="复制分镜脚本"
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-n40 bg-n0 text-n300 hover:border-primary hover:text-primary"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <span className="ml-auto inline-flex items-center gap-3">
                  {Number.isFinite(creditCost) && creditCost > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warning" title="本轮模型调用实际扣除创作点数">
                      <Coins className="h-3.5 w-3.5" /> 本次消耗 {creditCost} 创作点数
                    </span>
                  )}
                  {conversation?.currentVersionId === version.id && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-success">
                      <Check className="h-3.5 w-3.5" /> {isWorkflowScript ? '当前采用版本' : '当前版本'}
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
          {isAssistant && version && canCollapse && !isCollapsed && (
            <div
              className="flex w-9 flex-shrink-0 self-stretch flex-col items-center"
              data-testid={`script-card-scroll-controls-${message.id}`}
            >
              <div className={`sticky top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1 rounded-full border border-n40 bg-n0 p-1 shadow-md transition-opacity duration-200 ${messageControls.canJumpTop || messageControls.canJumpBottom ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                <button
                  type="button"
                  onClick={() => scrollMessageBoundary(message.id, 'top')}
                  title="跳到本卡片顶部"
                  aria-label="跳到本卡片顶部"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-n400 transition-all duration-200 hover:bg-primary-light hover:text-primary ${messageControls.canJumpTop ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0'}`}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollMessageBoundary(message.id, 'bottom')}
                  title="跳到本卡片底部"
                  aria-label="跳到本卡片底部"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-n400 transition-all duration-200 hover:bg-primary-light hover:text-primary ${messageControls.canJumpBottom ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0'}`}
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </article>
    );
  };

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-n20" data-testid="script-conversation-pane">
      <header className="relative flex h-11 flex-shrink-0 items-center gap-3 border-b border-n40 bg-n0 px-4">
        <FileText className="h-4 w-4 flex-shrink-0 text-primary" />
        <div className="max-w-[32%] truncate text-sm font-semibold text-n800">{selectedFile?.name || '请选择剧本任务'}</div>
        {workspaceMode && onWorkspaceModeChange && (
          <div
            className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
            data-testid="script-workspace-mode-switch-anchor"
          >
            <ScriptWorkspaceModeSwitch
              mode={workspaceMode}
              onChange={onWorkspaceModeChange}
            />
          </div>
        )}
        {isLoading && conversation && (
          <span className="ml-auto inline-flex flex-shrink-0 items-center gap-1 text-[10px] text-n300" title="正在后台同步最新对话">
            <LoaderCircle className="h-3 w-3 animate-spin text-primary" /> 后台同步
          </span>
        )}
        <button
          type="button"
          onClick={onOpenStoryboard}
          disabled={!selectedFile || storyboardItemCount === 0}
          className={`${isLoading && conversation ? '' : 'ml-auto'} inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded border border-primary bg-primary-light px-3 text-xs font-medium text-primary hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:border-n40 disabled:bg-n20 disabled:text-n100`}
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
          展开镜头设计{storyboardItemCount > 0 ? ` (${storyboardItemCount})` : ''}
        </button>
      </header>

      <div
        ref={scrollRef}
        onScroll={updateScrollControls}
        className="min-h-0 flex-1 overflow-y-auto custom-scrollbar"
      >
        {!selectedFile ? (
          <div className="flex h-full items-center justify-center text-sm text-n100">请从左侧选择一个剧本任务</div>
        ) : isLoading && !conversation ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-n300">
            <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> 正在加载对话
          </div>
        ) : (conversation?.messages || []).length > 0 ? (
          <div className="mx-auto grid w-full max-w-[1680px] grid-cols-1 gap-3 px-3 py-4 lg:grid-cols-[172px_minmax(0,1fr)_172px] xl:grid-cols-[196px_minmax(0,1fr)_196px]">
            <aside className="hidden min-w-0 lg:block" data-testid="conversation-turn-rail">
              <div className="sticky top-4 border-r border-n40 pr-3">
                <div className="mb-2 flex h-7 min-w-0 items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                  <span className="flex-shrink-0 whitespace-nowrap text-[11px] font-semibold text-n700">对话轮次</span>
                  <span className="flex-shrink-0 whitespace-nowrap text-[10px] tabular-nums text-n100">{conversationTurns.length}</span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => scrollConversationTo('top')}
                    disabled={!scrollControls.canScrollUp}
                    title="回到对话顶部"
                    aria-label="回到对话顶部"
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-n300 hover:bg-n0 hover:text-primary disabled:cursor-default disabled:text-n50"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollConversationTo('bottom')}
                    disabled={!scrollControls.canScrollDown}
                    title="前往最新对话"
                    aria-label="前往最新对话"
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-n300 hover:bg-n0 hover:text-primary disabled:cursor-default disabled:text-n50"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <nav className="max-h-[calc(100vh-250px)] space-y-1 overflow-y-auto pr-1 custom-scrollbar" aria-label="对话轮次快速导航">
                  {conversationTurns.map(turn => (
                    <button
                      key={turn.id}
                      type="button"
                      onClick={() => scrollToTurn(turn)}
                      title={turn.preview}
                      className={`w-full rounded px-2 py-2 text-left transition-colors ${activeTurnId === turn.id ? 'bg-n0 text-primary shadow-sm' : 'text-n300 hover:bg-n0 hover:text-n700'}`}
                    >
                      <span className="flex items-center gap-1.5 text-[10px] font-semibold">
                        <span>{turn.isInitial ? '初始剧本' : `第 ${turn.number} 轮`}</span>
                        {turn.versionNo && <span className="rounded bg-primary-light px-1 py-0.5 text-[9px] text-primary">V{turn.versionNo}</span>}
                      </span>
                      <span className="mt-1 block truncate text-[10px] leading-4 text-n100">{turn.preview}</span>
                    </button>
                  ))}
                </nav>
              </div>
            </aside>

            <main className="min-w-0 space-y-3">{orderedConversationMessages.map(renderMessage)}</main>

            <aside className="hidden min-w-0 lg:block" data-testid="conversation-summary-rail">
              <div className="sticky top-4 border-l border-n40 pl-3">
                <div className="mb-3 text-[11px] font-semibold text-n700">当前任务</div>
                <dl className="space-y-3">
                  <div className="flex items-start gap-2">
                    <MessageSquare className="mt-0.5 h-3.5 w-3.5 text-n300" />
                    <div><dt className="text-[10px] text-n100">对话数量</dt><dd className="text-xs font-medium tabular-nums text-n700">{conversation!.messages.length} 条 · {conversationTurns.length} 轮</dd></div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Layers3 className="mt-0.5 h-3.5 w-3.5 text-n300" />
                    <div><dt className="text-[10px] text-n100">分镜版本</dt><dd className="text-xs font-medium tabular-nums text-n700">{conversation!.versions.length} 个</dd></div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Film className={`mt-0.5 h-3.5 w-3.5 ${storyboardItemCount > 0 ? 'text-success' : 'text-n100'}`} />
                    <div>
                      <dt className="text-[10px] text-n100">镜头设计</dt>
                      <dd className={`text-xs font-medium ${storyboardItemCount > 0 ? 'text-success' : 'text-n300'}`}>
                        {storyboardItemCount > 0 ? `已生成 · ${storyboardItemCount} 个镜头` : '尚未生成'}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <History className="mt-0.5 h-3.5 w-3.5 text-n300" />
                    <div><dt className="text-[10px] text-n100">镜头设计历史</dt><dd className="text-xs font-medium tabular-nums text-n700">{selectedFile?.versions?.length || 0} 个存档</dd></div>
                  </div>
                </dl>
              </div>
            </aside>
          </div>
        ) : (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center px-8 text-center">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded border border-n40 bg-n0 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold text-n800">开始生成分镜脚本</h3>
            <p className="mt-2 text-xs leading-6 text-n300">在下方输入剧本文本。生成后可继续发送修改意见，每次回复都会保留为独立版本。</p>
            <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-warning">
              <Coins className="h-3.5 w-3.5" /> 每次生成都会扣除一定数量的创作点数
            </p>
          </div>
        )}
        <div
          aria-hidden="true"
          data-testid="conversation-composer-spacer"
          className="pointer-events-none w-full flex-shrink-0"
          style={{ height: composerHeight + 36 }}
        />
      </div>

      {scrollControls.canScrollDown && (
        <div
          data-testid="conversation-jump-to-latest-anchor"
          className="pointer-events-none absolute inset-x-0 z-40"
          style={{ bottom: composerHeight + 28 }}
        >
          <div className="mx-auto grid w-full max-w-[1680px] grid-cols-1 gap-3 px-3 lg:grid-cols-[172px_minmax(0,1fr)_172px] xl:grid-cols-[196px_minmax(0,1fr)_196px]">
            <div className="flex min-w-0 justify-center lg:col-start-2">
              <button
                type="button"
                data-testid="conversation-jump-to-latest"
                onClick={() => scrollConversationTo('bottom')}
                title="前往最新对话"
                aria-label="前往最新对话"
                className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-n40 bg-n0 text-n500 shadow-bottom hover:border-primary hover:text-primary"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30" data-testid="floating-conversation-composer">
        <div
          className="mx-auto grid w-full max-w-[1680px] grid-cols-1 gap-3 px-3 lg:grid-cols-[172px_minmax(0,1fr)_172px] xl:grid-cols-[196px_minmax(0,1fr)_196px]"
          data-testid="conversation-composer-grid"
        >
          <div className="min-w-0 lg:col-start-2">
            {isSending && (
              <div
                role="status"
                aria-live="polite"
                data-testid="script-generation-status"
                className="pointer-events-auto mb-2 flex w-full items-center gap-2 rounded border border-primary/25 bg-primary-light px-3 py-2 text-xs font-medium text-primary shadow-sm"
              >
                <LoaderCircle className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
                正在校验创作点数并生成分镜脚本，完成后会自动显示在对话中…
              </div>
            )}
            {error && (
              <div className="pointer-events-auto mb-2 flex w-full items-center gap-3 rounded border border-danger/30 bg-r50 px-3 py-2 text-xs text-danger shadow-sm">
                <span className="min-w-0 flex-1">{error}</span>
                <button
                  type="button"
                  onClick={onDismissError}
                  title="关闭错误提示"
                  aria-label="关闭错误提示"
                  className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded hover:bg-danger/10"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div
              className="pointer-events-auto relative flex w-full flex-col overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-[0_18px_55px_rgba(15,23,42,0.16)] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10"
              style={{ height: composerHeight }}
            >
          <button
            type="button"
            data-testid="composer-fullscreen-button"
            onClick={() => setIsComposerFullscreen(true)}
            disabled={!selectedFile || isSending}
            title="全屏输入文字剧本或修改要求"
            aria-label="全屏输入剧本"
            className="absolute right-12 top-2 z-10 inline-flex h-6 w-8 items-center justify-center rounded text-n100 hover:bg-n20 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="composer-resize-handle"
            onPointerDown={event => {
              event.preventDefault();
              const scrollNode = scrollRef.current;
              keepLatestVisibleOnResizeRef.current = !scrollNode
                || scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight < 48;
              composerResizeOriginRef.current = { y: event.clientY, height: composerHeight };
              setIsResizingComposer(true);
            }}
            title="向上或向下拖动调整输入框高度"
            aria-label="调整输入框高度"
            className="absolute right-3 top-2 z-10 inline-flex h-6 w-8 cursor-ns-resize items-center justify-center rounded text-n100 hover:bg-n20 hover:text-primary"
          >
            <GripHorizontal className="h-4 w-4" />
          </button>
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            disabled={!selectedFile || isSending}
            rows={2}
            placeholder={(conversation?.messages || []).length > 0 ? '继续输入修改意见…' : '输入文字剧本…'}
            className="min-h-0 flex-1 resize-none bg-transparent px-4 pb-2 pt-4 pr-20 text-sm leading-6 text-n800 outline-none placeholder:text-n100 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex min-h-11 items-center gap-2 px-3 py-2">
            <input
              ref={composerFileInputRef}
              type="file"
              className="hidden"
              accept=".txt,.md,.json"
              onChange={handleComposerFileUpload}
            />
            <button
              type="button"
              onClick={() => composerFileInputRef.current?.click()}
              disabled={!selectedFile || isSending}
              title="上传文本到输入框"
              aria-label="上传文本到输入框"
              className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded text-n300 hover:bg-n20 hover:text-primary disabled:cursor-not-allowed disabled:text-n100"
            >
              <Upload className="h-4 w-4" />
            </button>
            <span
              className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-warning"
              title="根据当前输入、历史上下文、预计输出和所选模型动态计算"
            >
              <Coins className="h-3.5 w-3.5" />
              预计消耗创作点数：{isEstimatingCredits ? '计算中…' : (estimatedCreditCost ?? '--')}
            </span>
            <div className="ml-auto flex min-w-0 items-center gap-2">
              {selectedModelHint && (
                <span
                  className="flex-shrink-0 whitespace-nowrap text-[11px] font-medium text-n300"
                  data-testid="script-model-hint"
                >
                  {selectedModelHint}
                </span>
              )}
              <ModelPicker
                value={aiModel}
                options={modelPickerOptions}
                onChange={onChangeModel}
                disabled={isSending}
                compact
                className="w-[240px] max-w-[40vw]"
                ariaLabel="选择剧本模型"
                title="剧本模型"
                kind="text"
              />
            </div>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!selectedFile || !draft.trim() || isSending}
              title={isSending ? '正在生成分镜脚本' : '发送'}
              aria-label="发送"
              aria-busy={isSending}
              className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-n800 text-white hover:bg-n700 disabled:cursor-not-allowed disabled:bg-n100"
            >
              {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
            </div>
          </div>
        </div>
      </div>

      {isComposerFullscreen && (
        <div
          data-testid="fullscreen-script-composer"
          className="fixed inset-0 z-[120] flex flex-col bg-n0"
        >
          <div className="flex h-14 flex-shrink-0 items-center border-b border-n40 px-5">
            <div>
              <h2 className="text-sm font-semibold text-n800">
                {(conversation?.messages || []).length > 0 ? '全屏输入修改要求' : '全屏输入文字剧本'}
              </h2>
              <p className="mt-0.5 text-xs text-n200">内容与底部对话框实时同步，关闭后不会丢失。</p>
            </div>
            <button
              type="button"
              onClick={() => setIsComposerFullscreen(false)}
              title="退出全屏输入"
              aria-label="退出全屏输入"
              className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded hover:bg-n20"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 p-5">
            <textarea
              autoFocus
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void submit().then(sent => {
                    if (sent) setIsComposerFullscreen(false);
                  });
                }
              }}
              disabled={!selectedFile || isSending}
              placeholder={(conversation?.messages || []).length > 0 ? '继续输入修改意见…' : '输入文字剧本…'}
              className="h-full w-full resize-none rounded-lg border border-n40 bg-n0 p-5 text-sm leading-7 text-n800 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
          <div className="flex min-h-16 flex-shrink-0 items-center gap-3 border-t border-n40 px-5 py-3">
            <button
              type="button"
              onClick={() => composerFileInputRef.current?.click()}
              disabled={!selectedFile || isSending}
              title="上传文本到输入框"
              className="inline-flex h-9 items-center gap-2 rounded border border-n40 px-3 text-sm text-n500 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Upload className="h-4 w-4" />
              上传文本
            </button>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
              <Coins className="h-3.5 w-3.5" />
              预计消耗创作点数：{isEstimatingCredits ? '计算中…' : (estimatedCreditCost ?? '--')}
            </span>
            <div className="ml-auto flex min-w-0 items-center gap-2">
              {selectedModelHint && (
                <span className="flex-shrink-0 whitespace-nowrap text-xs font-medium text-n300">
                  {selectedModelHint}
                </span>
              )}
              <ModelPicker
                value={aiModel}
                options={modelPickerOptions}
                onChange={onChangeModel}
                disabled={isSending}
                fullWidth
                className="w-[260px] max-w-[50vw]"
                ariaLabel="选择剧本模型"
                title="剧本模型"
                kind="text"
              />
            </div>
            <button
              type="button"
              onClick={() => setIsComposerFullscreen(false)}
              className="h-9 rounded border border-n40 px-4 text-sm text-n500 hover:bg-n20"
            >
              完成输入
            </button>
            <button
              type="button"
              onClick={() => {
                void submit().then(sent => {
                  if (sent) setIsComposerFullscreen(false);
                });
              }}
              disabled={!selectedFile || !draft.trim() || isSending}
              className="inline-flex h-9 items-center gap-2 rounded bg-primary px-4 text-sm text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-n100"
            >
              {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              发送
            </button>
          </div>
        </div>
      )}

      {editingVersion && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-n900/45 p-3 sm:p-5">
          <div className="flex h-full w-full max-w-[1680px] flex-col rounded-md border border-n40 bg-n0 shadow-bottom">
            <div className="flex h-12 flex-shrink-0 items-center border-b border-n40 px-4">
              <div>
                <div className="text-sm font-semibold text-n800">编辑分镜脚本</div>
                <div className="text-[10px] text-n100">保存后创建新版本，历史回复不会被覆盖</div>
              </div>
              <button
                type="button"
                onClick={() => setIsReferenceScriptCollapsed(current => !current)}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded border border-n40 bg-n0 px-3 text-xs text-n700 hover:border-primary hover:text-primary"
                aria-label={isReferenceScriptCollapsed ? '展开文字剧本对照' : '收起文字剧本对照'}
              >
                {isReferenceScriptCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
                {isReferenceScriptCollapsed ? '展开文字剧本' : '收起文字剧本'}
              </button>
              <button
                type="button"
                onClick={() => setIsReferenceScriptOnLeft(current => !current)}
                disabled={isReferenceScriptCollapsed}
                className="ml-2 inline-flex h-8 items-center gap-1.5 rounded border border-n40 bg-n0 px-3 text-xs text-n700 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="交换文字剧本与分镜脚本的左右位置"
                title={isReferenceScriptCollapsed ? '请先展开文字剧本对照' : '交换左右位置'}
              >
                <ArrowLeftRight className="h-4 w-4" />
                交换左右
              </button>
              <button type="button" onClick={() => setEditingVersion(null)} className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded text-n300 hover:bg-n20 hover:text-n800" aria-label="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className={`grid min-h-0 flex-1 gap-px overflow-hidden bg-n40 ${isReferenceScriptCollapsed ? 'grid-cols-1 grid-rows-1' : 'grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1'}`}>
              <section className={`flex min-h-0 min-w-0 flex-col bg-n0 ${
                isReferenceScriptCollapsed || !isReferenceScriptOnLeft ? 'order-1' : 'order-2'
              }`}>
                <div className="flex h-10 flex-shrink-0 items-center border-b border-n40 px-5 text-xs font-semibold text-n700">
                  分镜脚本（可编辑）
                </div>
                <textarea
                  value={editValue}
                  onChange={event => setEditValue(event.target.value)}
                  className="font-document min-h-0 flex-1 resize-none bg-n0 p-5 text-sm leading-7 text-n800 outline-none"
                  aria-label="编辑分镜脚本内容"
                />
              </section>
              {!isReferenceScriptCollapsed && (
                <aside className={`flex min-h-0 min-w-0 flex-col bg-n20 ${
                  isReferenceScriptOnLeft ? 'order-1' : 'order-2'
                }`}>
                  <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-n40 px-5">
                    <span className="text-xs font-semibold text-n700">文字剧本（对照）</span>
                    <span className="text-[10px] text-n100">最初输入 · 只读</span>
                  </div>
                  <div className="font-document min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-5 text-sm leading-7 text-n700 custom-scrollbar">
                    {initialScriptContent || '暂无最初输入的文字剧本'}
                  </div>
                </aside>
              )}
            </div>
            <div className="flex h-14 flex-shrink-0 items-center justify-end gap-2 border-t border-n40 px-4">
              <button type="button" onClick={() => setEditingVersion(null)} className="h-8 rounded border border-n40 px-4 text-xs text-n700 hover:bg-n20">取消</button>
              <button type="button" onClick={() => void saveEdit()} disabled={isSavingEdit || !editValue.trim()} className="inline-flex h-8 items-center gap-1.5 rounded bg-primary px-4 text-xs text-white hover:bg-primary-hover disabled:opacity-50">
                {isSavingEdit && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />} 保存为新版本
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
