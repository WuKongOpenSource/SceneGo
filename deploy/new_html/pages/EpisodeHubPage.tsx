import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Plus,
  ArrowLeft,
  LayoutList,
  Grid3X3,
  Clock,
  Film,
  MoreVertical,
  Trash2,
  Pencil,
  Copy,
  Upload,
} from 'lucide-react';
import { apiJson } from '../services/httpClient';
import { secureApiUrl } from '../services/httpClient';
import { uploadEntityFile } from '../services/entityFileService';
import {
  duplicateEpisode as duplicateEpisodeRequest,
  reorderEpisodes,
  updateEpisode,
} from '../services/projectWorkflowService';
import type { Episode } from '../types';
import { BrandLogo } from '../components/BrandLogo';
import AccountMenu from '../components/AccountMenu';
import AppSidebar from '../components/AppSidebar';
import { crmConfirm, crmMessage } from '../admin/crmUI';
import { prepareCoverUploadFile } from '../utils/coverImage';
import { cleanupReplacedCoverFile } from '../utils/coverCleanup';

type EpisodeCard = Episode & { coverUrl?: string };
type EpisodeStatus = Episode['status'];
type EpisodeTab = 'all' | EpisodeStatus;

const episodeStatusOrder: EpisodeStatus[] = ['draft', 'in_progress', 'completed', 'published'];
const episodeStatusLabels: Record<EpisodeStatus, string> = {
  draft: '草稿',
  in_progress: '制作中',
  completed: '已完成',
  published: '已发布',
};

function normalizeEpisodeSettings(value: any): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function orderValue(ep: EpisodeCard): number {
  const sort = Number(ep.sortOrder);
  if (Number.isFinite(sort)) return sort;
  const number = Number(ep.episodeNumber);
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function sortEpisodes(items: EpisodeCard[]): EpisodeCard[] {
  return [...items].sort((a, b) => {
    const bySort = orderValue(a) - orderValue(b);
    if (bySort !== 0) return bySort;
    const byEpisodeNumber = Number(a.episodeNumber || 0) - Number(b.episodeNumber || 0);
    if (byEpisodeNumber !== 0) return byEpisodeNumber;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

function renumberEpisodeSortOrder(items: EpisodeCard[]): EpisodeCard[] {
  return items.map((ep, index) => ({ ...ep, sortOrder: index }));
}

function previewEpisodeReorder(items: EpisodeCard[], sourceId: string, targetId: string): EpisodeCard[] {
  const sourceIndex = items.findIndex(ep => ep.episodeId === sourceId);
  const targetIndex = items.findIndex(ep => ep.episodeId === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return items;
  }

  const nextEpisodes = [...items];
  const [moved] = nextEpisodes.splice(sourceIndex, 1);
  nextEpisodes.splice(targetIndex, 0, moved);
  return renumberEpisodeSortOrder(nextEpisodes);
}

function episodeOrderChanged(previous: EpisodeCard[], next: EpisodeCard[]): boolean {
  if (previous.length !== next.length) return true;
  return previous.some((ep, index) => ep.episodeId !== next[index]?.episodeId);
}

function isInteractiveDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('button,input,textarea,select,a,[data-no-card-drag="true"]'));
}

function mapEpisode(row: any): EpisodeCard {
  const settings = normalizeEpisodeSettings(row.settings);
  const status = episodeStatusOrder.includes(row.status) ? row.status : 'draft';
  return {
    episodeId: row.episode_id ?? row.episodeId,
    projectId: row.project_id ?? row.projectId,
    episodeNumber: Number(row.episode_number ?? row.episodeNumber ?? 0),
    episodeName: row.episode_name ?? row.episodeName ?? '',
    description: row.description || '',
    coverUrl: row.cover_url ?? row.coverUrl ?? settings.cover_url ?? settings.coverUrl,
    status,
    settings,
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? row.episode_number ?? 0),
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

export const EpisodeHubPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const [episodes, setEpisodes] = useState<EpisodeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [draggingEpisodeId, setDraggingEpisodeId] = useState<string | null>(null);
  const [dragOverEpisodeId, setDragOverEpisodeId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [coverUploadTargetId, setCoverUploadTargetId] = useState<string | null>(null);
  const [uploadingCoverEpisodeId, setUploadingCoverEpisodeId] = useState<string | null>(null);
  const [activeStatusTab, setActiveStatusTab] = useState<EpisodeTab>('all');
  const dragOverlayRef = useRef<HTMLElement | null>(null);
  const transparentDragImageRef = useRef<HTMLElement | null>(null);
  const dragPointerOffsetRef = useRef({ x: 0, y: 0 });

  const loadEpisodes = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await apiJson<any>(`/api/projects/${projectId}/episodes`, {}, '分集列表');
      if (data.success) {
        setEpisodes(sortEpisodes((data.episodes || []).map(mapEpisode)));
      }
    } catch (e) {
      console.error('Failed to load episodes:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadEpisodes(); }, [loadEpisodes]);

  const removeDragVisuals = useCallback(() => {
    dragOverlayRef.current?.remove();
    transparentDragImageRef.current?.remove();
    dragOverlayRef.current = null;
    transparentDragImageRef.current = null;
  }, []);

  useEffect(() => removeDragVisuals, [removeDragVisuals]);

  const coverImageSrc = useCallback((url: string) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url) && !url.startsWith(window.location.origin)) return url;
    return secureApiUrl(url, { absolute: url.startsWith('/') });
  }, []);

  const createEpisode = async () => {
    if (!newTitle.trim() || !projectId) return;
    try {
      const data = await apiJson<any>(`/api/projects/${projectId}/episodes`, {
        method: 'POST',
        body: JSON.stringify({ episode_name: newTitle })
      }, '创建分集');
      if (data.success) {
        setNewTitle('');
        setShowCreate(false);
        loadEpisodes();
      }
    } catch (e) {
      console.error('Failed to create episode:', e);
    }
  };

  const deleteEpisode = async (episodeId: string) => {
    const episode = episodes.find(item => item.episodeId === episodeId);
    if (!await crmConfirm({
      title: '删除分集',
      message: `确定删除「${episode?.episodeName || '未命名分集'}」？该分集的剧本、分镜和生成结果将一并删除，且不可恢复。`,
      type: 'danger',
      confirmText: '删除分集',
    })) return;
    try {
      const data = await apiJson<any>(`/api/episodes/${episodeId}`, {
        method: 'DELETE',
      }, '删除分集');
      if (data.success) {
        crmMessage.success('分集已删除');
        loadEpisodes();
      }
    } catch (e) {
      console.error('Failed to delete episode:', e);
      crmMessage.error('删除失败，请检查网络');
    }
    setMenuOpen(null);
  };

  const duplicateEpisode = async (episodeId: string) => {
    setMenuOpen(null);
    if (duplicatingId) return;
    setDuplicatingId(episodeId);
    try {
      const data = await duplicateEpisodeRequest(episodeId);
      if (data.success) {
        await loadEpisodes();
      } else {
        crmMessage.error('复制失败：' + (data.detail || '未知错误'));
      }
    } catch (e) {
      console.error('Failed to duplicate episode:', e);
      crmMessage.error('复制失败，请检查网络');
    } finally {
      setDuplicatingId(null);
    }
  };

  const openCoverUpload = useCallback((episodeId: string) => {
    setMenuOpen(null);
    setCoverUploadTargetId(episodeId);
    window.setTimeout(() => coverInputRef.current?.click(), 0);
  }, []);

  const handleCoverFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    const episodeId = coverUploadTargetId;
    setCoverUploadTargetId(null);
    if (!file || !episodeId) return;

    if (!file.type.startsWith('image/')) {
      crmMessage.warning('请选择图片文件作为分集封面');
      return;
    }

    const episode = episodes.find(item => item.episodeId === episodeId);
    const previousCoverUrl = episode?.coverUrl ?? episode?.settings?.cover_url ?? episode?.settings?.coverUrl;
    const nextSettings = {
      ...(episode?.settings || {}),
      cover_url: '',
    };

    setUploadingCoverEpisodeId(episodeId);
    try {
      const coverFile = await prepareCoverUploadFile(file);
      const uploaded = await uploadEntityFile(coverFile, 'episode', episodeId, 'cover');
      nextSettings.cover_url = uploaded.fileUrl;
      await updateEpisode(episodeId, { settings: nextSettings });
      setEpisodes(prev => prev.map(item =>
        item.episodeId === episodeId
          ? {
              ...item,
              coverUrl: uploaded.fileUrl,
              settings: nextSettings,
              updatedAt: new Date().toISOString(),
            }
          : item
      ));
      try {
        await cleanupReplacedCoverFile(previousCoverUrl, uploaded.fileId);
        crmMessage.success('分集封面已更新');
      } catch (cleanupError) {
        console.warn('Failed to clean up replaced episode cover:', cleanupError);
        crmMessage.warning('分集封面已更新，但旧封面文件清理失败');
      }
    } catch (error) {
      console.error('上传分集封面失败:', error);
      crmMessage.error('上传分集封面失败，请检查图片格式或网络');
    } finally {
      setUploadingCoverEpisodeId(null);
    }
  }, [coverUploadTargetId, episodes]);

  const startRename = (ep: Episode) => {
    setEditingId(ep.episodeId);
    setEditingName(ep.episodeName || '');
    setMenuOpen(null);
  };

  const submitRename = async () => {
    if (!editingId || !editingName.trim()) { setEditingId(null); return; }
    try {
      const data = await apiJson<any>(`/api/episodes/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify({ episode_name: editingName.trim() })
      }, '重命名分集');
      if (data.success) loadEpisodes();
    } catch (e) {
      console.error('Failed to rename episode:', e);
    }
    setEditingId(null);
  };

  const persistEpisodeOrder = useCallback(async (nextEpisodes: EpisodeCard[], previousEpisodes: EpisodeCard[]) => {
    if (!projectId) return;
    setReordering(true);
    try {
      await reorderEpisodes(projectId, nextEpisodes.map(ep => ep.episodeId));
      crmMessage.success('分集顺序已更新');
    } catch (error) {
      console.error('Failed to reorder episodes:', error);
      setEpisodes(previousEpisodes);
      crmMessage.error('分集排序保存失败，已恢复原顺序');
    } finally {
      setReordering(false);
    }
  }, [projectId]);

  const handleDragStart = (event: React.DragEvent<HTMLElement>, episodeId: string) => {
    if (reordering || editingId || isInteractiveDragTarget(event.target)) {
      event.preventDefault();
      return;
    }
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    const pointerX = event.clientX || rect.left + rect.width / 2;
    const pointerY = event.clientY || rect.top + Math.min(rect.height / 2, 120);
    dragPointerOffsetRef.current = {
      x: Math.max(0, pointerX - rect.left),
      y: Math.max(0, pointerY - rect.top),
    };

    removeDragVisuals();
    const overlay = card.cloneNode(true) as HTMLElement;
    overlay.removeAttribute('data-testid');
    overlay.querySelectorAll('[data-testid]').forEach(node => node.removeAttribute('data-testid'));
    overlay.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('draggable', 'false');
    overlay.dataset.episodeDragOverlay = 'true';
    Object.assign(overlay.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      zIndex: '9999',
      pointerEvents: 'none',
      opacity: '1',
      margin: '0',
      animation: 'none',
      transition: 'none',
      transform: 'scale(1.025) rotate(0.2deg)',
      transformOrigin: 'center',
      boxShadow: '0 28px 64px rgba(15, 23, 42, 0.28)',
    });
    document.body.appendChild(overlay);
    dragOverlayRef.current = overlay;

    const transparentDragImage = document.createElement('span');
    Object.assign(transparentDragImage.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '1px',
      height: '1px',
      opacity: '0.001',
      pointerEvents: 'none',
    });
    document.body.appendChild(transparentDragImage);
    transparentDragImageRef.current = transparentDragImage;

    setDraggingEpisodeId(episodeId);
    setDragOverEpisodeId(episodeId);
    setMenuOpen(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', episodeId);
    if (typeof event.dataTransfer.setDragImage === 'function') {
      event.dataTransfer.setDragImage(transparentDragImage, 0, 0);
    }
  };

  const handleDrag = (event: React.DragEvent<HTMLElement>) => {
    const overlay = dragOverlayRef.current;
    if (!overlay || (event.clientX === 0 && event.clientY === 0)) return;
    overlay.style.left = `${event.clientX - dragPointerOffsetRef.current.x}px`;
    overlay.style.top = `${event.clientY - dragPointerOffsetRef.current.y}px`;
  };

  const handleDragOver = (event: React.DragEvent<HTMLElement>, targetEpisodeId: string) => {
    const sourceId = draggingEpisodeId || event.dataTransfer.getData('text/plain');
    if (!sourceId || reordering) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (sourceId === targetEpisodeId) return;
    setDragOverEpisodeId(targetEpisodeId);
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>, targetEpisodeId: string) => {
    event.preventDefault();
    const sourceId = draggingEpisodeId || event.dataTransfer.getData('text/plain');
    const effectiveTargetId = sourceId === targetEpisodeId
      ? dragOverEpisodeId || targetEpisodeId
      : targetEpisodeId;
    const previousEpisodes = episodes;
    const nextEpisodes = sourceId
      ? previewEpisodeReorder(previousEpisodes, sourceId, effectiveTargetId)
      : previousEpisodes;
    removeDragVisuals();
    setDraggingEpisodeId(null);
    setDragOverEpisodeId(null);
    if (!sourceId || reordering) return;
    if (!episodeOrderChanged(previousEpisodes, nextEpisodes)) return;

    setEpisodes(nextEpisodes);
    void persistEpisodeOrder(nextEpisodes, previousEpisodes);
  };

  const handleDragEnd = () => {
    removeDragVisuals();
    setDraggingEpisodeId(null);
    setDragOverEpisodeId(null);
  };

  const goToWorkflow = (episodeId: string) => {
    navigate(`/projects/${projectId}/ep/${episodeId}/workflow/script`);
  };

  const goToCanvas = (episodeId: string) => {
    navigate(`/projects/${projectId}/ep/${episodeId}/canvas`);
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-n30 text-n700',
    in_progress: 'bg-primary-light text-primary',
    completed: 'bg-n30 text-success',
    published: 'bg-g50 text-g400',
  };

  const statusCounts = useMemo(() => (
    episodeStatusOrder.reduce<Record<EpisodeStatus, number>>((acc, status) => {
      acc[status] = episodes.filter(ep => ep.status === status).length;
      return acc;
    }, {
      draft: 0,
      in_progress: 0,
      completed: 0,
      published: 0,
    })
  ), [episodes]);

  const episodeTabs = useMemo(() => [
    { key: 'all' as const, label: '全部分集', count: episodes.length },
    ...episodeStatusOrder.map(status => ({
      key: status,
      label: episodeStatusLabels[status],
      count: statusCounts[status],
    })),
  ], [episodes.length, statusCounts]);

  const filteredEpisodes = useMemo(() => (
    activeStatusTab === 'all'
      ? episodes
      : episodes.filter(ep => ep.status === activeStatusTab)
  ), [activeStatusTab, episodes]);

  const dragPreviewEpisodes = useMemo(() => (
    draggingEpisodeId && dragOverEpisodeId
      ? previewEpisodeReorder(episodes, draggingEpisodeId, dragOverEpisodeId)
      : episodes
  ), [dragOverEpisodeId, draggingEpisodeId, episodes]);

  const dragPreviewOrder = useMemo(() => new Map(
    dragPreviewEpisodes
      .filter(ep => activeStatusTab === 'all' || ep.status === activeStatusTab)
      .map((ep, index) => [ep.episodeId, index])
  ), [activeStatusTab, dragPreviewEpisodes]);

  const dragPreviewNumbers = useMemo(() => new Map(
    dragPreviewEpisodes.map((ep, index) => [ep.episodeId, index + 1])
  ), [dragPreviewEpisodes]);

  const pageTitle = activeStatusTab === 'all' ? '全部分集' : episodeStatusLabels[activeStatusTab];

  const episodeGridClass = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5';

  return (
    <div className="layout-safe flex min-h-screen bg-n20 text-n800" onClick={() => setMenuOpen(null)}>
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="选择分集封面图片"
        onChange={handleCoverFileChange}
      />

      <AppSidebar className="sticky top-0 hidden h-screen lg:flex" />
      <div className="min-h-screen w-full min-w-0 max-w-none bg-n0 md:border-x md:border-n40">
        <header className="animate-slideDown">
          <div className="flex min-h-[72px] flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="flex min-w-0 items-center gap-4">
              <button
                type="button"
                onClick={() => navigate('/projects')}
                className="flex shrink-0 items-center gap-2 rounded focus:outline-none focus:ring-2 focus:ring-primary/25"
                title="创剧 · AI 视频创作平台"
              >
                <BrandLogo className="h-8 w-auto max-w-[170px]" alt="创剧 · AI 视频创作平台" />
              </button>
              <div className="h-8 w-px shrink-0 bg-n40" />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold tracking-tight text-n800 sm:text-2xl">分集</h1>
                <p className="mt-0.5 text-xs text-n100 lg:hidden">{episodes.length} 个分集</p>
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap lg:gap-3">
              <AccountMenu />
            </div>
          </div>

          <div className="flex h-14 items-end border-y border-n40 px-4 sm:px-6 lg:h-16 lg:px-8">
            <button
              type="button"
              onClick={() => navigate('/projects')}
              className="mb-2 mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-n40 bg-n0 text-n300 transition-colors hover:border-n70 hover:text-n800"
              title="返回项目列表"
              aria-label="返回项目列表"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex h-full min-w-0 items-end gap-4 overflow-x-auto">
              {episodeTabs.map(tab => {
                const active = activeStatusTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setActiveStatusTab(tab.key)}
                    className={`relative flex h-full shrink-0 items-center px-2 text-sm font-medium transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 ${active ? 'text-primary after:bg-primary' : 'text-n700 after:bg-transparent hover:text-primary'}`}
                  >
                    {tab.label}
                    <span className={`ml-2 inline-flex min-w-5 items-center justify-center rounded-full border px-1.5 py-0.5 text-[11px] ${active ? 'border-b75 bg-primary-light text-primary' : 'border-n40 bg-n20 text-n300'}`}>
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        <main className="px-4 py-7 sm:px-6 lg:px-8">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-n800">{pageTitle}</h2>
              <p className="mt-1 text-xs text-n100">共 {filteredEpisodes.length} 个分集；每个分集拥有独立生产链路，拖动卡片可调整顺序，EP 编号会按当前顺序自动刷新。</p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-card transition-all hover:bg-primary-hover hover:shadow-atlas sm:w-auto sm:min-w-[128px]"
            >
              <Plus size={17} /> 新建分集
            </button>
          </div>

          {loading ? (
            <div className={episodeGridClass}>
              {[1, 2, 3, 4].map(item => (
                <div key={item} className="aspect-[4/3] animate-pulse rounded-lg border border-n40 bg-n20" />
              ))}
            </div>
          ) : filteredEpisodes.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-n40 bg-n10 px-6 text-center text-n100">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-light text-primary">
                <Film className="h-7 w-7" />
              </div>
              <p className="mb-1 text-base font-medium text-n700">{episodes.length === 0 ? '暂无分集' : `暂无${pageTitle}分集`}</p>
              <p className="text-sm">{episodes.length === 0 ? '点击「新建分集」开始创作' : '切换其他状态或新建分集继续创作'}</p>
            </div>
          ) : (
            <div className={episodeGridClass}>
              {filteredEpisodes.map((ep, idx) => {
                const displayIndex = episodes.findIndex(item => item.episodeId === ep.episodeId);
                const displayNumber = dragPreviewNumbers.get(ep.episodeId) ?? (displayIndex >= 0 ? displayIndex + 1 : idx + 1);
                const visualOrder = dragPreviewOrder.get(ep.episodeId) ?? idx;
                const isDragging = draggingEpisodeId === ep.episodeId;
                const isDropTarget = dragOverEpisodeId === ep.episodeId;
                const canDragCard = !reordering && !editingId;
                return (
                  <article
                    key={ep.episodeId}
                    data-testid={`episode-card-${ep.episodeId}`}
                    data-dragging={isDragging ? 'true' : undefined}
                    data-drop-placeholder={isDragging ? 'true' : undefined}
                    data-drop-target={isDropTarget ? 'true' : undefined}
                    title={canDragCard ? '拖动卡片调整分集顺序' : undefined}
                    aria-label={canDragCard ? `${ep.episodeName || '未命名分集'} 拖动排序` : undefined}
                    draggable={canDragCard}
                    className={`group relative overflow-hidden rounded-lg border border-n40 bg-n0 shadow-card transition-[border-color,box-shadow,opacity,filter] duration-150 ease-out animate-slideUp ${canDragCard ? 'cursor-grab select-none active:cursor-grabbing' : 'cursor-default'} hover:-translate-y-0.5 hover:border-n70 hover:shadow-atlas ${isDragging ? 'z-10 border-dashed border-primary/60 bg-primary-light opacity-25 shadow-none grayscale-[35%]' : ''}`}
                    style={{ animationDelay: `${visualOrder * 60}ms`, order: visualOrder }}
                    onClick={event => event.stopPropagation()}
                    onDragStart={event => handleDragStart(event, ep.episodeId)}
                    onDrag={handleDrag}
                    onDragEnd={handleDragEnd}
                    onDragEnter={event => handleDragOver(event, ep.episodeId)}
                    onDragOver={event => handleDragOver(event, ep.episodeId)}
                    onDrop={event => handleDrop(event, ep.episodeId)}
                  >
                  <div className="relative aspect-video overflow-visible bg-gradient-to-br from-n30 via-n20 to-primary-light">
                    {ep.coverUrl ? (
                      <img draggable={false} src={coverImageSrc(ep.coverUrl)} alt={`${ep.episodeName || '未命名分集'} 封面`} className="h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.02]" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                        <BrandLogo variant="mark" className="h-24 w-24 opacity-[0.08]" alt="" />
                      </div>
                    )}
                    {uploadingCoverEpisodeId === ep.episodeId && (
                      <div className="absolute inset-0 flex items-center justify-center bg-n800/45 text-sm font-medium text-white">
                        封面上传中...
                      </div>
                    )}
                    <div className="absolute right-3 top-3 z-20">
                      <button
                        type="button"
                        aria-label={`${ep.episodeName || '未命名分集'} 更多操作`}
                        onClick={() => setMenuOpen(menuOpen === ep.episodeId ? null : ep.episodeId)}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-n40 bg-n0 text-n300 shadow-card transition-colors hover:text-n800"
                      >
                        <MoreVertical size={16} />
                      </button>
                      {menuOpen === ep.episodeId && (
                        <div className="absolute right-0 top-10 z-30 min-w-[144px] overflow-hidden rounded-lg border border-n40 bg-n0 py-1 shadow-bottom animate-scaleIn">
                          <button onClick={() => startRename(ep)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-n700 transition-colors hover:bg-n20">
                            <Pencil size={14} /> 重命名
                          </button>
                          <button
                            type="button"
                            onClick={() => openCoverUpload(ep.episodeId)}
                            disabled={uploadingCoverEpisodeId === ep.episodeId}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-n700 transition-colors hover:bg-n20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Upload size={14} /> 上传封面
                          </button>
                          <button
                            onClick={() => duplicateEpisode(ep.episodeId)}
                            disabled={duplicatingId === ep.episodeId}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-n700 transition-colors hover:bg-n20 disabled:opacity-50"
                          >
                            <Copy size={14} /> {duplicatingId === ep.episodeId ? '复制中...' : '复制'}
                          </button>
                          <button onClick={() => deleteEpisode(ep.episodeId)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger transition-colors hover:bg-r50">
                            <Trash2 size={14} /> 删除
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-4">
                    {editingId === ep.episodeId ? (
                      <div data-testid={`episode-title-row-${ep.episodeId}`} className="mb-2 flex items-center gap-2">
                        <span className="shrink-0 rounded bg-n800 px-2 py-1 text-[11px] font-semibold text-white shadow-card">EP {String(displayNumber).padStart(2, '0')}</span>
                        <input
                          value={editingName}
                          onChange={event => setEditingName(event.target.value)}
                          onKeyDown={event => { if (event.key === 'Enter') submitRename(); if (event.key === 'Escape') setEditingId(null); }}
                          onBlur={submitRename}
                          autoFocus
                          className="min-w-0 flex-1 rounded border border-primary bg-n0 px-2 py-1 text-sm font-semibold text-n800 outline-none ring-2 ring-primary/15"
                        />
                      </div>
                    ) : (
                      <div data-testid={`episode-title-row-${ep.episodeId}`} className="mb-2 flex min-w-0 items-center gap-2">
                        <span className="shrink-0 rounded bg-n800 px-2 py-1 text-[11px] font-semibold text-white shadow-card">EP {String(displayNumber).padStart(2, '0')}</span>
                        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-n800">{ep.episodeName || '未命名分集'}</h3>
                        <span className={`shrink-0 rounded px-2 py-1 text-[11px] font-medium ${statusColors[ep.status] || statusColors.draft}`}>
                          {episodeStatusLabels[ep.status] || ep.status}
                        </span>
                      </div>
                    )}
                    {ep.description && <p className="mb-3 line-clamp-2 text-xs text-n200">{ep.description}</p>}
                    <div className="mb-4 flex items-center text-xs text-n100">
                      <Clock size={12} className="mr-1" />
                      更新于 {ep.updatedAt ? new Date(ep.updatedAt).toLocaleDateString('zh-CN') : '未编辑'}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => goToWorkflow(ep.episodeId)}
                        className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-b75 bg-primary-light px-2 text-sm font-medium text-primary transition-colors hover:border-primary"
                      >
                        <LayoutList size={15} /> 流程化制作
                      </button>
                      <button
                        onClick={() => goToCanvas(ep.episodeId)}
                        className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-n40 bg-n20 px-2 text-sm font-medium text-success transition-colors hover:border-g200"
                      >
                        <Grid3X3 size={15} /> 自由创作
                      </button>
                    </div>
                  </div>
                  </article>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {showCreate && (
        <div
          className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-episode-title"
          onClick={() => { setShowCreate(false); setNewTitle(''); }}
        >
          <div className="app-modal-surface w-full max-w-md overflow-hidden" onClick={event => event.stopPropagation()}>
            <div className="app-modal-header">
              <h2 id="create-episode-title" className="text-lg font-semibold text-n800">新建分集</h2>
            </div>
            <div className="app-modal-body">
              <label className="mb-1.5 block text-sm text-n300">分集标题</label>
              <input
                value={newTitle}
                onChange={event => setNewTitle(event.target.value)}
                placeholder="例如：第一集 - 序章"
                className="w-full rounded-lg border border-n40 bg-n0 px-3 py-2.5 text-sm text-n800 outline-none transition-all placeholder:text-n100 focus:border-primary focus:ring-2 focus:ring-primary/20"
                onKeyDown={event => event.key === 'Enter' && createEpisode()}
                autoFocus
              />
              <p className="mt-2 text-xs text-n100">创建后可选择流程化制作或自由创作。</p>
            </div>
            <div className="app-modal-footer">
              <button onClick={() => { setShowCreate(false); setNewTitle(''); }} className="rounded-lg border border-n40 bg-n0 px-4 py-2 text-sm font-medium text-n700 transition-colors hover:bg-n20">
                取消
              </button>
              <button onClick={createEpisode} disabled={!newTitle.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-n70">
                创建分集
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
