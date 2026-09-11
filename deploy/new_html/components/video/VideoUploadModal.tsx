import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
import {
  readUploadedVideoDuration, VIDEO_UPLOAD_ACCEPT, type VideoImportDraft,
} from '../../services/videoUploadService';

export interface VideoUploadTarget {
  uuid: string;
  label: string;
  hasResult: boolean;
  busy: boolean;
}

interface Props {
  targets: VideoUploadTarget[];
  initialTarget?: string;
  onClose: () => void;
  onImport: (file: File, durationMs: number, target: string, selectForEnhance: boolean, draft: VideoImportDraft) => Promise<void>;
}

export function VideoUploadModal({ targets, initialTarget = '', onClose, onImport }: Props) {
  const [target, setTarget] = useState(initialTarget);
  const [file, setFile] = useState<File | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectForEnhance, setSelectForEnhance] = useState(false);
  const draft = useRef<VideoImportDraft>({});
  const submitting = useRef(false);
  const mounted = useRef(true);
  const selected = targets.find(item => item.uuid === target);
  const mustSelect = !selected?.hasResult;
  const targetUnavailable = !!target && (!selected || selected.busy);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    draft.current = {};
    setDurationMs(0);
    setError('');
    if (!file) return;
    const controller = new AbortController();
    setReading(true);
    void (async () => {
      try {
        const duration = await readUploadedVideoDuration(file, controller.signal);
        if (!controller.signal.aborted) setDurationMs(duration);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '读取视频失败');
      } finally {
        if (!controller.signal.aborted) setReading(false);
      }
    })();
    return () => controller.abort();
  }, [file]);

  const submit = async () => {
    if (submitting.current || !file || !durationMs || targetUnavailable) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await onImport(file, durationMs, target, mustSelect || selectForEnhance, draft.current);
      if (mounted.current) onClose();
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : '视频导入失败，请重试');
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-n900/60 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="video-upload-title" className="w-[520px] max-w-full rounded-lg bg-n0 p-5 shadow-bottom">
        <div className="mb-3 flex items-center justify-between">
          <h3 id="video-upload-title" className="font-bold text-n800">上传外部视频</h3>
          <button type="button" aria-label="关闭上传" disabled={busy} onClick={onClose} className="text-n300 disabled:opacity-40"><X size={18} /></button>
        </div>
        <p className="mb-4 text-xs leading-5 text-n300">导入完整视频，不只是抽取首帧。上传不扣生成点数，后续放大、配音等操作按原规则计费。</p>
        <label className="mb-4 block text-sm text-n700">
          导入位置
          <select aria-label="导入位置" value={target} disabled={busy} onChange={event => {
            setTarget(event.target.value);
            setSelectForEnhance(false);
            draft.current = {};
          }} className="mt-2 w-full rounded border border-n40 bg-n0 p-2">
            <option value="">新增独立视频片段</option>
            {targets.map(item => <option key={item.uuid} value={item.uuid} disabled={item.busy}>{item.label}{item.busy ? '（任务处理中）' : ''}</option>)}
          </select>
        </label>
        <label className="mb-3 block rounded-lg border border-dashed border-primary/40 bg-n20 p-4 text-sm text-n700">
          选择视频文件
          <input aria-label="选择视频文件" type="file" accept={VIDEO_UPLOAD_ACCEPT} disabled={busy} className="mt-3 block w-full text-xs" onChange={event => {
            const next = event.target.files?.[0];
            if (next) setFile(next);
            event.target.value = '';
          }} />
          <span className="mt-3 block text-xs text-n300">支持 MP4、MOV、WebM、M4V，推荐 H.264 MP4。单文件最多 1 GB，受服务器上传限制。</span>
        </label>
        {reading && <p role="status" className="mb-3 text-xs text-primary">正在读取视频信息…</p>}
        {!!durationMs && file && <p className="mb-3 break-all text-xs text-n300">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB · {(durationMs / 1000).toFixed(1)} 秒</p>}
        <label className="mb-3 flex items-center gap-2 text-sm text-n700">
          <input type="checkbox" checked={mustSelect || selectForEnhance} disabled={busy || mustSelect} onChange={event => setSelectForEnhance(event.target.checked)} />
          将此视频设为优化合成使用
        </label>
        <p className="mb-4 text-xs text-n300">{mustSelect ? '新增或没有视频的镜头会自动使用上传结果。' : '原有视频保留；不勾选则仅追加到候选视频中。'}</p>
        {targetUnavailable && <p role="alert" className="mb-3 text-xs text-danger">目标镜头正在处理或已移除，请选择其他位置。</p>}
        {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded border border-n40 px-4 py-2 text-sm disabled:opacity-40">取消</button>
          <button type="button" onClick={() => void submit()} disabled={busy || reading || !file || !durationMs || targetUnavailable} className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {busy ? '正在上传并保存…' : '上传并导入'}
          </button>
        </div>
      </section>
    </div>
  );
}
