// Mentions stay plain text so IME, clipboard, and deletion semantics remain
// native. This companion row owns visual previews without coupling rich media
// behavior to textarea editing.
import { SeedreamSourceBadge } from './SeedreamSourceBadge';
import React, { useState } from 'react';
import { ImageIcon, Music, Video as VideoIcon, X } from 'lucide-react';
import type { SeedanceParams, SeedanceMediaInput } from '../services/videoModelService';
import { removeMediaInput, TOKEN_PREFIX } from '../utils/seedanceMedia';

export interface SeedanceMentionTokensRowProps {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    /** Called when the user clicks the thumbnail (open in lightbox). Optional. */
    onPreview?: (url: string, kind: SeedanceMediaInput['kind']) => void;
    disabled?: boolean;
    /** Hide row entirely when no media (default true). */
    hideWhenEmpty?: boolean;
    /** Open previews upward when the row is near a clipped dialog boundary. */
    openUpward?: boolean;
}

interface TokenInfo {
    absIdx: number;          // index in media_inputs
    kind: SeedanceMediaInput['kind'];
    url: string;
    rankInKind: number;      // 1-based among same kind
    label: string;
}

function buildTokens(value: SeedanceParams): TokenInfo[] {
    const counters: Record<string, number> = { image: 0, video: 0, audio: 0 };
    return value.media_inputs.map((m, i) => {
        counters[m.kind]++;
        return {
            absIdx: i,
            kind: m.kind,
            url: m.url,
            rankInKind: counters[m.kind],
            label: `${TOKEN_PREFIX[m.kind]}${counters[m.kind]}`,
        };
    });
}

export const SeedanceMentionTokensRow: React.FC<SeedanceMentionTokensRowProps> = (p) => {
    const tokens = buildTokens(p.value);
    const [hovering, setHovering] = useState<number | null>(null);

    if (tokens.length === 0 && (p.hideWhenEmpty ?? true)) return null;

    return (
        <div
            className="flex flex-wrap items-center gap-1 mt-1.5 pt-1.5 border-t border-n40"
            data-testid="seedance-mention-tokens-row"
            aria-label="已插入素材"
        >
            {tokens.length === 0 ? (
                <span className="text-[10px] text-n100 italic">尚未插入素材，输入 @ 选择</span>
            ) : (
                tokens.map((t) => (
                    <TokenChip
                        key={t.absIdx}
                        token={t}
                        hovering={hovering === t.absIdx}
                        onHoverStart={() => setHovering(t.absIdx)}
                        onHoverEnd={() => setHovering(prev => prev === t.absIdx ? null : prev)}
                        onPreview={() => p.onPreview?.(t.url, t.kind)}
                        onRemove={() => p.onChange(removeMediaInput(p.value, t.absIdx))}
                        disabled={!!p.disabled}
                        openUpward={!!p.openUpward}
                    />
                ))
            )}
        </div>
    );
};

interface TokenChipProps {
    token: TokenInfo;
    hovering: boolean;
    onHoverStart: () => void;
    onHoverEnd: () => void;
    onPreview: () => void;
    onRemove: () => void;
    disabled: boolean;
    openUpward?: boolean;
}

const TokenChip: React.FC<TokenChipProps> = ({ token, hovering, onHoverStart, onHoverEnd, onPreview, onRemove, disabled, openUpward }) => {
    const isImage = token.kind === 'image';
    const isVideo = token.kind === 'video';
    const isAudio = token.kind === 'audio';

    const popoverPos = openUpward ? 'bottom-full mb-1' : 'top-full mt-1';


    return (
        <div
            className="relative inline-flex items-center gap-1 bg-n30 hover:bg-n20 border border-n40 rounded px-1 py-0.5 text-[10px] text-n700 group"
            onMouseEnter={onHoverStart}
            onMouseLeave={onHoverEnd}
        >

            {isImage ? (
                <button
                    type="button"
                    onClick={onPreview}
                    title={`点击预览 ${token.label}`}
                    className="relative block w-12 h-9 rounded overflow-hidden bg-n0 border border-n40 cursor-zoom-in"
                >
                    <img src={token.url} alt={token.label} className="w-full h-full object-cover" />
                </button>
            ) : isVideo ? (
                <button
                    type="button"
                    onClick={onPreview}
                    title={`点击预览 ${token.label}`}
                    className="flex items-center justify-center w-12 h-9 rounded bg-n0 border border-n40 text-primary cursor-zoom-in"
                >
                    <VideoIcon size={14} />
                </button>
            ) : (
                <button
                    type="button"
                    onClick={onPreview}
                    title={`点击预览 ${token.label}`}
                    className="flex items-center justify-center w-12 h-9 rounded bg-n0 border border-n40 text-success cursor-zoom-in"
                >
                    <Music size={14} />
                </button>
            )}


            <div className="flex flex-col items-start min-w-0">
                <span className="font-medium tabular-nums text-n800">{token.label}</span>
                <span className="text-[9px] text-n100 truncate max-w-[80px]">
                    {(token.url || '').split('/').pop()?.split('?')[0] || token.kind}
                </span>
            </div>

            <button
                type="button"
                onClick={onRemove}
                disabled={disabled}
                aria-label={`删除 ${token.label}`}
                className="ml-0.5 p-0.5 text-n300 hover:text-danger hover:bg-r50 rounded opacity-60 group-hover:opacity-100 transition-opacity"
            >
                <X size={10} />
            </button>


            {hovering && isImage && (
                <div
                    className={`absolute z-50 left-0 ${popoverPos} p-1 bg-n0 border border-n40 rounded shadow-bottom pointer-events-none`}
                    style={{ minWidth: 180 }}
                >
                    <img src={token.url} alt={token.label} className="block max-w-[220px] max-h-[160px] object-contain rounded" />
                    <SeedreamSourceBadge reference={token.url} />
                    <div className="mt-1 text-[9px] text-n300 text-center">{token.label}</div>
                </div>
            )}
            {hovering && (isVideo || isAudio) && (
                <div
                    className={`absolute z-50 left-0 ${popoverPos} p-1.5 bg-n0 border border-n40 rounded shadow-bottom pointer-events-none text-[10px] text-n700`}
                    style={{ minWidth: 180 }}
                >
                    <div className="flex items-center gap-1">
                        {isVideo ? <VideoIcon size={12} /> : <Music size={12} />}
                        <span className="truncate" style={{ maxWidth: 160 }}>{token.url}</span>
                    </div>
                    <div className="mt-0.5 text-[9px] text-n100">点击在 lightbox 预览</div>
                </div>
            )}
        </div>
    );
};

export default SeedanceMentionTokensRow;
