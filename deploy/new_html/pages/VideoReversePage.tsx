







import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Upload, RefreshCw, X, RotateCcw, Coins, Film, FilePlus2,
  Copy, Check, ChevronRight, Loader2, AlertTriangle,
} from 'lucide-react';
import { sanitizeProcessingTerminology } from '../utils/processingTerminology';
import {
  estimateVideoReverse,
  createVideoReverseTask,
  listVideoReverseTasks,
  getVideoReverseTask,
  cancelVideoReverseTask,
  retryVideoReverseTask,
  VideoReverseTask,
  VideoReverseSegment,
  VideoReverseStatus,
} from '../services/videoReverseService';
import { uploadMediaItem } from '../services/mediaLibraryService';
import { CreditEstimateModal } from '../components/CreditEstimateModal';
import { LazyVideo } from '../components/LazyVideo';
import { createEpisodeScript, createScriptVersion } from '../services/scriptTimelineService';
import {
  buildVideoReverseCandidateMetadata,
  buildVideoReverseCandidateName,
  buildVideoReverseCandidateScript,
  buildVideoReverseStoryboardItems,
} from '../utils/videoReverseCandidate';

const STATUS_LABEL: Record<VideoReverseStatus, { label: string; color: string }> = {
  pending:          { label: '排队中',     color: 'bg-n50' },
  splitting:        { label: '切分中',     color: 'bg-b400' },
  extracting_frames:{ label: '抽帧中',     color: 'bg-b400' },
  analyzing:        { label: '视觉分析中', color: 'bg-p400' },
  building_prompts: { label: '生成提示词', color: 'bg-p400' },
  completed:        { label: '已完成',     color: 'bg-success' },
  failed:           { label: '失败',       color: 'bg-danger' },
  cancelled:        { label: '已取消',     color: 'bg-n50' },
};

interface VideoReversePageProps {
  embedded?: boolean;
  onClose?: () => void;
  onCandidateCreated?: (scriptId: string) => Promise<void> | void;
}

export const VideoReversePage: React.FC<VideoReversePageProps> = ({
  embedded = false,
  onClose,
  onCandidateCreated,
}) => {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId?: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [tasks, setTasks] = useState<VideoReverseTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<VideoReverseTask | null>(null);
  const [segments, setSegments] = useState<VideoReverseSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingCandidate, setCreatingCandidate] = useState(false);
  const detailPollFailuresRef = useRef(0);


  const [uploading, setUploading] = useState(false);
  const [pendingVideoFileId, setPendingVideoFileId] = useState<string | null>(null);
  const [pendingDuration, setPendingDuration] = useState<number>(0);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await listVideoReverseTasks({
        project_id: projectId,
        episode_id: episodeId,
        limit: 50,
      });
      setTasks(r.tasks || []);
      if (!selectedTaskId && r.tasks?.length) setSelectedTaskId(r.tasks[0].reverse_task_id);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [episodeId, projectId, selectedTaskId]);

  const loadDetail = useCallback(async (rid: string) => {
    try {
      const r = await getVideoReverseTask(rid);
      setSelectedTask(r.task);
      setSegments(r.segments || []);
      detailPollFailuresRef.current = 0;
      setPollError(null);
    } catch (e: any) {
      detailPollFailuresRef.current += 1;
      if (detailPollFailuresRef.current >= 3) {
        const detail = e?.message || String(e);
        setPollError(`任务详情连接暂时中断，正在自动重试：${detail}`);
      }
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (selectedTaskId) loadDetail(selectedTaskId);
  }, [selectedTaskId, loadDetail]);


  useEffect(() => {
    if (!selectedTaskId) return;
    const inProgress = !selectedTask || !['completed', 'failed', 'cancelled'].includes(selectedTask.status);
    if (!inProgress) return;
    const timer = setInterval(() => {
      loadDetail(selectedTaskId);
      reload();
    }, 3000);
    return () => clearInterval(timer);
  }, [selectedTask?.status, selectedTaskId, loadDetail, reload]);

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !projectId) return;
    setError(null);
    setUploading(true);
    try {
      const result = await uploadMediaItem(file, {
        projectId,
        permissionScope: 'project',
        title: file.name,
      });
      setPendingVideoFileId(result.file_id);

      const est = await estimateVideoReverse({ video_file_id: result.file_id });
      setPendingDuration(est.duration_seconds || 0);
      setEstimateOpen(true);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConfirmCreate = async () => {
    if (!pendingVideoFileId || !projectId) return;
    setEstimateOpen(false);
    try {
      const r = await createVideoReverseTask({
        video_file_id: pendingVideoFileId,
        project_id: projectId,
        episode_id: episodeId,
        language: 'zh',
      });
      setSelectedTaskId(r.reverse_task_id);
      setPendingVideoFileId(null);
      reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const handleCancel = async (rid: string) => {
    if (!confirm('确定要取消该任务吗？已冻结创作点数将退回。')) return;
    try {
      await cancelVideoReverseTask(rid);
      reload();
      if (rid === selectedTaskId) loadDetail(rid);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const handleRetry = async (rid: string) => {
    try {
      await retryVideoReverseTask(rid);
      reload();
      if (rid === selectedTaskId) loadDetail(rid);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const handleCreateCandidate = async () => {
    if (!episodeId || !selectedTask || selectedTask.status !== 'completed') return;
    const content = buildVideoReverseCandidateScript(selectedTask, segments);
    if (!content) {
      setError('反推任务没有可导入的内容，请重新执行视频反推。');
      return;
    }

    setCreatingCandidate(true);
    setError(null);
    try {
      const metadata = buildVideoReverseCandidateMetadata(selectedTask, segments);
      const storyboardItems = buildVideoReverseStoryboardItems(selectedTask, segments);
      const result = await createEpisodeScript(episodeId, {
        file_name: buildVideoReverseCandidateName(selectedTask),
        original_content: content,
        adapted_script: content,
        metadata,
        source_type: 'video_reverse',
        source_id: selectedTask.reverse_task_id,
      });
      const scriptId = result?.script?.script_id ?? result?.script?.scriptId;
      if (!scriptId) throw new Error('候选剧本已创建，但接口未返回剧本 ID');
      await createScriptVersion(episodeId, scriptId, {
        content,
        storyboardItems,
        source: 'ai',
        status: 'ready',
        modelAlias: '视频反推',
        provider: 'video_reverse',
        modelName: 'video_reverse_prompt',
        metadata: {
          ...metadata,
          scriptPipeline: {
            version: 3,
            stage: 'videoReverse',
            generatedOutputs: ['text', 'storyboard', 'shot_design'],
            keyframeReferenceMode: 'one-keyframe-per-segment',
          },
        },
        setCurrent: true,
      });
      if (onCandidateCreated) {
        await onCandidateCreated(scriptId);
      } else {
        navigate(`/projects/${projectId}/ep/${episodeId}/workflow/script?browseScriptId=${encodeURIComponent(scriptId)}`);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setCreatingCandidate(false);
    }
  };

  return (
    <div className={`layout-safe flex flex-col text-n800 ${embedded ? 'h-full bg-n20' : 'h-screen bg-n0'}`}>
      <div className="responsive-toolbar flex items-center gap-3 border-b border-n40 bg-n0 px-4 py-3">
        {!embedded && (
          <button onClick={() => navigate(`/projects/${projectId}/episodes`)} className="text-sm text-n300 hover:text-n800">
            ← 返回项目
          </button>
        )}
        <div className="text-sm font-medium ml-2 flex items-center gap-2">
          <Film size={16} className="text-primary" />
          视频反推提示词
        </div>
        <div className="text-xs text-n100">项目 {projectId}</div>
        <div className="toolbar-actions ml-auto">
          <button onClick={reload} className="p-2 rounded bg-n0 hover:bg-n20">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleUploadClick}
            disabled={uploading}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-primary hover:bg-primary-hover text-white disabled:opacity-60 text-sm font-medium"
          >
            <Upload size={14} />
            {uploading ? '上传中…' : '上传视频反推'}
          </button>
          {embedded && onClose && (
            <button
              type="button"
              onClick={onClose}
              title="关闭视频反推"
              aria-label="关闭视频反推"
              className="inline-flex h-8 w-8 items-center justify-center rounded text-n300 hover:bg-n20 hover:text-n800"
            >
              <X size={16} />
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleFileChosen}
          />
        </div>
      </div>

      {(error || pollError) && (
        <div className="px-4 py-2 text-xs text-danger bg-r50 border-b border-r75 flex items-center gap-2">
          <AlertTriangle size={14} />
          {error || pollError}
        </div>
      )}

      <div className={`responsive-split flex min-h-0 flex-1 overflow-hidden ${embedded ? 'gap-3 bg-n20 p-3' : ''}`}>

        <aside className={`responsive-pane w-72 overflow-auto bg-n0 ${embedded ? 'rounded-md border border-n40 p-2 shadow-card' : 'border-r border-n40'}`}>
          <div className={`px-3 py-2 text-xs font-medium text-n300 ${embedded ? '' : 'border-b border-n40'}`}>
            历史任务 {tasks.length}
          </div>
          {tasks.map(t => (
            <button
              key={t.reverse_task_id}
              onClick={() => setSelectedTaskId(t.reverse_task_id)}
              className={`mb-1.5 flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left last:mb-0 ${
                selectedTaskId === t.reverse_task_id
                  ? 'border-primary/30 bg-primary-light'
                  : 'border-n40 bg-n0 hover:border-n100 hover:bg-n20'
              }`}
            >
              <div className={`w-2 h-2 rounded-full mt-1.5 ${STATUS_LABEL[t.status]?.color || 'bg-n50'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-n700 truncate">{t.video_file_name || t.video_file_id}</div>
                <div className="mt-0.5 text-[10px] text-n100 flex items-center gap-2">
                  <span>{STATUS_LABEL[t.status]?.label || t.status}</span>
                  {t.duration_seconds && <span>{Number(t.duration_seconds).toFixed(1)}s</span>}
                  {t.credit_cost > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Coins size={9} className="text-warning" />
                      {t.credit_cost}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={12} className="text-n100 mt-1" />
            </button>
          ))}
          {!tasks.length && (
            <div className="text-center text-xs text-n100 py-12 px-4">
              暂无历史任务，点击右上角"上传视频反推"开始
            </div>
          )}
        </aside>


        <main className={`responsive-pane min-w-0 flex-1 overflow-auto ${embedded ? 'rounded-md border border-n40 bg-n0 shadow-card' : ''}`}>
          {!selectedTask ? (
            <div className="text-center text-sm text-n100 py-24">
              选择一个任务以查看详情
            </div>
          ) : (
            <TaskDetail
              task={selectedTask}
              segments={segments}
              onCancel={() => handleCancel(selectedTask.reverse_task_id)}
              onRetry={() => handleRetry(selectedTask.reverse_task_id)}
              onCopy={copyText}
              copiedId={copied}
              canCreateCandidate={Boolean(episodeId)}
              creatingCandidate={creatingCandidate}
              onCreateCandidate={handleCreateCandidate}
            />
          )}
        </main>
      </div>

      <CreditEstimateModal
        open={estimateOpen}
        featureKey="video_reverse_prompt"
        params={{ duration_seconds: pendingDuration }}
        title="视频反推创作点数预估"
        description={`视频时长 ${pendingDuration.toFixed(1)}s，请确认是否继续`}
        confirmLabel="开始反推"
        onCancel={() => { setEstimateOpen(false); setPendingVideoFileId(null); }}
        onConfirm={() => handleConfirmCreate()}
      />
    </div>
  );
};


const TaskDetail: React.FC<{
  task: VideoReverseTask;
  segments: VideoReverseSegment[];
  onCancel: () => void;
  onRetry: () => void;
  onCopy: (id: string, text: string) => void;
  copiedId: string | null;
  canCreateCandidate: boolean;
  creatingCandidate: boolean;
  onCreateCandidate: () => void;
}> = ({
  task,
  segments,
  onCancel,
  onRetry,
  onCopy,
  copiedId,
  canCreateCandidate,
  creatingCandidate,
  onCreateCandidate,
}) => {
  const inProgress = !['completed', 'failed', 'cancelled'].includes(task.status);

  return (
    <div className="p-5 space-y-4">
      <div className="stack-on-narrow flex items-start gap-4">
        <div className="w-72 shrink-0 rounded overflow-hidden bg-n0 border border-n40">
          {task.video_file_url
            ? (
              <LazyVideo
                src={task.video_file_url}
                controls
                muted={false}
                firstFrame={false}
                hoverPreview={false}
                className="w-full"
              />
            )
            : <div className="w-full h-40 flex items-center justify-center text-n100"><Film size={32} /></div>
          }
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="text-sm font-medium text-n800">{task.video_file_name || task.video_file_id}</div>
          <div className="flex items-center gap-2 text-xs text-n300">
            <span className={`px-1.5 py-0.5 rounded ${STATUS_LABEL[task.status]?.color}`}>
              {STATUS_LABEL[task.status]?.label || task.status}
            </span>
            <span>{Number(task.duration_seconds || 0).toFixed(1)}s</span>
            <span className="flex items-center gap-0.5"><Coins size={11} className="text-warning" />{task.credit_cost}</span>
            <span className="text-n100">·</span>
            <span>{new Date(task.created_at).toLocaleString('zh-CN')}</span>
          </div>
          {inProgress && (
            <div className="mt-2 w-full bg-n30 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-primary h-full transition-all"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          )}
          {task.error_message && (
            <div className="mt-2 p-2 text-xs text-danger bg-r50 border border-r75 rounded">
              {sanitizeProcessingTerminology(task.error_message)}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            {inProgress && (
              <button onClick={onCancel} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-n0 hover:bg-n20">
                <X size={12} /> 取消
              </button>
            )}
            {['failed', 'cancelled'].includes(task.status) && (
              <button onClick={onRetry} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-n0 hover:bg-n20">
                <RotateCcw size={12} /> 重试
              </button>
            )}
            {task.status === 'completed' && canCreateCandidate && (
              <button
                onClick={onCreateCandidate}
                disabled={creatingCandidate}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-primary hover:bg-primary-hover text-white disabled:opacity-60"
              >
                {creatingCandidate ? <Loader2 size={13} className="animate-spin" /> : <FilePlus2 size={13} />}
                {creatingCandidate ? '正在创建…' : '创建候选剧本'}
              </button>
            )}
          </div>
          {task.status === 'completed' && !canCreateCandidate && (
            <div className="text-xs text-n300">请从具体分集的视频反推页面进入，才能创建候选剧本。</div>
          )}
        </div>
      </div>


      <section className="rounded border border-n40 bg-n0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-n40">
          <div className="text-xs font-medium">整体提示词（中文）</div>
          <CopyButton
            id="overall_zh"
            text={task.overall_prompt_zh}
            copiedId={copiedId}
            onCopy={onCopy}
          />
        </div>
        <div className="p-3 text-xs text-n700 whitespace-pre-wrap font-mono">
          {task.overall_prompt_zh || (inProgress ? <span className="text-n100"><Loader2 size={12} className="inline animate-spin mr-1" />生成中…</span> : <span className="text-n100">（空）</span>)}
        </div>
      </section>

      {task.overall_negative_prompt && (
        <section className="rounded border border-n40 bg-n0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-n40">
            <div className="text-xs font-medium">Negative</div>
            <CopyButton id="neg" text={task.overall_negative_prompt} copiedId={copiedId} onCopy={onCopy} />
          </div>
          <div className="p-3 text-xs text-n300 font-mono">{task.overall_negative_prompt}</div>
        </section>
      )}


      <section className="rounded border border-n40 bg-n0">
        <div className="px-3 py-2 border-b border-n40 text-xs font-medium">
          分镜段 {segments.length}
        </div>
        {segments.map((seg, idx) => (
          <div key={seg.segment_id} className="border-t border-n40 first:border-0 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-n100">#{idx + 1}</span>
              <span className="text-n700">{Number(seg.start_seconds).toFixed(1)}s → {Number(seg.end_seconds).toFixed(1)}s</span>
              <span className="text-n100">·</span>
              <span className="text-n100">{seg.frame_file_ids.length} 帧</span>
            </div>
            {seg.description && (
              <div className="text-xs text-n700">{seg.description}</div>
            )}
            <div className="grid grid-cols-2 gap-2 text-[11px] text-n300">
              {seg.camera_description && (
                <div><span className="text-n100">镜头：</span>{seg.camera_description}</div>
              )}
              {seg.motion_description && (
                <div><span className="text-n100">运动：</span>{seg.motion_description}</div>
              )}
            </div>
          </div>
        ))}
        {!segments.length && (
          <div className="text-center text-xs text-n100 py-6">暂无分镜结果</div>
        )}
      </section>

      {/* Structured JSON */}
      {task.structured_prompt && Object.keys(task.structured_prompt).length > 0 && (
        <section className="rounded border border-n40 bg-n0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-n40">
            <div className="text-xs font-medium">结构化输出（JSON）</div>
            <CopyButton id="structured" text={JSON.stringify(task.structured_prompt, null, 2)} copiedId={copiedId} onCopy={onCopy} />
          </div>
          <pre className="p-3 text-[10px] text-n300 overflow-auto max-h-72 font-mono">
            {JSON.stringify(task.structured_prompt, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
};


const CopyButton: React.FC<{
  id: string;
  text: string;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
}> = ({ id, text, copiedId, onCopy }) => (
  <button
    onClick={() => onCopy(id, text)}
    disabled={!text}
    className="flex items-center gap-1 text-[10px] text-n100 hover:text-n700 disabled:opacity-30"
  >
    {copiedId === id ? <Check size={11} /> : <Copy size={11} />}
    {copiedId === id ? '已复制' : '复制'}
  </button>
);

export default VideoReversePage;
