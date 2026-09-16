import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Film, Volume2, X } from 'lucide-react';
import type { SeedanceMediaInput, SeedanceParams } from '../services/videoModelService';
import { TOKEN_PREFIX, removeMediaInput } from '../utils/seedanceMedia';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  value: SeedanceParams;
  onChange: (next: SeedanceParams) => void;
  disabled?: boolean;
  addControl: React.ReactNode;
  onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
}

/** The reference shelf, mentions and submitted media all use the same ordered input array. */
export function SeedanceReferenceShelf({ value, onChange, disabled, addControl, onPreviewMedia }: Props) {
  const [filter, setFilter] = useState<'all' | SeedanceMediaInput['kind']>('all');
  const [confirmClear, setConfirmClear] = useState(false);
  const tabs = [['all', '全部'], ['image', '图片'], ['video', '视频'], ['audio', '音频']] as const;
  return <section aria-label="参考内容" data-testid="seedance-reference-shelf" className="shrink-0 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="tablist" aria-label="参考内容分类" className="flex gap-1">
        {tabs.map(([kind, label]) => <button key={kind} type="button" role="tab" aria-selected={filter === kind}
          onClick={() => setFilter(kind)} className={`rounded-lg px-2 py-1.5 text-[11px] ${filter === kind ? 'bg-primary/10 text-primary' : 'text-n300 hover:bg-n20'}`}>
          {label} ({kind === 'all' ? value.media_inputs.length : value.media_inputs.filter(item => item.kind === kind).length})
        </button>)}
      </div>
      <button type="button" disabled={disabled || !value.media_inputs.length} onClick={() => setConfirmClear(true)} className="text-[10px] text-n100 hover:text-danger disabled:opacity-40">清空参考内容</button>
    </div>
    <div className="flex max-w-full items-start gap-2 overflow-x-auto px-1 py-1" role="tabpanel">
      {value.media_inputs.map((item, index) => {
        if (filter !== 'all' && filter !== item.kind) return null;
        const label = `${TOKEN_PREFIX[item.kind]}${value.media_inputs.slice(0, index + 1).filter(row => row.kind === item.kind).length}`;
        return <div key={`${item.kind}:${item.url}:${index}`} className="relative h-20 w-16 shrink-0 rounded-lg border border-n40 bg-n20/60" data-reference-label={label}>
          <button type="button" title={`预览${label}`} onClick={() => onPreviewMedia?.(item.url, item.kind)} className="flex h-full w-full flex-col overflow-hidden rounded-lg">
            <span className="flex min-h-0 w-full flex-1 items-center justify-center">
              {item.kind === 'image' ? <img src={item.url} alt={label} className="h-full w-full object-cover" /> : item.kind === 'video' ? <Film size={20} /> : <Volume2 size={20} />}
            </span>
            <span className="w-full shrink-0 py-0.5 text-center text-[10px] text-n300">{label}</span>
          </button>
          <button type="button" aria-label={`移除${label}`} disabled={disabled} onClick={() => onChange(removeMediaInput(value, index))} className="absolute -right-1 -top-1 rounded-full bg-n900/75 p-0.5 text-white disabled:opacity-40"><X size={12} /></button>
        </div>;
      })}
      {addControl}
    </div>
    {confirmClear && createPortal(<div className="relative z-[9800]"><ConfirmDialog open title="清空参考内容？" message="只移除当前卡片的参考内容和对应 @ 编号，不删除上方画面素材、素材库原图或历史视频。"
      onCancel={() => setConfirmClear(false)} onConfirm={() => {
        if (!disabled) onChange(value.media_inputs.reduceRight((next, _, index) => removeMediaInput(next, index), value));
        setConfirmClear(false);
      }} /></div>, document.body)}
  </section>;
}
