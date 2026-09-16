import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles } from 'lucide-react';
import type { SeedanceParams, SeedanceMediaInput } from '../services/videoModelService';
import type { SeedanceAssetCandidate } from '../utils/seedanceMedia';
import { hasMediaTokenReference, insertMention, parseArkAssetId, removeMediaInput, TOKEN_PREFIX } from '../utils/seedanceMedia';
import { SeedanceMentionTokensRow } from './SeedanceMentionTokensRow';
import { AIRewritePromptModal } from './AIRewritePromptModal';
import { splitPromptSegments, TOKEN_KIND_OVERLAY_CLASS } from '../utils/promptHighlight';

export interface SeedanceMentionPromptEditorProps {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    candidates: SeedanceAssetCandidate[];
    disabled?: boolean;
    autoOpenOnMount?: boolean;
    placeholder?: string;
    /** Click on a token thumbnail → external lightbox handler (see VideoPage). Optional. */
    onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
    /** Hide the row even when there's media (used by list-view rows where space is tight). */
    hideTokensRow?: boolean;

    rows?: number;
    fillHeight?: boolean;
    /** Allow the embedded card editor to yield height to a sibling media strip. */
    compactFillHeight?: boolean;

    openUpward?: boolean;
}

const GROUP_LABELS: Record<string, string> = {
    current_card: '当前卡',
    storyboard_data: '分镜',
    storyboard_library: '分镜生成资源',
    assets: '素材库',
    audio: '音频',
    video_segments: '视频片段',
    user_files: '媒体库',
    media_library: '通用素材库',
    ark_asset_id: '远程 ID',
};

export const SeedanceMentionPromptEditor: React.FC<SeedanceMentionPromptEditorProps> = (props) => {
    const { value, onChange, candidates, disabled, autoOpenOnMount, placeholder, onPreviewMedia, hideTokensRow, rows, openUpward, fillHeight, compactFillHeight } = props;
    const taRef = useRef<HTMLTextAreaElement | null>(null);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [activeIdx, setActiveIdx] = useState(0);
    const [composing, setComposing] = useState(false);

    const [atPos, setAtPos] = useState<number | null>(null);

    const [rewriteOpen, setRewriteOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
    useLayoutEffect(() => {
        if (!fillHeight || !open) return;
        const place = () => {
            const rect = taRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
            const height = Math.min(256, window.innerHeight - 24);
            const top = rect.top >= height + 16 ? rect.top - height - 8 : Math.min(rect.bottom + 8, window.innerHeight - height - 12);
            setMenuStyle({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: Math.max(12, top), width, maxHeight: height });
        };
        place();
        const outside = (event: PointerEvent) => {
            if (!menuRef.current?.contains(event.target as Node) && event.target !== taRef.current) setOpen(false);
        };
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        document.addEventListener('pointerdown', outside);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
            document.removeEventListener('pointerdown', outside);
        };
    }, [fillHeight, open]);
    const renderMenu = (menu: React.ReactNode) => fillHeight ? createPortal(menu, document.body) : menu;

    // autoOpenOnMount
    useEffect(() => {
        if (autoOpenOnMount && (value.prompt || '').trim() === '@') {
            setOpen(true);
            setSearch('');

            const idx = value.prompt.indexOf('@');
            setAtPos(idx >= 0 ? idx : 0);
            // Focus + place cursor at end so the popover anchors at the @
            taRef.current?.focus();
            taRef.current?.setSelectionRange(value.prompt.length, value.prompt.length);
        }
    // mount-only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Compose (IME) suppression
    useEffect(() => { if (composing) setOpen(false); }, [composing]);

    // Filtered + grouped candidates
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = q
            ? candidates.filter(c => c.label.toLowerCase().includes(q))
            : candidates;
        const groups: Record<string, SeedanceAssetCandidate[]> = {};
        for (const c of list) {
            (groups[c.group] ||= []).push(c);
        }
        return groups;
    }, [search, candidates]);

    const flatList = useMemo(
        () => Object.entries(filtered).flatMap(([_, items]) => items),
        [filtered],
    );

    const handleSelect = useCallback(
        (cand: SeedanceAssetCandidate) => {


            const ta = taRef.current;
            const caretPos = ta ? ta.selectionStart : (value.prompt || '').length;
            const opts = atPos != null && caretPos >= atPos
                ? { atPos, caretPos }
                : undefined;

            let next: SeedanceParams;
            if (cand.group === 'ark_asset_id') {
                const raw = window.prompt('输入 asset:// id（如 asset://abc-123）：') || '';
                const valid = parseArkAssetId(raw);
                if (!valid) {
                    window.alert('无效的 asset:// 格式');
                    return;
                }
                const arkCand: SeedanceAssetCandidate = { ...cand, arkAssetId: valid };
                next = insertMention(value, arkCand, opts);
            } else {
                next = insertMention(value, cand, opts);
            }
            onChange(next);
            setOpen(false);
            setSearch('');
            setAtPos(null);

            setTimeout(() => {
                if (!taRef.current) return;
                taRef.current.focus();
                const newCursor = opts ? Math.min(next.prompt.length, opts.atPos + (next.prompt.length - (value.prompt || '').length + (caretPos - opts.atPos))) : next.prompt.length;
                taRef.current.setSelectionRange(newCursor, newCursor);
            }, 0);
        },
        [value, onChange, atPos],
    );

    // Detect @ trigger after each input event
    const handleInput = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            const v = e.target.value;
            onChange({ ...value, prompt: v });
            if (composing || disabled) return;
            const cursor = e.target.selectionStart || 0;
            const justTyped = v.charAt(cursor - 1);
            if (justTyped !== '@') {

                if (open && atPos != null) {
                    if (cursor < atPos) {

                        setOpen(false);
                        setAtPos(null);
                    } else {
                        const segment = v.slice(atPos + 1, cursor);

                        if (/\s/.test(segment)) {
                            setOpen(false);
                            setAtPos(null);
                        } else {
                            setSearch(segment);
                            setActiveIdx(0);
                        }
                    }
                } else if (open) {
                    const lastAt = v.lastIndexOf('@', cursor - 1);
                    if (lastAt < 0) setOpen(false);
                }
                return;
            }
            const prev = cursor >= 2 ? v.charAt(cursor - 2) : '';
            // A highlighted media token is a boundary even though its index ends in a digit.
            // Keep ordinary words/emails and the middle of multi-digit token indices literal.
            const previousSegment = splitPromptSegments(v.slice(0, cursor - 1)).at(-1);
            const followsMediaToken = previousSegment?.type === 'token' && !/\d/.test(v.charAt(cursor));
            if (prev === '' || !/[A-Za-z0-9_]/.test(prev) || followsMediaToken) {
                setOpen(true);
                setSearch('');
                setActiveIdx(0);

                setAtPos(cursor - 1);
            }
        },
        [value, onChange, composing, disabled, open, atPos],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {

            // and removes the matching media_inputs entry (renumbers remaining tokens).
            // TOKEN_PREFIX is imported as the canonical label source; the regex below
            // uses the literal labels for clarity.
            if (e.key === 'Backspace' && !composing) {
                const ta = taRef.current;
                if (ta) {
                    const cursor = ta.selectionStart;
                    // Only fire when there's no selection (range delete is plain text)
                    if (cursor === ta.selectionEnd) {
                        const before = (value.prompt || '').slice(0, cursor);
                        const m = /(图片|视频|音频)(\d+)$/.exec(before);
                        if (m) {
                            e.preventDefault();
                            const tokenLen = m[0].length;
                            const labelToKind: Record<string, 'image' | 'video' | 'audio'> = {
                                '图片': 'image', '视频': 'video', '音频': 'audio',
                            };
                            const kind = labelToKind[m[1]];
                            const tokenN = parseInt(m[2], 10);
                            // Find the corresponding media_inputs index (N-th of that kind)
                            const sameKindAbs = value.media_inputs
                                .map((mi, i) => mi.kind === kind ? i : -1)
                                .filter(i => i >= 0);
                            const targetAbsIdx = sameKindAbs[tokenN - 1];

                            // Delete the token text and (if present) one preceding space
                            const start = cursor - tokenLen;
                            const trimStart = start > 0 && (value.prompt || '').charAt(start - 1) === ' ' ? start - 1 : start;
                            const promptStripped =
                                (value.prompt || '').slice(0, trimStart) + (value.prompt || '').slice(cursor);

                            if (targetAbsIdx === undefined || targetAbsIdx < 0) {
                                onChange({ ...value, prompt: promptStripped });
                            } else if (hasMediaTokenReference(promptStripped, kind, tokenN)) {
                                onChange({ ...value, prompt: promptStripped });
                            } else {
                                onChange(removeMediaInput({ ...value, prompt: promptStripped }, targetAbsIdx));
                            }
                            return;
                        }
                    }
                }
            }
            if (!open) return;
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); taRef.current?.focus(); return; }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx(i => Math.min(flatList.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx(i => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const cand = flatList[activeIdx];
                if (cand) handleSelect(cand);
            }
        },
        [open, flatList, activeIdx, handleSelect, value, onChange, composing],
    );




    const overlayRef = useRef<HTMLDivElement | null>(null);
    const promptText = value.prompt || '';
    const segments = useMemo(() => splitPromptSegments(promptText), [promptText]);

    const handleScroll = useCallback(() => {
        if (taRef.current && overlayRef.current) {
            overlayRef.current.scrollTop = taRef.current.scrollTop;
            overlayRef.current.scrollLeft = taRef.current.scrollLeft;
        }
    }, []);


    const SHARED_TEXT_CLS =
        'w-full px-2 py-1.5 pr-8 text-xs leading-5 font-sans whitespace-pre-wrap break-words';

    return (
        <div className={fillHeight ? 'relative flex min-h-0 flex-1 flex-col' : 'relative'}>

            <div className={fillHeight ? `relative ${compactFillHeight ? 'min-h-[96px]' : 'min-h-[140px]'} flex-1` : 'relative'}>


            <div
                ref={overlayRef}
                aria-hidden="true"
                className={
                    `${SHARED_TEXT_CLS} absolute inset-0 m-0 rounded ` +
                    'bg-n30 border border-transparent select-none ' +
                    `${composing ? 'text-transparent' : 'text-n800'} ` +
                    'overflow-hidden pointer-events-none'
                }
                style={{ zIndex: 0 }}
            >
                {segments.length === 0 ? '\u200b' : segments.map((seg, i) => {
                    if (seg.type === 'token') {
                        return (

                            <span
                                key={`tok-${i}`}
                                className={`rounded-sm ${TOKEN_KIND_OVERLAY_CLASS[seg.kind]}`}
                            >
                                {seg.text}
                            </span>
                        );
                    }
                    return <span key={`txt-${i}`}>{seg.text}</span>;
                })}

                {promptText.endsWith('\n') && '\u200b'}
            </div>
            <textarea
                ref={taRef}
                value={value.prompt}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                onScroll={handleScroll}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                placeholder={placeholder || '描述动作、镜头、声音；@ 选素材...'}
                disabled={disabled}
                rows={rows ?? 3}
                className={
                    `${SHARED_TEXT_CLS} ${fillHeight ? `h-full ${compactFillHeight ? 'min-h-[96px]' : 'min-h-[140px]'}` : ''} relative bg-transparent border border-n40 rounded ` +
                    `${composing ? 'text-n800' : 'text-transparent'} ` +
                    'caret-n800 placeholder:text-n100 resize-none ' +



                    'focus:outline-none focus:border-primary'
                }
                style={{ zIndex: 1 }}
            />

            <button
                type="button"
                onClick={() => setRewriteOpen(true)}
                disabled={disabled || !(value.prompt || '').trim()}
                className="absolute top-1 right-1 z-10 w-6 h-6 flex items-center justify-center text-primary hover:text-primary-hover bg-n0 hover:bg-primary-light border border-primary rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="AI 改写视频提示词"
                aria-label="AI 改写"
            >
                <Sparkles size={13} />
            </button>
            </div>
            {renderMenu(<div className={fillHeight ? 'relative z-[9900]' : undefined}><AIRewritePromptModal
                open={rewriteOpen}
                originalPrompt={value.prompt || ''}
                onAccept={(newPrompt) => {
                    onChange({ ...value, prompt: newPrompt });
                    setRewriteOpen(false);
                }}
                onClose={() => setRewriteOpen(false)}
            /></div>)}

            {!hideTokensRow && (
                <SeedanceMentionTokensRow
                    value={value}
                    onChange={onChange}
                    onPreview={onPreviewMedia}
                    disabled={disabled}
                    openUpward={openUpward}
                />
            )}

            <div className="relative">
            {open && !composing && renderMenu(
                <div
                    ref={menuRef}
                    role="listbox"
                    style={fillHeight ? menuStyle : undefined}
                    aria-label="mention candidates"
                    className={
                        'overflow-y-auto bg-n0 border border-n40 rounded-xl shadow-bottom ' +
                        (fillHeight ? 'fixed z-[9800]' : 'absolute left-0 right-0 max-h-64 z-50 ' + (openUpward ? 'bottom-full mb-1' : 'top-full mt-1'))
                    }
                >
                    <input
                        autoFocus
                        type="text"
                        value={search}
                        onChange={e => { setSearch(e.target.value); setActiveIdx(0); }}
                        onKeyDown={e => handleKeyDown(e as unknown as React.KeyboardEvent<HTMLTextAreaElement>)}
                        placeholder="搜索..."
                        className="w-full px-2 py-1 text-xs bg-n0 border-b border-n40 text-n700"
                    />
                    {Object.entries(filtered).map(([group, items]) => (
                        <div key={group}>
                            <div className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-n100 bg-n30">
                                {GROUP_LABELS[group] || group}
                            </div>
                            {items.map((c) => {
                                const idx = flatList.indexOf(c);
                                return (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => handleSelect(c)}
                                        className={`flex items-center gap-2 w-full text-left px-2 py-1 text-xs hover:bg-n20 ${
                                            idx === activeIdx ? 'bg-n20' : ''
                                        }`}
                                    >
                                        {c.thumbnailUrl && (
                                            <span className="relative shrink-0 w-6 h-6"><img src={c.thumbnailUrl} alt="" className="w-full h-full object-cover rounded" />
                                            </span>
                                        )}
                                        <span className="text-n700">{c.label}</span>
                                        <span className="ml-auto text-[10px] text-n100">{c.kind}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                    {flatList.length === 0 && (
                        <div className="px-2 py-2 text-[11px] text-n100">无匹配</div>
                    )}
                </div>
            )}
            </div>
        </div>
    );
};
