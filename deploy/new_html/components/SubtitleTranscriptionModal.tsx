import React, { useEffect, useRef, useState } from 'react';
import { Captions, Loader, X } from 'lucide-react';
import type { EnhanceMediaClip } from '../utils/enhanceSourceClips';
import type { EnhanceSubtitleCue } from '../utils/enhanceTimelineEditor';
import { getAudioTranscriptionCapability, transcribeTimelineAudio } from '../services/audioTranscriptionService';
import { buildSubtitleChunks, isAutomaticSubtitle, mergeSubtitleResults, subtitleTimelineKey, type SubtitleSource, type SubtitleMergeMode } from '../utils/subtitleTranscription';

interface Props {
  episodeId: string;
  projectId?: string;
  clips: EnhanceMediaClip[];
  subtitles: EnhanceSubtitleCue[];
  defaultSource: SubtitleSource;
  onClose: () => void;
  onApply: (cues: EnhanceSubtitleCue[], mode: SubtitleMergeMode, expectedTimeline: string) => void;
}

export function SubtitleTranscriptionModal({ episodeId, projectId, clips, subtitles, defaultSource, onClose, onApply }: Props) {
  const [source, setSource] = useState(defaultSource);
  const [mode, setMode] = useState<SubtitleMergeMode>('fill_gaps');
  const [capability, setCapability] = useState<{ available: boolean; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ cues: EnhanceSubtitleCue[]; timeline: string; silent: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void getAudioTranscriptionCapability(episodeId).then(value => { if (active) setCapability(value); })
      .catch(() => { if (active) setCapability({ available: false, reason: '暂时无法读取识别服务状态，请关闭后重试' }); });
    return () => { active = false; controller.current?.abort(); };
  }, [episodeId]);
  const plan = (() => { try { return { chunks: buildSubtitleChunks(clips, source), error: '' }; }
    catch (caught) { return { chunks: [], error: (caught as Error).message }; } })();
  const preview = mergeSubtitleResults(subtitles, result?.cues || [], mode);
  const stale = result && result.timeline !== subtitleTimelineKey(clips);
  const generate = async () => {
    if (controller.current || !capability?.available) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError(''); setResult(null);
    const timeline = subtitleTimelineKey(clips);
    const cues: EnhanceSubtitleCue[] = [];
    let silent = 0;
    try {
      for (let index = 0; index < plan.chunks.length; index++) {
        const chunk = plan.chunks[index];
        setProgress(`正在识别 ${index + 1}/${plan.chunks.length}：${chunk.label}`);
        const segments = await transcribeTimelineAudio(episodeId, projectId, [chunk], abort.signal);
        if (abort.signal.aborted) return;
        if (!segments.length) silent++;
        for (const segment of segments) {
          if (segment.clipId !== chunk.clipId || !Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs) || segment.startMs < 0 || segment.endMs > chunk.durationMs + 150 || segment.endMs <= segment.startMs) throw new Error('识别结果时间点无效，请重试');
          cues.push({ id: `asr_${crypto.randomUUID()}`, text: segment.text,
            startTime: (chunk.timelineStartMs + segment.startMs) / 1000,
            duration: (Math.min(chunk.durationMs, segment.endMs) - segment.startMs) / 1000 });
        }
      }
      setResult({ cues, timeline, silent });
      setProgress('');
    } catch (caught) {
      if (!abort.signal.aborted) setError((caught as Error).message || '识别失败，请重试');
    } finally {
      if (controller.current === abort) { controller.current = null; setBusy(false); }
    }
  };
  const close = () => { controller.current?.abort(); onClose(); };
  const apply = () => {
    if (!result || stale || !preview.added) return;
    if (mode === 'replace' && subtitles.length && !window.confirm(`确认替换当前 ${subtitles.length} 条字幕？可通过撤销恢复。`)) return;
    if (mode === 'update_generated' && subtitles.some(isAutomaticSubtitle) && !window.confirm('将更新旧自动字幕和未填写占位块，保留手写字幕；修改过的自动字幕也会被更新，是否继续？')) return;
    try { onApply(result.cues, mode, result.timeline); onClose(); }
    catch (caught) { setError((caught as Error).message); }
  };
  return <div className="fixed inset-0 z-[150] flex items-center justify-center bg-n900/50 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="AI 字幕">
    <div className="w-full max-w-2xl max-h-[85vh] overflow-auto rounded-xl border border-n40 bg-n0 p-5 shadow-xl space-y-4">
      <div className="flex items-center justify-between"><h2 className="font-semibold flex items-center gap-2"><Captions size={18} className="text-primary" />AI 字幕</h2><button type="button" onClick={close} aria-label="关闭 AI 字幕"><X size={18} /></button></div>
      <p className="text-sm text-n300">识别人声，按实际说话时间生成字幕。先预览结果，再加入时间线；加入后可编辑文字、调整样式和时间，并随成片导出。</p>
      <label className="block text-sm text-n700">识别来源<select className="mt-2 w-full rounded-lg border border-n40 bg-n0 p-2.5" value={source} disabled={busy} onChange={e => { setSource(e.target.value as SubtitleSource); setResult(null); setError(''); }}>
        <option value="video_original">视频原声</option><option value="reference_dubbing">配音轨（对白与旁白）</option>
      </select></label>
      <p className="text-xs text-n300">{plan.chunks.length} 个片段，约 {Math.ceil(plan.chunks.reduce((sum, chunk) => sum + chunk.durationMs, 0) / 1000)} 秒</p>
      {!capability && <p className="text-xs text-n300">正在检查识别服务…</p>}
      {(error || plan.error || stale || capability?.reason) && <p role="alert" className="rounded-lg bg-danger/5 p-3 text-sm text-danger">{stale ? '识别期间时间线已变化，请重新识别；当前字幕已保留。' : error || plan.error || capability?.reason}</p>}
      {!plan.chunks.length && !plan.error && <p className="text-sm text-n300">所选来源没有可识别片段，请加入视频或配音。</p>}
      {busy && <p role="status" className="flex items-center gap-2 text-sm text-primary"><Loader size={16} className="animate-spin" />{progress}</p>}
      {result && <>
        <p role="status" className="text-sm">已识别 {result.cues.length} 条字幕{result.silent ? `，${result.silent} 段未识别到人声或没有音轨` : ''}。</p>
        {result.cues.length > 0 && <>
          <label className="block text-sm">加入方式<select className="mt-2 w-full rounded-lg border border-n40 bg-n0 p-2.5" value={mode} onChange={e => setMode(e.target.value as SubtitleMergeMode)}>
            <option value="fill_gaps">保留已有字幕，补充空白时段</option>
            <option value="update_generated">更新自动字幕和占位块，保留手写字幕</option>
            <option value="replace">替换全部字幕（确认后应用）</option>
          </select></label>
          <p className="text-xs text-n300">将加入 {preview.added} 条，跳过 {preview.skipped} 条重叠结果。可通过时间线撤销恢复。</p>
          <div className="max-h-56 overflow-auto rounded-lg border border-n40 divide-y divide-n40">{result.cues.map(cue => <div key={cue.id} className="flex gap-3 p-2.5 text-sm"><span className="shrink-0 font-mono text-xs text-n300">{cue.startTime.toFixed(2)}–{(cue.startTime + cue.duration).toFixed(2)}s</span><span>{cue.text}</span></div>)}</div>
        </>}
      </>}
      <div className="flex justify-end gap-2 border-t border-n40 pt-4">
        <button type="button" className="rounded-lg border border-n40 px-3 py-2 text-sm" onClick={close}>{busy ? '取消识别' : '取消'}</button>
        <button type="button" className="rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-40" disabled={busy || !capability?.available || !plan.chunks.length || !!plan.error} onClick={() => void generate()}>{result ? '重新识别' : '开始识别'}</button>
        {result && <button type="button" className="rounded-lg bg-success px-3 py-2 text-sm text-white disabled:opacity-40" disabled={busy || !!stale || !preview.added} onClick={apply}>加入字幕轨道</button>}
      </div>
    </div>
  </div>;
}
