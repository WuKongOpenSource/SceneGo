import React, { useEffect, useRef, useState } from 'react';
import { Loader, RotateCcw, X } from 'lucide-react';
import { fetchEntityFiles, type EntityFile } from '../services/entityFileService';
import { secureApiUrl } from '../services/httpClient';
import { videoSourceLabels, videoSourceSettings } from '../utils/videoSourceVersions';

interface Props {
  sourceId: string;
  currentUrl: string;
  labels: string[];
  requiredDuration: number;
  disabled?: boolean;
  onSelect: (file: EntityFile) => Promise<void>;
}

export function VideoSourceControls({ sourceId, currentUrl, labels, requiredDuration, disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<EntityFile[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<EntityFile>();
  const [duration, setDuration] = useState<number>();
  const [retry, setRetry] = useState(0);
  const scope = useRef(sourceId);
  scope.current = sourceId;
  useEffect(() => { setOpen(false); setFiles([]); setSelected(undefined); setOffset(0); }, [sourceId]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError('');
    fetchEntityFiles('video_segment', sourceId, 'video', offset).then(result => {
      if (!active) return;
      setFiles(previous => {
        const versions = [...(offset ? previous : []), ...result.items]
          .filter(file => file.fileType === 'video' && file.fileRole === 'video' && !file.isDeleted && !file.deletedAt && file.fileUrl);
        return [...new Map(versions.map(file => [file.fileId, file])).values()];
      });
      setTotal(result.total);
    }).catch(() => { if (active) setError('素材版本加载失败，请重试。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, sourceId, offset, retry]);
  const choose = (file: EntityFile) => {
    setSelected(file); setDuration(undefined); setError('');
  };
  const close = () => { if (!busy) { setOpen(false); setSelected(undefined); setOffset(0); } };
  const tooShort = duration !== undefined && duration + 0.001 < requiredDuration;
  const submit = async () => {
    if (!selected || !duration || tooShort || busy) return;
    const capturedSource = sourceId;
    setBusy(true); setError('');
    try {
      await onSelect({ ...selected, durationSeconds: duration });
      if (scope.current === capturedSource) { setOpen(false); setSelected(undefined); setOffset(0); }
    } catch {
      if (scope.current === capturedSource) setError('切换未完成，请检查保存状态后重试。不会删除任何素材版本。');
    } finally { setBusy(false); }
  };
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-1 text-[11px]" aria-label="当前素材处理状态">
      {(labels.length ? labels : ['原素材']).map(label => <span key={label} className="rounded bg-primary-light px-2 py-0.5 text-primary">{label}</span>)}
    </div>
    <button type="button" disabled={disabled || busy} onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50">
      <RotateCcw size={12} />{labels.length ? '恢复原素材' : '切换素材版本'}
    </button>
    {open && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onMouseDown={event => event.stopPropagation()}>
      <section role="dialog" aria-modal="true" aria-label="恢复原素材" className="w-full max-w-xl rounded-xl bg-n0 p-5 shadow-xl"
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') close(); }}>
        <header className="flex items-center justify-between"><h3 className="font-semibold text-n700">选择素材版本</h3>
          <button type="button" aria-label="关闭素材版本" disabled={busy} onClick={close}><X size={18} /></button></header>
        <p className="my-3 text-xs leading-5 text-n300">同一素材的切分片段会同步切换。保留各自的入点、时长、位置、转场、字幕及音轨，不删除高清版本。</p>
        <div className="max-h-52 space-y-2 overflow-auto" role="radiogroup" aria-label="素材版本">
          {files.map((file, index) => {
            const current = secureApiUrl(file.fileUrl, { requireAuth: false }) === currentUrl;
            const versionLabels = videoSourceLabels(videoSourceSettings(file));
            return <label key={file.fileId} className={`flex cursor-pointer items-center gap-2 rounded border p-2 text-xs ${selected?.fileId === file.fileId ? 'border-primary' : 'border-n40'}`}>
              <input type="radio" name="video-source-version" disabled={busy || current} checked={selected?.fileId === file.fileId} onChange={() => choose(file)} />
              <span className="min-w-0 flex-1">{versionLabels.join(' · ') || '原素材'} · 版本 {index + 1}
                <span className="ml-2 text-n300">{file.createdAt ? new Date(file.createdAt).toLocaleString() : ''}</span></span>
              {current && <span className="shrink-0 text-primary">当前使用</span>}
            </label>;
          })}
          {!loading && !files.length && <p className="text-xs text-n300">没有可用的历史素材版本。</p>}
        </div>
        {loading && <p className="mt-2 flex items-center gap-1 text-xs text-n300"><Loader size={12} className="animate-spin" />正在读取素材版本…</p>}
        {!loading && offset + 50 < total && <button type="button" disabled={busy} className="mt-2 text-xs text-primary" onClick={() => setOffset(value => value + 50)}>加载更多版本</button>}
        {selected && <div className="mt-3">
          <video key={`${selected.fileId}:${retry}`} aria-label="待恢复素材预览" controls preload="metadata"
            src={secureApiUrl(selected.fileUrl, { requireAuth: false })} className="max-h-48 w-full rounded bg-black"
            onLoadedMetadata={event => {
              const value = event.currentTarget.duration;
              if (Number.isFinite(value) && value > 0) setDuration(value);
              else setError('无法核验该素材时长，请选择其他版本。');
            }} onError={() => { setDuration(undefined); setError('该素材无法读取，请选择其他版本或重试。'); }} />
          {duration === undefined && !error && <p className="mt-1 text-xs text-n300">正在核验素材时长…</p>}
        </div>}
        {tooShort && <p role="alert" className="mt-2 text-xs text-danger">该素材不足以覆盖当前剪辑所需的 {requiredDuration.toFixed(2)} 秒，不能直接恢复。请先调整裁剪，避免时间轴错位。</p>}
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error} <button type="button" disabled={busy} onClick={() => { setDuration(undefined); setRetry(value => value + 1); }} className="underline">重新读取</button></p>}
        <footer className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={close} className="rounded border border-n40 px-3 py-2 text-xs">取消</button>
          <button type="button" disabled={busy || loading || !selected || !duration || tooShort} onClick={() => void submit()}
            className="rounded bg-primary px-3 py-2 text-xs text-white disabled:opacity-50">{busy ? '正在保存…' : '确认使用此素材'}</button>
        </footer>
      </section>
    </div>}
  </div>;
}
