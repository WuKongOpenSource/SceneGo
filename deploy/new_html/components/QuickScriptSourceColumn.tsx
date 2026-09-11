import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Coins, LoaderCircle, Wand2, X } from 'lucide-react';
import type { AiModel, ProjectFile, ScriptGenerationStageState, ScriptStoryboardVersion } from '../types';
import {
  getScriptModelBillingKey,
  getScriptModelOption,
  type ScriptModelOption,
} from '../services/scriptModelCatalogService';
import { estimateCredits, estimateTextTokens } from '../services/creditService';
import { ModelPicker } from './ModelPicker';
import { buildScriptModelPickerOptions } from './modelPickerCatalogs';

const BRIEF_SOURCE_MAX_CHARACTERS = 80;
type QuickStageKey = keyof NonNullable<ProjectFile['generationStages']>;

function countContentCharacters(value: string): number {
  return value.replace(/\s+/g, '').length;
}

interface QuickScriptSourceColumnProps {
  selectedFile: ProjectFile | undefined;
  aiModel: AiModel;
  modelOptions: readonly ScriptModelOption[];
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  onDismissError: () => void;
  onChangeModel: (model: AiModel) => void;
  onUpdateSource: (fileId: string, content: string) => void;
  onSplitScript: (fileId: string) => Promise<boolean | void>;
  onGenerateVideoScript: (fileId: string) => Promise<boolean | ScriptStoryboardVersion | void>;
  onExtractStoryboardPrompts: (fileId: string) => Promise<boolean | void>;
  onRunThreeStage: (fileId: string) => Promise<void>;
  actualCreditCost?: number;
}

export const QuickScriptSourceColumn: React.FC<QuickScriptSourceColumnProps> = ({
  selectedFile,
  aiModel,
  modelOptions,
  isLoading,
  isSending,
  error,
  onDismissError,
  onChangeModel,
  onUpdateSource,
  onSplitScript,
  onGenerateVideoScript,
  onExtractStoryboardPrompts,
  onRunThreeStage,
  actualCreditCost = 0,
}) => {
  const [requestError, setRequestError] = useState('');
  const [estimatedCreditCost, setEstimatedCreditCost] = useState<number | null>(null);
  const [isEstimatingCredits, setIsEstimatingCredits] = useState(false);

  useEffect(() => {
    setRequestError('');
  }, [selectedFile?.id]);

  const runAction = async (
    action: (fileId: string) => Promise<unknown>,
    fallbackMessage: string,
  ) => {
    if (!selectedFile || isSending) return;
    setRequestError('');
    try {
      await action(selectedFile.id);
    } catch (submitError) {
      setRequestError(submitError instanceof Error ? submitError.message : fallbackMessage);
    }
  };

  const visibleError = requestError || error || '';
  const stages = selectedFile?.generationStages;
  const segmentCount = selectedFile?.scriptSegments?.length || 0;
  const generatedSegmentCount = selectedFile?.scriptSegments?.filter(segment => segment.videoScript).length || 0;
  const storyboardDesignCount = selectedFile?.storyboard?.items
    ?.filter(item => !item.isPlaceholder && (item.imagePrompt || item.videoPrompt || item.scriptSegment || item.originalText))
    .length || 0;
  const hasCompletedOutputForStage = (key: QuickStageKey, stage?: ScriptGenerationStageState) => {
    const targetTotal = typeof stage?.total === 'number' && stage.total > 0 ? stage.total : 0;
    if (key === 'split') return segmentCount > 0 && (!targetTotal || segmentCount >= targetTotal);
    if (key === 'videoScript') return segmentCount > 0 && generatedSegmentCount >= (targetTotal || segmentCount);
    return storyboardDesignCount > 0 && (!targetTotal || storyboardDesignCount >= targetTotal);
  };
  const getCompletedTotalForStage = (key: QuickStageKey) => {
    if (key === 'split') return segmentCount;
    if (key === 'videoScript') return generatedSegmentCount;
    return storyboardDesignCount;
  };
  const getDisplayStage = (key: QuickStageKey): ScriptGenerationStageState | undefined => {
    const stage = stages?.[key];
    if (stage?.status === 'running' && !hasCompletedOutputForStage(key, stage)) return stage;
    if (hasCompletedOutputForStage(key, stage)) {
      const completedTotal = getCompletedTotalForStage(key);
      return {
        ...stage,
        status: 'done',
        total: completedTotal,
        completed: completedTotal,
      };
    }
    return stage;
  };
  const isStageRunning = (Object.entries(stages || {}) as Array<[QuickStageKey, ScriptGenerationStageState]>)
    .some(([key, stage]) => stage?.status === 'running' && !hasCompletedOutputForStage(key, stage));
  const isBusy = isLoading || isSending || isStageRunning;
  const selectedModelOption = getScriptModelOption(aiModel, modelOptions);
  const selectedModelHint = selectedModelOption.hint.trim();
  const modelPickerOptions = useMemo(
    () => buildScriptModelPickerOptions(modelOptions),
    [modelOptions],
  );
  const completedActualCreditCost = Number.isFinite(actualCreditCost) && actualCreditCost > 0 ? actualCreditCost : 0;
  const creditEstimateParams = useMemo(() => {
    if (!selectedFile?.originalContent?.trim()) return null;
    const sourceText = selectedFile.originalContent;
    const sourceTokens = estimateTextTokens(sourceText);
    const segmentTexts = selectedFile.scriptSegments?.map(segment => segment.sourceText).join('\n') || '';
    const isBriefSource = countContentCharacters(sourceText) <= BRIEF_SOURCE_MAX_CHARACTERS;
    const currentVideoScript = selectedFile.scriptContent || selectedFile.scriptSegments
      ?.map(segment => segment.videoScript || '')
      .filter(Boolean)
      .join('\n\n')
      || '';
    const storedSegmentCount = selectedFile.scriptSegments?.length || 0;
    const segmentCountEstimate = Math.max(
      1,
      isBriefSource ? 1 : storedSegmentCount || Math.ceil(sourceTokens / 120),
    );
    const sourceShotCountEstimate = Math.max(
      1,
      selectedFile.storyboard?.items?.length
        || (currentVideoScript ? Math.ceil(estimateTextTokens(currentVideoScript) / 180) : segmentCountEstimate),
    );
    const model = getScriptModelBillingKey(selectedModelOption);

    return {
      script: {
        input_tokens: estimateTextTokens([sourceText, segmentTexts || sourceText].join('\n')),
        output_tokens: Math.max(1000, sourceTokens * 3, segmentCountEstimate * 700),
        model,
      },
      design: {
        shot_count: sourceShotCountEstimate,
        input_tokens: estimateTextTokens(currentVideoScript || sourceText),
        output_tokens: Math.max(500, sourceShotCountEstimate * 500),
        model,
      },
    };
  }, [selectedFile?.id, selectedFile?.originalContent, selectedFile?.scriptContent, selectedFile?.scriptSegments, selectedFile?.storyboard?.items, selectedModelOption]);

  useEffect(() => {
    let cancelled = false;
    if (!creditEstimateParams || isBusy) {
      setEstimatedCreditCost(null);
      setIsEstimatingCredits(false);
      return undefined;
    }
    setIsEstimatingCredits(true);
    const timer = window.setTimeout(() => {
      void Promise.all([
        estimateCredits('script_model_call', creditEstimateParams.script),
        estimateCredits('storyboard_design_generation', creditEstimateParams.design),
      ])
        .then(([scriptEstimate, designEstimate]) => {
          if (cancelled) return;
          setEstimatedCreditCost(
            (scriptEstimate.enabled ? scriptEstimate.estimated_cost : 0)
            + (designEstimate.enabled ? designEstimate.estimated_cost : 0),
          );
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
  }, [creditEstimateParams, isBusy]);

  const statusText = (stage?: ScriptGenerationStageState) => {
    if (stage?.status === 'running') return `进行中 ${stage.completed ?? 0}/${stage.total ?? '?'}`;
    if (stage?.status === 'done') return '完成';
    if (stage?.status === 'error') return '失败，可重试';
    return '未开始';
  };

  const statusClass = (stage?: ScriptGenerationStageState) => {
    if (stage?.status === 'done') return 'text-success';
    if (stage?.status === 'error') return 'text-danger';
    if (stage?.status === 'running') return 'text-warning';
    return 'text-n200';
  };

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-n0"
      data-testid="quick-script-source-column"
    >
      <header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-n40/70 px-4">
        <BookOpen className="h-4 w-4 flex-shrink-0 text-primary" />
        <h2 className="whitespace-nowrap text-sm font-semibold text-n700">2. 文字脚本</h2>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {selectedModelHint && (
            <span
              className="flex-shrink-0 whitespace-nowrap text-[11px] font-medium text-n300"
              data-testid="quick-script-model-hint"
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
            className="max-w-[180px]"
            ariaLabel="选择剧本模型"
            title="剧本模型"
            kind="text"
          />
        </div>
      </header>

      <div className="relative mx-3 mb-3 min-h-0 flex-1 overflow-hidden rounded-md border border-n40 bg-n0">
        {selectedFile ? (
          <textarea
            key={selectedFile.id}
            readOnly={isBusy}
            value={selectedFile.originalContent}
            onChange={event => onUpdateSource(selectedFile.id, event.target.value)}
            placeholder="在此输入文字剧本…"
            aria-label="文字剧本"
            className="h-full w-full resize-none bg-n0 p-5 font-serif text-sm leading-7 text-n700 outline-none custom-scrollbar focus:ring-1 focus:ring-inset focus:ring-primary/20 read-only:cursor-default"
            spellCheck={false}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-n100">
            <BookOpen className="h-10 w-10 opacity-25" />
            <p className="text-xs">请先从文件列表选择分集剧本</p>
          </div>
        )}
      </div>

      {selectedFile && (
        <div className="mx-3 mb-3 flex-shrink-0 rounded-md border border-n40 bg-n20/60 p-3" data-testid="quick-three-stage-panel">
          {visibleError && (
            <div className="mb-2 flex items-start gap-2 rounded border border-danger/30 bg-r50 px-2.5 py-2 text-[11px] leading-5 text-danger">
              <span className="min-w-0 flex-1">{visibleError}</span>
              <button
                type="button"
                onClick={() => {
                  setRequestError('');
                  onDismissError();
                }}
                title="关闭错误提示"
                aria-label="关闭错误提示"
                className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded hover:bg-danger/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-n700">三步生成</span>
            <button
              type="button"
              onClick={() => void runAction(onRunThreeStage, '按三步生成失败，请稍后重试')}
              disabled={!selectedFile.originalContent.trim() || isBusy}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-n100"
            >
              {isBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {isBusy ? '执行中…' : '按三步生成'}
            </button>
          </div>
          {([
            {
              key: 'split',
              label: '拆分剧本',
              metric: `分段数：${segmentCount}`,
              action: onSplitScript,
              disabled: !selectedFile.originalContent.trim(),
            },
            {
              key: 'videoScript',
              label: '生成视频脚本',
              metric: `已生成：${generatedSegmentCount}/${segmentCount}`,
              action: onGenerateVideoScript,
              disabled: segmentCount === 0,
            },
            {
              key: 'storyboardPrompt',
              label: '生成镜头设计',
              metric: `镜头设计：${storyboardDesignCount}`,
              action: onExtractStoryboardPrompts,
              disabled: generatedSegmentCount === 0,
            },
          ] as const).map(row => {
            const stage = getDisplayStage(row.key);
            return (
              <div key={row.key} className="mb-1.5 rounded border border-n40 bg-n0 px-2.5 py-2 last:mb-0">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void runAction(row.action, `${row.label}失败，请稍后重试`)}
                    disabled={row.disabled || isBusy}
                    className="min-w-0 flex-1 truncate text-left text-[11px] font-semibold text-n700 hover:text-primary disabled:cursor-not-allowed disabled:text-n100"
                  >
                    {row.label}
                  </button>
                  <span className={`inline-flex flex-shrink-0 items-center gap-1 text-[10px] ${statusClass(stage)}`}>
                    {stage?.status === 'running' && <LoaderCircle className="h-3 w-3 animate-spin" />}
                    {statusText(stage)}
                  </span>
                </div>
                <span className="mt-1 block truncate text-[10px] text-n300">{row.metric}</span>
              </div>
            );
          })}
          <div className="mt-2.5 flex items-start gap-1.5 px-0.5 text-[10px] font-medium text-warning">
            <Coins className="h-3.5 w-3.5 flex-shrink-0" />
            <div className="min-w-0 space-y-0.5">
              {completedActualCreditCost > 0 && (
                <div title="当前版本剧本生成与镜头设计生成合计扣除创作点数">
                  <span>{`本次合计消耗：${completedActualCreditCost}`}</span>
                  <span className="ml-1 text-n100">创作点数</span>
                </div>
              )}
              <div title="按当前输入、所选模型和预计镜头规模估算，实际以成功生成后的用量为准">
                <span>
                  {completedActualCreditCost > 0 ? '再次生成预计消耗创作点数：' : '预计消耗创作点数：'}
                  {isEstimatingCredits ? '计算中…' : (estimatedCreditCost ?? '--')}
                </span>
                <span className="ml-1 text-n100">· 成功后扣除</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
