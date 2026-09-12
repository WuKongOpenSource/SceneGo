import React, { useEffect, useState } from 'react';

export function BlackClipControls({ duration, onChange, onDelete }: {
  duration: number; onChange: (duration: number) => void; onDelete: () => void;
}) {
  const [draft, setDraft] = useState(String(duration));
  useEffect(() => setDraft(String(duration)), [duration]);
  return <section className="space-y-4">
    <h3 className="text-sm font-semibold text-n800">黑幕片段</h3>
    <div className="aspect-video rounded-lg border border-n40 bg-black" />
    <label className="block space-y-2 text-xs text-n500">黑幕时长（秒）
      <input type="number" min={.1} max={300} step={.1} value={draft}
        onFocus={event => event.currentTarget.select()} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        onBlur={() => {
          const value = Number(draft);
          const next = Math.round(Math.max(.1, Math.min(300, Number.isFinite(value) ? value : duration)) * 1000) / 1000;
          setDraft(String(next)); if (next !== duration) onChange(next);
        }} className="block w-full rounded-lg border border-n40 px-3 py-2 focus:border-primary focus:outline-none" />
    </label>
    <p className="text-[11px] leading-5 text-n300">拖动下方黑幕块可放到任意两个视频之间，也可拖动两端调整长度。黑幕本身无声，独立音乐和音效按时间线继续播放。</p>
    <button type="button" onClick={onDelete} className="w-full rounded-lg border border-danger/30 px-3 py-2 text-xs text-danger">删除黑幕</button>
  </section>;
}
