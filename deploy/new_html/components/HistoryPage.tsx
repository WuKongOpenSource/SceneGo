import React, { useState, useEffect, useCallback } from 'react';
import { SeedreamSourceBadge } from './SeedreamSourceBadge';
import { History, Download, Trash2, RefreshCw, CheckSquare, Square, Film, Image as ImageIcon, Play, Clock, AlertTriangle, X, ShieldAlert, FileText } from 'lucide-react';
import { fetchDeletedUserFiles, fetchUserFiles, deleteEntityFile, hardDeleteEntityFile, hardDeleteEntityFiles, type EntityFile } from '../services/entityFileService';
import { apiJson, secureApiUrl } from '../services/httpClient';
import {
  enrichHistoryTaskMetadata,
  enrichImageUpscaleHistory,
  getHistoryPromptText,
  getHistoryThumbnailFallbackSource,
  getHistoryThumbnailSource,
  isImageUpscaleResultFile,
  isImageUpscaleTask,
  type HistoryTaskSummary,
} from '../utils/historyPrompt';

interface HistoryThumbnailImageProps {
  src: string;
  fallbackSrc?: string;
  alt: string;
}

const HistoryThumbnailImage: React.FC<HistoryThumbnailImageProps> = ({ src, fallbackSrc = '', alt }) => {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    setCurrentSrc(src);
    setUnavailable(false);
  }, [src, fallbackSrc]);

  if (unavailable || !currentSrc) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-n100">
        <ImageIcon className="h-16 w-16 opacity-20" />
        <span className="text-xs">缩略图暂不可用</span>
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      className="h-full w-full object-cover"
      loading="lazy"
      alt={alt}
      onError={() => {
        if (fallbackSrc && currentSrc !== fallbackSrc) {
          setCurrentSrc(fallbackSrc);
          return;
        }
        setUnavailable(true);
      }}
    />
  );
};

interface HistoryPageProps {
  view?: 'history' | 'recycle';
}

interface HistoryTask extends HistoryTaskSummary {
  status?: string;
  result?: { images?: Array<string | { url?: string }> };
  created_at?: string;
  completed_at?: string;
}

async function fetchRecentHistoryTasks(): Promise<HistoryTask[]> {
  try {
    const data = await apiJson<{ tasks?: HistoryTask[] }>('/api/tasks?limit=100', {}, '加载任务图片');
    return data.tasks || [];
  } catch {
    return [];
  }
}

function taskImagesFromHistory(tasks: HistoryTask[]): EntityFile[] {
  const taskFiles: EntityFile[] = [];
  for (const task of tasks) {
    if (task.status !== 'completed') continue;
    const images = task.result?.images || [];
    const isUpscaleTask = isImageUpscaleTask(task);
    for (const image of images) {
      const url = typeof image === 'string' ? image : image.url;
      if (!url) continue;
      taskFiles.push({
        fileId: `task_${task.task_id}_${taskFiles.length}`,
        fileUrl: url,
        fileType: 'image',
        fileRole: isUpscaleTask ? 'upscaled_image' : 'generated_image',
        isSelected: false,
        createdAt: task.completed_at || task.created_at || '',
        metadata: {
          task_id: task.task_id,
          prompt: task.data?.prompt,
          model: task.data?.model || task.task_type,
          source: 'task',
          requested_workflow_type: task.data?.requested_workflow_type,
          source_page: task.data?.source_page,
          display_name: task.data?.display_name,
          source_file_id: task.data?.source_file_id,
        },
      });
    }
  }
  return enrichImageUpscaleHistory(taskFiles, tasks);
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ view = 'history' }) => {
  const [files, setFiles] = useState<EntityFile[]>([]);
  const activeTab = view;
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<'video' | 'image'>('video');
  const [promptModalFile, setPromptModalFile] = useState<EntityFile | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ mode: 'single' | 'batch'; files: EntityFile[]; permanent: boolean } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = activeTab === 'recycle'
        ? await fetchDeletedUserFiles(undefined, 500, 0)
        : await fetchUserFiles(undefined, 500, 0);
      let allFiles = data.items;

      const tasks = await fetchRecentHistoryTasks();
      allFiles = enrichHistoryTaskMetadata(allFiles, tasks);
      allFiles = enrichImageUpscaleHistory(allFiles, tasks);

      setFiles(allFiles);
    } catch (error: any) {
      console.error('加载历史记录失败:', error);
      setLoadError(error?.message || '加载历史记录失败');
      if (activeTab === 'history') {
        try {
          const taskFiles = taskImagesFromHistory(await fetchRecentHistoryTasks());
          if (taskFiles.length > 0) {
            setFiles(taskFiles);
            setLoadError(null);
          }
        } catch { /* ignore fallback error */ }
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeTab]);

  const [activeTasks, setActiveTasks] = useState<Array<{
    task_id: string;
    status: string;
    task_type: string;
    created_at: string;
  }>>([]);

  const loadActiveTasks = useCallback(async () => {
    try {
      const data = await apiJson<{ tasks?: any[] }>('/api/tasks?status=processing,queued&limit=20', {}, '加载进行中任务');
      setActiveTasks((data.tasks || []).filter((t: any) =>
        t.status === 'processing' || t.status === 'queued'
      ));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    loadActiveTasks();
    const interval = setInterval(loadActiveTasks, 10000);
    return () => clearInterval(interval);
  }, [loadActiveTasks]);


  const toggleSelect = (fileId: string) => {
    const newSelected = new Set(selectedTasks);
    if (newSelected.has(fileId)) {
      newSelected.delete(fileId);
    } else {
      newSelected.add(fileId);
    }
    setSelectedTasks(newSelected);
  };


  const toggleSelectAll = () => {
    const completedFiles = activeTab === 'recycle'
      ? files
      : files.filter(f => getMediaUrl(f));
    if (selectedTasks.size === completedFiles.length) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(new Set(completedFiles.map(f => f.fileId)));
    }
  };

  const openDeleteModal = (file: EntityFile) => {
    setDeleteModal({ mode: 'single', files: [file], permanent: activeTab === 'recycle' });
    setDeleteProgress(null);
  };

  const openBatchDeleteModal = () => {
    if (selectedTasks.size === 0) return;
    const selected = files.filter(f => selectedTasks.has(f.fileId));
    setDeleteModal({ mode: 'batch', files: selected, permanent: activeTab === 'recycle' });
    setDeleteProgress(null);
  };

  const executeDelete = async () => {
    if (!deleteModal) return;
    setIsDeleting(true);
    const ids = deleteModal.files.map(f => f.fileId);
    const total = ids.length;

    try {
      if (deleteModal.permanent) {
        if (ids.length === 1) {
          await hardDeleteEntityFile(ids[0]);
        } else {
          const result = await hardDeleteEntityFiles(ids);
          if (result.errors.length > 0) {
            throw new Error(`${result.deleted}/${total} 个文件已删除，其余文件仍保留在回收站`);
          }
        }
        setDeleteProgress({ done: total, total });
      } else {
        let done = 0;
        for (const id of ids) {
          await deleteEntityFile(id);
          done++;
          setDeleteProgress({ done, total });
        }
      }
      setSelectedTasks(new Set());
      setDeleteModal(null);
      loadHistory();
    } catch (error: any) {
      console.error('删除失败:', error);
      alert(`删除失败: ${error?.message || '未知错误'}`);
    } finally {
      setIsDeleting(false);
      setDeleteProgress(null);
    }
  };


  const downloadSelected = async () => {
    if (selectedTasks.size === 0) {
      alert('请先选择要下载的文件');
      return;
    }

    let downloadCount = 0;
    for (const fileId of selectedTasks) {
      const file = files.find(f => f.fileId === fileId);
      if (!file) continue;

      const url = getMediaUrl(file);
      if (!url) continue;

      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = isVideo(file)
          ? `video_${fileId.substring(0, 8)}.mp4`
          : `image_${fileId.substring(0, 8)}.jpg`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        downloadCount++;

        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error('下载失败:', fileId, error);
      }
    }

    alert(`成功下载 ${downloadCount} 个文件`);
  };


  const getMediaUrl = (file: EntityFile): string | null => {
    if (file.isDeleted || activeTab === 'recycle') return null;
    if (!file.fileUrl) return null;
    return secureApiUrl(file.fileUrl, { absolute: true });
  };

  const getThumbnailUrl = (file: EntityFile): string | null => {
    if (file.fileType === 'video' && !file.isDeleted && activeTab === 'history') {
      if (file.thumbnailUrl) {
        return secureApiUrl(file.thumbnailUrl, { absolute: true });
      }
      const thumbnailEndpoint = `/api/thumbnail?url=${encodeURIComponent(file.fileUrl)}&width=640&height=360`;
      return secureApiUrl(thumbnailEndpoint, { absolute: true });
    }
    const sourceUrl = getHistoryThumbnailSource(file);
    if (sourceUrl) return secureApiUrl(sourceUrl, { absolute: true });
    if (activeTab === 'recycle' && file.fileType === 'image' && file.fileId.startsWith('file_')) {
      return secureApiUrl(`/api/entity-files/${encodeURIComponent(file.fileId)}/recycle-thumbnail`, { absolute: true });
    }
    return getMediaUrl(file);
  };

  const getThumbnailFallbackUrl = (file: EntityFile): string | null => {
    const fallbackSource = getHistoryThumbnailFallbackSource(file);
    return fallbackSource
      ? secureApiUrl(fallbackSource, { absolute: true })
      : null;
  };

  const isVideo = (file: EntityFile): boolean => {
    return file.fileType === 'video';
  };


  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };


  const openPreview = (file: EntityFile) => {
    const url = getMediaUrl(file);
    if (url) {
      setPreviewUrl(url);
      setPreviewType(isVideo(file) ? 'video' : 'image');
    }
  };

  const meta = (file: EntityFile) => file.metadata as { prompt?: string; model?: string } | undefined;

  return (
    <div className="workflow-stage-layout flex-col">

      <div className="workflow-stage-toolbar px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {activeTab === 'recycle'
            ? <Trash2 className="w-4 h-4 text-primary" />
            : <History className="w-4 h-4 text-primary" />}
          <h2 className="text-sm font-bold text-n700 uppercase tracking-wider">
            {activeTab === 'recycle' ? '回收站' : '生成历史'}
          </h2>
          <span className="text-xs text-n100">共 {files.length} 个文件</span>
          {activeTab === 'recycle' && (
            <span className="text-xs text-danger">仅显示你的素材；此处操作为永久删除</span>
          )}
        </div>

        <div className="flex items-center gap-2">

          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-n0 hover:bg-n20 text-n700 rounded text-xs font-medium transition-colors"
          >
            {selectedTasks.size > 0 ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            {selectedTasks.size > 0 ? `已选 ${selectedTasks.size}` : '全选'}
          </button>

          {activeTab === 'history' ? (
            <>
              <button
                onClick={downloadSelected}
                disabled={selectedTasks.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover disabled:bg-n0 disabled:text-n100 text-white rounded text-xs font-medium transition-colors"
              >
                <Download className="w-3.5 h-3.5" />批量下载
              </button>
              <button
                onClick={openBatchDeleteModal}
                disabled={selectedTasks.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-danger hover:bg-red-500 disabled:bg-n0 disabled:text-n100 text-white rounded text-xs font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />移入回收站
              </button>
            </>
          ) : (
            <button
              onClick={openBatchDeleteModal}
              disabled={selectedTasks.size === 0 || isDeleting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-danger hover:bg-red-500 disabled:bg-n0 disabled:text-n100 text-white rounded text-xs font-medium transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />批量永久删除
            </button>
          )}


          <button
            onClick={loadHistory}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-n0 hover:bg-n20 text-n700 rounded text-xs font-medium transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>


      <div className="workflow-stage-canvas workflow-stage-scroll p-6">
        {activeTab === 'history' && activeTasks.length > 0 && (
          <div className="mb-4 p-3 bg-b50 border border-b75 rounded-lg">
            <h4 className="text-xs font-bold text-b400 mb-2 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 animate-spin" />
              进行中 ({activeTasks.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {activeTasks.map(t => (
                <div key={t.task_id} className="px-3 py-1.5 bg-b50 border border-b75 rounded text-xs text-b400">
                  {t.task_type} - {t.status === 'processing' ? '处理中' : '排队中'}
                </div>
              ))}
            </div>
          </div>
        )}
        {loadError && (
          <div className="mb-4 p-3 bg-r50 border border-r75 rounded-lg">
            <div className="flex items-center gap-2 text-danger text-xs font-bold mb-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              加载出错
            </div>
            <p className="text-danger text-xs">{loadError}</p>
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
              <span className="text-n300">加载中...</span>
            </div>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-n100">
            <History className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg font-medium">{activeTab === 'recycle' ? '回收站为空' : '暂无历史记录'}</p>
            <p className="text-sm mt-2">{activeTab === 'recycle' ? '移入回收站的本人素材会显示在这里' : '开始生成你的第一个作品吧'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {files.map(file => {
              const mediaUrl = getMediaUrl(file);
              const thumbnailUrl = getThumbnailUrl(file);
              const thumbnailFallbackUrl = getThumbnailFallbackUrl(file);
              const isVideoFile = isVideo(file);
              const isLargeUpscaleResult = isImageUpscaleResultFile(file);
              const isSelected = selectedTasks.has(file.fileId);
              const canSelect = activeTab === 'recycle' || !!mediaUrl;
              const m = meta(file);
              const promptText = getHistoryPromptText(file);

              return (
                <div
                  key={file.fileId}
                  className={`bg-n0 rounded-md border overflow-hidden hover:border-primary transition-all shadow-card hover:shadow-atlas group relative ${
                    isSelected ? 'border-primary ring-1 ring-primary/30' : 'border-n40'
                  }`}
                >

                  {canSelect && (
                    <div className="absolute top-3 left-3 z-10">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(file.fileId)}
                        className="w-5 h-5 rounded border-2 border-n40 bg-n0 text-primary focus:ring-2 focus:ring-primary focus:ring-offset-0 cursor-pointer transition-all"
                      />
                    </div>
                  )}


                  <div
                    className="relative w-full aspect-video bg-n0 cursor-pointer"
                    onClick={() => canSelect && openPreview(file)}
                  >
                    {isLargeUpscaleResult && (
                      <span className="absolute right-3 top-3 z-10 rounded-md border border-white/30 bg-n900/75 px-2 py-1 text-[10px] font-bold text-white shadow-sm backdrop-blur">
                        大尺寸图
                      </span>
                    )}
                    {isVideoFile && (
                      <span className="absolute right-3 top-3 z-10 rounded-md border border-white/30 bg-primary/90 px-2 py-1 text-[10px] font-bold text-white shadow-sm backdrop-blur">
                        视频
                      </span>
                    )}
                    {activeTab === 'recycle' ? (
                      thumbnailUrl && !isVideoFile ? (
                        <HistoryThumbnailImage src={thumbnailUrl} alt="回收站图片缩略图" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-n100 gap-2">
                          {isVideoFile ? <Film className="w-16 h-16 opacity-20" /> : <ImageIcon className="w-16 h-16 opacity-20" />}
                          <span className="text-xs">缩略图暂不可用</span>
                        </div>
                      )
                    ) : mediaUrl ? (
                      <>
                        {isVideoFile ? (
                          <HistoryThumbnailImage
                            src={thumbnailUrl || ''}
                            alt="视频缩略图"
                          />
                        ) : (
                          <HistoryThumbnailImage
                            src={thumbnailUrl || mediaUrl}
                            fallbackSrc={thumbnailFallbackUrl || ''}
                            alt={isLargeUpscaleResult ? '图片高清放大缩略图' : '历史图片缩略图'}
                          />
                        )}

                        <div className="absolute inset-0 flex items-center justify-center bg-n900/50 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play className="w-12 h-12 text-white" />
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-n100">
                        {isVideoFile ? <Film className="w-16 h-16 opacity-20" /> : <ImageIcon className="w-16 h-16 opacity-20" />}
                      </div>
                    )}
                  </div>


                  <div className="p-3">
                    {!isVideoFile && <SeedreamSourceBadge reference={file.fileUrl || undefined} />}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-n100 truncate max-w-[55%]" title={m?.model}>
                        {m?.model || '—'}
                      </span>
                      <span className="text-[10px] text-n100 shrink-0">{formatTime(file.createdAt)}</span>
                    </div>

                    <div className="text-xs text-n300 mb-3 line-clamp-2 min-h-[2.5rem]">
                      {promptText || <span className="italic opacity-50">无提示词</span>}
                    </div>

                    <div className="flex gap-2">
                      {activeTab === 'recycle' ? (
                        <button
                          onClick={() => openDeleteModal(file)}
                          disabled={isDeleting}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-danger hover:bg-red-500 text-white rounded text-xs font-medium transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />永久删除
                        </button>
                      ) : mediaUrl ? (
                        <a
                          href={mediaUrl}
                          download
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded text-xs font-medium transition-colors"
                        >
                          <Download className="w-3 h-3" />
                          下载
                        </a>
                      ) : (
                        <button
                          disabled
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-n0 text-n100 rounded text-xs cursor-not-allowed"
                        >
                          <Download className="w-3 h-3" />
                          下载
                        </button>
                      )}
                      {activeTab === 'history' && (
                        <button
                          type="button"
                          onClick={() => setPromptModalFile(file)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary rounded text-xs font-medium transition-colors"
                        >
                          <FileText className="w-3 h-3" />提示词
                        </button>
                      )}
                      {activeTab === 'history' && file.fileId.startsWith('file_') && (
                        <button
                          onClick={() => openDeleteModal(file)}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-danger hover:bg-red-500 text-white rounded text-xs font-medium transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />删除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>


      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-n900/50 backdrop-blur-sm" onClick={() => !isDeleting && setDeleteModal(null)}>
          <div
            className="relative w-full max-w-lg mx-4 bg-n0 border border-red-500/20 rounded-2xl shadow-bottom shadow-red-950/30 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="h-1 bg-gradient-to-r from-red-600 via-red-500 to-orange-500" />

            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <ShieldAlert className="w-5 h-5 text-danger" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-n800">
                    {deleteModal.permanent
                      ? (deleteModal.mode === 'single' ? '确认永久删除' : `永久删除 ${deleteModal.files.length} 个文件`)
                      : (deleteModal.mode === 'single' ? '确认删除' : `批量删除 ${deleteModal.files.length} 个文件`)}
                  </h3>
                  <p className={`text-xs mt-0.5 ${deleteModal.permanent ? 'font-medium text-danger' : 'text-n100'}`}>
                    {deleteModal.permanent
                      ? '删除后将从服务器上删除内容，且不可再次恢复'
                      : '文件将移入回收站，尚未从服务器永久删除'}
                  </p>
                </div>
              </div>
              {!isDeleting && (
                <button onClick={() => setDeleteModal(null)} className="w-8 h-8 rounded-lg hover:bg-n20 flex items-center justify-center text-n100 hover:text-n700 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="px-6 py-3">
              {deleteModal.mode === 'single' ? (
                <div className="flex gap-4 p-3 bg-n30 rounded-md border border-n40">
                  <div className="w-24 h-24 rounded-lg overflow-hidden bg-n0 flex-shrink-0">
                    {getThumbnailUrl(deleteModal.files[0]!) ? (
                      <img src={getThumbnailUrl(deleteModal.files[0]!) || ''} className="w-full h-full object-cover" alt="待删除素材缩略图" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-8 h-8 text-n100" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-n300 truncate">{meta(deleteModal.files[0])?.model || '未知模型'}</p>
                    <p className="text-xs text-n100 mt-1">{formatTime(deleteModal.files[0]?.createdAt || '')}</p>
                    <p className="text-xs text-n100 mt-2 line-clamp-2">{getHistoryPromptText(deleteModal.files[0]) || '无提示词'}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-2">
                    {deleteModal.files.slice(0, 8).map(f => (
                      <div key={f.fileId} className="aspect-square rounded-lg overflow-hidden bg-n0 border border-n40">
                        {getThumbnailUrl(f) ? (
                          <img src={getThumbnailUrl(f) || ''} className="w-full h-full object-cover" alt="待删除素材缩略图" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-6 h-6 text-n100" /></div>
                        )}
                      </div>
                    ))}
                  </div>
                  {deleteModal.files.length > 8 && (
                    <p className="text-xs text-n100 text-center">...还有 {deleteModal.files.length - 8} 个文件</p>
                  )}
                </div>
              )}
              {deleteModal.permanent && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs leading-5 text-danger">
                  此操作会删除你本人素材对应的服务器文件并释放存储空间，同时删除文件记录；操作不可撤销。
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-n30 border-t border-n40">
              {deleteProgress && (
                <div className="flex-1 text-xs text-n100">
                  正在删除 {deleteProgress.done}/{deleteProgress.total}...
                </div>
              )}
              <button
                onClick={() => setDeleteModal(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm text-n300 hover:text-n700 hover:bg-n20 rounded-lg transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={executeDelete}
                disabled={isDeleting}
                className="px-5 py-2 text-sm font-medium text-white bg-danger hover:bg-red-500 rounded-lg transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    删除中...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    {deleteModal.permanent ? '确认永久删除' : '移入回收站'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}


      {promptModalFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-n900/50 backdrop-blur-sm"
          onClick={() => setPromptModalFile(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-prompt-title"
            className="relative w-full max-w-2xl mx-4 overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-bottom"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-n40 px-6 py-5">
              <div>
                <h3 id="history-prompt-title" className="text-base font-bold text-n800">生成提示词</h3>
                <p className="mt-1 text-xs text-n100">
                  {meta(promptModalFile)?.model || '未知模型'} · {formatTime(promptModalFile.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPromptModalFile(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-n100 transition-colors hover:bg-n20 hover:text-n700"
                aria-label="关闭提示词"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
              <div className="whitespace-pre-wrap break-words rounded-md border border-n40 bg-n20 p-4 text-sm leading-6 text-n700">
                {getHistoryPromptText(promptModalFile) || '该历史记录没有保存提示词'}
              </div>
            </div>
            <div className="flex justify-end border-t border-n40 bg-n20 px-6 py-4">
              <button
                type="button"
                onClick={() => setPromptModalFile(null)}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}


      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-n900/50 backdrop-blur-sm"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="max-w-4xl max-h-[90vh] relative" onClick={e => e.stopPropagation()}>
            {previewType === 'video' ? (
              <video
                src={previewUrl}
                preload="metadata"
                className="max-w-full max-h-[85vh] rounded-lg"
                controls
                autoPlay
              />
            ) : (
              <><img src={previewUrl} className="max-w-full max-h-[85vh] rounded-lg" alt="" /><SeedreamSourceBadge reference={previewUrl} /></>
            )}
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute -top-2 -right-2 w-8 h-8 bg-n0 hover:bg-n20 text-n800 rounded-full flex items-center justify-center"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
