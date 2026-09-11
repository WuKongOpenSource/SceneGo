import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Link2,
  Music,
  Plus,
  Scissors,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { MusicModal } from './MusicModal';
import { SfxModal } from './SfxModal';
import { AudioClipReferenceModal } from './AudioClipReferenceModal';
import type { AudioClipInfo, AudioTrack, StoryboardItemDB } from '../../types';
import { resolveShotDurationMs } from '../../utils/audioTimeline';
import {
  moveAudioTrackTimeline,
  patchAudioTrackTimeline,
  resolveAudioTrackTimeline,
  trimAudioTrackTimelineEnd,
  trimAudioTrackTimelineStart,
  type AudioTrackTimelineEdit,
} from '../../utils/audioTrackTimeline';
import { updateAudioTrack } from '@runtime/audioGenerationService';
import { dbItemToStoryboardItem } from '../../utils/episodeAdapters';
import { buildStoryboardSegmentGroups } from '../../utils/storyboardSegments';

export interface TimelineSegment {
  itemId: string;
  sortOrder: number;
  durationMs: number;
  hasDialogue: boolean;
  hasAudio: boolean;
  clip: AudioClipInfo | null;
  label: string;
}

export interface MultiTrackTimelineProps {
  storyboardItems: StoryboardItemDB[];
  clips: AudioClipInfo[];
  localAudio: Record<string, { url: string; durationMs?: number }>;
  audioTracks: AudioTrack[];
  clipKeyFn: (clip: AudioClipInfo) => string;
  onClickItem: (itemId: string) => void;
  episodeId: string;
  projectId?: string;
  script: any;
  reload: () => Promise<void>;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

type PointerEditMode = 'move' | 'trim-start' | 'trim-end';

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

function formatTimelineShotLabel(label: string, sortOrder: number): string {
  const hierarchical = label.match(/分段\s*(\d+).*镜头\s*\d+\s*[-－—]\s*(\d+)/);
  if (hierarchical) {
    return `${hierarchical[1]}-${hierarchical[2]}`;
  }

  const legacy = label.match(/分段\s*(\d+).*镜头\s*(\d+)/);
  return legacy ? legacy.slice(1).join('-') : `#${sortOrder}`;
}

export const MultiTrackTimeline: React.FC<MultiTrackTimelineProps> = ({
  storyboardItems,
  clips,
  localAudio,
  audioTracks,
  clipKeyFn,
  onClickItem,
  episodeId,
  projectId,
  script,
  reload,
  collapsed = false,
  onCollapsedChange,
}) => {
  const [showMusicModal, setShowMusicModal] = useState(false);
  const [showSfxModal, setShowSfxModal] = useState(false);
  const [referenceTarget, setReferenceTarget] = useState<'bgm' | 'sfx_global' | null>(null);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(40);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<string, AudioTrackTimelineEdit>>({});
  const activePointerEdit = useRef<{
    track: AudioTrack;
    mode: PointerEditMode;
    startX: number;
    initial: AudioTrackTimelineEdit;
  } | null>(null);

  const sortedItems = useMemo(
    () => [...storyboardItems].sort((a, b) => a.sortOrder - b.sortOrder),
    [storyboardItems],
  );

  const segmentDisplayByItemId = useMemo(() => {
    const displayByItemId = new Map<string, {
      segmentLabel: string;
      localShotLabel: string;
    }>();
    buildStoryboardSegmentGroups(
      sortedItems.map(item => dbItemToStoryboardItem(item)),
    ).forEach(group => {
      group.entries.forEach(entry => {
        displayByItemId.set(entry.item.id, {
          segmentLabel: group.segmentLabel,
          localShotLabel: entry.localShotLabel,
        });
      });
    });
    return displayByItemId;
  }, [sortedItems]);

  const segments: TimelineSegment[] = useMemo(() => (
    sortedItems.map(item => {
      const segmentDisplay = segmentDisplayByItemId.get(item.itemId);
      const itemClips = clips
        .filter(clip => clip.itemId === item.itemId)
        .sort((a, b) => a.sequenceIndex - b.sequenceIndex);
      const clip = itemClips[0] || null;
      const hasAudio = itemClips.some(itemClip => {
        const itemAudio = localAudio[clipKeyFn(itemClip)];
        return Boolean(itemAudio?.url || itemClip.audioUrl);
      });
      const speakers = Array.from(new Set(
        itemClips.map(itemClip => itemClip.characterName).filter(Boolean),
      ));
      const durationMs = resolveShotDurationMs({
        item,
        clips: itemClips,
        localAudio,
        clipKeyFn,
      });
      return {
        itemId: item.itemId,
        sortOrder: item.sortOrder,
        durationMs,
        hasDialogue: itemClips.length > 0,
        hasAudio,
        clip,
        label: itemClips.length > 0
          ? `${segmentDisplay?.segmentLabel || '未分段'} · ${segmentDisplay?.localShotLabel || `镜头 ${item.sortOrder}`} · ${speakers.join(' / ')} · ${itemClips.length} 段配音`
          : `${segmentDisplay?.segmentLabel || '未分段'} · ${segmentDisplay?.localShotLabel || `镜头 ${item.sortOrder}`}`,
      };
    })
  ), [sortedItems, segmentDisplayByItemId, clips, localAudio, clipKeyFn]);

  const totalMs = Math.max(
    100,
    segments.reduce((sum, segment) => sum + segment.durationMs, 0),
  );
  const bgmTracks = useMemo(
    () => audioTracks.filter(track => track.trackType === 'bgm'),
    [audioTracks],
  );
  const sfxTracks = useMemo(
    () => audioTracks.filter(track => track.trackType === 'sfx_global'),
    [audioTracks],
  );
  const resolvedEdits = useMemo(() => {
    const edits: Record<string, AudioTrackTimelineEdit> = {};
    audioTracks.forEach(track => {
      edits[track.trackId] = resolveAudioTrackTimeline(track, totalMs);
    });
    return edits;
  }, [audioTracks, totalMs]);

  useEffect(() => {
    setDraftEdits({});
  }, [audioTracks]);

  useEffect(() => {
    if (selectedTrackId && !audioTracks.some(track => track.trackId === selectedTrackId)) {
      setSelectedTrackId(null);
    }
  }, [audioTracks, selectedTrackId]);

  const editFor = useCallback(
    (track: AudioTrack) => draftEdits[track.trackId] || resolvedEdits[track.trackId],
    [draftEdits, resolvedEdits],
  );

  const persistEdit = useCallback(async (
    track: AudioTrack,
    edit: AudioTrackTimelineEdit,
  ) => {
    setDraftEdits(previous => ({ ...previous, [track.trackId]: edit }));
    try {
      await updateAudioTrack(track.trackId, {
        generation_params: patchAudioTrackTimeline(track, edit),
      });
      await reload();
    } catch (error) {
      console.error('保存音轨编辑失败:', error);
      setDraftEdits(previous => {
        const next = { ...previous };
        delete next[track.trackId];
        return next;
      });
      alert(`保存音轨编辑失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [reload]);

  const normalizeDirectEdit = useCallback((
    track: AudioTrack,
    edit: AudioTrackTimelineEdit,
  ) => resolveAudioTrackTimeline(
    {
      ...track,
      generationParams: patchAudioTrackTimeline(track, edit),
    },
    totalMs,
  ), [totalMs]);

  const beginPointerEdit = useCallback((
    event: React.PointerEvent,
    track: AudioTrack,
    mode: PointerEditMode,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedTrackId(track.trackId);
    const initial = editFor(track);
    if (!initial) return;
    activePointerEdit.current = {
      track,
      mode,
      startX: event.clientX,
      initial,
    };
    let latestEdit = initial;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const active = activePointerEdit.current;
      if (!active) return;
      const deltaMs = ((moveEvent.clientX - active.startX) / pixelsPerSecond) * 1000;
      const sourceDurationMs = Math.max(100, active.track.durationMs || totalMs);
      if (active.mode === 'move') {
        latestEdit = moveAudioTrackTimeline(active.initial, deltaMs, totalMs);
      } else if (active.mode === 'trim-start') {
        latestEdit = trimAudioTrackTimelineStart(active.initial, deltaMs, sourceDurationMs);
      } else {
        latestEdit = trimAudioTrackTimelineEnd(
          active.initial,
          deltaMs,
          sourceDurationMs,
          totalMs,
        );
      }
      setDraftEdits(previous => ({
        ...previous,
        [active.track.trackId]: latestEdit,
      }));
    };

    const handlePointerUp = () => {
      const active = activePointerEdit.current;
      activePointerEdit.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      if (active) void persistEdit(active.track, latestEdit);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [editFor, persistEdit, pixelsPerSecond, totalMs]);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      setPixelsPerSecond(previous => (
        Math.max(10, Math.min(200, previous - event.deltaY * 0.1))
      ));
    }
  }, []);

  const trackWidth = Math.max(560, (totalMs / 1000) * pixelsPerSecond);
  const msToPixels = (ms: number) => Math.max(0, (ms / 1000) * pixelsPerSecond);
  const msToWidth = (ms: number) => `${Math.max(10, msToPixels(ms))}px`;
  const selectedTrack = audioTracks.find(track => track.trackId === selectedTrackId) || null;
  const selectedEdit = selectedTrack ? editFor(selectedTrack) : null;

  const renderTrackLabel = (
    label: string,
    extra?: React.ReactNode,
  ) => (
    <div className="sticky left-0 z-20 flex h-full w-64 shrink-0 items-center justify-between border-r border-n40 bg-n20 px-3 text-[10px] text-n100">
      <span className="font-medium">{label}</span>
      {extra}
    </div>
  );

  const renderEditableTrack = (
    track: AudioTrack,
    colorClass: string,
  ) => {
    const edit = editFor(track);
    if (!edit) return null;
    const selected = selectedTrackId === track.trackId;
    const fadeInWidth = edit.durationMs > 0
      ? `${(edit.fadeInMs / edit.durationMs) * 100}%`
      : '0%';
    const fadeOutWidth = edit.durationMs > 0
      ? `${(edit.fadeOutMs / edit.durationMs) * 100}%`
      : '0%';

    return (
      <div
        key={track.trackId}
        className={`absolute inset-y-1 overflow-hidden rounded border ${
          selected ? 'border-primary shadow-sm' : 'border-transparent'
        } ${colorClass}`}
        style={{
          left: `${msToPixels(edit.startMs)}px`,
          width: msToWidth(edit.durationMs),
        }}
        onClick={() => setSelectedTrackId(track.trackId)}
        title={`${track.name} · 拖动移动，左右边缘裁剪`}
      >
        {track.trackType === 'bgm' && edit.fadeInMs > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 bg-white/35"
            style={{ width: fadeInWidth, clipPath: 'polygon(0 100%, 100% 0, 100% 100%)' }}
          />
        )}
        {track.trackType === 'bgm' && edit.fadeOutMs > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 bg-white/35"
            style={{ width: fadeOutWidth, clipPath: 'polygon(0 0, 100% 100%, 0 100%)' }}
          />
        )}
        <button
          type="button"
          aria-label={`裁剪 ${track.name} 起点`}
          className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize bg-n900/15 hover:bg-n900/30"
          onPointerDown={event => beginPointerEdit(event, track, 'trim-start')}
        />
        <button
          type="button"
          className="flex h-full w-full cursor-grab items-center gap-1 truncate px-3 text-left text-[9px] active:cursor-grabbing"
          onPointerDown={event => beginPointerEdit(event, track, 'move')}
        >
          {track.trackType === 'bgm'
            ? <Music size={10} className="shrink-0" />
            : <Sparkles size={10} className="shrink-0" />}
          <span className="truncate">{track.name || (track.trackType === 'bgm' ? 'BGM' : '音效')}</span>
        </button>
        <button
          type="button"
          aria-label={`裁剪 ${track.name} 终点`}
          className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize bg-n900/15 hover:bg-n900/30"
          onPointerDown={event => beginPointerEdit(event, track, 'trim-end')}
        />
      </div>
    );
  };

  if (sortedItems.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center border-t border-n40 bg-n20 text-xs text-n100">
        暂无分镜数据
      </div>
    );
  }

  return (
    <div className={`flex flex-col border-t border-n40 bg-n20 ${collapsed ? 'h-10' : 'h-[304px]'}`}>
      <div className="flex shrink-0 items-center gap-3 border-b border-n40 px-4 py-2">
        {onCollapsedChange && (
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => onCollapsedChange(!collapsed)}
            title={collapsed ? '展开时间轴' : '折叠时间轴'}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-n40 bg-n0 px-2 text-[10px] font-semibold text-n700 hover:border-primary hover:text-primary"
          >
            {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {collapsed ? '展开' : '折叠'}
          </button>
        )}
        <span className="text-xs font-bold uppercase text-n100">时间轴</span>
        <span className="tabular-nums text-[10px] text-n100">
          总 {(totalMs / 1000).toFixed(1)}s | {Math.round(pixelsPerSecond)}px/s
        </span>
        <span className="flex items-center gap-1 text-[10px] text-n100">
          <GripVertical size={11} /> 拖动片段移动，拖动边缘裁剪
        </span>
        <span className="flex-1" />
        <span className="text-[10px] text-n100">Ctrl+滚轮缩放</span>
      </div>

      {!collapsed && (
        <>
          {selectedTrack && selectedEdit && (
            <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-n40 bg-n0 px-4 py-2">
              <Scissors size={13} className="text-primary" />
              <strong className="max-w-40 truncate text-[11px] text-n700">{selectedTrack.name}</strong>
              <audio controls src={selectedTrack.audioUrl || ''} className="h-7 w-44" />
          {[
            ['位置', 'startMs'],
            ['素材起点', 'sourceOffsetMs'],
            ['保留', 'durationMs'],
          ].map(([label, key]) => (
            <label key={key} className="flex items-center gap-1 text-[10px] text-n100">
              {label}
              <input
                type="number"
                min="0"
                step="0.1"
                value={seconds(selectedEdit[key as keyof AudioTrackTimelineEdit] as number)}
                className="w-16 rounded border border-n40 bg-n0 px-1.5 py-1 text-right text-[10px] text-n700"
                onChange={event => {
                  const valueMs = Math.max(0, Number(event.target.value) * 1000);
                  const next = normalizeDirectEdit(selectedTrack, {
                    ...selectedEdit,
                    [key]: valueMs,
                  });
                  setDraftEdits(previous => ({ ...previous, [selectedTrack.trackId]: next }));
                }}
                onBlur={() => void persistEdit(
                  selectedTrack,
                  editFor(selectedTrack) || selectedEdit,
                )}
              />
              秒
            </label>
          ))}
          {selectedTrack.trackType === 'bgm' && (
            <>
              {[
                ['淡入', 'fadeInMs'],
                ['淡出', 'fadeOutMs'],
              ].map(([label, key]) => (
                <label key={key} className="flex items-center gap-1 text-[10px] text-n100">
                  {label}
                  <input
                    type="number"
                    min="0"
                    max={seconds(selectedEdit.durationMs)}
                    step="0.1"
                    value={seconds(selectedEdit[key as keyof AudioTrackTimelineEdit] as number)}
                    className="w-14 rounded border border-n40 bg-n0 px-1.5 py-1 text-right text-[10px] text-n700"
                    onChange={event => {
                      const valueMs = Math.max(0, Number(event.target.value) * 1000);
                      const next = normalizeDirectEdit(selectedTrack, {
                        ...selectedEdit,
                        [key]: valueMs,
                      });
                      setDraftEdits(previous => ({ ...previous, [selectedTrack.trackId]: next }));
                    }}
                    onBlur={() => void persistEdit(
                      selectedTrack,
                      editFor(selectedTrack) || selectedEdit,
                    )}
                  />
                  秒
                </label>
              ))}
            </>
          )}
          <label className="flex items-center gap-1 whitespace-nowrap text-[10px] text-n100">
            音量
            <input
              type="number"
              min="0"
              max="2"
              step="0.05"
              value={selectedEdit.volume}
              className="w-14 rounded border border-n40 bg-n0 px-1.5 py-1 text-right text-[10px] text-n700"
              onChange={event => {
                const next = normalizeDirectEdit(selectedTrack, {
                  ...selectedEdit,
                  volume: Math.max(0, Math.min(2, Number(event.target.value))),
                });
                setDraftEdits(previous => ({ ...previous, [selectedTrack.trackId]: next }));
              }}
              onBlur={() => void persistEdit(
                selectedTrack,
                editFor(selectedTrack) || selectedEdit,
              )}
            />
          </label>
            </div>
          )}

          <div className="flex-1 overflow-auto" onWheel={handleWheel}>
            <div style={{ minWidth: `${trackWidth + 256}px` }}>
          <div className="flex h-7 items-center border-b border-n40">
            {renderTrackLabel('镜头')}
            <div className="flex h-full" style={{ width: `${trackWidth}px` }}>
              {segments.map(segment => (
                <button
                  key={`mark-${segment.itemId}`}
                  type="button"
                  style={{ width: msToWidth(segment.durationMs) }}
                  className="flex items-center justify-center border-r border-n40 text-[10px] text-n100 transition-colors hover:bg-n30"
                  onClick={() => onClickItem(segment.itemId)}
                  title={segment.label}
                >
                  {formatTimelineShotLabel(segment.label, segment.sortOrder)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex h-8 items-center border-b border-n40">
            {renderTrackLabel('台词')}
            <div className="flex h-full gap-px py-0.5" style={{ width: `${trackWidth}px` }}>
              {segments.map(segment => (
                <button
                  key={`audio-${segment.itemId}`}
                  type="button"
                  style={{ width: msToWidth(segment.durationMs) }}
                  className={`truncate rounded-sm px-1 text-[9px] transition-colors ${
                    segment.hasAudio
                      ? 'bg-b50 text-b400 hover:bg-b75'
                      : segment.hasDialogue
                        ? 'bg-warning/20 text-warning hover:bg-warning/30'
                        : 'border border-dashed border-n40 bg-n30 text-n100'
                  }`}
                  onClick={() => onClickItem(segment.itemId)}
                  title={segment.label}
                >
                  {segment.hasDialogue
                    ? segment.label
                    : `${(segment.durationMs / 1000).toFixed(1)}s`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex h-12 items-center border-b border-n40">
            {renderTrackLabel(
              'BGM',
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setReferenceTarget('bgm')}
                  className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/5 px-2 py-1 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/10"
                  title="引用本集已经生成的配音作为 BGM"
                >
                  <Link2 size={11} /> 引用配音
                </button>
                <button
                  type="button"
                  onClick={() => setShowMusicModal(true)}
                  className="inline-flex items-center gap-1 rounded border border-n40 bg-n0 px-2 py-1 text-[10px] font-semibold text-n700 transition-colors hover:bg-n30"
                  title="上传已有背景音乐"
                >
                  <Plus size={11} /> 添加
                </button>
                <button
                  type="button"
                  onClick={() => setShowMusicModal(true)}
                  className="inline-flex items-center gap-1 rounded bg-success px-2 py-1 text-[10px] font-semibold text-white"
                  title="AI 音乐制作"
                >
                  <Wand2 size={11} /> AI
                </button>
              </div>,
            )}
            <div className="relative h-full" style={{ width: `${trackWidth}px` }}>
              {bgmTracks.map(track => renderEditableTrack(track, 'bg-success/25 text-success'))}
            </div>
          </div>

          <div className="flex h-12 items-center">
            {renderTrackLabel(
              '音效',
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setReferenceTarget('sfx_global')}
                  className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/5 px-2 py-1 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/10"
                  title="引用本集已经生成的配音作为音效"
                >
                  <Link2 size={11} /> 引用配音
                </button>
                <button
                  type="button"
                  onClick={() => setShowSfxModal(true)}
                  className="inline-flex items-center gap-1 rounded border border-n40 bg-n0 px-2 py-1 text-[10px] font-semibold text-n700 transition-colors hover:bg-n30"
                  title="上传已有音效"
                >
                  <Plus size={11} /> 添加
                </button>
                <button
                  type="button"
                  onClick={() => setShowSfxModal(true)}
                  className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-semibold text-white"
                  title="AI 音效制作"
                >
                  <Sparkles size={11} /> AI
                </button>
              </div>,
            )}
            <div className="relative h-full" style={{ width: `${trackWidth}px` }}>
              {sfxTracks.map(track => renderEditableTrack(track, 'bg-primary/20 text-primary'))}
            </div>
          </div>
            </div>
          </div>

          {showMusicModal && (
            <MusicModal
              episodeId={episodeId}
              projectId={projectId}
              script={script}
              onClose={() => setShowMusicModal(false)}
              onCreated={async () => {
                await reload();
                setShowMusicModal(false);
              }}
            />
          )}

          {showSfxModal && (
            <SfxModal
              episodeId={episodeId}
              projectId={projectId}
              script={script}
              onClose={() => setShowSfxModal(false)}
              onCreated={async () => {
                await reload();
                setShowSfxModal(false);
              }}
            />
          )}

          {referenceTarget && (
            <AudioClipReferenceModal
              episodeId={episodeId}
              targetTrackType={referenceTarget}
              clips={clips}
              localAudio={localAudio}
              clipKeyFn={clipKeyFn}
              onClose={() => setReferenceTarget(null)}
              onCreated={reload}
            />
          )}
        </>
      )}
    </div>
  );
};
