import { isDashScopeVideoModel, type VideoModel } from '../services/videoModelService';

export const PLACEHOLDER_CARD_HEIGHT_CLASS = 'h-[320px] flex flex-col overflow-hidden';

export const COMPACT_CARD_HEIGHT_CLASS = 'h-[560px] flex flex-col overflow-hidden';

export const DASHSCOPE_CARD_HEIGHT_CLASS = 'h-[560px] flex flex-col overflow-hidden';
/** MiniMax Hailuo model, duration, resolution, optimizer, and prompt controls. */
export const MINIMAX_CARD_HEIGHT_CLASS = 'h-[560px] flex flex-col overflow-hidden';

export const SEEDANCE_CARD_HEIGHT_CLASS = 'h-[560px] flex flex-col overflow-hidden';
export const SEEDANCE_15_CARD_HEIGHT_CLASS = 'h-[560px] flex flex-col overflow-hidden';

export const PARAMETRIC_CARD_HEIGHT_CLASS = DASHSCOPE_CARD_HEIGHT_CLASS;

export const CARD_MEDIA_HEIGHT_CLASS = 'h-28 shrink-0';

export const RESULT_MEDIA_HEIGHT_CLASS = CARD_MEDIA_HEIGHT_CLASS;
export const SEEDANCE_RESULT_MEDIA_HEIGHT_CLASS = CARD_MEDIA_HEIGHT_CLASS;

export const CARD_BODY_SCROLL_CLASS = 'flex-1 min-h-0 overflow-y-auto mt-2 pr-0.5';

export const SIMPLE_PROMPT_TEXTAREA_CLASS =
    'w-full h-full min-h-[72px] overflow-y-auto bg-n0 border border-n40 rounded px-3 py-2 text-xs text-n700 focus:border-primary focus:outline-none resize-none';

export const PLACEHOLDER_PROMPT_TEXTAREA_CLASS =
    'w-full h-full min-h-[56px] overflow-y-auto bg-n0 border border-n40 rounded px-3 py-2 text-xs text-n700 focus:border-primary focus:outline-none resize-none';

export const RESULT_PROMPT_READONLY_CLASS =
    'w-full max-h-[220px] overflow-y-auto bg-n0 border border-n40 rounded px-3 py-2 text-[12px] leading-5 text-n700 border-l-2 border-l-primary/40 whitespace-pre-wrap break-words';

export function isSeedanceModel(model: VideoModel): boolean {
    return model === 'Seedance15'
        || model === 'Seedance2'
        || model === 'Seedance2Fast'
        || model === 'Seedance2Mini';
}

export function getCardHeightClass(model: VideoModel, isPlaceholder = false): string {
    if (isPlaceholder) return PLACEHOLDER_CARD_HEIGHT_CLASS;
    if (model === 'Seedance15') return SEEDANCE_15_CARD_HEIGHT_CLASS;
    if (isSeedanceModel(model)) return SEEDANCE_CARD_HEIGHT_CLASS;
    if (isDashScopeVideoModel(model)) return DASHSCOPE_CARD_HEIGHT_CLASS;
    if (model === 'MINI') return MINIMAX_CARD_HEIGHT_CLASS;
    return COMPACT_CARD_HEIGHT_CLASS;
}

export function getPreviewImageHeightClass(model: VideoModel, isPair: boolean): string {
    return CARD_MEDIA_HEIGHT_CLASS;
}

export function getResultVisualHeightClass(model: VideoModel): string {
    return CARD_MEDIA_HEIGHT_CLASS;
}

/** Fill the current four-column result row with stable dashed placeholders. */
export function getVideoResultPlaceholderCount(itemCount: number, isRunning = false): number {
    const occupied = Math.max(0, itemCount) + (isRunning ? 1 : 0);
    if (occupied === 0) return 4;
    const remainder = occupied % 4;
    return remainder === 0 ? 0 : 4 - remainder;
}
