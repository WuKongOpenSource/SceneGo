













import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Upload, Download, Star, StarOff, Trash2, Eye, RefreshCw, Filter,
  Grid as GridIcon, List as ListIcon, Image as ImageIcon, Film, Music, FileText,
  Search, Folder, FolderPlus, FolderOpen, ChevronRight, ChevronDown, Pencil, X as XIcon,
  Layers,
} from 'lucide-react';
import {
  listMediaItems,
  uploadMediaItem,
  updateMediaItem,
  deleteMediaItem,
  batchDownloadMediaItems,
  listMediaFolders,
  createMediaFolder,
  updateMediaFolder,
  deleteMediaFolder,
  MediaLibraryItem,
  MediaItemType,
  PermissionScope,
  MediaFolder,
} from '../services/mediaLibraryService';
import { buildFolderTree, flattenForSelect, type FolderNode } from '../utils/mediaFolderTree';
import ShareResourceDialog from '../components/ShareResourceDialog';
import { useCurrentOrgId, useWorkspace } from '../contexts/WorkspaceContext';
import { useEpisode } from '../contexts/EpisodeContext';
import { LazyVideo } from '../components/LazyVideo';
import { getStoredUserId } from '../services/accountStorage';
import { secureApiUrl } from '../services/httpClient';
import { FilmstripThumbnail } from '../components/FilmstripThumbnail';

type CategoryKey = 'all' | 'mine' | 'shared' | 'image' | 'video' | 'audio' | 'frame' | 'favorite';

const CATEGORIES: { key: CategoryKey; label: string; icon: React.ReactNode }[] = [
  { key: 'all',      label: '全部素材',    icon: <Grid size={14} /> },
  { key: 'mine',     label: '我的',         icon: <ImageIcon size={14} /> },
  { key: 'shared',   label: '项目共享',     icon: <Eye size={14} /> },
  { key: 'image',    label: '图片',         icon: <ImageIcon size={14} /> },
  { key: 'video',    label: '视频',         icon: <Film size={14} /> },
  { key: 'audio',    label: '音频',         icon: <Music size={14} /> },
  { key: 'frame',    label: '抽帧素材',     icon: <Film size={14} /> },
  { key: 'favorite', label: '收藏',         icon: <Star size={14} /> },
];

function Grid({ size = 14 }: { size?: number }) {
  return <GridIcon size={size} />;
}

function formatBytes(n?: number) {
  if (!n && n !== 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const SCOPE_LABEL: Record<PermissionScope, string> = {
  private: '私有',
  project: '项目共享',
  team: '团队共享',
  public_link: '公开',
};

export const MediaLibraryPage: React.FC = () => {
  const { projectId, episodeId: routeEpisodeId } = useParams<{ projectId: string; episodeId?: string }>();
  const navigate = useNavigate();
  const episodeContext = useEpisode();
  const episodeId = episodeContext.episodeId || routeEpisodeId || '';
  const assetScopeMode = episodeId ? episodeContext.assetScopeMode : 'project';
  const setAssetScopeMode = episodeContext.setAssetScopeMode;
  const myUserId = getStoredUserId();
  const hasProjectContext = Boolean(projectId);

  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [category, setCategory] = useState<CategoryKey>('all');
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [shareTarget, setShareTarget] = useState<MediaLibraryItem | null>(null);

  const orgId = useCurrentOrgId();
  const { isOrgWorkspace, currentName } = useWorkspace();
  const [uploadVisibility, setUploadVisibility] = useState<'private' | 'org-default'>('private');
  useEffect(() => {
    setUploadVisibility(isOrgWorkspace ? 'org-default' : 'private');
  }, [isOrgWorkspace]);



  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState<string>('');
  const [folderEditor, setFolderEditor] = useState<{
    mode: 'create' | 'rename';
    value: string;
    parentFolderId: string | null;
    folder?: MediaFolder;
  } | null>(null);
  const [folderSaving, setFolderSaving] = useState(false);
  const [folderEditorError, setFolderEditorError] = useState('');


  useEffect(() => {
    if (selectedFolderId && selectedFolderId !== '__unfiled__') setUploadTargetFolderId(selectedFolderId);
    else setUploadTargetFolderId('');
  }, [selectedFolderId]);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const folderOptions = useMemo(() => flattenForSelect(folderTree), [folderTree]);

  const loadFolders = useCallback(async () => {
    if (!projectId) {
      setFolders([]);
      setSelectedFolderId(null);
      return;
    }
    try {
      const resp = await listMediaFolders(projectId);
      setFolders(resp.folders || []);
    } catch (e: any) {

      console.warn('加载素材文件夹失败:', e?.message || e);
    }
  }, [projectId]);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  const selected = useMemo(
    () => items.find(i => i.library_item_id === selectedId) || null,
    [items, selectedId],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { limit: 200 };
      if (projectId) params.project_id = projectId;
      if (episodeId && assetScopeMode === 'episode') {
        params.episode_id = episodeId;
        params.include_shared = true;
      }
      switch (category) {
        case 'mine':
          params.permission_scope = 'private';
          break;
        case 'shared':
          params.permission_scope = 'project';
          break;
        case 'image':
          params.item_type = 'image';
          break;
        case 'video':
          params.item_type = 'video';
          break;
        case 'audio':
          params.item_type = 'audio';
          break;
        case 'frame':
          params.source = 'video_reverse_frame';
          break;
        case 'favorite':
          params.is_favorite = true;
          break;
      }
      if (keyword.trim()) params.keyword = keyword.trim();
      if (projectId && selectedFolderId) params.folder_id = selectedFolderId;
      const resp = await listMediaItems(params);
      setItems(resp.items || []);
      setTotal(resp.total || 0);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, episodeId, assetScopeMode, category, keyword, selectedFolderId]);

  useEffect(() => { reload(); }, [reload]);

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      const uploadFolderId = uploadTargetFolderId || undefined;
      for (const f of files) {
        await uploadMediaItem(f, {
          projectId: projectId || undefined,
          episodeId: projectId && episodeId ? episodeId : undefined,
          permissionScope: projectId ? 'project' : 'private',
          title: f.name,
          visibility: uploadVisibility,
          orgId: uploadVisibility === 'org-default' ? (orgId || undefined) : undefined,
          folderId: projectId ? uploadFolderId : undefined,
        });
      }
      await reload();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleCheck = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBatchDownload = async () => {
    if (!checked.size) return;
    try {
      const blob = await batchDownloadMediaItems(Array.from(checked));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `media_library_${projectId || 'personal'}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const handleToggleFavorite = async (item: MediaLibraryItem) => {
    try {
      const res = await updateMediaItem(item.library_item_id, { is_favorite: !item.is_favorite });
      setItems(prev => prev.map(i => i.library_item_id === item.library_item_id ? res.item : i));
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const handleChangeScope = async (item: MediaLibraryItem, scope: PermissionScope) => {
    if (scope === 'project' && !item.project_id) {
      setError('该素材尚未归属项目，不能设置为项目共享。');
      return;
    }
    try {
      const res = await updateMediaItem(item.library_item_id, { permission_scope: scope });
      setItems(prev => prev.map(i => i.library_item_id === item.library_item_id ? res.item : i));
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const handleDelete = async (item: MediaLibraryItem) => {
    if (!confirm(`确定从素材库移除 "${item.title || item.file_name || item.library_item_id}" 吗？\n（文件本体不会被删除）`)) return;
    try {
      await deleteMediaItem(item.library_item_id);
      setItems(prev => prev.filter(i => i.library_item_id !== item.library_item_id));
      if (selectedId === item.library_item_id) setSelectedId(null);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };


  const handleCreateFolder = (parentFolderId: string | null) => {
    if (!projectId) return;
    setFolderEditorError('');
    setFolderEditor({ mode: 'create', value: '', parentFolderId });
  };

  const handleRenameFolder = (folder: MediaFolder) => {
    setFolderEditorError('');
    setFolderEditor({ mode: 'rename', value: folder.name, parentFolderId: folder.parent_folder_id || null, folder });
  };

  const submitFolderEditor = async () => {
    if (!folderEditor || !projectId || !folderEditor.value.trim()) return;
    const name = folderEditor.value.trim();
    if (folderEditor.mode === 'rename' && name === folderEditor.folder?.name) {
      setFolderEditor(null);
      return;
    }
    setFolderSaving(true);
    setError(null);
    setFolderEditorError('');
    try {
      if (folderEditor.mode === 'create') {
        await createMediaFolder({ project_id: projectId, name, parent_folder_id: folderEditor.parentFolderId });
        if (folderEditor.parentFolderId) {
          setExpandedFolders(prev => new Set(prev).add(folderEditor.parentFolderId as string));
        }
      } else if (folderEditor.folder) {
        await updateMediaFolder(folderEditor.folder.folder_id, { name });
      }
      await loadFolders();
      setFolderEditor(null);
    } catch (e: any) {
      const message = e?.message || String(e);
      setError(message);
      setFolderEditorError(message);
    } finally {
      setFolderSaving(false);
    }
  };

  const handleDeleteFolder = async (folder: MediaFolder) => {
    if (!confirm(`删除文件夹 "${folder.name}"？\n其子文件夹会一并删除；夹内素材不会删除，只会变为「未归类」。`)) return;
    try {
      await deleteMediaFolder(folder.folder_id);
      if (selectedFolderId === folder.folder_id) setSelectedFolderId(null);
      await loadFolders();
      await reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const moveItemToFolder = async (libraryItemId: string, folderId: string | null) => {
    try {
      await updateMediaItem(libraryItemId, { folder_id: folderId });

      if (selectedFolderId && selectedFolderId !== folderId &&
          !(selectedFolderId === '__unfiled__' && folderId === null)) {
        setItems(prev => prev.filter(i => i.library_item_id !== libraryItemId));
      } else {
        setItems(prev => prev.map(i => i.library_item_id === libraryItemId ? { ...i, folder_id: folderId } : i));
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setDragOverFolder(null);
    }
  };

  return (
    <div className="layout-safe workflow-stage-layout flex-col text-n800">

      <div className="responsive-toolbar workflow-stage-toolbar flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => navigate(projectId ? `/projects/${projectId}/episodes` : '/projects')}
          className="text-sm text-n300 hover:text-n800"
        >
          ← 返回项目{projectId ? '' : '列表'}
        </button>
        <div className="text-sm font-medium ml-2">素材库</div>
        <div className="text-xs text-n100">
          {episodeId && assetScopeMode === 'episode'
            ? '本集素材'
            : projectId
              ? `项目 ${projectId}`
              : '个人素材 · 跨项目查看'}
        </div>

        <div className="toolbar-actions ml-auto">
          {episodeId && (
            <div className="ui-tabs ui-tabs--compact" title="素材可见范围">
              <button
                type="button"
                onClick={() => setAssetScopeMode('episode')}
                className="ui-tab"
                aria-pressed={assetScopeMode === 'episode'}
              >
                <ImageIcon size={12} />
                本集素材
              </button>
              <button
                type="button"
                onClick={() => setAssetScopeMode('project')}
                className="ui-tab"
                aria-pressed={assetScopeMode === 'project'}
              >
                <Layers size={12} />
                全部素材
              </button>
            </div>
          )}

          <div className="flex items-center gap-1 px-2 py-1 rounded bg-n0">
            <Search size={14} className="text-n100" />
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="搜索素材..."
              className="bg-transparent outline-none text-sm w-44"
            />
          </div>

          <button
            onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
            className="p-2 rounded bg-n0 hover:bg-n20"
            title="切换视图"
          >
            {view === 'grid' ? <ListIcon size={14} /> : <GridIcon size={14} />}
          </button>

          <button
            onClick={reload}
            className="p-2 rounded bg-n0 hover:bg-n20"
            disabled={loading}
            title="刷新"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={handleBatchDownload}
            disabled={!checked.size}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-n0 hover:bg-n20 disabled:opacity-50 text-sm"
            title="批量下载"
          >
            <Download size={14} />
            <span>批量下载{checked.size ? ` (${checked.size})` : ''}</span>
          </button>


          <select
            value={uploadVisibility}
            onChange={e => setUploadVisibility(e.target.value as any)}
            disabled={!isOrgWorkspace}
            className="px-2 py-1.5 rounded bg-n0 text-xs border border-n40 disabled:opacity-50"
            title={isOrgWorkspace ? '新上传素材的可见性' : '切到组织 workspace 才能选「对组可见」'}
          >
            <option value="private">🔒 私有</option>
            <option value="org-default" disabled={!isOrgWorkspace}>
              🌐 {isOrgWorkspace ? `对组可见 (${currentName})` : '对组可见 — 需切组织'}
            </option>
          </select>


          {hasProjectContext && (
            <select
              value={uploadTargetFolderId}
              onChange={e => setUploadTargetFolderId(e.target.value)}
              className="px-2 py-1.5 rounded bg-n0 text-xs border border-n40 max-w-[150px]"
              title="上传到哪个文件夹"
            >
              <option value="">📂 未归类（不放入文件夹）</option>
              {folderOptions.map(o => (
                <option key={o.folder_id} value={o.folder_id}>
                  {`${'\u3000'.repeat(o.depth)}${o.name}`}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={handleUploadClick}
            disabled={uploading}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-success hover:bg-success text-white disabled:opacity-60 text-sm font-medium"
          >
            <Upload size={14} />
            <span>{uploading ? '上传中…' : '上传素材'}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={handleFileChosen}
          />
        </div>
      </div>

      <div className="responsive-split workflow-stage-layout">

        <aside className="responsive-pane workflow-stage-sidebar workflow-stage-scroll w-56 p-2 flex flex-col gap-1">
          {CATEGORIES.map(c => (
            <button
              key={c.key}
              onClick={() => { setCategory(c.key); setSelectedId(null); }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left ${
                category === c.key
                  ? 'bg-n30 text-n800'
                  : 'text-n300 hover:bg-n20 hover:text-n800'
              }`}
            >
              {c.icon}
              <span>{c.label}</span>
            </button>
          ))}


          {hasProjectContext && <div className="mt-3 pt-2 border-t border-n40">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[11px] font-semibold text-n100 uppercase tracking-wider">文件夹</span>
              <button
                onClick={() => handleCreateFolder(null)}
                className="p-1 rounded hover:bg-n20 text-n300 hover:text-success"
                title="新建文件夹"
              >
                <FolderPlus size={14} />
              </button>
            </div>


            <button
              onClick={() => { setSelectedFolderId(null); setSelectedId(null); }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left ${
                selectedFolderId === null ? 'bg-n30 text-n800' : 'text-n300 hover:bg-n20'
              }`}
            >
              <Folder size={14} />
              <span>全部文件夹</span>
            </button>
            <button
              onClick={() => { setSelectedFolderId('__unfiled__'); setSelectedId(null); }}
              onDragOver={e => { e.preventDefault(); setDragOverFolder('__unfiled__'); }}
              onDragLeave={() => setDragOverFolder(prev => prev === '__unfiled__' ? null : prev)}
              onDrop={e => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/library-item-id');
                if (id) moveItemToFolder(id, null);
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left ${
                dragOverFolder === '__unfiled__' ? 'ring-1 ring-success bg-success-light' :
                selectedFolderId === '__unfiled__' ? 'bg-n30 text-n800' : 'text-n300 hover:bg-n20'
              }`}
            >
              <Folder size={14} className="opacity-50" />
              <span>未归类</span>
            </button>

            {folderTree.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-n100">
                还没有文件夹，点击 <FolderPlus size={11} className="inline" /> 新建
              </div>
            ) : (
              <div className="mt-0.5">
                {folderTree.map(node => (
                  <FolderTreeNode
                    key={node.folder_id}
                    node={node}
                    depth={0}
                    selectedFolderId={selectedFolderId}
                    expanded={expandedFolders}
                    dragOverFolder={dragOverFolder}
                    onToggleExpand={fid => setExpandedFolders(prev => {
                      const next = new Set(prev);
                      next.has(fid) ? next.delete(fid) : next.add(fid);
                      return next;
                    })}
                    onSelect={fid => { setSelectedFolderId(fid); setSelectedId(null); }}
                    onCreateChild={fid => handleCreateFolder(fid)}
                    onRename={handleRenameFolder}
                    onDelete={handleDeleteFolder}
                    onDragOverFolder={setDragOverFolder}
                    onDropItem={(itemId, fid) => moveItemToFolder(itemId, fid)}
                  />
                ))}
              </div>
            )}
          </div>}

          <div className="mt-auto pt-3 border-t border-n40 text-xs text-n100 px-2">
            共 {total} 个素材
          </div>
        </aside>


        <main className="responsive-pane workflow-stage-canvas workflow-stage-scroll p-4">
          {error && (
            <div className="mb-3 p-2 text-xs text-danger bg-r50 border border-r75 rounded">
              {error}
            </div>
          )}

          {loading && !items.length && (
            <div className="text-center text-sm text-n100 py-12">加载中…</div>
          )}

          {!loading && !items.length && (
            <div className="text-center text-sm text-n100 py-16">
              <ImageIcon size={32} className="mx-auto mb-3 text-n100" />
              <div>暂无素材</div>
              <div className="text-xs mt-1">点击右上角"上传素材"开始</div>
            </div>
          )}

          {view === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              {items.map(item => (
                <MediaCard
                  key={item.library_item_id}
                  item={item}
                  selected={selectedId === item.library_item_id}
                  checked={checked.has(item.library_item_id)}
                  onSelect={() => setSelectedId(item.library_item_id)}
                  onToggleCheck={() => toggleCheck(item.library_item_id)}
                  onToggleFavorite={() => handleToggleFavorite(item)}
                  myUserId={myUserId}
                />
              ))}
            </div>
          ) : (
            <MediaList
              items={items}
              selectedId={selectedId}
              checked={checked}
              onSelect={id => setSelectedId(id)}
              onToggleCheck={toggleCheck}
              onToggleFavorite={handleToggleFavorite}
              myUserId={myUserId}
            />
          )}
        </main>


        {selected && (
          <aside className="responsive-pane media-detail-pane workflow-stage-sidebar workflow-stage-scroll border-l border-r-0">
            <MediaDetailPanel
              item={selected}
              onClose={() => setSelectedId(null)}
              onChangeScope={scope => handleChangeScope(selected, scope)}
              onToggleFavorite={() => handleToggleFavorite(selected)}
              onDelete={() => handleDelete(selected)}
              onShare={() => setShareTarget(selected)}
              folderOptions={folderOptions}
              onMoveToFolder={fid => moveItemToFolder(selected.library_item_id, fid)}
              myUserId={myUserId}
            />
          </aside>
        )}
      </div>

      {shareTarget && (
        <ShareResourceDialog
          resourceType="media"
          resourceId={shareTarget.library_item_id}
          resourceName={shareTarget.title || shareTarget.file_name}
          onClose={() => setShareTarget(null)}
          onChange={() => reload()}
        />
      )}
      {folderEditor && (
        <div className="app-modal-backdrop fixed inset-0 z-[120] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="关闭文件夹编辑"
            className="absolute inset-0 bg-n900/50"
            onClick={() => !folderSaving && setFolderEditor(null)}
          />
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-folder-editor-title"
            className="app-modal-surface relative z-10 w-full max-w-md rounded-xl border border-n40 bg-n0 p-5 shadow-xl"
            onSubmit={event => { event.preventDefault(); void submitFolderEditor(); }}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-success-light text-success">
                {folderEditor.mode === 'create' ? <FolderPlus size={18} /> : <Pencil size={18} />}
              </div>
              <div>
                <h2 id="media-folder-editor-title" className="text-base font-semibold text-n800">
                  {folderEditor.mode === 'create'
                    ? folderEditor.parentFolderId ? '新建子文件夹' : '新建文件夹'
                    : '重命名文件夹'}
                </h2>
                <p className="mt-1 text-xs text-n100">文件夹用于整理素材，不会移动或删除文件本体。</p>
              </div>
              <button
                type="button"
                onClick={() => setFolderEditor(null)}
                disabled={folderSaving}
                className="ml-auto rounded p-1 text-n100 hover:bg-n20 hover:text-n700 disabled:opacity-50"
                aria-label="关闭"
              >
                <XIcon size={18} />
              </button>
            </div>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-xs font-medium text-n500">文件夹名称</span>
              <input
                autoFocus
                value={folderEditor.value}
                onChange={event => setFolderEditor(current => current ? { ...current, value: event.target.value } : current)}
                placeholder={folderEditor.parentFolderId ? '例如：主角 / 反派' : '例如：人物 / 场景 / 道具'}
                maxLength={80}
                className="h-10 w-full rounded-lg border border-n40 bg-n0 px-3 text-sm text-n800 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </label>
            {folderEditorError && (
              <p role="alert" className="mt-3 rounded-lg border border-danger/20 bg-danger-light px-3 py-2 text-xs text-danger">
                文件夹保存失败：{folderEditorError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFolderEditor(null)}
                disabled={folderSaving}
                className="h-9 rounded-lg border border-n40 px-4 text-sm text-n500 hover:bg-n20 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={folderSaving || !folderEditor.value.trim()}
                className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {folderSaving ? '保存中…' : folderEditor.mode === 'create' ? '创建文件夹' : '保存名称'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};




interface FolderTreeNodeProps {
  node: FolderNode;
  depth: number;
  selectedFolderId: string | null;
  expanded: Set<string>;
  dragOverFolder: string | null;
  onToggleExpand: (folderId: string) => void;
  onSelect: (folderId: string) => void;
  onCreateChild: (folderId: string) => void;
  onRename: (folder: MediaFolder) => void;
  onDelete: (folder: MediaFolder) => void;
  onDragOverFolder: (folderId: string | null) => void;
  onDropItem: (itemId: string, folderId: string) => void;
}

const FolderTreeNode: React.FC<FolderTreeNodeProps> = ({
  node, depth, selectedFolderId, expanded, dragOverFolder,
  onToggleExpand, onSelect, onCreateChild, onRename, onDelete,
  onDragOverFolder, onDropItem,
}) => {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.folder_id);
  const isSelected = selectedFolderId === node.folder_id;
  const isDragOver = dragOverFolder === node.folder_id;

  return (
    <div>
      <div
        onClick={() => onSelect(node.folder_id)}
        onDragOver={e => { e.preventDefault(); onDragOverFolder(node.folder_id); }}
        onDragLeave={() => onDragOverFolder(null)}
        onDrop={e => {
          e.preventDefault();
          const id = e.dataTransfer.getData('text/library-item-id');
          if (id) onDropItem(id, node.folder_id);
        }}
        style={{ paddingLeft: 8 + depth * 14 }}
        className={`group/folder flex items-center gap-1 pr-1 py-1.5 rounded text-sm cursor-pointer ${
          isDragOver ? 'ring-1 ring-success bg-success-light' :
          isSelected ? 'bg-n30 text-n800' : 'text-n300 hover:bg-n20'
        }`}
      >
        <button
          onClick={e => { e.stopPropagation(); if (hasChildren) onToggleExpand(node.folder_id); }}
          className={`shrink-0 ${hasChildren ? 'text-n300' : 'text-transparent pointer-events-none'}`}
        >
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {isOpen && hasChildren ? <FolderOpen size={14} className="shrink-0" /> : <Folder size={14} className="shrink-0" />}
        <span className="truncate flex-1" title={node.name}>{node.name}</span>

        <div className="hidden group-hover/folder:flex items-center gap-0.5 shrink-0">
          <button onClick={e => { e.stopPropagation(); onCreateChild(node.folder_id); }} className="p-0.5 hover:text-success" title="新建子文件夹">
            <FolderPlus size={12} />
          </button>
          <button onClick={e => { e.stopPropagation(); onRename(node); }} className="p-0.5 hover:text-primary" title="重命名">
            <Pencil size={12} />
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete(node); }} className="p-0.5 hover:text-danger" title="删除文件夹">
            <XIcon size={12} />
          </button>
        </div>
      </div>

      {isOpen && hasChildren && (
        <div>
          {node.children.map(child => (
            <FolderTreeNode
              key={child.folder_id}
              node={child}
              depth={depth + 1}
              selectedFolderId={selectedFolderId}
              expanded={expanded}
              dragOverFolder={dragOverFolder}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
              onDragOverFolder={onDragOverFolder}
              onDropItem={onDropItem}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface MediaCardProps {
  item: MediaLibraryItem;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggleCheck: () => void;
  onToggleFavorite: () => void;
  myUserId: string;
}

const MediaCard: React.FC<MediaCardProps> = ({
  item, selected, checked, onSelect, onToggleCheck, onToggleFavorite, myUserId,
}) => {
  const isMine = item.user_id === myUserId;
  const sourceThumb = item.thumbnail_url || (item.item_type === 'image' ? item.file_url : null);
  const thumb = sourceThumb
    ? secureApiUrl(sourceThumb, { absolute: true })
    : item.item_type === 'video' && item.file_url
      ? secureApiUrl(
          `/api/thumbnail?url=${encodeURIComponent(item.file_url)}&width=640&height=360`,
          { absolute: true },
        )
      : null;

  return (
    <div
      onClick={onSelect}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/library-item-id', item.library_item_id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`relative group rounded overflow-hidden border bg-n0 cursor-pointer shadow-card hover:shadow-atlas ${
        selected ? 'border-primary' : 'border-n40 hover:border-n40'
      }`}
    >
      <div className="aspect-square bg-n20 flex items-center justify-center overflow-hidden">
        {item.item_type === 'video' ? (
          <FilmstripThumbnail src={thumb} alt="视频缩略图" />
        ) : thumb ? (
          <img src={thumb} alt={item.title || item.file_name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : item.item_type === 'audio' ? (
          <Music size={32} className="text-n100" />
        ) : (
          <FileText size={32} className="text-n100" />
        )}
      </div>

      <div className="px-2 py-1.5">
        <div className="text-xs text-n700 truncate flex items-center gap-1" title={item.title || item.file_name}>
          <span className="truncate">{item.title || item.file_name || item.library_item_id}</span>
          {/* 2026-05-26 Slice 5: visibility badge */}
          {item.visibility && item.visibility !== 'private' && (
            <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-b50 text-b400 border border-b75">
              🌐
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-n100">
          <span>{SCOPE_LABEL[item.permission_scope] || item.permission_scope}</span>
          <span>·</span>
          <span>{item.item_type}</span>
          {item.use_count > 0 && (
            <>
              <span>·</span>
              <span>{item.use_count} 次引用</span>
            </>
          )}
        </div>
      </div>

      <div
        className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100"
        onClick={e => { e.stopPropagation(); onToggleCheck(); }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => {}}
          className="w-4 h-4 accent-success"
        />
      </div>

      <button
        onClick={e => { e.stopPropagation(); onToggleFavorite(); }}
        className="absolute top-1.5 right-1.5 p-1 rounded bg-n900/50 opacity-0 group-hover:opacity-100 hover:bg-n900/50"
        title={item.is_favorite ? '取消收藏' : '收藏'}
      >
        {item.is_favorite
          ? <Star size={12} className="text-warning" fill="currentColor" />
          : <StarOff size={12} className="text-n700" />}
      </button>

      {!isMine && (
        <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 text-[10px] bg-b50 text-b400 rounded">
          共享
        </div>
      )}
    </div>
  );
};


const MediaList: React.FC<{
  items: MediaLibraryItem[];
  selectedId: string | null;
  checked: Set<string>;
  onSelect: (id: string) => void;
  onToggleCheck: (id: string) => void;
  onToggleFavorite: (item: MediaLibraryItem) => void;
  myUserId: string;
}> = ({ items, selectedId, checked, onSelect, onToggleCheck, onToggleFavorite, myUserId }) => (
  <table className="w-full text-sm">
    <thead className="text-xs text-n100">
      <tr className="border-b border-n40">
        <th className="w-8"></th>
        <th className="text-left py-2 pr-2">名称</th>
        <th className="text-left py-2 pr-2">类型</th>
        <th className="text-left py-2 pr-2">来源</th>
        <th className="text-left py-2 pr-2">大小</th>
        <th className="text-left py-2 pr-2">权限</th>
        <th className="text-left py-2 pr-2">引用</th>
        <th className="w-8"></th>
      </tr>
    </thead>
    <tbody>
      {items.map(item => {
        const isMine = item.user_id === myUserId;
        return (
          <tr
            key={item.library_item_id}
            onClick={() => onSelect(item.library_item_id)}
            draggable
            onDragStart={e => {
              e.dataTransfer.setData('text/library-item-id', item.library_item_id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            className={`border-b border-n40 cursor-pointer ${
              selectedId === item.library_item_id ? 'bg-n30' : 'hover:bg-n20'
            }`}
          >
            <td onClick={e => { e.stopPropagation(); onToggleCheck(item.library_item_id); }} className="py-2 pl-1">
              <input type="checkbox" checked={checked.has(item.library_item_id)} onChange={() => {}} className="w-3 h-3 accent-success" />
            </td>
            <td className="py-2 pr-2 text-n700 truncate max-w-[260px]">
              {item.title || item.file_name}
              {item.visibility && item.visibility !== 'private' && (
                <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-b50 text-b400 border border-b75">🌐</span>
              )}
            </td>
            <td className="py-2 pr-2 text-n300">{item.item_type}</td>
            <td className="py-2 pr-2 text-n300">{item.source}</td>
            <td className="py-2 pr-2 text-n300">{formatBytes(item.file_size_bytes)}</td>
            <td className="py-2 pr-2 text-n300">{SCOPE_LABEL[item.permission_scope] || item.permission_scope}{!isMine && ' (他人)'}</td>
            <td className="py-2 pr-2 text-n300">{item.use_count}</td>
            <td className="py-2 pr-1">
              <button onClick={e => { e.stopPropagation(); onToggleFavorite(item); }}>
                {item.is_favorite
                  ? <Star size={12} className="text-warning" fill="currentColor" />
                  : <StarOff size={12} className="text-n100" />}
              </button>
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
);


const MediaDetailPanel: React.FC<{
  item: MediaLibraryItem;
  onClose: () => void;
  onChangeScope: (scope: PermissionScope) => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onShare?: () => void;
  folderOptions?: { folder_id: string; name: string; depth: number }[];
  onMoveToFolder?: (folderId: string | null) => void;
  myUserId: string;
}> = ({ item, onClose, onChangeScope, onToggleFavorite, onDelete, onShare, folderOptions = [], onMoveToFolder, myUserId }) => {
  const isMine = item.user_id === myUserId;
  const isImage = item.item_type === 'image' || item.file_type === 'image';
  const isVideo = item.item_type === 'video' || item.file_type === 'video';
  const isAudio = item.item_type === 'audio' || item.file_type === 'audio';

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium truncate">{item.title || item.file_name}</div>
        <button onClick={onClose} className="text-n100 hover:text-n700 text-sm">×</button>
      </div>

      <div className="rounded overflow-hidden bg-n20 border border-n40">
        {isImage && item.file_url && (
          <img src={item.file_url} alt={item.title || ''} loading="lazy" decoding="async" className="w-full max-h-72 object-contain" />
        )}
        {isVideo && item.file_url && (
          <LazyVideo
            src={item.file_url}
            controls
            muted={false}
            firstFrame={false}
            hoverPreview={false}
            className="w-full max-h-72"
          />
        )}
        {isAudio && item.file_url && (
          <audio src={item.file_url} controls className="w-full p-3" />
        )}
        {!isImage && !isVideo && !isAudio && (
          <div className="p-6 text-center text-xs text-n100">
            <FileText size={24} className="mx-auto mb-2 text-n100" />
            无可用预览
          </div>
        )}
      </div>

      <dl className="text-xs space-y-1.5 text-n300">
        <Detail k="素材 ID" v={item.library_item_id} mono />
        <Detail k="文件 ID" v={item.file_id} mono />
        <Detail k="类型" v={item.item_type} />
        <Detail k="来源" v={item.source} />
        <Detail k="大小" v={formatBytes(item.file_size_bytes)} />
        {item.width && item.height && <Detail k="分辨率" v={`${item.width} × ${item.height}`} />}
        {item.duration_seconds && <Detail k="时长" v={`${item.duration_seconds.toFixed(1)} 秒`} />}
        <Detail k="上传者" v={item.user_id} mono />
        <Detail k="引用次数" v={String(item.use_count)} />
        <Detail k="权限" v={SCOPE_LABEL[item.permission_scope] || item.permission_scope} />
        <Detail k="创建" v={new Date(item.created_at).toLocaleString('zh-CN')} />
      </dl>

      {item.file_url && (
        <div className="pt-2 border-t border-n40">
          <div className="text-xs text-n100 mb-1">引用代码</div>
          <code className="block text-[10px] bg-n20 p-2 rounded border border-n40 break-all">
            asset_id="{item.library_item_id}"
          </code>
        </div>
      )}

      <div className="pt-2 border-t border-n40 space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleFavorite}
            className="flex-1 px-2 py-1.5 text-xs rounded bg-n0 hover:bg-n20"
          >
            {item.is_favorite ? '取消收藏' : '加入收藏'}
          </button>
          {isMine && onShare && (
            <button
              onClick={onShare}
              className="px-2 py-1.5 text-xs rounded bg-primary-light hover:bg-primary-light text-primary"
              title="共享给组织或项目"
            >
              共享
            </button>
          )}
          {isMine && (
            <button
              onClick={onDelete}
              className="px-2 py-1.5 text-xs rounded bg-r50 hover:bg-r50 text-danger"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>

        {isMine && (
          <div>
            <div className="text-xs text-n100 mb-1">权限范围</div>
            <select
              value={item.permission_scope}
              onChange={e => onChangeScope(e.target.value as PermissionScope)}
              className="w-full text-xs px-2 py-1.5 bg-n0 border border-n40 rounded"
            >
              <option value="private">私有</option>
              <option value="project">项目共享</option>
            </select>
          </div>
        )}

        {onMoveToFolder && (
          <div>
            <div className="text-xs text-n100 mb-1">所在文件夹</div>
            <select
              value={item.folder_id || ''}
              onChange={e => onMoveToFolder(e.target.value || null)}
              className="w-full text-xs px-2 py-1.5 bg-n0 border border-n40 rounded"
            >
              <option value="">未归类</option>
              {folderOptions.map(o => (
                <option key={o.folder_id} value={o.folder_id}>
                  {`${'\u3000'.repeat(o.depth)}${o.name}`}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
};


const Detail: React.FC<{ k: string; v: string; mono?: boolean }> = ({ k, v, mono }) => (
  <div className="flex items-start">
    <dt className="w-20 shrink-0 text-n100">{k}</dt>
    <dd className={`flex-1 break-all ${mono ? 'font-mono text-[10px]' : ''}`}>{v}</dd>
  </div>
);

export default MediaLibraryPage;
