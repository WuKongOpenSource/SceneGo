import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';

export const VideoPromptField: React.FC<{
    value: string;
    onChange: (value: string) => void;
    hint: string;
    disabled?: boolean;
}> = ({ value, onChange, hint, disabled }) => {
    const [expanded, setExpanded] = useState(false);
    useEffect(() => {
        if (!expanded) return;
        const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
        document.addEventListener('keydown', close);
        return () => document.removeEventListener('keydown', close);
    }, [expanded]);
    const field = (large: boolean) => <textarea aria-label={large ? '放大编辑提示词内容' : '视频提示词'} value={value}
        onChange={event => onChange(event.target.value)} disabled={disabled} placeholder="输入文字，描述画面内容、动作和运镜……"
        className={`w-full min-h-[140px] flex-1 resize-none rounded-xl border border-n40 bg-n20/40 p-3 text-xs leading-[1.8] text-n800 outline-none focus:border-primary ${large ? 'h-[min(60vh,640px)]' : ''}`} />;
    return <>
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3" data-testid="video-prompt-field">
            <div className="flex shrink-0 items-center justify-between gap-2 text-[10px] text-n100">
                <span>{hint}</span><button type="button" onClick={() => setExpanded(true)} className="inline-flex shrink-0 items-center gap-1 text-primary"><Maximize2 size={12} />放大编辑</button>
            </div>{field(false)}
        </div>
        {expanded && createPortal(<div className="fixed inset-0 z-[9500] flex items-center justify-center bg-n900/50 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) setExpanded(false); }}>
            <div role="dialog" aria-modal="true" aria-label="放大编辑提示词" className="flex max-h-[90vh] w-full max-w-5xl flex-col gap-3 rounded-2xl bg-n0 p-4 shadow-bottom">
                <div className="flex items-center justify-between"><div className="text-sm font-semibold">提示词 · 放大编辑</div><button type="button" aria-label="关闭" onClick={() => setExpanded(false)}><X size={16} /></button></div>
                <p className="text-xs text-n100">{hint}</p>{field(true)}
                <button type="button" onClick={() => setExpanded(false)} className="self-end rounded-full bg-primary px-5 py-2 text-xs text-white">完成</button>
            </div>
        </div>, document.body)}
    </>;
};
