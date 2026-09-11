import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Plus, Sparkles, Square, SkipBack, Wand2, Trash2 } from 'lucide-react';

export interface TimelineClip {
  id: string;
  label: string;
  track: 'narration' | 'dialogue' | 'bgm' | 'sfx' | 'image';
  audioUrl?: string;
  imageUrl?: string;
  durationMs: number;
  startMs: number;
  color?: string;
}

export interface TimelineTrackProps {
  mode: 'audio-only' | 'combined';
  clips: TimelineClip[];
  totalDurationMs: number;
  onClipClick?: (clip: TimelineClip) => void;
  showPreview?: boolean;
  onAddBgm?: () => void;
  onGenerateBgm?: () => void;
  onAddSfx?: () => void;
  onGenerateSfx?: () => void;
  onDeleteClip?: (clip: TimelineClip) => void | Promise<void>;
}

const TRACK_COLORS: Record<string, string> = {
  narration: 'bg-amber-500/60',
  dialogue: 'bg-sky-500/60',
  bgm: 'bg-emerald-500/40',
  sfx: 'bg-blue-500/40',
  image: 'bg-violet-500/50',
};

const TRACK_LABELS: Record<string, string> = {
  narration: '旁白',
  dialogue: '台词',
  bgm: 'BGM',
  sfx: '音效',
  image: '分镜',
};

function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const sec = ms / 1000;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export const TimelineTrack: React.FC<TimelineTrackProps> = ({
  mode, clips, totalDurationMs, onClipClick, showPreview = false,
  onAddBgm, onGenerateBgm, onAddSfx, onGenerateSfx,
  onDeleteClip,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const rafRef = useRef<number>(0);
  const startTsRef = useRef(0);
  const pausedAtRef = useRef(0);
  const playingRef = useRef(false);
  const positionRef = useRef(0);
  const scrubRef = useRef<{ pointerId: number; startX: number; moved: boolean; resume: boolean; target: Element } | null>(null);
  const suppressClickRef = useRef(false);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  const effectiveTotal = Number.isFinite(totalDurationMs) ? Math.max(0, totalDurationMs) : 0;

  const releaseScrub = useCallback(() => {
    const scrub = scrubRef.current;
    scrubRef.current = null;
    if (scrub?.target.hasPointerCapture?.(scrub.pointerId)) scrub.target.releasePointerCapture(scrub.pointerId);
    return scrub;
  }, []);

  const tracks = useMemo(() => {
    const order = mode === 'combined'
      ? ['image', 'narration', 'dialogue', 'bgm', 'sfx']
      : ['narration', 'dialogue', 'bgm', 'sfx'];
    return order.filter(t => (
      clips.some(c => c.track === t)
      || (t === 'bgm' && Boolean(onAddBgm || onGenerateBgm))
      || (t === 'sfx' && Boolean(onAddSfx || onGenerateSfx))
    ));
  }, [clips, mode, onAddBgm, onAddSfx, onGenerateBgm, onGenerateSfx]);

  const renderTrackActions = (trackId: string) => {
    if (trackId !== 'bgm' && trackId !== 'sfx') return null;
    const onAdd = trackId === 'bgm' ? onAddBgm : onAddSfx;
    const onGenerate = trackId === 'bgm' ? onGenerateBgm : onGenerateSfx;
    return (
      <div className="flex items-center gap-1">
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex h-6 items-center gap-0.5 rounded border border-n40 bg-n0 px-1.5 text-[9px] font-semibold text-n700 hover:bg-n30"
            title={trackId === 'bgm' ? '添加本地 BGM' : '添加本地音效'}
          >
            <Plus size={10} /> 添加
          </button>
        )}
        {onGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            className={`inline-flex h-6 items-center gap-0.5 rounded px-1.5 text-[9px] font-semibold text-white ${
              trackId === 'bgm' ? 'bg-success hover:bg-success' : 'bg-primary hover:bg-primary-hover'
            }`}
            title={trackId === 'bgm' ? 'AI 音乐制作' : 'AI 音效制作'}
          >
            {trackId === 'bgm' ? <Wand2 size={10} /> : <Sparkles size={10} />} AI 生成
          </button>
        )}
      </div>
    );
  };

  const clipsByTrack = useMemo(() => {
    const m = new Map<string, TimelineClip[]>();
    for (const c of clips) {
      const arr = m.get(c.track) || [];
      arr.push(c);
      m.set(c.track, arr);
    }
    return m;
  }, [clips]);

  const tick = useCallback(() => {
    if (!playingRef.current) return;
    const elapsed = Date.now() - startTsRef.current;
    const ms = pausedAtRef.current + elapsed;
    if (ms >= effectiveTotal) {
      playingRef.current = false;
      positionRef.current = effectiveTotal;
      pausedAtRef.current = effectiveTotal;
      setCurrentTimeMs(effectiveTotal);
      setIsPlaying(false);
      audioRefs.current.forEach(el => el.pause());
      return;
    }
    positionRef.current = ms;
    setCurrentTimeMs(ms);
    rafRef.current = requestAnimationFrame(tick);
  }, [effectiveTotal]);

  const handlePlay = useCallback(() => {
    if (playingRef.current || effectiveTotal <= 0) return;
    if (pausedAtRef.current >= effectiveTotal) {
      pausedAtRef.current = 0;
      positionRef.current = 0;
      setCurrentTimeMs(0);
    }
    playingRef.current = true;
    startTsRef.current = Date.now();
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(tick);

    clips.forEach(c => {
      if (!c.audioUrl) return;
      const el = audioRefs.current.get(c.id);
      if (!el) return;
      const relMs = pausedAtRef.current - c.startMs;
      if (relMs >= 0 && relMs < c.durationMs) {
        el.currentTime = relMs / 1000;
        el.play().catch(() => {});
      }
    });
  }, [effectiveTotal, tick, clips]);

  const handlePause = useCallback(() => {
    playingRef.current = false;
    setIsPlaying(false);
    cancelAnimationFrame(rafRef.current);
    pausedAtRef.current = positionRef.current;
    audioRefs.current.forEach(el => el.pause());
  }, []);

  const handleStop = useCallback(() => {
    releaseScrub();
    playingRef.current = false;
    positionRef.current = 0;
    setIsPlaying(false);
    cancelAnimationFrame(rafRef.current);
    pausedAtRef.current = 0;
    setCurrentTimeMs(0);
    audioRefs.current.forEach(el => { el.pause(); el.currentTime = 0; });
  }, [releaseScrub]);

  const seekTo = useCallback((targetMs: number) => {
    if (!Number.isFinite(targetMs)) return;
    const ms = Math.max(0, Math.min(effectiveTotal, targetMs));
    pausedAtRef.current = ms;
    positionRef.current = ms;
    setCurrentTimeMs(ms);
    if (ms >= effectiveTotal) handlePause();
    if (playingRef.current) {
      startTsRef.current = Date.now();
    }
    clips.forEach(clip => {
      const el = audioRefs.current.get(clip.id);
      if (!el) return;
      const relativeMs = ms - clip.startMs;
      const inRange = relativeMs >= 0 && relativeMs < clip.durationMs;
      el.currentTime = inRange ? relativeMs / 1000 : 0;
      if (inRange && playingRef.current) {
        if (el.paused) el.play().catch(() => {});
      } else {
        el.pause();
      }
    });
  }, [effectiveTotal, clips, handlePause]);

  const seekFromClientX = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    seekTo(((clientX - rect.left) / rect.width) * effectiveTotal);
  }, [effectiveTotal, seekTo]);

  const beginScrub = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false || scrubRef.current || effectiveTotal <= 0) return;
    event.preventDefault();
    suppressClickRef.current = false;
    const target = event.target instanceof Element ? event.target : event.currentTarget;
    scrubRef.current = { pointerId: event.pointerId, startX: event.clientX, moved: false, resume: playingRef.current, target };
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      // Window listeners still handle dragging if capture is unavailable.
    }
    handlePause();
    seekFromClientX(event.clientX);
  }, [effectiveTotal, handlePause, seekFromClientX]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const scrub = scrubRef.current;
      if (!scrub || event.pointerId !== scrub.pointerId) return;
      scrub.moved ||= Math.abs(event.clientX - scrub.startX) > 3;
      seekFromClientX(event.clientX);
    };
    const end = (event: PointerEvent) => {
      const scrub = scrubRef.current;
      if (!scrub || event.pointerId !== scrub.pointerId) return;
      releaseScrub();
      suppressClickRef.current = scrub.moved || Math.abs(event.clientX - scrub.startX) > 3;
      seekFromClientX(event.clientX);
      if (scrub.resume && positionRef.current < effectiveTotal) handlePlay();
    };
    const cancel = (event: PointerEvent | Event) => {
      if (!scrubRef.current || ('pointerId' in event && event.pointerId !== scrubRef.current.pointerId)) return;
      releaseScrub();
      suppressClickRef.current = true;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('lostpointercapture', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, [effectiveTotal, handlePlay, releaseScrub, seekFromClientX]);

  const handleSeekKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 1000 : 100;
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? effectiveTotal
      : event.key === 'ArrowLeft' ? positionRef.current - step
        : event.key === 'ArrowRight' ? positionRef.current + step : null;
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    seekTo(target);
  };

  useEffect(() => {
    if (positionRef.current > effectiveTotal) seekTo(effectiveTotal);
    if (playingRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [effectiveTotal, seekTo, tick]);

  useEffect(() => {
    return () => {
      releaseScrub();
      playingRef.current = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [releaseScrub]);

  useEffect(() => {
    const players = [...audioRefs.current.values()];
    return () => players.forEach(player => player.pause());
  }, [clips]);

  useEffect(() => {
    if (!isPlaying) return;
    clips.forEach(c => {
      if (!c.audioUrl) return;
      const el = audioRefs.current.get(c.id);
      if (!el) return;
      const inRange = currentTimeMs >= c.startMs && currentTimeMs < c.startMs + c.durationMs;
      if (inRange && el.paused) {
        el.currentTime = (currentTimeMs - c.startMs) / 1000;
        el.play().catch(() => {});
      } else if (!inRange && !el.paused) {
        el.pause();
      }
    });
  }, [isPlaying, currentTimeMs, clips]);

  const playheadPct = (currentTimeMs / (effectiveTotal || 1)) * 100;

  const currentImageClip = useMemo(() => {
    if (!showPreview) return null;
    const previewTime = Math.min(currentTimeMs, Math.max(0, effectiveTotal - 1));
    return clips.find(c =>
      c.track === 'image' &&
      previewTime >= c.startMs &&
      previewTime < c.startMs + c.durationMs
    ) || clips.find(c => c.track === 'image') || null;
  }, [showPreview, clips, currentTimeMs, effectiveTotal]);

  return (
    <div className="bg-n0 rounded-md border border-n40 p-4 shadow-card">
      <div className={showPreview ? 'flex gap-4' : ''}>
        {showPreview && (
          <div className="shrink-0 w-[200px]">
            <div className="w-[200px] h-[120px] bg-black rounded-lg overflow-hidden border border-n40 flex items-center justify-center">
              {currentImageClip?.imageUrl ? (
                <img
                  src={currentImageClip.imageUrl}
                  alt={currentImageClip.label}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-n100 text-xs">无画面</span>
              )}
            </div>
            <p className="text-[10px] text-n100 mt-1 truncate text-center">
              {currentImageClip?.label || '—'}
            </p>
          </div>
        )}
        <div className="flex-1 min-w-0">
          {/* Controls */}
          <div className="flex items-center gap-3 mb-3">
            <button
              aria-label="回到开头"
              onClick={handleStop}
              className="w-8 h-8 rounded-lg bg-n0 hover:bg-n20 flex items-center justify-center text-n300 transition-colors"
            >
              <SkipBack size={14} />
            </button>
            <button
              aria-label={isPlaying ? '暂停' : '播放'}
              disabled={effectiveTotal <= 0}
              onClick={isPlaying ? handlePause : handlePlay}
              className="w-10 h-10 rounded-lg bg-primary hover:bg-primary-hover flex items-center justify-center text-white transition-colors"
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              aria-label="停止"
              onClick={handleStop}
              className="w-8 h-8 rounded-lg bg-n0 hover:bg-n20 flex items-center justify-center text-n300 transition-colors"
            >
              <Square size={14} />
            </button>
            <span className="text-sm text-n300 tabular-nums ml-2">
              {fmtTime(currentTimeMs)} / {fmtTime(effectiveTotal)}
            </span>
          </div>

          {/* Tracks */}
          <div className="flex min-w-[640px] select-none">
            <div className="w-48 shrink-0 pr-2">
              <div className="h-5 mb-1 border-b border-n40" />
              {tracks.map(trackId => (
                <div key={`label-${trackId}`} className="mb-1 flex h-10 items-center justify-between gap-1 text-[9px] text-n100">
                  <span className="font-medium">{TRACK_LABELS[trackId] || trackId}</span>
                  {renderTrackActions(trackId)}
                </div>
              ))}
            </div>
            <div
              ref={containerRef}
              data-testid="timeline-seek-surface"
              className="relative min-w-0 flex-1 cursor-crosshair touch-none"
              onPointerDown={beginScrub}
              onDragStart={event => event.preventDefault()}
              onClickCapture={event => {
                if (!suppressClickRef.current) return;
                suppressClickRef.current = false;
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={event => seekFromClientX(event.clientX)}
            >
              {/* Playhead */}
              <div
                role="slider"
                tabIndex={0}
                aria-label="播放位置"
                aria-orientation="horizontal"
                aria-valuemin={0}
                aria-valuemax={effectiveTotal}
                aria-valuenow={Math.round(currentTimeMs)}
                aria-valuetext={`${(currentTimeMs / 1000).toFixed(1)} 秒 / ${(effectiveTotal / 1000).toFixed(1)} 秒`}
                onPointerDown={event => event.currentTarget.focus({ preventScroll: true })}
                onKeyDown={handleSeekKeyDown}
                title="拖动播放指针定位，方向键微调，Shift + 方向键移动 1 秒"
                className="absolute top-0 bottom-0 w-5 -translate-x-1/2 z-20 cursor-col-resize touch-none rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                style={{ left: `${playheadPct}%` }}
              >
                <div className="absolute top-0 bottom-0 left-1/2 w-0.5 -translate-x-1/2 bg-red-500 pointer-events-none" />
                <div className="absolute left-1/2 top-0 w-3 h-3 -translate-x-1/2 -translate-y-1/2 bg-red-500 rounded-full pointer-events-none" />
              </div>

              {/* Time ruler */}
              <div className="h-5 relative mb-1 border-b border-n40">
                {[0, 0.25, 0.5, 0.75, 1].map(pct => (
                  <span
                    key={pct}
                    className="absolute text-[9px] text-n100 -translate-x-1/2"
                    style={{ left: `${pct * 100}%` }}
                  >
                    {fmtTime(pct * effectiveTotal)}
                  </span>
                ))}
              </div>

              {/* Track rows */}
              {tracks.map(trackId => {
                const trackClips = clipsByTrack.get(trackId) || [];
                return (
                  <div key={trackId} className="mb-1 h-10 rounded bg-n30 relative overflow-hidden">
                    {trackClips.map(clip => {
                      const leftPct = (clip.startMs / (effectiveTotal || 1)) * 100;
                      const widthPct = (clip.durationMs / (effectiveTotal || 1)) * 100;
                      const colorClass = clip.color || TRACK_COLORS[clip.track] || 'bg-n300';
                      const canDelete = Boolean(onDeleteClip && (clip.track === 'bgm' || clip.track === 'sfx'));

                      return (
                        <div
                          key={clip.id}
                          className={`group absolute top-0.5 bottom-0.5 rounded ${colorClass} flex items-center overflow-hidden cursor-pointer hover:brightness-110 transition-all`}
                          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%` }}
                          onClick={e => { e.stopPropagation(); seekFromClientX(e.clientX); onClipClick?.(clip); }}
                          title={`${clip.label} (${fmtTime(clip.durationMs)})`}
                        >
                          {clip.track === 'image' && clip.imageUrl ? (
                            <img src={clip.imageUrl} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
                          ) : (
                            <span className={`text-[8px] text-white/70 truncate px-1 ${canDelete ? 'pr-5' : ''}`}>{clip.label}</span>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onPointerDown={e => e.stopPropagation()}
                              onClick={e => {
                                e.stopPropagation();
                                void onDeleteClip?.(clip);
                              }}
                              className="absolute right-0.5 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded bg-black/35 text-white/80 opacity-0 transition-opacity hover:bg-danger hover:text-white group-hover:opacity-100"
                              title={clip.track === 'bgm' ? '删除 BGM' : '删除音效'}
                            >
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Hidden audio elements */}
      {clips.filter(c => c.audioUrl).map(c => (
        <audio
          key={c.id}
          ref={el => { if (el) audioRefs.current.set(c.id, el); else audioRefs.current.delete(c.id); }}
          src={c.audioUrl}
          preload="metadata"
          className="hidden"
        />
      ))}
    </div>
  );
};
