import React, { useEffect, useRef, useState } from 'react';
import {
  normalizeEnhanceSubtitleStyle, resolveSubtitleCoordinates,
  type EnhanceSubtitleCue, type EnhanceSubtitleStyle,
} from '../utils/enhanceTimelineEditor';

interface Props {
  cues: EnhanceSubtitleCue[];
  style: EnhanceSubtitleStyle;
  sourceWidth: number;
  sourceHeight: number;
  onSelect: (id: string) => void;
  onChange: (style: Partial<EnhanceSubtitleStyle>) => void;
}

export function SubtitlePreview({ cues, style, sourceWidth, sourceHeight, onSelect, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<EnhanceSubtitleStyle | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; before: EnhanceSubtitleStyle; latest: EnhanceSubtitleStyle } | null>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = sourceWidth > 0 ? sourceWidth : 1920;
  const height = sourceHeight > 0 ? sourceHeight : 1080;
  const scale = Math.min(size.width / width, size.height / height) || 0;
  const pictureWidth = width * scale;
  const pictureHeight = height * scale;
  const current = draft || style;
  const coordinates = resolveSubtitleCoordinates(current);
  const finishDrag = (event: React.PointerEvent, cancel: boolean) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setDraft(null);
    if (!cancel) onChange({ positionX: active.latest.positionX, positionY: active.latest.positionY });
  };

  return <div ref={host} className="absolute inset-0 z-20 pointer-events-none" aria-label="字幕位置预览">
    <div className="absolute" style={{
      width: pictureWidth, height: pictureHeight,
      left: (size.width - pictureWidth) / 2, top: (size.height - pictureHeight) / 2,
    }}>
      {cues.length > 0 && <div
        className="absolute flex w-max max-w-[90%] flex-col items-center gap-1"
        style={{ left: `${coordinates.x}%`, top: `${coordinates.y}%`,
          transform: `translate(-50%, ${current.position === 'top' ? '0' : current.position === 'center' ? '-50%' : '-100%'})` }}
      >
        {cues.map(cue => <div
          key={cue.id}
          role="button"
          tabIndex={0}
          aria-label={`移动字幕：${cue.text}`}
          title="拖动调整字幕位置；方向键微调，Shift 加速"
          className="pointer-events-auto max-w-full cursor-move touch-none select-none whitespace-pre-wrap break-words rounded text-center leading-snug focus:outline focus:outline-2 focus:outline-primary hover:outline hover:outline-1 hover:outline-primary"
          style={{ color: current.textColor,
            backgroundColor: `${current.backgroundColor}${Math.round(current.backgroundOpacity * 255).toString(16).padStart(2, '0')}`,
            fontSize: current.fontSize * scale, padding: `${4 * scale}px ${6 * scale}px`,
            textShadow: '0 1px 2px rgba(0,0,0,.9)' }}
          onPointerDown={event => {
            if (event.button !== 0 || pictureWidth <= 0 || pictureHeight <= 0) return;
            event.preventDefault();
            onSelect(cue.id);
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, before: style, latest: style };
          }}
          onPointerMove={event => {
            const active = drag.current;
            if (!active || event.pointerId !== active.pointerId) return;
            const start = resolveSubtitleCoordinates(active.before);
            const next = normalizeEnhanceSubtitleStyle({ ...active.before,
              positionX: start.x + (event.clientX - active.x) / pictureWidth * 100,
              positionY: start.y + (event.clientY - active.y) / pictureHeight * 100,
            });
            active.latest = next;
            setDraft(next);
          }}
          onPointerUp={event => finishDrag(event, false)}
          onPointerCancel={event => finishDrag(event, true)}
          onLostPointerCapture={event => finishDrag(event, true)}
          onKeyDown={event => {
            const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
            if (!delta) return;
            event.preventDefault();
            event.stopPropagation();
            const step = event.shiftKey ? 5 : 1;
            onSelect(cue.id);
            onChange({ positionX: coordinates.x + delta[0] * step, positionY: coordinates.y + delta[1] * step });
          }}
        >{cue.text}</div>)}
      </div>}
    </div>
  </div>;
}
