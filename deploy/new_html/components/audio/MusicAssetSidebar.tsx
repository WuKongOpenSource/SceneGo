import React, { useMemo, useState } from 'react';
import { Download, Library, Music2, Sparkles } from 'lucide-react';
import type { AudioTrack } from '../../types';
import { safeBrowserResourceUrl } from '../../services/httpClient';

function resolveUrl(path: string | null): string {
  if (!path) return '';
  const normalized = path.startsWith('/') || /^(?:https?:|blob:|data:)/i.test(path) ? path : `/${path}`;
  return safeBrowserResourceUrl(normalized);
}

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) return '--';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function sourceLabel(track: AudioTrack): string {
  const source = String(track.generationParams?.source || '');
  if (source === 'local_minimax_music3' || source === 'minimax_sfx') return 'AI 生成';
  if (source === 'local_upload') return '本地上传';
  if (source === 'dubbing_reference') return '引用配音';
  return '已有音乐';
}

function modeLabel(track: AudioTrack): string {
  if (track.trackType === 'sfx_global') return '音效';
  return track.generationParams?.mode === 'theme' ? '主题曲' : 'BGM';
}

export interface MusicAssetSidebarProps {
  audioTracks: AudioTrack[];
}

export const MusicAssetSidebar: React.FC<MusicAssetSidebarProps> = ({ audioTracks }) => {
  const [category, setCategory] = useState<'music' | 'sfx'>('music');
  const counts = useMemo(() => ({
    music: audioTracks.filter(track => track.trackType === 'bgm' && track.audioUrl).length,
    sfx: audioTracks.filter(track => track.trackType === 'sfx_global' && track.audioUrl).length,
  }), [audioTracks]);
  const audioAssets = useMemo(
    () => audioTracks
      .filter(track => track.audioUrl && (category === 'music' ? track.trackType === 'bgm' : track.trackType === 'sfx_global'))
      .slice()
      .reverse(),
    [audioTracks, category],
  );

  return (
    <aside
      aria-label="音频资产"
      className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border border-n40 bg-n0 shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-n40 px-4 py-3">
        <div className="flex items-center gap-2">
          <Library size={16} className="text-success" />
          <h2 className="text-sm font-bold text-n800">音频资产</h2>
        </div>
        <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
          {counts.music + counts.sfx}
        </span>
      </div>

      <div role="tablist" aria-label="音频资产分类" className="grid grid-cols-2 gap-1 border-b border-n40 bg-n20 p-2">
        <button
          type="button"
          role="tab"
          aria-selected={category === 'music'}
          onClick={() => setCategory('music')}
          className={`rounded-md px-2 py-1.5 text-xs font-semibold ${category === 'music' ? 'bg-success text-white' : 'text-n500 hover:bg-n0'}`}
        >
          音乐 {counts.music}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={category === 'sfx'}
          onClick={() => setCategory('sfx')}
          className={`rounded-md px-2 py-1.5 text-xs font-semibold ${category === 'sfx' ? 'bg-primary text-white' : 'text-n500 hover:bg-n0'}`}
        >
          音效 {counts.sfx}
        </button>
      </div>

      <div className="border-b border-n40 bg-n20 px-4 py-2 text-xs leading-5 text-n100">
        当前分集已生成、已上传和已引用的{category === 'music' ? '音乐' : '音效'}，最新内容排在最前。
      </div>

      {audioAssets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="mb-3 rounded-full bg-success/10 p-3 text-success">
            {category === 'music' ? <Music2 size={22} /> : <Sparkles size={22} />}
          </span>
          <p className="text-sm font-semibold text-n700">暂无{category === 'music' ? '音乐' : '音效'}资产</p>
          <p className="mt-1 text-xs leading-5 text-n100">
            {category === 'music' ? '在右侧生成或上传音乐后，会自动出现在这里。' : '在时间轴生成、上传或引用音效后，会自动出现在这里。'}
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {audioAssets.map(track => {
            const audioUrl = resolveUrl(track.audioUrl);
            return (
              <article key={track.trackId} className="rounded-lg border border-n40 bg-n20 p-3">
                <div className="mb-2 flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-n800" title={track.name || '未命名音乐'}>
                      {track.name || '未命名音乐'}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="rounded bg-success/10 px-1.5 py-0.5 text-success">{sourceLabel(track)}</span>
                      <span className="rounded bg-n40 px-1.5 py-0.5 text-n500">{modeLabel(track)}</span>
                      <span className="tabular-nums text-n100">{formatDuration(track.durationMs)}</span>
                    </div>
                  </div>
                  <a
                    href={audioUrl}
                    download
                    aria-label={`下载 ${track.name || '音乐'}`}
                    title="下载音乐"
                    className="shrink-0 rounded-md border border-n40 bg-n0 p-1.5 text-n500 hover:border-success hover:text-success"
                  >
                    <Download size={14} />
                  </a>
                </div>
                <audio controls preload="none" src={audioUrl} className="h-9 w-full" />
              </article>
            );
          })}
        </div>
      )}
    </aside>
  );
};
