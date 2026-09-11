import React, { useCallback, useRef, useState } from 'react';
import {
  Play, Pause, Mic, RefreshCw, Loader, ChevronDown,
} from 'lucide-react';
import type { AudioClipInfo, CharacterVoice, ClipOverride, AssetItem } from '../../types';
import { InlineCreditEstimate } from '../InlineCreditEstimate';
import { safeBrowserResourceUrl } from '../../services/httpClient';

const EMOTIONS = [
  { value: '', label: '默认(继承)' },
  { value: 'neutral', label: '中性' },
  { value: 'happy', label: '快乐' },
  { value: 'sad', label: '悲伤' },
  { value: 'angry', label: '愤怒' },
  { value: 'fearful', label: '恐惧' },
  { value: 'surprised', label: '惊讶' },
  { value: 'excited', label: '兴奋' },
];

function resolveUrl(path: string) {
  if (!path) return '';
  const normalized = path.startsWith('/') || /^(?:https?:|blob:|data:)/i.test(path) ? path : `/${path}`;
  return safeBrowserResourceUrl(normalized);
}

function fmtSec(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

export function getAssetThumb(asset: AssetItem | undefined): string {
  if (!asset) return '';
  const ef = (asset.entityFiles || []).find(f => f.fileRole === 'reference_image');
  if (ef) return resolveUrl(ef.fileUrl);
  const t = (asset as any).thumbnailUrl || (asset as any).thumbnail_url || '';
  if (t) return resolveUrl(t);
  const refs = (asset as any).referenceImages || (asset as any).reference_images || [];
  if (Array.isArray(refs) && refs.length > 0) {
    const first = typeof refs[0] === 'string' ? refs[0] : refs[0]?.url || '';
    return resolveUrl(first);
  }
  return '';
}

export interface DubbingCardProps {
  clip: AudioClipInfo;
  clipKey: string;
  voice: CharacterVoice | undefined;
  charAsset: AssetItem | undefined;
  override: ClipOverride;
  onOverrideChange: (key: string, patch: Partial<ClipOverride>) => void;
  audioUrl: string;
  audioDurationMs: number | null;
  isGenerating: boolean;
  error: string | null;
  isPlaying: boolean;
  onGenerate: () => void;
  onTogglePlay: () => void;
  plannedDurationMs: number | null;
  allCharNames: string[];
  onClipPersist?: (
    clip: AudioClipInfo,
    patch: { speaker?: string; text?: string },
  ) => void;
}

export const DubbingCard: React.FC<DubbingCardProps> = ({
  clip, clipKey, voice, charAsset, override, onOverrideChange,
  audioUrl, audioDurationMs, isGenerating, error, isPlaying,
  onGenerate, onTogglePlay, plannedDurationMs, allCharNames,
  onClipPersist,
}) => {
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const displayText = override.text ?? clip.text;
  const displaySpeaker = override.speaker ?? clip.characterName;
  const thumb = getAssetThumb(charAsset);

  const actualMs = audioDurationMs;
  const overDuration = plannedDurationMs && actualMs && actualMs > plannedDurationMs;

  const effectiveSpeed = override.speed ?? (voice?.voiceParams as any)?.speed ?? 1.0;

  const handleTextBlur = useCallback(() => {
    setEditing(false);
    const trimmed = editRef.current?.value.trim() ?? '';
    if (trimmed !== clip.text) {
      onOverrideChange(clipKey, { text: trimmed });
      onClipPersist?.(clip, { text: trimmed });
    }
  }, [clip, clip.text, clipKey, onOverrideChange, onClipPersist]);

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg bg-n30 border border-n40 shadow-card">
      {/* Row 1: speaker + text + play/generate */}
      <div className="flex items-center gap-3">
        {thumb ? (
          <img src={thumb} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-n40"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).style.removeProperty('display'); }}
          />
        ) : null}
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0 text-white text-xs font-bold" style={thumb ? { display: 'none' } : undefined}>
          {displaySpeaker.charAt(0)}
        </div>

        <div className="relative shrink-0">
          <select
            value={displaySpeaker}
            onChange={e => {
              const speaker = e.target.value;
              onOverrideChange(clipKey, {
                speaker,
                emotion: undefined,
                speed: undefined,
                pitch: undefined,
              });
              onClipPersist?.(clip, { speaker });
            }}
            className="appearance-none bg-transparent text-xs font-semibold text-primary pr-4 cursor-pointer focus:outline-none"
          >
            {allCharNames.map(n => <option key={n} value={n}>{n}</option>)}
            {!allCharNames.includes('旁白') && <option value="旁白">旁白</option>}
          </select>
          <ChevronDown size={10} className="absolute right-0 top-1/2 -translate-y-1/2 text-primary pointer-events-none" />
        </div>

        <div className="flex-1 min-w-0">
          {editing ? (
            <textarea
              ref={editRef}
              defaultValue={displayText}
              onBlur={handleTextBlur}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTextBlur(); } }}
              autoFocus
              rows={2}
              className="w-full bg-n0 border border-primary rounded px-2 py-1 text-sm text-n700 resize-none focus:outline-none"
            />
          ) : (
            <p
              className="text-sm text-n700 truncate cursor-text hover:text-n800 hover:bg-n30 rounded px-1 -mx-1 transition-colors group/edit"
              onClick={() => setEditing(true)}
              title="点击编辑台词"
            >
              {displayText}
              <span className="invisible group-hover/edit:visible text-n100 ml-1 text-[10px]">✎</span>
            </p>
          )}
          {error && <p className="text-xs text-danger mt-0.5">{error}</p>}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <InlineCreditEstimate
            featureKey="audio_generation_tts"
            params={{ character_count: displayText.length }}
            fallbackCost={2}
            className="text-[10px]"
          />
          {audioUrl && (
            <button
              onClick={onTogglePlay}
              className="w-7 h-7 rounded-md bg-n0 hover:bg-n20 flex items-center justify-center transition-colors"
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
            </button>
          )}
          <button
            disabled={isGenerating}
            onClick={onGenerate}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-primary hover:bg-primary-hover text-white text-xs font-semibold disabled:opacity-50 transition-all"
          >
            {isGenerating ? <Loader size={11} className="animate-spin" /> : audioUrl ? <RefreshCw size={11} /> : <Mic size={11} />}
            {audioUrl ? '重新' : '生成'}
          </button>
        </div>
      </div>

      {/* Row 2: emotion + speed + pitch + duration */}
      <div className="flex items-center gap-3 pl-11 text-xs">
        <span
          className={voice ? 'text-success' : 'text-n100'}
          title={voice?.voiceModelId || '未绑定人物音色，生成时使用默认音色'}
        >
          音色：{voice?.voiceName || '默认音色'}
        </span>
        <select
          value={override.emotion || ''}
          onChange={e => onOverrideChange(clipKey, { emotion: e.target.value || undefined })}
          className="bg-n0 border border-n40 rounded px-1.5 py-1 text-n700 text-[11px]"
        >
          {EMOTIONS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>

        <div className="flex items-center gap-1">
          <span className="text-n100">速</span>
          <input
            type="range" min="0.5" max="2.0" step="0.1"
            value={override.speed ?? (voice?.voiceParams as any)?.speed ?? 1.0}
            onChange={e => onOverrideChange(clipKey, { speed: parseFloat(e.target.value) })}
            className="w-16 h-1 accent-primary"
          />
          <span className="text-n100 tabular-nums w-7">{effectiveSpeed.toFixed(1)}x</span>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-n100">调</span>
          <input
            type="range" min="-12" max="12" step="1"
            value={override.pitch ?? (voice?.voiceParams as any)?.pitch ?? 0}
            onChange={e => onOverrideChange(clipKey, { pitch: parseInt(e.target.value) })}
            className="w-12 h-1 accent-primary"
          />
          <span className="text-n100 tabular-nums w-5">{override.pitch ?? (voice?.voiceParams as any)?.pitch ?? 0}</span>
        </div>

        <span className="ml-auto text-n100 tabular-nums">
          {plannedDurationMs ? `设计${fmtSec(plannedDurationMs)}` : ''}
          {actualMs ? (
            <span className={overDuration ? 'text-warning ml-1' : 'text-success ml-1'}>
              / 音频{fmtSec(actualMs)} {overDuration ? '⚠' : '✓'}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
};
