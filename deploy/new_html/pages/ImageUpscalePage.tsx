import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileImage,
  History,
  ImagePlus,
  Loader2,
  RefreshCw,
  ScanLine,
  Sparkles,
  Type,
  X,
} from 'lucide-react';
import { processMaterial, uploadImageToComfyUI } from '@runtime/comfyuiBridgeService';
import { waitForComfyUITask } from '@runtime/comfyuiTaskWaitService';
import { estimateCredits } from '../services/creditService';
import { apiBlob, apiJson } from '../services/httpClient';
import { formatImageUpscaleDeletionTime, isImageUpscaleExpired } from '../utils/imageUpscaleRetention';
import {
  getImageUpscaleBillingNote,
  getImageUpscaleHistoryError,
  getImageUpscaleHistorySpec,
  isImageUpscaleTask,
  isLocalImageUpscaleDelivery,
} from '../utils/historyPrompt';

const LONG_EDGE_PRESETS = [4096, 8192, 16000, 32000, 50000] as const;
const DPI_PRESETS = [72, 150, 300] as const;

interface UpscaleHistoryTask {
  task_id: string;
  task_type?: string;
  status?: string;
  progress?: number | null;
  result?: any;
  error?: string | null;
  refund_status?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  data?: Record<string, any>;
}

function upscaleResultUrl(task: UpscaleHistoryTask): string {
  const first = task.result?.images?.[0];
  if (typeof first === 'string') return first;
  return typeof first?.url === 'string' ? first.url : '';
}

function upscaleResultExpiresAt(task: UpscaleHistoryTask): string | null {
  const first = task.result?.images?.[0];
  return typeof first?.expires_at === 'string' ? first.expires_at : null;
}

function formatHistoryTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function historyStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    pending: '排队中',
    queued: '排队中',
    processing: '处理中',
    running: '处理中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    timeout: '已超时',
  };
  return labels[String(status || '').toLowerCase()] || '未知状态';
}

function fallbackCost(targetLongEdge: number, dpi: number, textClarity: boolean): number {
  const base = targetLongEdge <= 4096
    ? 8
    : targetLongEdge <= 8192
      ? 15
      : targetLongEdge <= 16000
        ? 25
        : targetLongEdge <= 32000
          ? 38
          : 45;
  const dpiSurcharge = dpi >= 300 ? 3 : dpi >= 150 ? 1 : 0;
  return Math.min(50, base + dpiSurcharge + (textClarity ? 2 : 0));
}

function estimatedDurationLabel(targetLongEdge: number, textClarity: boolean): string {
  const range = targetLongEdge <= 4096
    ? [1, 3]
    : targetLongEdge <= 8192
      ? [2, 4]
      : targetLongEdge <= 16000
        ? [3, 5]
        : targetLongEdge <= 32000
          ? [3, 6]
          : [4, 8];
  const upper = range[1] + (textClarity && targetLongEdge < 50000 ? 1 : 0);
  return `约 ${range[0]}–${upper} 分钟`;
}

function formatPixels(value: number): string {
  return value.toLocaleString('zh-CN');
}

function outputSize(
  source: { width: number; height: number } | null,
  targetLongEdge: number,
): { width: number; height: number } | null {
  if (!source || source.width <= 0 || source.height <= 0) return null;
  const scale = targetLongEdge / Math.max(source.width, source.height);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

export const ImageUpscalePage: React.FC = () => {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [targetLongEdge, setTargetLongEdge] = useState<number>(8192);
  const [dpi, setDpi] = useState<number>(300);
  const [textClarity, setTextClarity] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'queued' | 'running' | 'completed' | 'failed'>('idle');
  const [progress, setProgress] = useState(0);
  const [taskId, setTaskId] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [error, setError] = useState('');
  const [estimatedCost, setEstimatedCost] = useState(() => fallbackCost(8192, 300, false));
  const [historyTasks, setHistoryTasks] = useState<UpscaleHistoryTask[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [historyDownloadId, setHistoryDownloadId] = useState('');
  const [activeTab, setActiveTab] = useState<'upscale' | 'history'>('upscale');

  const estimatedOutput = useMemo(
    () => outputSize(sourceSize, targetLongEdge),
    [sourceSize, targetLongEdge],
  );
  const estimatedDuration = useMemo(
    () => estimatedDurationLabel(targetLongEdge, textClarity),
    [targetLongEdge, textClarity],
  );
  const busy = ['uploading', 'queued', 'running'].includes(status);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const data = await apiJson<{ tasks?: UpscaleHistoryTask[] }>(
        '/api/tasks?limit=100',
        {},
        '加载图片放大历史',
      );
      setHistoryTasks((data.tasks || []).filter(isImageUpscaleTask).slice(0, 20));
    } catch (caught: any) {
      setHistoryError(caught?.message || '图片放大历史加载失败');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      estimateCredits('image_upscale', {
        target_long_edge: targetLongEdge,
        dpi,
        text_clarity: textClarity,
      })
        .then(quote => {
          if (active) setEstimatedCost(quote.enabled ? quote.estimated_cost : fallbackCost(targetLongEdge, dpi, textClarity));
        })
        .catch(() => {
          if (active) setEstimatedCost(fallbackCost(targetLongEdge, dpi, textClarity));
        });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [dpi, targetLongEdge, textClarity]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    void loadHistory();
  }, [activeTab, loadHistory]);

  const selectFile = useCallback((selected: File | null) => {
    if (!selected) return;
    if (!selected.type.startsWith('image/')) {
      setError('请选择 PNG、JPG、WEBP 或 TIFF 图片。');
      return;
    }
    const nextUrl = URL.createObjectURL(selected);
    const probe = new Image();
    probe.onload = () => {
      setSourceSize({ width: probe.naturalWidth, height: probe.naturalHeight });
      setFile(selected);
      setPreviewUrl(nextUrl);
      setStatus('idle');
      setProgress(0);
      setTaskId('');
      setResultUrl('');
      setError('');
    };
    probe.onerror = () => {
      URL.revokeObjectURL(nextUrl);
      setError('无法读取这张图片，请更换文件后重试。');
    };
    probe.src = nextUrl;
  }, []);

  const clearFile = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl('');
    setSourceSize(null);
    setResultUrl('');
    setTaskId('');
    setStatus('idle');
    setProgress(0);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }, [previewUrl]);

  const startUpscale = useCallback(async () => {
    if (!file || busy) return;
    setStatus('uploading');
    setProgress(0);
    setError('');
    setResultUrl('');
    let phase = '上传图片';
    try {
      const upload = await uploadImageToComfyUI(file, { standalone: !projectId });
      phase = '提交放大任务';
      setStatus('queued');
      const submitted = await processMaterial(upload.filename, 'image_upscale', {
        fileRole: 'upscaled_image',
        ...(projectId ? {
          entityType: 'project',
          entityId: projectId,
          projectId,
          episodeId: episodeId || undefined,
        } : {}),
        targetLongEdge,
        dpi,
        textClarity,
        sourceFileId: upload.file_id,
      });
      setTaskId(submitted.task_id);
      setStatus('running');
      phase = '读取任务进度';
      void loadHistory();
      const url = await waitForComfyUITask(
        submitted.task_id,
        value => setProgress(value > 1 ? value / 100 : value),
        {
          title: `图片高清放大 · ${formatPixels(targetLongEdge)}px`,
          kind: 'image-upscale',
          targetPage: 'image-upscale',
          ...(projectId ? {
            targetProjectId: projectId,
            episodeId: episodeId || undefined,
            targetEntityType: 'project',
            targetEntityId: projectId,
          } : {}),
          fileRole: 'upscaled_image',
        },
      );
      setResultUrl(url);
      setProgress(1);
      setStatus('completed');
      void loadHistory();
      window.dispatchEvent(new CustomEvent('credits:updated'));
    } catch (caught: any) {
      setStatus('failed');
      const message = String(caught?.message || '');
      setError(/failed to fetch|networkerror|load failed/i.test(message)
        ? `${phase}时网络连接失败，请检查网络后重试；若任务已提交，可在放大历史中查看，勿重复提交。`
        : message || '图片放大失败，请稍后重试。');
    }
  }, [busy, dpi, episodeId, file, loadHistory, projectId, targetLongEdge, textClarity]);

  const downloadUpscaleOutput = useCallback(async (url: string, filename: string) => {
    const nodeOutputMatch = url.match(/^\/api\/node-outputs\/[^/]+\/[^/]+\/download(?:\?.*)?$/);
    if (nodeOutputMatch) {
      const ticketEndpoint = url.replace(/\/download(?:\?.*)?$/, '/ticket');
      const ticket = await apiJson<{ download_url: string }>(
        ticketEndpoint,
        { method: 'POST' },
        '申请高清图片下载',
      );
      const anchor = document.createElement('a');
      anchor.href = ticket.download_url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }
    const blob = await apiBlob(url, { method: 'GET' }, '下载高清放大图片');
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }, []);

  const downloadResult = useCallback(async () => {
    if (!resultUrl) return;
    try {
      await downloadUpscaleOutput(
        resultUrl,
        `${(file?.name || 'image').replace(/\.[^.]+$/, '')}_${targetLongEdge}px_${dpi}dpi.png`,
      );
    } catch (caught: any) {
      setError(caught?.message || '下载失败，请从任务通知重新打开结果。');
    }
  }, [downloadUpscaleOutput, dpi, file?.name, resultUrl, targetLongEdge]);

  const downloadHistoryResult = useCallback(async (task: UpscaleHistoryTask) => {
    const url = upscaleResultUrl(task);
    if (!url) return;
    const edge = Number(task.data?.target_long_edge || 0);
    const outputDpi = Number(task.data?.dpi || 0);
    setHistoryDownloadId(task.task_id);
    setHistoryError('');
    try {
      await downloadUpscaleOutput(
        url,
        `图片放大_${edge || 'result'}px_${outputDpi || 300}dpi.png`,
      );
    } catch (caught: any) {
      setHistoryError(caught?.message || '历史结果下载失败，文件可能已超过 30 天保留期。');
    } finally {
      setHistoryDownloadId('');
    }
  }, [downloadUpscaleOutput]);

  return (
    <div className="h-full overflow-y-auto bg-n20 px-6 py-6 scrollbar-atlas">
      <div className="mx-auto w-full max-w-[1480px]">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-primary">
              <ScanLine size={15} /> 本地节点图片工具
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-n900">图片高清放大</h1>
            <p className="mt-1 text-sm text-n300">AI 修复细节后按原比例输出，最长边最高 50,000px，最高写入 300 DPI。</p>
            <p className="mt-1 text-xs text-n200">适用于宣传图、海报等大尺寸打印场景。</p>
          </div>
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-xs leading-5 text-n500">
            <span className="font-semibold text-warning">图片放大独立队列</span> · 每位用户最多 2 个 · 成功后扣除 {estimatedCost} 点
          </div>
        </div>

        <div className="ui-tabs mb-5" role="tablist" aria-label="图片高清放大功能">
          <button
            id="image-upscale-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === 'upscale'}
            aria-controls="image-upscale-panel"
            onClick={() => setActiveTab('upscale')}
            className="ui-tab"
          >
            开始放大
          </button>
          <button
            id="image-upscale-history-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            aria-controls="image-upscale-history-panel"
            onClick={() => setActiveTab('history')}
            className="ui-tab"
          >
            放大历史
          </button>
        </div>

        {activeTab === 'upscale' && (
        <div id="image-upscale-panel" role="tabpanel" aria-labelledby="image-upscale-tab" className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(390px,0.75fr)]">
          <section className="overflow-hidden rounded-2xl border border-n50 bg-n0 shadow-soft">
            <div className="flex items-center justify-between border-b border-n40 px-5 py-4">
              <div>
                <h2 className="font-display text-base font-bold text-n800">1. 添加图片</h2>
                <p className="mt-0.5 text-xs text-n200">推荐使用清晰原图；极限尺寸输出文件可能较大。</p>
              </div>
              {file && (
                <button type="button" onClick={clearFile} disabled={busy} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-n300 hover:bg-r50 hover:text-danger disabled:opacity-40">
                  <X size={13} /> 更换图片
                </button>
              )}
            </div>

            {!file ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragEnter={event => { event.preventDefault(); setDragging(true); }}
                onDragOver={event => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={event => {
                  event.preventDefault();
                  setDragging(false);
                  selectFile(event.dataTransfer.files?.[0] || null);
                }}
                className={`m-5 flex min-h-[440px] w-[calc(100%-2.5rem)] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 text-center transition-colors ${dragging ? 'border-primary bg-primary-light' : 'border-n60 bg-n10 hover:border-b300 hover:bg-b50/40'}`}
              >
                <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-light text-primary"><ImagePlus size={30} /></span>
                <span className="font-display text-lg font-bold text-n800">拖入图片，或点击选择</span>
                <span className="mt-2 max-w-md text-sm leading-6 text-n200">支持 PNG、JPG、WEBP、TIFF；保留原始构图与宽高比。</span>
              </button>
            ) : (
              <div className="relative flex min-h-[500px] items-center justify-center bg-[linear-gradient(45deg,#f5f5f5_25%,transparent_25%),linear-gradient(-45deg,#f5f5f5_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f5f5f5_75%),linear-gradient(-45deg,transparent_75%,#f5f5f5_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] p-6">
                <img src={previewUrl} alt="待放大原图预览" className="max-h-[620px] max-w-full rounded-xl object-contain shadow-bottom" />
                <span className="absolute bottom-4 left-4 rounded-lg bg-n900/85 px-3 py-2 font-mono text-xs text-n0 backdrop-blur">
                  {resultUrl && estimatedOutput
                    ? `结果 ${formatPixels(estimatedOutput.width)} × ${formatPixels(estimatedOutput.height)} · ${dpi} DPI`
                    : sourceSize
                      ? `原图 ${formatPixels(sourceSize.width)} × ${formatPixels(sourceSize.height)}`
                      : '正在读取图片'}
                </span>
              </div>
            )}
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/tiff" className="hidden" onChange={event => selectFile(event.target.files?.[0] || null)} />
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-n50 bg-n0 p-5 shadow-soft">
              <h2 className="font-display text-base font-bold text-n800">2. 输出规格</h2>
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-n500">目标最长边</span>
                  {estimatedOutput && <span className="font-mono text-n200">{formatPixels(estimatedOutput.width)} × {formatPixels(estimatedOutput.height)} px</span>}
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {LONG_EDGE_PRESETS.map(value => (
                    <button key={value} type="button" onClick={() => setTargetLongEdge(value)} disabled={busy} className={`rounded-lg border px-1 py-2 text-xs font-semibold transition-colors ${targetLongEdge === value ? 'border-primary bg-primary-light text-primary' : 'border-n50 bg-n0 text-n400 hover:border-b300'} disabled:opacity-50`}>
                      {value === 4096 ? '4K' : value === 8192 ? '8K' : `${value / 1000}K`}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-n200">50K 为极限输出，处理与下载时间会明显增加。</p>
              </div>

              <div className="mt-5 border-t border-n40 pt-4">
                <div className="mb-2 text-xs font-semibold text-n500">输出 DPI</div>
                <div className="grid grid-cols-3 gap-2">
                  {DPI_PRESETS.map(value => (
                    <button key={value} type="button" onClick={() => setDpi(value)} disabled={busy} className={`rounded-lg border py-2 text-xs font-semibold transition-colors ${dpi === value ? 'border-primary bg-primary-light text-primary' : 'border-n50 text-n400 hover:border-b300'} disabled:opacity-50`}>
                      {value} DPI
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-n200">DPI 是打印密度信息；实际像素由上方最长边决定。150 DPI 加 1 点，300 DPI 加 3 点。</p>
              </div>
            </section>

            <section className="rounded-2xl border border-n50 bg-n0 p-5 shadow-soft">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-b50 text-primary"><Type size={17} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-n800">文字清晰</h3>
                      <p className="mt-0.5 text-[11px] text-n200">海报、标识、字幕边缘增强</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label="文字清晰"
                      aria-checked={textClarity}
                      onClick={() => setTextClarity(value => !value)}
                      disabled={busy}
                      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${textClarity ? 'border-primary bg-primary' : 'border-n100 bg-n70'} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <span className={`pointer-events-none absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-n0 shadow transition-transform ${textClarity ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2 rounded-xl border border-warning/25 bg-warning/10 p-3 text-[11px] leading-5 text-n400">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
                    <span>AI 放大可能改变细小文字。该选项只增强已有文字边缘，不重新生成字符；请下载后校对。纯图片背景效果通常更稳定。</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-n50 bg-n0 p-5 shadow-soft">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-n500">预计创作点数</span>
                <span className="font-display text-xl font-bold text-warning">{estimatedCost} 点</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-n50 pt-2 text-sm">
                <span className="font-semibold text-n500">预计处理耗时</span>
                <span className="font-semibold text-n700">{estimatedDuration}</span>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-n200">基于当前本地节点实测估算；排队等待与下载时间另计。</p>
              <p className="mt-1 text-[11px] leading-5 text-n200">加入图片放大独立队列；每位用户最多同时排队或处理 2 个。成功后扣除，失败或取消自动退回。结果保留 30 天。</p>

              {busy && (
                <div className="mt-4 rounded-xl bg-b50 p-3">
                  <div className="flex items-center justify-between text-xs text-primary">
                    <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />{status === 'uploading' ? '正在上传原图' : status === 'queued' ? '正在加入本地队列' : '本地节点处理中'}</span>
                    <span className="font-mono">{Math.round(progress * 100)}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-b100"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(4, progress * 100)}%` }} /></div>
                  {taskId && <div className="mt-2 truncate font-mono text-[10px] text-n200">task_id: {taskId}</div>}
                </div>
              )}

              {status === 'completed' && (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-success/25 bg-success/10 p-3 text-xs font-semibold text-success"><CheckCircle2 size={16} /> 放大完成，可以下载原尺寸图片。</div>
              )}
              {error && <div className="mt-4 rounded-xl border border-danger/25 bg-r50 p-3 text-xs leading-5 text-danger">{error}</div>}

              <div className="mt-4 flex gap-2">
                {resultUrl ? (
                  <button type="button" onClick={downloadResult} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-n0 shadow-glow hover:bg-primary-hover">
                    <Download size={16} /> 下载高清图片
                  </button>
                ) : (
                  <button type="button" onClick={startUpscale} disabled={!file || busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-n0 shadow-glow hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-n70 disabled:shadow-none">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    {busy ? '处理中' : `加入处理队列 · ${estimatedCost} 点`}
                  </button>
                )}
              </div>
              {!file && <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-n200"><FileImage size={13} /> 请先添加一张图片</div>}
            </section>
          </aside>
        </div>
        )}

        {activeTab === 'history' && (
        <section id="image-upscale-history-panel" role="tabpanel" aria-labelledby="image-upscale-history-tab" className="overflow-hidden rounded-2xl border border-n50 bg-n0 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-n40 px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-display text-base font-bold text-n800"><History size={17} className="text-primary" /> 图片放大历史</h2>
              <p className="mt-1 text-xs text-n200">保留最近 20 条任务记录；完成结果在 30 天内可重新下载。</p>
            </div>
            <button
              type="button"
              onClick={() => { void loadHistory(); }}
              disabled={historyLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-n50 px-3 py-2 text-xs font-semibold text-n400 hover:border-b300 hover:text-primary disabled:opacity-50"
            >
              <RefreshCw size={14} className={historyLoading ? 'animate-spin' : ''} /> 刷新
            </button>
          </div>

          {historyError && (
            <div className="mx-5 mt-4 rounded-xl border border-danger/25 bg-r50 p-3 text-xs leading-5 text-danger">{historyError}</div>
          )}

          {historyLoading && historyTasks.length === 0 ? (
            <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-n200"><Loader2 size={16} className="animate-spin" /> 正在加载历史记录</div>
          ) : historyTasks.length === 0 ? (
            <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-sm text-n200"><History size={22} /> 暂无图片放大记录</div>
          ) : (
            <div className="divide-y divide-n40">
              {historyTasks.map(task => {
                const normalizedStatus = String(task.status || '').toLowerCase();
                const result = upscaleResultUrl(task);
                const spec = getImageUpscaleHistorySpec(task);
                const publicError = getImageUpscaleHistoryError(task);
                const billingNote = getImageUpscaleBillingNote(task);
                const localDelivery = isLocalImageUpscaleDelivery(task);
                const expired = isImageUpscaleExpired(upscaleResultExpiresAt(task));
                const active = ['pending', 'queued', 'processing', 'running'].includes(normalizedStatus);
                const deletionTime = normalizedStatus === 'completed'
                  ? formatImageUpscaleDeletionTime(
                    upscaleResultExpiresAt(task),
                    task.completed_at,
                    task.created_at,
                  )
                  : '';
                const statusClass = normalizedStatus === 'completed'
                  ? 'bg-success/10 text-success'
                  : active
                    ? 'bg-b50 text-primary'
                    : normalizedStatus === 'failed' || normalizedStatus === 'timeout'
                      ? 'bg-r50 text-danger'
                      : 'bg-n30 text-n300';
                return (
                  <div key={task.task_id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass}`}>{historyStatusLabel(normalizedStatus)}</span>
                        <span className="font-mono text-xs text-n400">
                          {spec.targetLongEdge ? `${formatPixels(spec.targetLongEdge)}px` : '规格未知'} · {spec.dpi || 'DPI 未知'}{typeof spec.dpi === 'number' && spec.dpi > 0 ? ' DPI' : ''}
                        </span>
                        {spec.width > 0 && spec.height > 0 && (
                          <span className="text-[11px] text-n200">实际 {formatPixels(spec.width)} × {formatPixels(spec.height)}</span>
                        )}
                        {spec.textClarity && <span className="rounded-full bg-primary-light px-2 py-1 text-[10px] font-semibold text-primary">文字增强</span>}
                      </div>
                      <div className="mt-1 truncate text-[11px] text-n200">{formatHistoryTime(task.completed_at || task.created_at)} · {task.task_id}</div>
                      {active && typeof task.progress === 'number' && (
                        <div className="mt-2 h-1.5 max-w-sm overflow-hidden rounded-full bg-n40"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, Math.min(100, task.progress > 1 ? task.progress : task.progress * 100))}%` }} /></div>
                      )}
                      {publicError && <div className="mt-1 text-[11px] text-danger">{publicError}</div>}
                      {billingNote && <div className="mt-1 text-[11px] text-n300">{billingNote}</div>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-n300">
                      {normalizedStatus === 'completed' && <span>{deletionTime || '过期时间未知（结果保留 30 天）'}</span>}
                      {localDelivery && <span>结果已保存到本机</span>}
                      {!localDelivery && active && <span>等待本地节点处理</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => { void downloadHistoryResult(task); }}
                      disabled={!result || expired || historyDownloadId === task.task_id}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary px-3 text-xs font-semibold text-primary hover:bg-primary-light disabled:cursor-not-allowed disabled:border-n60 disabled:text-n200"
                    >
                      {historyDownloadId === task.task_id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      {expired ? '已过期' : result ? '重新下载' : localDelivery ? '本机文件' : '暂无结果'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        )}
      </div>
    </div>
  );
};

export default ImageUpscalePage;
