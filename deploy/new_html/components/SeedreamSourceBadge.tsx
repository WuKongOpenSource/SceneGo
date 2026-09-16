import React, { useEffect, useRef, useState } from 'react';
import { apiJson } from '../services/httpClient';
import { compactImageSourceLabel } from '../utils/imageSourceDisplay';
import { Star } from 'lucide-react';

type Source = { label?: string; display_label?: string; purpose?: string; mode_label?: string; generation_mode?: string; portrait_reference_scopes?: string[]; portrait_reference_expires_at?: number };
type Subscriber = { active: boolean; eligibility: boolean; update: (source: Source) => void };
const pending = new Map<string, Subscriber[]>();
let timer: ReturnType<typeof setTimeout> | undefined;
function load(reference: string, update: (source: Source) => void, eligibility = false): () => void {
  const subscriber = { active: true, eligibility, update };
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
            method: 'POST', body: JSON.stringify({ references: batch.map(([ref]) => ref),
              ...(batch.some(([, subscribers]) => subscribers.some(item => item.active && item.eligibility)) ? { include_portrait_eligibility: true } : {}),
            }), signal: controller.signal,
          }, '图片生成来源');
          batch.forEach(([ref, callbacks]) => callbacks.forEach(item => { if (item.active) item.update(data.items[ref] || {}); }));
        } catch { batch.forEach(([, callbacks]) => callbacks.forEach(item => { if (item.active) item.update({}); })); }
        finally { clearTimeout(timeout); }
      }
    }, 30);
  }
  return () => { subscriber.active = false; };
}

export function SeedreamSourceBadge({ reference, modeOnly = false, showUnknown = true, fallbackLabel }: { reference?: string; modeOnly?: boolean; showUnknown?: boolean; fallbackLabel?: string }) {
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
    return <span className={`inline-block max-w-full truncate align-middle mt-1 rounded px-1.5 py-0.5 text-[10px] leading-4 ${label === '文生图' ? 'bg-primary-light text-primary' : label === '图生图' ? 'bg-warning/10 text-warning' : 'bg-n30 text-n300'}`}
      title={label ? '按服务端生成记录区分；文生图不等于已通过真人参考校验，图生图不能用于该真人参考模式。' : '缺少可靠生成记录，不能据此认定为文生图。'}>
      {compactImageSourceLabel(source.display_label || label || '来源待确认')}
    </span>;
  }
  const label = source.display_label || source.label || fallbackLabel;
  if (!label && !showUnknown) return null;
  const purpose = source.purpose === 'character_four_view' ? '人物四视图' : source.purpose === 'pure_background' ? '纯背景' : '';
  return <span className="block max-w-full truncate text-[10px] leading-4 text-primary" title={`${label || '来源待确认'}；按服务端保存的模型和参考图记录标记；不代表已通过真人参考校验，上游仍需审核。`}>
    {compactImageSourceLabel(label || '来源待确认')}{purpose && ` · ${purpose}`}
  </span>;
}

const STAR_LABEL = '可用于仿真人视频的 Seedream 文生图';
const STAR_HELP = '星号表示原图已通过来源、30天有效期与完整性校验；生成时仍需校验账号权限、所选模式和上游审核。';

export function PortraitReferenceLegend() {
  return <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-n300" title={STAR_HELP}>
    <Star size={13} className="shrink-0 fill-amber-400 text-amber-600" aria-hidden="true" />
    {STAR_LABEL}
  </span>;
}

export function PortraitReferenceStar({ reference, scope = 'workflow' }: { reference?: string; scope?: 'workflow' | 'studio' }) {
  const [loaded, setLoaded] = useState<{ reference: string; source: Source } | null>(null);
  const [clock, expire] = useState(0);
  const source = loaded && loaded.reference === reference ? loaded.source : undefined;
  useEffect(() => {
    setLoaded(null);
    if (reference && !/^(data:|blob:)/.test(reference)) {
      return load(reference, source => setLoaded({ reference, source }), true);
    }
  }, [reference]);
  const expires = source?.portrait_reference_expires_at || 0;
  useEffect(() => {
    if (!expires) return;
    const delay = expires * 1000 - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(() => expire(value => value + 1), Math.min(delay, 2147483647));
    return () => clearTimeout(timer);
  }, [expires, clock]);
  if (!source?.portrait_reference_scopes?.includes(scope) || expires * 1000 <= Date.now()) return null;
  return <span role="img" aria-label={STAR_LABEL} title={`${STAR_LABEL}。${STAR_HELP}`}
    className="pointer-events-none absolute bottom-0.5 right-0.5 z-10 inline-flex h-3 w-3 items-center justify-center rounded-full bg-white/90 shadow-sm">
    <Star size={10} className="fill-amber-400 text-amber-600" aria-hidden="true" />
  </span>;
}

export function ImageSourceBadgeOverlay({ reference, scope = 'workflow', fallbackLabel }: { reference?: string; scope?: 'workflow' | 'studio'; fallbackLabel?: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const parent = host.current?.parentElement;
    if (!parent) return;
    // Small references stay unobstructed. Measure rendered size, including zoom.
    const measure = () => {
      const { width, height } = parent.getBoundingClientRect();
      setVisible(width >= 160 && height >= 120);
      setCompact(width > 0 && height > 0 && width <= 96 && height <= 96);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(parent);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  return <>{compact && <PortraitReferenceStar reference={reference} scope={scope} />}<span ref={host} className="pointer-events-none absolute bottom-0 left-0 z-10 max-w-full">
    {visible && <span className="block max-w-full rounded-tr bg-white/95 px-1.5 py-0.5"><SeedreamSourceBadge reference={reference} fallbackLabel={fallbackLabel} /></span>}
  </span></>;
}
