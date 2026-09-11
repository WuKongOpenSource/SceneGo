import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { VIDEO_CONTROL_PILL_CLASS } from './videoControlStyles';

export const VideoControlPopover: React.FC<{
    label: React.ReactNode;
    title: string;
    children: React.ReactNode;
    disabled?: boolean;
    width?: number;
    dismissKey?: unknown;
    triggerClassName?: string;
    hideChevron?: boolean;
}> = ({ label, title, children, disabled, width = 300, dismissKey, triggerClassName, hideChevron }) => {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 400 });
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const id = useId();
    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const rect = trigger.current?.getBoundingClientRect();
            if (!rect) return;
            const height = Math.min(panel.current?.offsetHeight || 240, window.innerHeight - 24);
            const top = rect.top >= height + 20 ? rect.top - height - 8 : Math.min(rect.bottom + 8, window.innerHeight - height - 12);
            setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - Math.min(width, window.innerWidth - 24) - 12)), top: Math.max(12, top), maxHeight: window.innerHeight - 24 });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
    }, [open, width, children]);
    useEffect(() => {
        if (!open) return;
        const pointer = (event: PointerEvent) => {
            if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
        };
        const key = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
        };
        document.addEventListener('pointerdown', pointer);
        document.addEventListener('keydown', key);
        panel.current?.focus();
        return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
    }, [open]);
    useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
    useEffect(() => { setOpen(false); }, [dismissKey]);
    return <>
        <button ref={trigger} type="button" className={triggerClassName || VIDEO_CONTROL_PILL_CLASS} disabled={disabled}
            aria-label={title} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
            onClick={() => setOpen(!open)}>{label}{!hideChevron && <ChevronDown size={10} className="text-n100" />}</button>
        {open && createPortal(
            <div ref={panel} id={id} role="dialog" aria-label={title} tabIndex={-1}
                className="fixed z-[9600] overflow-y-auto rounded-2xl border border-n40 bg-n0 p-3 text-xs text-n700 shadow-bottom outline-none"
                style={{ ...position, width, maxWidth: 'calc(100vw - 24px)' }}>
                <div className="mb-3 flex items-center justify-between gap-3 font-semibold">
                    {title}<button type="button" aria-label={`关闭${title}`} onClick={() => { setOpen(false); trigger.current?.focus(); }} className="rounded-lg p-1 text-n100 hover:bg-n20"><X size={14} /></button>
                </div>
                <div className="space-y-3">{children}</div>
            </div>, document.body,
        )}
    </>;
};
