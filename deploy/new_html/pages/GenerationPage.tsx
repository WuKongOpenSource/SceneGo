import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Pause, Video, Image as ImageIcon, Clock, Film, Plus, Loader, RefreshCw } from 'lucide-react';
import { useEpisode } from '../contexts/EpisodeContext';
import { createVideoSegment } from '../services/videoWorkflowService';
import { getStoryboardItems, getVideoSegments } from '../services/episodeDataService';
import { secureApiUrl } from '../services/httpClient';
import type { AudioTrack, StoryboardItemDB, VideoSegment } from '../types';
import { MediaImage } from '../components/MediaImage';

const GENERATION_INITIAL_STORYBOARD_COUNT = 10;
const GENERATION_STORYBOARD_PAGE_SIZE = 10;

type SegmentUiStatus = 'pending' | 'generating' | 'completed' | 'error';

function withAuthParam(url: string): string {
  if (!url) return url;
  return secureApiUrl(url, { requireAuth: false });
}

function sbId(item: StoryboardItemDB & Record<string, unknown>): string {
  return String(item.itemId ?? item.item_id ?? '');
}
function sbSort(item: StoryboardItemDB & Record<string, unknown>): number {
  const v = item.sortOrder ?? item.sort_order;
  return typeof v === 'number' ? v : 0;
}
function sbDialogue(item: StoryboardItemDB & Record<string, unknown>): string {
  return String(item.dialogue ?? '');
}
function sbImageUrl(item: StoryboardItemDB & Record<string, unknown>): string | null {
  const u = item.generatedImageUrl ?? item.generated_image_url;
  return u ? String(u) : null;
}
function sbAudioDurationMs(item: StoryboardItemDB & Record<string, unknown>): number | null {
  const v = item.audioDurationMs ?? item.audio_duration_ms;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function segId(s: VideoSegment & Record<string, unknown>): string {
  return String(s.segmentId ?? s.segment_id ?? '');
}
function segStoryboardItemId(s: VideoSegment & Record<string, unknown>): string | null {
  const v = s.storyboardItemId ?? s.storyboard_item_id;
  return v ? String(v) : null;
}
function segSortOrder(s: VideoSegment & Record<string, unknown>): number {
  const v = s.sortOrder ?? s.sort_order;
  return typeof v === 'number' ? v : 0;
}
function segStatusRaw(s: VideoSegment & Record<string, unknown>): string {
  return String(s.status ?? 'pending').toLowerCase();
}
function segVideoUrl(s: VideoSegment & Record<string, unknown>): string | null {
  const u = s.videoUrl ?? s.video_url;
  return u ? String(u) : null;
}
function segDurationMs(s: VideoSegment & Record<string, unknown>): number | null {
  const v = s.durationMs ?? s.duration_ms;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function trackType(t: AudioTrack & Record<string, unknown>): string {
  return String(t.trackType ?? t.track_type ?? 'bgm');
}
function trackName(t: AudioTrack & Record<string, unknown>): string {
  return String(t.name ?? 'Audio');
}
function trackDurationMs(t: AudioTrack & Record<string, unknown>): number | null {
  const v = t.durationMs ?? t.duration_ms;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function trackStartItemId(t: AudioTrack & Record<string, unknown>): string | null {
  const v = t.startItemId ?? t.start_item_id;
  return v ? String(v) : null;
}
function trackEndItemId(t: AudioTrack & Record<string, unknown>): string | null {
  const v = t.endItemId ?? t.end_item_id;
  return v ? String(v) : null;
}

function normalizeSegmentUiStatus(raw: string, isClientGenerating: boolean): SegmentUiStatus {
  if (isClientGenerating) return 'generating';
  if (raw === 'completed' || raw === 'done' || raw === 'success') return 'completed';
  if (raw === 'failed' || raw === 'error') return 'error';
  if (['processing', 'queued', 'running', 'generating'].includes(raw)) return 'generating';
  return 'pending';
}

function statusLabel(s: SegmentUiStatus): string {
  switch (s) {
    case 'pending': return '待生成';
    case 'generating': return '生成中';
    case 'completed': return '已完成';
    case 'error': return '失败';
  }
}

const STATUS_BADGE: Record<SegmentUiStatus, string> = {
  pending: 'bg-n30 text-n300',
  generating: 'bg-primary-light text-primary',
  completed: 'bg-success/15 text-success',
  error: 'bg-r50 text-danger',
};

function audioTrackColor(tt: string): string {
  switch (tt) {
    case 'bgm': return '#5B49F0';
    case 'sfx_global': return '#FF6A3D';
    case 'narration_global': return '#3B7BE5';
    default: return '#8B6BFF';
  }
}

function normalizeStoryboardVideoItem(r: any): StoryboardItemDB {
  return {
    itemId: r.item_id ?? r.itemId ?? '',
    episodeId: r.episode_id ?? r.episodeId ?? '',
    sortOrder: typeof (r.sort_order ?? r.sortOrder) === 'number' ? (r.sort_order ?? r.sortOrder) : 0,
    sceneHeading: '',
    actionText: '',
    dialogue: r.dialogue ?? '',
    cameraMovement: '',
    imagePrompt: '',
    videoPrompt: r.video_prompt ?? r.videoPrompt ?? '',
    generatedImageUrl: r.generated_image_url ?? r.generatedImageUrl ?? null,
    boundAssets: [],
    configuredReferences: [],
    status: r.status ?? 'draft',
    dialogueAudioUrl: null,
    narrationAudioUrl: null,
    sfxAudioUrl: null,
    audioDurationMs: r.audio_duration_ms ?? r.audioDurationMs ?? null,
    plannedDurationMs: r.planned_duration_ms ?? r.plannedDurationMs ?? null,
  };
}

export const GenerationPage: React.FC = () => {
  const { episodeId, selectedScriptId, isLoading, error, audioTracks, videoSegments, reload, loadSlices } = useEpisode();
  const [storyboardVideoItems, setStoryboardVideoItems] = useState<StoryboardItemDB[]>([]);
  const [storyboardVideoTotalCount, setStoryboardVideoTotalCount] = useState(0);
  const [storyboardVideoReloadKey, setStoryboardVideoReloadKey] = useState(0);
  const [visibleStoryboardCount, setVisibleStoryboardCount] = useState(GENERATION_INITIAL_STORYBOARD_COUNT);
  const storyboardScopeRef = React.useRef('');

  useEffect(() => {
    loadSlices('audioTracks', 'videoSegments');
  }, [loadSlices]);

  useEffect(() => {
    setVisibleStoryboardCount(GENERATION_INITIAL_STORYBOARD_COUNT);
  }, [episodeId, selectedScriptId]);

  useEffect(() => {
    let active = true;
    if (!episodeId) {
      setStoryboardVideoItems([]);
      setStoryboardVideoTotalCount(0);
      storyboardScopeRef.current = '';
      return () => { active = false; };
    }
    const scopeKey = `${episodeId}:${selectedScriptId || ''}`;
    const isNewScope = storyboardScopeRef.current !== scopeKey;
    if (isNewScope) {
      storyboardScopeRef.current = scopeKey;
      if (visibleStoryboardCount !== GENERATION_INITIAL_STORYBOARD_COUNT) {
        setVisibleStoryboardCount(GENERATION_INITIAL_STORYBOARD_COUNT);
      }
      setStoryboardVideoItems([]);
      setStoryboardVideoTotalCount(0);
    }
    const fetchLimit = isNewScope ? GENERATION_INITIAL_STORYBOARD_COUNT : visibleStoryboardCount;
    getStoryboardItems(episodeId, selectedScriptId || undefined, {
      fields: 'video',
      limit: fetchLimit,
      includeTotal: true,
    })
      .then(res => {
        if (!active) return;
        const nextItems = res.success ? (res.items || []).map(normalizeStoryboardVideoItem) : [];
        setStoryboardVideoItems(nextItems);
        setStoryboardVideoTotalCount(
          res.success && typeof (res as any).total === 'number'
            ? (res as any).total
            : nextItems.length,
        );
      })
      .catch(err => {
        console.warn('storyboard video fields load failed:', err);
        if (active) {
          setStoryboardVideoItems([]);
          setStoryboardVideoTotalCount(0);
        }
      });
    return () => { active = false; };
  }, [episodeId, selectedScriptId, storyboardVideoReloadKey, visibleStoryboardCount]);

  const sortedItems = useMemo(
    () => [...storyboardVideoItems].sort(
      (a, b) => sbSort(a as StoryboardItemDB & Record<string, unknown>) - sbSort(b as StoryboardItemDB & Record<string, unknown>)
    ),
    [storyboardVideoItems]
  );

  const visibleStoryboardItems = useMemo(
    () => sortedItems.slice(0, visibleStoryboardCount),
    [sortedItems, visibleStoryboardCount],
  );

  const hasMoreStoryboardItems = storyboardVideoTotalCount > sortedItems.length;

  const itemStartMs = useMemo(() => {
    const map = new Map<string, number>();
    let t = 0;
    for (const raw of sortedItems) {
      const item = raw as StoryboardItemDB & Record<string, unknown>;
      const id = sbId(item);
      if (!id) continue;
      map.set(id, t);
      const d = sbAudioDurationMs(item);
      t += d != null && d > 0 ? d : 4000;
    }
    return map;
  }, [sortedItems]);

  const visibleVideoSegments = useMemo(
    () => videoSegments.filter((seg) => {
      const sid = segStoryboardItemId(seg as VideoSegment & Record<string, unknown>);
      return !sid || itemStartMs.has(sid);
    }),
    [videoSegments, itemStartMs],
  );

  const totalTimelineMs = useMemo(() => {
    let sum = 0;
    for (const raw of sortedItems) {
      const item = raw as StoryboardItemDB & Record<string, unknown>;
      const d = sbAudioDurationMs(item);
      sum += d != null && d > 0 ? d : 4000;
    }
    if (sum < 1) sum = 8000;
    for (const seg of visibleVideoSegments) {
      const s = seg as VideoSegment & Record<string, unknown>;
      const sid = segStoryboardItemId(s);
      if (!sid) continue;
      const start = itemStartMs.get(sid) ?? 0;
      const len = segDurationMs(s) ?? sbAudioDurationMs(
        sortedItems.find((x) => sbId(x as StoryboardItemDB & Record<string, unknown>) === sid) as StoryboardItemDB & Record<string, unknown>
      ) ?? 4000;
      sum = Math.max(sum, start + len);
    }
    for (const tr of audioTracks) {
      const t = tr as AudioTrack & Record<string, unknown>;
      const startId = trackStartItemId(t);
      const start = startId ? itemStartMs.get(startId) ?? 0 : 0;
      const len = trackDurationMs(t) ?? 3000;
      sum = Math.max(sum, start + len);
    }
    return sum;
  }, [sortedItems, visibleVideoSegments, audioTracks, itemStartMs]);

  const latestSegmentByStoryboardId = useMemo(() => {
    const map = new Map<string, VideoSegment & Record<string, unknown>>();
    const ordered = [...videoSegments].sort(
      (a, b) => segSortOrder(a as VideoSegment & Record<string, unknown>) - segSortOrder(b as VideoSegment & Record<string, unknown>)
    );
    for (const seg of ordered) {
      const s = seg as VideoSegment & Record<string, unknown>;
      const sid = segStoryboardItemId(s);
      if (sid) map.set(sid, s);
    }
    return map;
  }, [videoSegments]);

  const [generatingIds, setGeneratingIds] = useState<Set<string>>(() => new Set());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  const setGenerating = useCallback((itemId: string, on: boolean) => {
    setGeneratingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(itemId); else next.delete(itemId);
      return next;
    });
  }, []);

  const handleGenerate = useCallback(async (item: StoryboardItemDB) => {
    const row = item as StoryboardItemDB & Record<string, unknown>;
    const id = sbId(row);
    if (!episodeId || !id) return;
    setGenerating(id, true);
    try {
      const sortOrder = sbSort(row);
      await createVideoSegment(episodeId, {
        storyboard_item_id: id,
        sort_order: sortOrder,
        generation_mode: 'i2v',
        model: '',
        input_params: {
          video_prompt: row.videoPrompt ?? row.video_prompt ?? '',
          image_url: sbImageUrl(row) ?? '',
          dialogue: sbDialogue(row),
        },
      });
      await reload();
    } catch (e) { console.error(e); }
    finally { setGenerating(id, false); }
  }, [episodeId, reload, setGenerating]);

  const refreshSegmentsOnly = useCallback(async () => {
    if (!episodeId) return;
    try {
      const res = await getVideoSegments(episodeId);
      if (res.success) await reload();
    } catch (e) { console.error(e); }
  }, [episodeId, reload]);

  const refreshGenerationData = useCallback(async () => {
    setStoryboardVideoReloadKey(key => key + 1);
    await refreshSegmentsOnly();
  }, [refreshSegmentsOnly]);

  useEffect(() => {
    const busy = videoSegments.some((seg) => {
      const s = segStatusRaw(seg as VideoSegment & Record<string, unknown>);
      return ['pending', 'processing', 'queued', 'running', 'generating'].includes(s);
    });
    if (!busy || !episodeId) return;
    const timer = window.setInterval(() => void refreshSegmentsOnly(), 5000);
    return () => window.clearInterval(timer);
  }, [videoSegments, episodeId, refreshSegmentsOnly]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) void v.play().catch(() => setPlaying(false));
    else v.pause();
  }, [playing, previewUrl]);

  const pickDefaultPreview = useCallback(() => {
    const withUrl = videoSegments.filter((s) => segVideoUrl(s as VideoSegment & Record<string, unknown>));
    if (withUrl.length === 0) { setPreviewUrl(null); return; }
    const last = withUrl[withUrl.length - 1] as VideoSegment & Record<string, unknown>;
    const url = segVideoUrl(last);
    setPreviewUrl(url ? withAuthParam(url) : null);
  }, [videoSegments]);

  useEffect(() => {
    if (!previewUrl) pickDefaultPreview();
  }, [videoSegments, pickDefaultPreview, previewUrl]);

  const togglePlay = () => { if (!previewUrl) return; setPlaying((p) => !p); };

  if (isLoading) {
    return (
      <div className="min-h-full bg-n20 flex items-center justify-center">
        <Loader size={24} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-n20 text-n800 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-n40 shrink-0 animate-slideDown">
        <div className="flex items-center gap-3">
          <Film size={20} className="text-primary" />
          <div>
            <div className="font-semibold text-base">视频生成工作台</div>
            <div className="text-xs text-n100 mt-0.5">分镜驱动 · 时间轴预览</div>
          </div>
        </div>
        <button
          onClick={() => void refreshGenerationData()}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-primary text-primary hover:bg-primary-light text-sm transition-all"
        >
          <RefreshCw size={14} /> 同步片段
        </button>
      </header>

      {error && <div className="px-5 py-3 text-danger text-sm">{error}</div>}

      <div className="video-workbench-grid flex-1 grid grid-cols-[minmax(280px,340px)_1fr] grid-rows-[1fr_minmax(160px,220px)] gap-3 p-3 min-h-0">
        {/* Left: storyboard list */}
        <aside className="row-span-1 bg-n0 rounded-md border border-n40 shadow-card flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-n40 text-sm font-semibold flex items-center gap-2">
            <ImageIcon size={15} className="text-primary" />
            分镜列表
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 scrollbar-thin">
            {sortedItems.length === 0 ? (
              <div className="text-center py-10 text-n100 text-sm">
                <Plus size={28} className="inline-block mb-2 opacity-30" />
                <div>暂无分镜条目</div>
              </div>
            ) : (
              visibleStoryboardItems.map((raw, idx) => {
                const item = raw as StoryboardItemDB & Record<string, unknown>;
                const id = sbId(item);
                const seg = id ? latestSegmentByStoryboardId.get(id) : undefined;
                const rawStatus = seg ? segStatusRaw(seg) : 'pending';
                const clientGen = id ? generatingIds.has(id) : false;
                const uiStatus = normalizeSegmentUiStatus(rawStatus, clientGen);
                const dur = sbAudioDurationMs(item);
                const durSec = dur != null && dur > 0 ? (dur / 1000).toFixed(1) : '—';
                const img = sbImageUrl(item);

                return (
                  <div
                    key={id || `storyboard-row-${idx}`}
                    className="mb-2.5 p-2.5 rounded-lg bg-n30 border border-n40 hover:border-primary transition-all animate-slideUp"
                    style={{ animationDelay: `${idx * 30}ms` }}
                  >
                    <div className="flex gap-2.5">
                      <div className="relative w-[72px] h-[72px] rounded-lg overflow-hidden shrink-0 bg-n30">
                        {img && <PortraitReferenceStar reference={img} />}
                        {img ? (
                          <MediaImage
                            src={withAuthParam(img)}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-n100">
                            <ImageIcon size={24} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-n100 mb-1 flex items-center gap-1.5">
                          <Clock size={11} /> {durSec}s
                        </div>
                        <div className="text-sm leading-snug max-h-[72px] overflow-hidden">
                          {sbDialogue(item) || <span className="text-n100">（无对白）</span>}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_BADGE[uiStatus]}`}>
                        {statusLabel(uiStatus)}
                      </span>
                      <button
                        disabled={!episodeId || clientGen}
                        onClick={() => void handleGenerate(raw)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {clientGen ? <Loader size={12} className="animate-spin" /> : <Video size={12} />}
                        生成视频
                      </button>
                    </div>
                  </div>
                );
              })
            )}
            {hasMoreStoryboardItems && (
              <button
                type="button"
                onClick={() => setVisibleStoryboardCount(count => (
                  storyboardVideoTotalCount > 0
                    ? Math.min(count + GENERATION_STORYBOARD_PAGE_SIZE, storyboardVideoTotalCount)
                    : count + GENERATION_STORYBOARD_PAGE_SIZE
                ))}
                className="w-full mt-1.5 px-3 py-2 rounded-lg border border-n40 bg-n0 hover:border-primary hover:text-primary text-xs text-n300 transition-colors"
              >
                加载更多镜头（{Math.min(sortedItems.length, storyboardVideoTotalCount)} / {storyboardVideoTotalCount}）
              </button>
            )}
          </div>
        </aside>

        {/* Right: preview */}
        <section className="row-span-1 bg-n0 rounded-md border border-n40 shadow-card flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-n40 text-sm font-semibold flex items-center gap-2">
            <Video size={15} className="text-primary" />
            视频预览
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-4 min-h-[200px]">
            {previewUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={previewUrl}
                  preload="none"
                  className="max-w-full rounded-lg bg-black"
                  style={{ maxHeight: 'calc(100% - 56px)' }}
                  controls={false}
                  playsInline
                  onEnded={() => setPlaying(false)}
                />
                <div className="mt-3 flex gap-2.5">
                  <button
                    onClick={togglePlay}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-primary bg-primary-light hover:bg-primary-light text-primary text-sm transition-all"
                  >
                    {playing ? <Pause size={16} /> : <Play size={16} />}
                    {playing ? '暂停' : '播放'}
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center text-n100">
                <Film size={40} className="mx-auto mb-3 opacity-25" />
                <p className="text-sm">暂无成片，生成后将在此播放</p>
                <p className="text-xs mt-2 opacity-70">点击下方时间轴上的视频块可切换预览</p>
              </div>
            )}
          </div>
        </section>

        {/* Bottom: timeline */}
        <div className="col-span-2 bg-n0 rounded-md border border-n40 shadow-card p-4 flex flex-col min-h-0 overflow-hidden">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Clock size={15} className="text-primary" />
            时间轴
            <span className="font-normal text-xs text-n100">
              {(totalTimelineMs / 1000).toFixed(1)}s 总时长
            </span>
          </div>
          <div className="flex-1 overflow-x-auto overflow-y-auto scrollbar-thin">
            {/* Audio tracks */}
            {audioTracks.map((tr, ti) => {
              const t = tr as AudioTrack & Record<string, unknown>;
              const tid = String(t.trackId ?? t.track_id ?? `audio-${ti}`);
              const tt = trackType(t);
              const startId = trackStartItemId(t);
              const endId = trackEndItemId(t);
              const startMs = startId ? itemStartMs.get(startId) ?? 0 : 0;
              let spanMs = trackDurationMs(t);
              if (spanMs == null || spanMs <= 0) {
                if (endId && startId) {
                  const a = itemStartMs.get(startId) ?? 0;
                  const b = itemStartMs.get(endId) ?? a;
                  const endItem = sortedItems.find(
                    (x) => sbId(x as StoryboardItemDB & Record<string, unknown>) === endId
                  ) as StoryboardItemDB & Record<string, unknown> | undefined;
                  const endDur = endItem ? sbAudioDurationMs(endItem) ?? 4000 : 4000;
                  spanMs = Math.max(800, b - a + endDur);
                } else spanMs = Math.min(totalTimelineMs, 4000);
              }
              const left = (startMs / totalTimelineMs) * 100;
              const width = (spanMs / totalTimelineMs) * 100;
              const color = audioTrackColor(tt);
              return (
                <div key={tid} className="mb-2">
                  <div className="text-[11px] text-n100 mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                    {trackName(t)}
                    <span className="opacity-60">({tt})</span>
                  </div>
                  <div className="h-7 bg-n30 rounded-md relative overflow-hidden">
                    <div
                      title={`${trackName(t)} · ${(spanMs / 1000).toFixed(2)}s`}
                      className="absolute top-1 bottom-1 rounded"
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(width, 1.5)}%`,
                        background: color,
                        opacity: 0.9,
                        boxShadow: `0 0 12px ${color}55`,
                      }}
                    />
                  </div>
                </div>
              );
            })}

            {/* Video track */}
            <div className="mb-2 mt-1">
              <div className="text-[11px] text-n100 mb-1 flex items-center gap-1.5">
                <Film size={11} /> 视频轨
              </div>
              <div className="h-9 bg-n30 rounded-md relative overflow-hidden">
                {visibleVideoSegments.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] text-n100">
                    无视频片段
                  </div>
                ) : (
                  visibleVideoSegments.map((seg) => {
                    const s = seg as VideoSegment & Record<string, unknown>;
                    const sid = segStoryboardItemId(s);
                    const startMs2 = sid ? itemStartMs.get(sid) ?? 0 : 0;
                    const len = segDurationMs(s) ??
                      (sid ? (() => {
                        const it = sortedItems.find(
                          (x) => sbId(x as StoryboardItemDB & Record<string, unknown>) === sid
                        ) as StoryboardItemDB & Record<string, unknown> | undefined;
                        return it ? sbAudioDurationMs(it) ?? 4000 : 4000;
                      })() : 4000);
                    const left = (startMs2 / totalTimelineMs) * 100;
                    const width = (len / totalTimelineMs) * 100;
                    const url = segVideoUrl(s);
                    const st = normalizeSegmentUiStatus(segStatusRaw(s), false);
                    return (
                      <button
                        key={segId(s)}
                        title={segId(s)}
                        onClick={() => { if (url) { setPreviewUrl(withAuthParam(url)); setPlaying(false); } }}
                        className="absolute top-1 bottom-1 rounded border border-primary flex items-center justify-center gap-1 min-w-[24px] transition-colors hover:brightness-110"
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 2)}%`,
                          background: st === 'completed' ? 'rgba(99,102,241,0.45)' : st === 'error' ? 'rgba(239,68,68,0.35)' : 'rgba(99,102,241,0.2)',
                          cursor: url ? 'pointer' : 'default',
                        }}
                      >
                        <Video size={10} className="text-white" />
                        <span className="text-[9px] text-white/80 overflow-hidden text-ellipsis whitespace-nowrap">
                          {statusLabel(st)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
import { PortraitReferenceStar } from '../components/SeedreamSourceBadge';
