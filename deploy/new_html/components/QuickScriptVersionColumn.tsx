import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Edit2, FileText, LoaderCircle, Save, Sparkles, X } from 'lucide-react';
import type { ProjectFile, ScriptStoryboardVersion, StoryboardItem } from '../types';
import { StoryboardScriptColumn } from './StoryboardScriptColumn';
import { formatScriptModelHistoryLabel } from '../services/scriptModelCatalogService';

interface QuickScriptVersionColumnProps {
  selectedFile: ProjectFile | undefined;
  version: ScriptStoryboardVersion | undefined;
  versions?: ScriptStoryboardVersion[];
  currentVersionId?: string;
  designItems?: StoryboardItem[];
  isSending: boolean;
  error: string | null;
  highlightedItemIds: Set<string>;
  onDismissError: () => void;
  onSelectItemIds: (selectedIds: Set<string>) => void;
  onSelectVersion?: (versionId: string) => void;
  onEditVersion: (version: ScriptStoryboardVersion, content: string) => Promise<void>;
  onGenerateDesign: (version: ScriptStoryboardVersion) => Promise<void>;
  onExportVersion: (version: ScriptStoryboardVersion) => void;
}

export const QuickScriptVersionColumn: React.FC<QuickScriptVersionColumnProps> = ({
  selectedFile,
  version,
  versions = [],
  currentVersionId,
  designItems = [],
  isSending,
  error,
  highlightedItemIds,
  onDismissError,
  onSelectItemIds,
  onSelectVersion,
  onEditVersion,
  onGenerateDesign,
  onExportVersion,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setIsEditing(false);
    setDraft(version?.content || '');
    setSaveError('');
  }, [version?.id]);

  const versionFile = useMemo<ProjectFile | undefined>(() => {
    if (!selectedFile || !version) return undefined;
    return {
      ...selectedFile,
      scriptContent: version.content,
      storyboard: { items: version.storyboardItems },
    };
  }, [selectedFile, version]);
  const availableVersions = useMemo(() => {
    const byId = new Map<string, ScriptStoryboardVersion>();
    versions.forEach(item => byId.set(item.id, item));
    if (version) byId.set(version.id, version);
    return Array.from(byId.values()).sort((a, b) => a.versionNo - b.versionNo);
  }, [version, versions]);

  const scriptItems = version?.storyboardItems || [];
  const splitStage = selectedFile?.generationStages?.split;
  const videoScriptStage = selectedFile?.generationStages?.videoScript;
  const pendingStage = videoScriptStage?.status === 'running' ? videoScriptStage : splitStage?.status === 'running' ? splitStage : undefined;
  const pendingLabel = videoScriptStage?.status === 'running'
    ? '正在生成分镜脚本'
    : splitStage?.status === 'running'
      ? '正在拆分剧本'
      : '等待分镜脚本生成';
  const versionModelLabel = formatScriptModelHistoryLabel(version?.modelName, version?.modelAlias);
  const normalizedText = (value?: string | null) => String(value || '').replace(/\s+/g, '').trim();
  const getSourceKey = (item: StoryboardItem): string => (
    String(item.sourceVideoShotNo || item.shotNumber || '').trim()
  );
  const findScriptItemsForDesign = useCallback((designItem: StoryboardItem) => {
    const sourceKey = getSourceKey(designItem);
    const sourceBlock = normalizedText(designItem.videoScriptBlock);
    return scriptItems.filter(scriptItem => (
      (sourceKey && getSourceKey(scriptItem) === sourceKey)
      || (sourceBlock && normalizedText(scriptItem.videoScriptBlock || scriptItem.originalText) === sourceBlock)
    ));
  }, [scriptItems]);
  const findDesignItemsForScript = useCallback((scriptItem: StoryboardItem) => {
    const sourceKey = getSourceKey(scriptItem);
    const sourceBlock = normalizedText(scriptItem.videoScriptBlock || scriptItem.originalText);
    return designItems.filter(designItem => (
      (sourceKey && getSourceKey(designItem) === sourceKey)
      || (sourceBlock && normalizedText(designItem.videoScriptBlock) === sourceBlock)
    ));
  }, [designItems]);
  const highlightedScriptItemIds = useMemo(() => {
    const mapped = new Set<string>();
    designItems
      .filter(item => highlightedItemIds.has(item.id))
      .forEach(designItem => {
        findScriptItemsForDesign(designItem).forEach(scriptItem => mapped.add(scriptItem.id));
      });
    return mapped.size > 0 ? mapped : highlightedItemIds;
  }, [designItems, findScriptItemsForDesign, highlightedItemIds]);
  const handleSelectScriptItems = useCallback((selectedIds: Set<string>) => {
    const mapped = new Set<string>();
    scriptItems
      .filter(item => selectedIds.has(item.id))
      .forEach(scriptItem => {
        findDesignItemsForScript(scriptItem).forEach(designItem => mapped.add(designItem.id));
      });
    onSelectItemIds(mapped.size > 0 ? mapped : selectedIds);
  }, [findDesignItemsForScript, onSelectItemIds, scriptItems]);

  const save = async () => {
    if (!version || !draft.trim() || isSaving) return;
    setIsSaving(true);
    setSaveError('');
    try {
      await onEditVersion(version, draft);
      setIsEditing(false);
    } catch (saveRequestError) {
      setSaveError(saveRequestError instanceof Error ? saveRequestError.message : '保存失败，请稍后重试');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-n0"
      data-testid="quick-script-version-column"
    >
      <header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-n40/70 px-4">
        <FileText className="h-4 w-4 flex-shrink-0 text-primary" />
        <h2 className="whitespace-nowrap text-sm font-semibold text-n700">3. 分镜脚本</h2>
        {version && availableVersions.length > 1 && onSelectVersion ? (
          <label className="relative">
            <span className="sr-only">选择分镜脚本版本</span>
            <select
              value={currentVersionId || version.id}
              onChange={event => onSelectVersion(event.target.value)}
              disabled={isSending || isSaving}
              className="h-7 rounded border border-primary/30 bg-primary-light px-2 text-[10px] font-semibold text-primary outline-none hover:border-primary disabled:opacity-40"
              aria-label="选择分镜脚本版本"
            >
              {availableVersions.map(item => (
                <option key={item.id} value={item.id}>
                  V{item.versionNo}
                </option>
              ))}
            </select>
          </label>
        ) : version && (
          <span className="rounded bg-primary-light px-2 py-1 text-[10px] font-semibold text-primary">
            V{version.versionNo}
          </span>
        )}
        <span
          className="ml-auto max-w-[150px] truncate text-[10px] text-n200"
          title={versionModelLabel}
        >
          {versionModelLabel}
        </span>
      </header>

      <div className="mx-3 mb-2 mt-3 flex min-h-[48px] flex-shrink-0 items-center gap-1.5 rounded-md bg-n20/70 px-2.5 py-2">
        {version ? (
          <>
            <button
              type="button"
              onClick={() => {
                setDraft(version.content);
                setIsEditing(current => !current);
                setSaveError('');
              }}
              disabled={isSending || isSaving}
              className={`inline-flex h-8 items-center gap-1 rounded border px-2 text-[11px] font-medium ${
                isEditing
                  ? 'border-n40 text-n400 hover:bg-n20'
                  : 'border-primary text-primary hover:bg-primary-light'
              } disabled:opacity-40`}
            >
              {isEditing ? <X className="h-3.5 w-3.5" /> : <Edit2 className="h-3.5 w-3.5" />}
              {isEditing ? '取消编辑' : '编辑'}
            </button>
            {isEditing && (
              <button
                type="button"
                onClick={() => void save()}
                disabled={!draft.trim() || isSaving}
                className="inline-flex h-8 items-center gap-1 rounded bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary-hover disabled:opacity-40"
              >
                {isSaving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                保存为新版
              </button>
            )}
            <button
              type="button"
              onClick={() => onExportVersion(version)}
              disabled={isSending || isSaving}
              className="inline-flex h-8 items-center gap-1 rounded border border-n40 px-2 text-[11px] font-medium text-n400 hover:border-success hover:text-success disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              导出
            </button>
            <button
              type="button"
              onClick={() => void onGenerateDesign(version)}
              disabled={isSending || isSaving}
              className="ml-auto inline-flex h-8 items-center gap-1 rounded bg-n800 px-2 text-[11px] font-semibold text-white hover:bg-n700 disabled:bg-n100"
            >
              {isSending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              生成镜头设计
            </button>
          </>
        ) : (
          <div className="flex w-full items-center justify-center">
            <div
              className={`inline-flex min-w-[190px] items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                pendingStage
                  ? 'border-primary/30 bg-primary-light text-primary shadow-sm'
                  : 'border-n40 bg-n20 text-n100'
              }`}
            >
              {pendingStage && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
              <span>
                {pendingLabel}
                {pendingStage ? ` ${pendingStage.completed ?? 0}/${pendingStage.total ?? '?'}` : '…'}
              </span>
            </div>
          </div>
        )}
      </div>

      {(saveError || error) && (
        <div className="mx-3 mb-2 flex flex-shrink-0 items-start gap-2 rounded-md border border-danger/30 bg-r50 px-3 py-2 text-[11px] leading-5 text-danger">
          <span className="min-w-0 flex-1">{saveError || error}</span>
          <button
            type="button"
            onClick={() => {
              setSaveError('');
              onDismissError();
            }}
            aria-label="关闭错误提示"
            className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded hover:bg-danger/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="mx-3 mb-3 min-h-0 flex-1 overflow-hidden rounded-md border border-n40 bg-n20">
        {isEditing && version ? (
          <textarea
            autoFocus
            value={draft}
            onChange={event => setDraft(event.target.value)}
            aria-label="编辑分镜脚本"
            className="font-document h-full w-full resize-none border-0 bg-n0 p-5 text-sm leading-7 text-n700 outline-none"
            spellCheck={false}
          />
        ) : versionFile ? (
          <StoryboardScriptColumn
            selectedFile={versionFile}
            highlightedItemIds={highlightedScriptItemIds}
            onSelectItemIds={handleSelectScriptItems}
            showHeader={false}
            cardMode
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-n100">
            <FileText className="h-10 w-10 opacity-25" />
            <p className="text-xs">在文字脚本列生成后，这里会显示分段和独立分镜卡片</p>
          </div>
        )}
      </div>
    </section>
  );
};
