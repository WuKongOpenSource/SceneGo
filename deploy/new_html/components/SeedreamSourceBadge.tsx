import React, { useEffect, useState } from 'react';
import { apiJson } from '../services/httpClient';

type Source = { label?: string; display_label?: string; purpose?: string; mode_label?: string; generation_mode?: string };
type Subscriber = { active: boolean; update: (source: Source) => void };
const pending = new Map<string, Subscriber[]>();
let timer: ReturnType<typeof setTimeout> | undefined;
function load(reference: string, update: (source: Source) => void): () => void {
  const subscriber = { active: true, update };
  pending.set(reference, [...(pending.get(reference) || []), subscriber]);
  if (!timer) {
    timer = setTimeout(async () => {
      timer = undefined;
      const entries = [...pending.entries()].filter(([, subscribers]) => subscribers.some(item => item.active));
      pending.clear();
      for (let index = 0; index < entries.length; index += 16) {
        const batch = entries.slice(index, index + 16);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const data = await apiJson<{ items: Record<string, Source> }>('/api/materials/seedream-source', {
            method: 'POST', body: JSON.stringify({ references: batch.map(([ref]) => ref) }), signal: controller.signal,
          }, '图片生成来源');
          batch.forEach(([ref, callbacks]) => callbacks.forEach(item => { if (item.active) item.update(data.items[ref] || {}); }));
        } catch { batch.forEach(([, callbacks]) => callbacks.forEach(item => { if (item.active) item.update({}); })); }
        finally { clearTimeout(timeout); }
      }
    }, 30);
  }
  return () => { subscriber.active = false; };
}

export function SeedreamSourceBadge({ reference, modeOnly = false, showUnknown = true }: { reference?: string; modeOnly?: boolean; showUnknown?: boolean }) {
  const [source, setSource] = useState<Source>({});
  useEffect(() => {
    setSource({});
    if (reference && !reference.startsWith('data:') && !reference.startsWith('blob:')) {
      return load(reference, setSource);
    }
  }, [reference]);
  if (modeOnly) {
    const label = source.generation_mode === 'text_to_image' ? '文生图' : source.generation_mode === 'image_to_image' ? '图生图' : '';
    if (!label && !source.display_label && !showUnknown) return null;
    return <span className={`inline-flex mt-1 rounded px-1.5 py-0.5 text-[10px] leading-4 ${label === '文生图' ? 'bg-primary-light text-primary' : label === '图生图' ? 'bg-warning/10 text-warning' : 'bg-n30 text-n300'}`}
      title={label ? '按服务端生成记录区分；文生图不等于已通过真人参考校验，图生图不能用于该真人参考模式。' : '缺少可靠生成记录，不能据此认定为文生图。'}>
      {source.display_label || label || '来源待确认'}
    </span>;
  }
  const label = source.display_label || source.label;
  if (!label && !showUnknown) return null;
  const purpose = source.purpose === 'character_four_view' ? '人物四视图' : source.purpose === 'pure_background' ? '纯背景' : '';
  return <span className="block text-[10px] leading-4 text-primary" title="按服务端保存的模型和参考图记录标记；不代表已通过真人参考校验，上游仍需审核。">
    {label || '来源待确认'}{purpose && ` · ${purpose}`}
  </span>;
}

export function ImageSourceBadgeOverlay({ reference }: { reference?: string }) {
  return <span className="pointer-events-none absolute bottom-0 left-0 z-10 max-w-full rounded-tr bg-white/95 px-1.5 py-0.5">
    <SeedreamSourceBadge reference={reference} />
  </span>;
}
