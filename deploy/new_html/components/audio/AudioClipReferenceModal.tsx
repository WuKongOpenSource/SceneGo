import React, { useMemo, useState } from 'react';
import { Link2, Loader, Mic, X } from 'lucide-react';
import type { AudioClipInfo } from '../../types';
import { createAudioTrack } from '@runtime/audioGenerationService';

export interface AudioClipReferenceModalProps {
  episodeId: string;
  targetTrackType: 'bgm' | 'sfx_global';
  clips: AudioClipInfo[];
  localAudio: Record<string, { url: string; durationMs?: number }>;
  clipKeyFn: (clip: AudioClipInfo) => string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

export const AudioClipReferenceModal: React.FC<AudioClipReferenceModalProps> = ({
  episodeId,
  targetTrackType,
  clips,
  localAudio,
  clipKeyFn,
  onClose,
  onCreated,
}) => {
  const [selectedClipId, setSelectedClipId] = useState('');
  const [saving, setSaving] = useState(false);
  const candidates = useMemo(() => clips.flatMap(clip => {
    const local = localAudio[clipKeyFn(clip)];
    const url = local?.url || clip.audioUrl || '';
    if (!url) return [];
    return [{
      clip,
      url,
      durationMs: local?.durationMs || clip.durationMs || 0,
    }];
  }), [clipKeyFn, clips, localAudio]);

  const handleReference = async () => {
    const selected = candidates.find(candidate => candidate.clip.clipId === selectedClipId);
    if (!selected) return;
    setSaving(true);
    try {
      const targetLabel = targetTrackType === 'bgm' ? 'BGM' : '音效';
      await createAudioTrack(episodeId, {
        track_type: targetTrackType,
        name: `引用配音 · ${selected.clip.characterName || '旁白'} · ${targetLabel}`,
        audio_url: selected.url,
        duration_ms: selected.durationMs,
        start_item_id: selected.clip.itemId,
        generation_params: {
          source: 'dubbing_reference',
          source_clip_id: selected.clip.clipId,
          source_storyboard_item_id: selected.clip.itemId,
          source_character_name: selected.clip.characterName || null,
        },
      });
      await onCreated();
      onClose();
    } catch (error) {
      console.error('引用配音失败:', error);
      alert(`引用配音失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-n900/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="引用已生成配音"
        className="app-modal-surface relative w-[620px] max-w-[calc(100vw-32px)] rounded-2xl border border-n40 bg-n0 p-6 shadow-xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-n800">
              <Link2 size={16} className="text-primary" /> 引用已生成配音
            </h3>
            <p className="mt-1 text-xs text-n100">
              复用本集已经生成的配音音频，作为{targetTrackType === 'bgm' ? ' BGM' : '音效'}片段，不会重新生成或重复上传。
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-n100 hover:text-n700">
            <X size={18} />
          </button>
        </div>

        {candidates.length > 0 ? (
          <div className="max-h-[48vh] space-y-2 overflow-auto pr-1">
            {candidates.map(({ clip, url, durationMs }) => {
              const selected = selectedClipId === clip.clipId;
              return (
                <label
                  key={clip.clipId}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    selected ? 'border-primary bg-primary/5' : 'border-n40 hover:bg-n30'
                  }`}
                >
                  <input
                    type="radio"
                    name="dubbing-reference"
                    checked={selected}
                    onChange={() => setSelectedClipId(clip.clipId)}
                  />
                  <Mic size={15} className="shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-n700">
                      <span>{clip.characterName || '旁白'}</span>
                      <span className="text-xs font-normal text-n100">镜头 {clip.sortOrder}</span>
                      <span className="text-xs font-normal text-n100">{durationMs > 0 ? `${(durationMs / 1000).toFixed(1)}s` : '--'}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-n100">{clip.text || '已生成配音'}</p>
                  </div>
                  <audio controls preload="none" src={url} className="h-8 w-44 shrink-0" />
                </label>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-n40 bg-n20 px-4 py-8 text-center text-sm text-n100">
            当前剧集还没有可引用的已生成配音，请先在“配音制作”中生成。
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2 border-t border-n40 pt-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-n40 px-4 py-2 text-sm text-n700">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleReference()}
            disabled={!selectedClipId || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader size={14} className="animate-spin" /> : <Link2 size={14} />}
            引用到{targetTrackType === 'bgm' ? ' BGM' : '音效'}
          </button>
        </div>
      </div>
    </div>
  );
};
