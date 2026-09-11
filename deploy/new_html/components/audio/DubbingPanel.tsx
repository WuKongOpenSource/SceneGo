import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Volume2, Loader, Clock, Plus, Timer, Trash2 } from 'lucide-react';
import { DubbingCard } from './DubbingCard';
import type {
  AudioClipInfo, CharacterVoice, ClipOverride, AssetItem, StoryboardAudioSegment,
  StoryboardItemDB,
} from '../../types';
import {
  buildShotDurationIndex,
  indexAudioClipsByItem,
  resolveShotDurationMs,
  resolveStoryboardPlannedDurationMs,
} from '../../utils/audioTimeline';
import {
  resolveBoundCharacterVoice,
  resolveEffectiveSpeaker,
} from '../../utils/audioVoiceBinding';
import { dbItemToStoryboardItem } from '../../utils/episodeAdapters';
import { buildStoryboardSegmentGroups } from '../../utils/storyboardSegments';

const DUBBING_INITIAL_ITEM_COUNT = 20;
const DUBBING_ITEM_PAGE_SIZE = 20;

export interface DubbingPanelHandle {
  scrollToItem: (itemId: string) => void;
}

export interface DubbingPanelProps {
  storyboardItems: StoryboardItemDB[];
  clips: AudioClipInfo[];
  voiceMap: Map<string, CharacterVoice>;
  charAssetMap: Map<string, AssetItem>;
  localOverrides: Record<string, ClipOverride>;
  setLocalOverrides: React.Dispatch<React.SetStateAction<Record<string, ClipOverride>>>;
  localAudio: Record<string, { url: string; durationMs?: number }>;
  generatingIds: Set<string>;
  errors: Record<string, string>;
  playingKey: string;
  onGenerate: (clip: AudioClipInfo) => void;
  onTogglePlay: (key: string) => void;
  onBatchGenerate: () => void;
  batchRunning: boolean;
  allCharNames: string[];
  clipKeyFn: (clip: AudioClipInfo) => string;
  onClipPersist?: (
    clip: AudioClipInfo,
    patch: { speaker?: string; text?: string },
  ) => void;
  onAddSpeech?: (itemId: string) => void;
  onAddSilence?: (itemId: string) => void;
  onUpdateSilence?: (
    itemId: string,
    segmentId: string,
    patch: { label?: string; durationMs?: number },
  ) => void;
  onRemoveSegment?: (itemId: string, segmentId: string) => void;
  onMoveSegment?: (
    itemId: string,
    segmentId: string,
    direction: 'up' | 'down',
  ) => void;
}

export const DubbingPanel = forwardRef<DubbingPanelHandle, DubbingPanelProps>((props, ref) => {
  const {
    storyboardItems, clips, voiceMap, charAssetMap,
    localOverrides, setLocalOverrides,
    localAudio, generatingIds, errors, playingKey,
    onGenerate, onTogglePlay, onBatchGenerate, batchRunning,
    allCharNames, clipKeyFn, onClipPersist,
    onAddSpeech, onAddSilence, onUpdateSilence, onRemoveSegment, onMoveSegment,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [visibleItemCount, setVisibleItemCount] = useState(DUBBING_INITIAL_ITEM_COUNT);

  const sortedItems = useMemo(
    () => [...storyboardItems].sort((a, b) => a.sortOrder - b.sortOrder),
    [storyboardItems],
  );

  const durationByItem = useMemo(
    () => buildShotDurationIndex(sortedItems, clips, localAudio, clipKeyFn),
    [sortedItems, clips, localAudio, clipKeyFn],
  );

  const segmentDisplayByItemId = useMemo(() => {
    const displayByItemId = new Map<string, {
      segmentLabel: string;
      localShotLabel: string;
      shotCount: number;
      estimatedDurationSec: number;
      isFirstInSegment: boolean;
    }>();
    buildStoryboardSegmentGroups(
      sortedItems.map(item => dbItemToStoryboardItem(item)),
    ).forEach(group => {
      const estimatedDurationSec = group.entries.reduce(
        (total, entry) => total + (durationByItem.get(entry.item.id) || 0) / 1000, 0,
      );
      group.entries.forEach((entry, entryIndex) => {
        displayByItemId.set(entry.item.id, {
          segmentLabel: group.segmentLabel,
          localShotLabel: entry.localShotLabel,
          shotCount: group.entries.length,
          estimatedDurationSec,
          isFirstInSegment: entryIndex === 0,
        });
      });
    });
    return displayByItemId;
  }, [sortedItems, durationByItem]);

  const itemIdSignature = useMemo(
    () => sortedItems[0]?.itemId || '',
    [sortedItems],
  );

  useEffect(() => {
    setVisibleItemCount(DUBBING_INITIAL_ITEM_COUNT);
    itemRefs.current.clear();
  }, [itemIdSignature]);

  const visibleStoryboardItems = useMemo(
    () => sortedItems.slice(0, visibleItemCount),
    [sortedItems, visibleItemCount],
  );

  const hasMoreStoryboardItems = visibleItemCount < sortedItems.length;

  const revealAndScrollToItem = useCallback((itemId: string) => {
    const idx = sortedItems.findIndex(item => item.itemId === itemId);
    if (idx >= visibleItemCount) {
      setVisibleItemCount(Math.min(idx + 1, sortedItems.length));
    }
    window.setTimeout(() => {
      const el = itemRefs.current.get(itemId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }, [sortedItems, visibleItemCount]);

  useImperativeHandle(ref, () => ({
    scrollToItem: revealAndScrollToItem,
  }), [revealAndScrollToItem]);

  const clipsByItem = useMemo(() => indexAudioClipsByItem(clips), [clips]);

  const handleOverrideChange = useCallback((key: string, patch: Partial<ClipOverride>) => {
    setLocalOverrides(prev => ({
      ...prev,
      [key]: { ...(prev[key] || {}), ...patch },
    }));
  }, [setLocalOverrides]);

  const totalDurationMs = useMemo(() => {
    return Array.from(durationByItem.values()).reduce((sum, duration) => sum + duration, 0);
  }, [durationByItem]);

  const generatedCount = clips.filter(c => localAudio[clipKeyFn(c)]?.url || c.audioUrl).length;

  return (
    <div ref={containerRef} className="workflow-stage-canvas workflow-stage-scroll flex-1 overflow-auto p-4 space-y-4">
      {/* Toolbar */}
      <div className="workflow-stage-toolbar sticky top-0 z-10 -mx-4 -mt-4 flex items-center gap-4 border-b border-n40 bg-n0 px-4 py-2.5">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-n0 border border-n40">
          <Clock size={14} className="text-primary" />
          <span className="text-xs text-n100" title="不短于设计时长；音频超出设计时长时，额外预留 0.5 秒动作空白">总时长</span>
          <span className="text-sm font-bold tabular-nums">
            {totalDurationMs > 0 ? `${(totalDurationMs / 1000).toFixed(1)}s` : '—'}
          </span>
        </div>
        <button
          disabled={batchRunning || clips.length === 0}
          onClick={onBatchGenerate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50"
        >
          {batchRunning ? <Loader size={14} className="animate-spin" /> : <Volume2 size={14} />}
          {batchRunning ? '批量处理中…' : generatedCount === clips.length && clips.length > 0 ? '全部重新生成' : '全部生成'}
        </button>
        <span className="text-xs text-n100 ml-auto">
          {generatedCount}/{clips.length} 已生成
        </span>
      </div>

      {/* Shot groups */}
      {sortedItems.length === 0 ? (
        <div className="py-16 text-center text-n100 bg-n0 rounded-md border border-dashed border-n40">
          暂无分镜条目。请先在剧本流程中创建分镜。
        </div>
      ) : (
        visibleStoryboardItems.map(item => {
          const segmentDisplay = segmentDisplayByItemId.get(item.itemId);
          const itemClips = [...(clipsByItem.get(item.itemId) || [])]
            .sort((a, b) => a.sequenceIndex - b.sequenceIndex);
          const hasDialogue = itemClips.length > 0;
          const plannedDurationMs = resolveStoryboardPlannedDurationMs(item);
          const shotDurationMs = resolveShotDurationMs({
            item,
            clips: itemClips,
            localAudio,
            clipKeyFn,
          });
          const persistedSegments = [...(item.audioSegments || [])]
            .sort((a, b) => a.sequenceIndex - b.sequenceIndex);
          const timelineSegments: StoryboardAudioSegment[] = persistedSegments.length > 0
            ? persistedSegments
            : itemClips.map(clip => ({
              segmentId: clip.clipId,
              kind: 'speech',
              sequenceIndex: clip.sequenceIndex,
              speaker: clip.characterName,
              text: clip.text,
              audioUrl: clip.audioUrl,
              durationMs: clip.durationMs,
              voiceId: clip.voiceId,
            }));
          return (
            <React.Fragment key={item.itemId}>
              {segmentDisplay?.isFirstInSegment && (
                <div className="flex items-center gap-2 pt-1 text-xs">
                  <span className="rounded-md bg-warning/15 px-2.5 py-1 font-bold text-warning">
                    {segmentDisplay.segmentLabel}
                  </span>
                  <span className="text-n100">
                    {segmentDisplay.shotCount} 个镜头 · 约 {Math.round(segmentDisplay.estimatedDurationSec)} 秒
                  </span>
                  <span className="h-px flex-1 bg-n40" />
                </div>
              )}
              <div
                ref={el => { if (el) itemRefs.current.set(item.itemId, el); }}
                className="bg-n0 rounded-md border border-n40 p-4 shadow-card"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-primary bg-primary-light px-2 py-0.5 rounded">
                    {segmentDisplay?.localShotLabel || `镜头 ${String(item.sortOrder).padStart(2, '0')}`}
                  </span>
                  {plannedDurationMs > 0 && (
                    <span className="text-[10px] text-n100">
                      设计时长 {(plannedDurationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  <span className="text-[10px] text-primary font-semibold">
                    镜头总时长 {(shotDurationMs / 1000).toFixed(1)}s
                  </span>
                  <span className="text-[10px] text-n100">
                    {itemClips.length} 段配音
                  </span>
                  {!hasDialogue && (
                    <span className="text-[10px] text-n100 italic ml-auto">
                      无台词 — 按设计时长占位
                    </span>
                  )}
                </div>
                {timelineSegments.length > 0 ? (
                  <div className="space-y-2">
                    {timelineSegments.map((segment, segmentIndex) => {
                    const canMoveUp = segmentIndex > 0;
                    const canMoveDown = segmentIndex < timelineSegments.length - 1;
                    const moveControls = (
                      <div className="flex shrink-0 items-center gap-0.5" aria-label="调整片段顺序">
                        <button
                          type="button"
                          title="上移片段"
                          aria-label="上移片段"
                          disabled={!canMoveUp}
                          onClick={() => onMoveSegment?.(item.itemId, segment.segmentId, 'up')}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-n100 hover:bg-n30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          title="下移片段"
                          aria-label="下移片段"
                          disabled={!canMoveDown}
                          onClick={() => onMoveSegment?.(item.itemId, segment.segmentId, 'down')}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-n100 hover:bg-n30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                    );
                    if (segment.kind === 'silence') {
                      const seconds = Math.max(0.1, Number(segment.durationMs || 1000) / 1000);
                      return (
                        <div
                          key={segment.segmentId}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg border border-dashed border-n60 bg-n20"
                        >
                          <Timer size={15} className="text-n300 shrink-0" />
                          {moveControls}
                          <input
                            defaultValue={segment.label || '无声动作'}
                            onBlur={event => onUpdateSilence?.(
                              item.itemId,
                              segment.segmentId,
                              { label: event.target.value },
                            )}
                            className="min-w-0 flex-1 bg-transparent text-sm text-n700 focus:outline-none"
                            aria-label="无声动作说明"
                          />
                          <label className="flex items-center gap-1 text-xs text-n100">
                            时长
                            <input
                              type="number"
                              min="0.1"
                              step="0.1"
                              defaultValue={seconds}
                              onBlur={event => onUpdateSilence?.(
                                item.itemId,
                                segment.segmentId,
                                { durationMs: Math.max(100, Number(event.target.value || 0) * 1000) },
                              )}
                              className="w-16 rounded border border-n40 bg-n0 px-2 py-1 text-right text-n700"
                              aria-label="无声动作时长"
                            />
                            秒
                          </label>
                          <button
                            type="button"
                            title="删除无声动作"
                            onClick={() => onRemoveSegment?.(item.itemId, segment.segmentId)}
                            className="w-7 h-7 rounded-md text-n100 hover:text-danger hover:bg-danger-light flex items-center justify-center"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    }

                    const clip = itemClips.find(candidate => candidate.clipId === segment.segmentId);
                    if (!clip) return null;
                    const key = clipKeyFn(clip);
                    const audio = localAudio[key];
                    const override = localOverrides[key] || {};
                    const selectedSpeaker = resolveEffectiveSpeaker(clip, override);
                    return (
                      <div key={key} className="flex items-start gap-2">
                        {moveControls}
                        <div className="min-w-0 flex-1">
                          <DubbingCard
                            clip={clip}
                            clipKey={key}
                            voice={resolveBoundCharacterVoice(voiceMap, selectedSpeaker)}
                            charAsset={charAssetMap.get(selectedSpeaker)}
                            override={override}
                            onOverrideChange={handleOverrideChange}
                            audioUrl={audio?.url || (clip.audioUrl ? (clip.audioUrl.startsWith('/') ? clip.audioUrl : `/${clip.audioUrl}`) : '')}
                            audioDurationMs={audio?.durationMs || clip.durationMs}
                            isGenerating={generatingIds.has(key)}
                            error={errors[key] || null}
                            isPlaying={playingKey === key}
                            onGenerate={() => onGenerate(clip)}
                            onTogglePlay={() => onTogglePlay(key)}
                            plannedDurationMs={plannedDurationMs}
                            allCharNames={allCharNames}
                            onClipPersist={onClipPersist}
                          />
                        </div>
                        <button
                          type="button"
                          title="删除配音片段"
                          onClick={() => onRemoveSegment?.(item.itemId, segment.segmentId)}
                          className="mt-1 w-7 h-7 rounded-md text-n100 hover:text-danger hover:bg-danger-light flex items-center justify-center shrink-0"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                    })}
                  </div>
                ) : (
                  <div className="px-3 py-4 text-center rounded border border-dashed border-n40">
                    <p className="text-xs text-n100">该镜头暂时没有配音片段</p>
                    <p className="text-[10px] text-n100 mt-1">
                      设计时长 {(plannedDurationMs / 1000).toFixed(1)}s
                    </p>
                  </div>
                )}
                <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-n40">
                  <button
                    type="button"
                    onClick={() => onAddSpeech?.(item.itemId)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-n40 bg-n0 hover:border-primary hover:text-primary text-xs"
                  >
                    <Plus size={12} />
                    添加配音
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddSilence?.(item.itemId)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-n40 bg-n0 hover:border-primary hover:text-primary text-xs"
                  >
                    <Timer size={12} />
                    添加无声动作
                  </button>
                </div>
              </div>
            </React.Fragment>
          );
        })
      )}
      {hasMoreStoryboardItems && (
        <button
          type="button"
          onClick={() => setVisibleItemCount(count => Math.min(count + DUBBING_ITEM_PAGE_SIZE, sortedItems.length))}
          className="w-full px-3 py-2 rounded-lg border border-n40 bg-n0 hover:border-primary hover:text-primary text-xs text-n300 transition-colors"
        >
          加载更多台词（{Math.min(visibleItemCount, sortedItems.length)} / {sortedItems.length}）
        </button>
      )}
    </div>
  );
});

DubbingPanel.displayName = 'DubbingPanel';
