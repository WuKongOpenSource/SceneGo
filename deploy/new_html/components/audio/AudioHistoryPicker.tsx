import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Library, Loader, Plus, RefreshCw } from 'lucide-react';
import { createAudioTrack } from '@runtime/audioGenerationService';
import {
  listMediaItems,
  useMediaItem,
  type MediaLibraryItem,
} from '../../services/mediaLibraryService';
import { safeBrowserResourceUrl } from '../../services/httpClient';

function resolveAudioUrl(path: string): string {
  if (!path) return '';
  const normalized = path.startsWith('/') || /^(?:https?:|blob:|data:)/i.test(path) ? path : `/${path}`;
  return safeBrowserResourceUrl(normalized);
}

export interface AudioHistoryPickerProps {
  episodeId: string;
  projectId?: string;
  kind: 'bgm' | 'sfx';
  onCreated: () => Promise<void>;
}

export const AudioHistoryPicker: React.FC<AudioHistoryPickerProps> = ({
  episodeId,
  projectId,
  kind,
  onCreated,
}) => {
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addingId, setAddingId] = useState('');
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await listMediaItems({
        project_id: projectId,
        include_shared: true,
        item_type: 'audio',
        limit: 50,
      });
      setItems(response.items || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const visibleItems = useMemo(() => items.filter(item => {
    const labels = [item.source, item.title, item.description, ...(item.tags || [])]
      .map(value => String(value || '').toLowerCase());
    if (kind === 'bgm') return labels.some(value => value.includes('bgm') || value.includes('music') || value.includes('音乐'));
    return labels.some(value => value.includes('sfx') || value.includes('sound_effect') || value.includes('音效'));
  }), [items, kind]);

  const addItem = async (item: MediaLibraryItem) => {
    if (!item.file_url || addingId) return;
    setAddingId(item.library_item_id);
    setError('');
    try {
      await createAudioTrack(episodeId, {
        track_type: kind === 'bgm' ? 'bgm' : 'sfx_global',
        name: item.title || item.file_name || (kind === 'bgm' ? '历史音乐' : '历史音效'),
        audio_url: item.file_url,
        duration_ms: Math.max(0, Math.round(Number(item.duration_seconds || 0) * 1000)),
        generation_params: {
          source: 'media_library',
          library_item_id: item.library_item_id,
          file_id: item.file_id,
        },
      });
      await useMediaItem(item.library_item_id, {
        usage_context: kind === 'bgm' ? 'episode_bgm_track' : 'episode_sfx_track',
        project_id: projectId,
        target_entity_type: 'episode',
        target_entity_id: episodeId,
      }).catch(() => undefined);
      setAddedIds(current => new Set(current).add(item.library_item_id));
      await onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAddingId('');
    }
  };

  return (
    <div className="mb-4 rounded-md border border-n40 bg-n30 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-sm font-bold text-n700">
          <Library size={14} className="text-primary" /> 历史{kind === 'bgm' ? '音乐' : '音效'}
        </h4>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 text-xs text-primary disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>
      {loading ? (
        <div className="flex h-16 items-center justify-center gap-2 text-xs text-n100"><Loader size={14} className="animate-spin" />正在读取历史素材…</div>
      ) : visibleItems.length === 0 ? (
        <p className="rounded-lg border border-dashed border-n40 bg-n0 px-3 py-4 text-center text-xs text-n100">历史库里还没有可用的{kind === 'bgm' ? '音乐' : '音效'}</p>
      ) : (
        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {visibleItems.map(item => {
            const added = addedIds.has(item.library_item_id);
            const adding = addingId === item.library_item_id;
            return (
              <div key={item.library_item_id} className="rounded-lg border border-n40 bg-n0 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-n700">{item.title || item.file_name || '未命名音频'}</p>
                    <p className="mt-0.5 text-[10px] text-n100">{item.duration_seconds ? `${Number(item.duration_seconds).toFixed(1)} 秒` : '时长未知'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void addItem(item)}
                    disabled={!item.file_url || Boolean(addingId) || added}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/30 px-2.5 py-1.5 text-xs text-primary disabled:opacity-50"
                  >
                    {adding ? <Loader size={12} className="animate-spin" /> : added ? <Check size={12} /> : <Plus size={12} />}
                    {adding ? '添加中' : added ? '已添加' : '添加到当前分集'}
                  </button>
                </div>
                {item.file_url && <audio controls preload="none" src={resolveAudioUrl(item.file_url)} className="h-8 w-full" />}
              </div>
            );
          })}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">读取或添加失败：{error}</p>}
    </div>
  );
};
