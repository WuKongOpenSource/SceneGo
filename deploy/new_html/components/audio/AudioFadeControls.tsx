import React, { useEffect, useState } from 'react';
import { normalizeAudioFades } from '../../utils/audioFades';

function FadeSeconds({ label, value, maximum, onCommit }: {
  label: string; value: number; maximum: number; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label className="block min-w-0 space-y-1">
    <span className="text-[11px] text-n500">{label}</span>
    <div className="flex items-center gap-2">
      <input type="number" min={0} max={maximum} step={0.1} value={draft}
        onFocus={event => event.currentTarget.select()}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = draft.trim() === '' ? 0 : Number(draft);
          const next = Math.round(Math.min(maximum, Math.max(0, Number.isFinite(parsed) ? parsed : value)) * 1000) / 1000;
          setDraft(String(next));
          if (next !== value) onCommit(next);
        }}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        className="min-w-0 w-full rounded-lg border border-n40 bg-n0 px-2 py-2 text-xs focus:border-primary focus:outline-none" />
      <span className="shrink-0 text-[11px] text-n300">秒</span>
    </div>
  </label>;
}

export function AudioFadeControls({ duration, fadeIn = 0, fadeOut = 0, onChange }: {
  duration: number; fadeIn?: number; fadeOut?: number;
  onChange: (fades: { fadeIn: number; fadeOut: number }) => void;
}) {
  const fades = normalizeAudioFades(duration, fadeIn, fadeOut);
  return <section className="space-y-2 rounded-lg border border-primary/20 bg-primary-light/30 p-3" aria-label="音频渐变">
    <h4 className="text-xs font-semibold text-n700">音乐 / 音效渐变</h4>
    <div className="grid grid-cols-2 gap-3">
      <FadeSeconds label="开头渐入" value={fades.fadeIn} maximum={Math.max(0, duration - fades.fadeOut)}
        onCommit={value => onChange(normalizeAudioFades(duration, value, fades.fadeOut))} />
      <FadeSeconds label="末尾渐出" value={fades.fadeOut} maximum={Math.max(0, duration - fades.fadeIn)}
        onCommit={value => onChange(normalizeAudioFades(duration, fades.fadeIn, value))} />
    </div>
    <p className="text-[10px] leading-4 text-n300">从静音逐渐达到设定音量，或在结尾逐渐变为静音。0 秒为关闭，两端合计不超过片段时长；预览与成片同步生效。</p>
  </section>;
}
