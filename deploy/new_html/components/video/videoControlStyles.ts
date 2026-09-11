/**
 * Shared Jimeng-style controls for every video provider panel.
 *
 * Core values stay visible as compact pills. Native selects/details only open
 * after an explicit click, so cards do not reserve permanent space for option
 * grids while each provider can still expose its real capability set.
 */
export const VIDEO_CONTROL_BAR_CLASS =
    'flex shrink-0 flex-wrap items-center gap-1.5 border-t border-n40 bg-n20/45 px-3 py-2';

export const VIDEO_CONTROL_ROW_CLASS =
    'flex flex-wrap items-center gap-1.5 rounded-xl border border-n40 bg-n20/45 p-2';

export const VIDEO_CONTROL_PILL_CLASS =
    'inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-full border border-n40 bg-n0 px-3 py-1.5 text-[10px] text-n500 shadow-sm transition-colors hover:border-primary hover:bg-p50 disabled:cursor-not-allowed disabled:opacity-40';

export const VIDEO_CONTROL_SELECT_CLASS =
    'min-w-0 max-w-[170px] cursor-pointer border-0 bg-transparent p-0 text-[10px] font-semibold text-n800 outline-none focus:ring-0 disabled:cursor-not-allowed';

export const VIDEO_CONTROL_INPUT_CLASS =
    'w-12 border-0 bg-transparent p-0 text-center text-[10px] font-semibold text-n800 outline-none focus:ring-0 disabled:cursor-not-allowed';

export const VIDEO_CONTROL_POPOVER_CLASS =
    'absolute bottom-10 left-0 z-30 rounded-2xl border border-n40 bg-n0 p-3 shadow-bottom';
