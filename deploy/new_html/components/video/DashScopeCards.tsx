












import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    ImagePlus, X, Wand2, Layers, Sparkles, Move, RotateCcw,
    Film, Play, Volume2, Hash, Maximize2, Image as ImageIcon,
} from 'lucide-react';
import type {
    DashScopeVideoParams, DashScopeVideoModel,
    SeedanceMediaInput, KlingMode, KlingSubModel,
    ViduSubModel, DashScopeResolution, DashScopeAspectRatio, HappyHorseRatio,
    ViduResolution, HhResolution, HhRatio,
} from '../../services/videoModelService';
import { getModelDisplayName } from '../../services/videoModelService';
import { secureApiUrl } from '../../services/httpClient';
import {
    VIDEO_CONTROL_INPUT_CLASS,
    VIDEO_CONTROL_PILL_CLASS,
    VIDEO_CONTROL_ROW_CLASS,
    VIDEO_CONTROL_SELECT_CLASS,
} from './videoControlStyles';
import { VideoControlPopover } from './VideoControlPopover';
import { VideoDurationControl } from './VideoDurationControl';
import { ModelPicker, type ModelPickerOption } from '../ModelPicker';

const VIDU_MODEL_PICKER_OPTIONS: readonly ModelPickerOption<ViduSubModel>[] = [
    { value: 'q3-mix', label: 'Vidu Q3 Mix · 多参考模型', description: '多参考素材融合优先', group: '在线 API' },
    { value: 'q3', label: 'Vidu Q3 · 全能模型', description: '平衡质量、速度和音频能力', group: '在线 API' },
    { value: 'q3-pro', label: 'Vidu Q3 Pro · 高质量模型', description: '画面质量优先', group: '在线 API' },
    { value: 'q3-turbo', label: 'Vidu Q3 Turbo · 快速模型', description: '速度优先，兼容首尾帧', group: '在线 API' },
    { value: 'q2', label: 'Vidu Q2 · 标准模型', description: '标准视频生成', group: '在线 API' },
    { value: 'q2-pro', label: 'Vidu Q2 Pro · 高质量模型', description: 'Q2 系列质量优先', group: '在线 API' },
    { value: 'q2-turbo', label: 'Vidu Q2 Turbo · 快速模型', description: 'Q2 系列速度优先', group: '在线 API' },
] as const;



type Theme = {
    name: string;
    accent: string;
    accentText: string;
    accentBorder: string;
    accentBg: string;
    accentBgStrong: string;
    gradient: string;
    badge: string;
};

const THEMES: Record<DashScopeVideoModel, Theme> = {
    Kling: {
        name: getModelDisplayName('Kling'),
        accent: '#3B7BE5',
        accentText: 'text-sky-300',
        accentBorder: 'border-sky-500/40',
        accentBg: 'bg-sky-500/10',
        accentBgStrong: 'bg-sky-600 hover:bg-sky-500',
        gradient: 'from-sky-500/15 via-blue-500/10 to-cyan-400/15',
        badge: 'bg-sky-500/20 text-sky-200 border-sky-500/30',
    },
    Vidu: {
        name: getModelDisplayName('Vidu'),
        accent: '#8B6BFF',
        accentText: 'text-purple-300',
        accentBorder: 'border-purple-500/40',
        accentBg: 'bg-purple-500/10',
        accentBgStrong: 'bg-purple-600 hover:bg-purple-500',
        gradient: 'from-purple-500/15 via-fuchsia-500/10 to-violet-400/15',
        badge: 'bg-purple-500/20 text-purple-200 border-purple-500/30',
    },
    HappyHorse: {
        name: getModelDisplayName('HappyHorse'),
        accent: '#FF6A3D',
        accentText: 'text-orange-300',
        accentBorder: 'border-orange-500/40',
        accentBg: 'bg-orange-500/10',
        accentBgStrong: 'bg-orange-600 hover:bg-orange-500',
        gradient: 'from-orange-500/15 via-amber-500/10 to-rose-400/15',
        badge: 'bg-orange-500/20 text-orange-200 border-orange-500/30',
    },
};



interface ShellProps {
    theme: Theme;
    subtitle: string;
    children: React.ReactNode;
}




const DashScopeCardShell: React.FC<ShellProps> = ({ theme, subtitle, children }) => (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-card" data-testid="jimeng-video-composer">
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3" aria-label={`${theme.name} · ${subtitle}`}>
            {children}
        </div>
    </div>
);



interface ImageSlotProps {
    media?: SeedanceMediaInput;
    placeholder: string;
    accentBorder: string;
    accentBg: string;
    onUploadClick: () => void;
    onClear?: () => void;
    onPreview?: (url: string) => void;
}

const ImageSlot: React.FC<ImageSlotProps> = ({
    media, placeholder, accentBorder, accentBg,
    onUploadClick, onClear, onPreview,
}) => {
    const hasImage = !!media && (media.url || media.file_id);



    const previewUrl = media?.url || '';

    if (!hasImage) {
        return (
            <button
                type="button"
                onClick={onUploadClick}
                className={`relative aspect-video w-full rounded border border-dashed ${accentBorder} ${accentBg} hover:opacity-90 transition-opacity flex flex-col items-center justify-center text-n300`}
            >
                <ImagePlus className="w-5 h-5 mb-1" />
                <span className="text-[10px]">{placeholder}</span>
            </button>
        );
    }
    return (
        <div className={`relative aspect-video w-full rounded border ${accentBorder} overflow-hidden bg-black group`}>
            {previewUrl ? (
                <img
                    src={previewUrl}
                    className="w-full h-full object-contain cursor-zoom-in"
                    onClick={() => onPreview?.(previewUrl)}
                />
            ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-n100 text-[10px] px-2">
                    <ImageIcon className="w-5 h-5 mb-1" />
                    <span className="truncate w-full text-center">{media?.file_id || '已选'}</span>
                </div>
            )}
            <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {previewUrl && (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onPreview?.(previewUrl); }}
                        className="p-1 bg-n900/50 hover:bg-n900/50 rounded"
                        title="放大"
                    >
                        <Maximize2 className="w-2.5 h-2.5 text-white" />
                    </button>
                )}
                {onClear && (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onClear(); }}
                        className="p-1 bg-n900/50 hover:bg-danger rounded"
                        title="移除"
                    >
                        <X className="w-2.5 h-2.5 text-white" />
                    </button>
                )}
            </div>
        </div>
    );
};




interface CompactImageSlotProps {
    media?: SeedanceMediaInput;
    label: string;
    accentBorder: string;
    accentBg: string;
    onUploadClick: () => void;
    onClear?: () => void;
    onPreview?: (url: string) => void;
}

const CompactImageSlot: React.FC<CompactImageSlotProps> = ({
    media, label, accentBorder, accentBg,
    onUploadClick, onClear, onPreview,
}) => {
    const hasImage = !!media && (media.url || media.file_id);



    const previewUrl = media?.url || '';
    return (
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-n300 shrink-0 w-10">{label}</span>
            {hasImage ? (
                <div className={`relative w-20 h-14 shrink-0 rounded border ${accentBorder} overflow-hidden bg-black group`}>
                    {previewUrl ? (
                        <img
                            src={previewUrl}
                            className="w-full h-full object-cover cursor-zoom-in"
                            onClick={() => onPreview?.(previewUrl)}
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-[9px] text-n100 px-1 truncate">
                            {media?.file_id || '已选'}
                        </div>
                    )}
                    {onClear && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onClear(); }}
                            className="absolute top-0 right-0 p-0.5 bg-n900/50 hover:bg-danger opacity-0 group-hover:opacity-100 transition-opacity"
                            title="移除"
                        >
                            <X className="w-2.5 h-2.5 text-white" />
                        </button>
                    )}
                </div>
            ) : (
                <button
                    type="button"
                    onClick={onUploadClick}
                    className={`w-20 h-14 shrink-0 rounded border border-dashed ${accentBorder} ${accentBg} hover:opacity-90 flex flex-col items-center justify-center text-n300 transition-opacity`}
                >
                    <ImagePlus className="w-3.5 h-3.5 mb-0.5" />
                    <span className="text-[9px]">上传</span>
                </button>
            )}
        </div>
    );
};


interface MultiRefRowProps {
    refs: SeedanceMediaInput[];
    maxCount: number;
    accentBorder: string;
    accentBg: string;
    placeholder?: string;
    onAdd: () => void;
    onRemove: (idx: number) => void;
    onPreview?: (url: string) => void;
}

const MultiRefRow: React.FC<MultiRefRowProps> = ({
    refs, maxCount, accentBorder, accentBg, placeholder = '+ 添加参考图',
    onAdd, onRemove, onPreview,
}) => (
    <div
        className="relative z-10 flex shrink-0 items-center gap-1 overflow-x-auto border-t border-n40 bg-n0 pt-2 pb-1"
        data-testid="dashscope-reference-row"
    >
        {refs.map((m, idx) => {

            const url = m.url || '';
            return (
                <div key={idx} className={`relative w-14 h-14 shrink-0 rounded border ${accentBorder} overflow-hidden bg-black group`}>
                    {url ? (
                        <img src={url} className="w-full h-full object-cover cursor-zoom-in" onClick={() => onPreview?.(url)} />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-[9px] text-n100">
                            #{idx + 1}
                        </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 text-center text-[8px] bg-n900/50 text-white">
                        [Image {idx + 1}]
                    </div>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
                        className="absolute top-0 right-0 p-0.5 bg-n900/50 hover:bg-danger opacity-0 group-hover:opacity-100"
                        title="移除"
                    >
                        <X className="w-2.5 h-2.5 text-white" />
                    </button>
                </div>
            );
        })}
        {refs.length < maxCount && (
            <button
                type="button"
                onClick={onAdd}
                className={`w-14 h-14 shrink-0 rounded border border-dashed ${accentBorder} ${accentBg} hover:opacity-90 flex flex-col items-center justify-center text-n300 text-[8px] leading-tight px-1`}
                title={placeholder}
            >
                <ImagePlus className="w-3 h-3 mb-0.5" />
                {refs.length}/{maxCount}
            </button>
        )}
    </div>
);


const inputCls = 'bg-n0 border border-n40 text-[11px] text-n800 rounded px-1.5 py-0.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
const labelCls = 'flex items-center gap-1 text-[10px] text-n300';



function splitMedia(media: SeedanceMediaInput[]) {
    const images = (media || []).filter(m => m.kind === 'image');
    const first = images.find(m => m.role === 'first_frame');
    const last = images.find(m => m.role === 'last_frame');
    const refs = images.filter(m => m !== first && m !== last);
    return { first, last, refs };
}

function patchMediaRole(
    media: SeedanceMediaInput[],
    role: 'first_frame' | 'last_frame' | 'reference_image' | undefined,
    next: SeedanceMediaInput | null,
    idx?: number,
): SeedanceMediaInput[] {
    const out = (media || []).filter(m => {
        if (role === 'first_frame' || role === 'last_frame') return m.role !== role;
        if (role === 'reference_image' && idx !== undefined) return true;
        return true;
    });
    if (next) out.push({ ...next, role });
    return out;
}





export interface DashScopePromptEditorProps {
    params: DashScopeVideoParams;
    onChange: (next: DashScopeVideoParams) => void;
    disabled?: boolean;
    placeholder?: string;
}

export interface DashScopeCardProps {
    params: DashScopeVideoParams;
    onChange: (next: DashScopeVideoParams) => void;

    onPickImage: (cb: (m: SeedanceMediaInput) => void) => void;

    onPreviewImage?: (url: string) => void;
    disabled?: boolean;

    PromptEditor?: React.FC<DashScopePromptEditorProps>;
}



export const KlingCard: React.FC<DashScopeCardProps> = (props) => {
    const { params, onChange, onPickImage, onPreviewImage, disabled } = props;
    const theme = THEMES.Kling;
    const { first, last, refs } = useMemo(() => splitMedia(params.media_inputs || []), [params.media_inputs]);





    type Mode = 'auto' | 'omni' | 'multi';
    const currentMode: Mode = useMemo(() => {
        if (params.kling_multi_shot) return 'multi';
        if (params.kling_active_mode === 'omni') return 'omni';
        if (params.kling_active_mode === 'multi') return 'multi';
        return 'auto';
    }, [params.kling_active_mode, params.kling_multi_shot]);

    const switchMode = useCallback((m: Mode) => {
        if (m === 'multi') {
            onChange({
                ...params,
                kling_active_mode: 'multi',
                kling_multi_shot: true,
                kling_shot_type: params.kling_shot_type || 'intelligence',
                kling_multi_prompt: params.kling_multi_prompt || [],
                media_inputs: [],
                sub_model_kling: 'standard',
            });
            return;
        }
        if (m === 'omni') {


            const fromFirst = first ? [{ ...first, role: 'reference_image' as const, file_id: first.file_id }] : [];
            const fromLast = last ? [{ ...last, role: 'reference_image' as const, file_id: last.file_id }] : [];
            const keptRefs = refs.map(r => ({ ...r, role: 'reference_image' as const }));
            onChange({
                ...params,
                kling_active_mode: 'omni',
                kling_multi_shot: false,
                media_inputs: [...fromFirst, ...fromLast, ...keptRefs],
                sub_model_kling: 'omni',
            });
            return;
        }



        const allImgs = [
            ...(first ? [{ ...first, role: 'first_frame' as const }] : []),
            ...(last ? [{ ...last, role: 'last_frame' as const }] : []),
            ...refs,
        ];
        onChange({
            ...params,
            kling_active_mode: 'auto',
            kling_multi_shot: false,
            media_inputs: allImgs,
            sub_model_kling: 'standard',
        });
    }, [params, first, last, refs, onChange]);

    const addRef = useCallback(() => {
        onPickImage((m) => {
            const next = [...(params.media_inputs || []), { ...m, role: 'reference_image' as const }];
            onChange({
                ...params,
                sub_model_kling: 'omni',
                media_inputs: next.slice(0, 9),
            });
        });
    }, [params, onChange, onPickImage]);

    const removeRef = useCallback((idx: number) => {

        const target = refs[idx];
        if (!target) return;
        const absIdx = (params.media_inputs || []).indexOf(target);
        if (absIdx < 0) return;
        const next = (params.media_inputs || []).filter((_, i) => i !== absIdx);
        onChange({ ...params, media_inputs: next });
    }, [params, refs, onChange]);







    const autoSubLabel = first && last ? '首尾帧过渡' : first ? '图生视频' : '文生视频';
    const showAspect = currentMode === 'omni' || currentMode === 'multi'
        || (currentMode === 'auto' && !first);
    const dispatchSubtitle = currentMode === 'auto' ? autoSubLabel
        : currentMode === 'omni' ? 'omni 多参考'
            : '多镜头';
    const isCustomMulti = currentMode === 'multi' && params.kling_shot_type === 'customize';

    return (
        <DashScopeCardShell theme={theme} subtitle={`Kling · ${dispatchSubtitle}`}>

            {props.PromptEditor ? (
                <props.PromptEditor
                    params={params}
                    onChange={onChange}
                    disabled={!!(disabled || isCustomMulti)}
                    placeholder={
                        isCustomMulti
                            ? '自定义分镜模式下 prompt 不生效，请在下方为每个分镜单独写'
                            : '描述画面内容、动作、镜头语言；@ 选素材...'
                    }
                />
            ) : (
                <textarea
                    value={params.prompt || ''}
                    onChange={(e) => onChange({ ...params, prompt: e.target.value })}
                    placeholder={
                        isCustomMulti
                            ? '自定义分镜模式下 prompt 不生效，请在下方为每个分镜单独写'
                            : '描述画面内容、动作、镜头语言...'
                    }
                    disabled={disabled || isCustomMulti}
                    className={`w-full bg-n0 border border-n40 rounded px-2 py-1 text-[11px] text-n700 focus:border-sky-500 focus:outline-none resize-none min-h-[140px] flex-1 disabled:opacity-50`}
                />
            )}


            {currentMode === 'omni' && (
                <MultiRefRow
                    refs={refs}
                    maxCount={7}
                    accentBorder={theme.accentBorder}
                    accentBg={theme.accentBg}
                    placeholder="+ 参考图 (omni 最多 7 张)"
                    onAdd={addRef}
                    onRemove={removeRef}
                    onPreview={onPreviewImage}
                />
            )}


            {currentMode === 'multi' && (
                <VideoControlPopover title="多镜头设置" label="编辑分镜" disabled={disabled} width={560}>
                    <label className={`${VIDEO_CONTROL_PILL_CLASS} self-start`}>
                        <Sparkles className="h-3 w-3" />
                        <select
                            value={params.kling_shot_type || 'intelligence'}
                            onChange={event => onChange({ ...params, kling_shot_type: event.target.value as 'intelligence' | 'customize' })}
                            disabled={disabled}
                            className={VIDEO_CONTROL_SELECT_CLASS}
                            aria-label="Kling 分镜模式"
                        >
                            <option value="intelligence">智能分镜</option>
                            <option value="customize">自定义分镜</option>
                        </select>
                    </label>

                    {params.kling_shot_type === 'customize' && (
                        <div className="flex flex-col gap-1.5 max-h-[160px] overflow-y-auto pr-1">
                            {(params.kling_multi_prompt || []).map((seg, idx) => (
                                <div key={idx} className="flex items-center gap-1 bg-n20 rounded px-1.5 py-1">
                                    <span className="text-[10px] text-sky-300 shrink-0 w-12">分镜 {seg.index}</span>
                                    <textarea
                                        value={seg.prompt}
                                        onChange={(e) => {
                                            const next = [...(params.kling_multi_prompt || [])];
                                            next[idx] = { ...next[idx], prompt: e.target.value };
                                            onChange({ ...params, kling_multi_prompt: next });
                                        }}
                                        placeholder="本镜头的画面描述"
                                        rows={2}
                                        disabled={disabled}
                                        className="flex-1 bg-n0 border border-n40 rounded px-1.5 py-0.5 text-[11px] text-n700 focus:border-sky-500 focus:outline-none resize-none"
                                    />
                                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                                        <input
                                            type="number" min={1} max={params.duration || 15} step={1}
                                            value={seg.duration}
                                            onChange={(e) => {
                                                const next = [...(params.kling_multi_prompt || [])];
                                                next[idx] = { ...next[idx], duration: Number(e.target.value) };
                                                onChange({ ...params, kling_multi_prompt: next });
                                            }}
                                            disabled={disabled}
                                            className={`${inputCls} w-12`}
                                        />
                                        <button
                                            type="button"
                                            disabled={disabled}
                                            onClick={() => {
                                                const next = (params.kling_multi_prompt || []).filter((_, i) => i !== idx);
                                                onChange({ ...params, kling_multi_prompt: next });
                                            }}
                                            className="text-[9px] text-danger hover:text-danger"
                                        >移除</button>
                                    </div>
                                </div>
                            ))}
                            {(params.kling_multi_prompt?.length || 0) < 6 && (
                                <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => {
                                        const arr = [...(params.kling_multi_prompt || [])];
                                        arr.push({ index: arr.length + 1, prompt: '', duration: 5 });
                                        onChange({ ...params, kling_multi_prompt: arr });
                                    }}
                                    className="text-[10px] text-primary hover:text-b400 border border-dashed border-b75 rounded py-1 hover:bg-b75"
                                >+ 添加分镜 ({(params.kling_multi_prompt?.length || 0)}/6)</button>
                            )}
                        </div>
                    )}
                </VideoControlPopover>
            )}

            <div className={VIDEO_CONTROL_ROW_CLASS} data-testid="kling-control-row">
                <label className={VIDEO_CONTROL_PILL_CLASS}>
                    <Layers className="h-3 w-3 text-primary" />
                    <select value={currentMode} onChange={event => switchMode(event.target.value as Mode)} disabled={disabled} className={VIDEO_CONTROL_SELECT_CLASS} aria-label="Kling 生成模式">
                        <option value="auto">自动模式</option>
                        <option value="omni">Omni 多参考</option>
                        <option value="multi">Multi 多镜头</option>
                    </select>
                </label>
                <label className={VIDEO_CONTROL_PILL_CLASS}>
                    <Sparkles className="h-3 w-3" />
                    <select value={params.mode || 'std'} onChange={event => onChange({ ...params, mode: event.target.value as KlingMode })} disabled={disabled} className={VIDEO_CONTROL_SELECT_CLASS} aria-label="Kling 清晰度">
                        <option value="std">720P</option>
                        <option value="pro">1080P</option>
                    </select>
                </label>
                <VideoDurationControl
                    value={params.duration ?? 5}
                    min={3}
                    max={15}
                    onChange={duration => onChange({ ...params, duration })}
                    disabled={disabled}
                    ariaLabel="Kling 时长"
                />
                {showAspect && (
                    <label className={VIDEO_CONTROL_PILL_CLASS}>
                        <RotateCcw className="h-3 w-3" />
                        <select value={params.aspect_ratio || '16:9'} onChange={event => onChange({ ...params, aspect_ratio: event.target.value as DashScopeAspectRatio })} disabled={disabled} className={VIDEO_CONTROL_SELECT_CLASS} aria-label="Kling 比例">
                            <option value="16:9">16:9</option>
                            <option value="9:16">9:16</option>
                            <option value="1:1">1:1</option>
                        </select>
                    </label>
                )}
                <label className={VIDEO_CONTROL_PILL_CLASS}>
                    <input type="checkbox" checked={!!params.audio} onChange={event => onChange({ ...params, audio: event.target.checked })} disabled={disabled} />
                    <Volume2 className="h-3 w-3" />有声
                </label>
                <label className={VIDEO_CONTROL_PILL_CLASS}>
                    <input type="checkbox" checked={!!params.watermark} onChange={event => onChange({ ...params, watermark: event.target.checked })} disabled={disabled} />水印
                </label>
                <span className={`${VIDEO_CONTROL_PILL_CLASS} text-n100`}><Film className="h-3 w-3" />{params.sub_model_kling === 'omni' ? 'omni · 多参考' : 'standard'}</span>
            </div>
        </DashScopeCardShell>
    );
};



export const ViduCard: React.FC<DashScopeCardProps> = (props) => {
    const { params, onChange, onPickImage, onPreviewImage, disabled } = props;
    const theme = THEMES.Vidu;
    const { first, last, refs } = useMemo(() => splitMedia(params.media_inputs || []), [params.media_inputs]);





    type Mode = 'reference' | 'startend';
    const currentMode: Mode = first && last ? 'startend' : 'reference';



    useEffect(() => {
        const hasPair = !!(first && last);
        const m = params.sub_model_vidu || 'q3';
        if (hasPair && !m.includes('turbo')) {
            const turbo = (m.includes('q3') ? 'q3-turbo' : 'q2-turbo') as ViduSubModel;
            onChange({ ...params, sub_model_vidu: turbo });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [first, last]);

    const addRef = useCallback(() => {
        onPickImage((m) => {
            const newRefs = [...refs, { ...m, role: 'reference_image' as const }];
            const keep = (params.media_inputs || []).filter(x => x.role === 'first_frame' || x.role === 'last_frame');
            onChange({
                ...params,
                media_inputs: [...keep, ...newRefs.slice(0, 7)],
            });
        });
    }, [refs, params, onChange, onPickImage]);

    const removeRef = useCallback((idx: number) => {
        const target = refs[idx];
        if (!target) return;
        const absIdx = (params.media_inputs || []).indexOf(target);
        if (absIdx < 0) return;
        onChange({
            ...params,
            media_inputs: (params.media_inputs || []).filter((_, i) => i !== absIdx),
        });
    }, [params, refs, onChange]);


    const subModel = params.sub_model_vidu || 'q3';
    const maxDuration = subModel.startsWith('q3') ? 16 : 10;
    const supportsAudio = subModel.startsWith('q3');
    const subtitle = currentMode === 'startend' ? '首尾帧通道' : (refs.length > 0 ? '参考生视频' : '待上传');

    return (
        <DashScopeCardShell theme={theme} subtitle={`Vidu · ${subtitle}`}>

            {props.PromptEditor ? (
                <props.PromptEditor
                    params={params}
                    onChange={onChange}
                    disabled={disabled}
                    placeholder="描述参考主体如何融合到场景中；@ 选素材..."
                />
            ) : (
                <textarea
                    value={params.prompt || ''}
                    onChange={(e) => onChange({ ...params, prompt: e.target.value })}
                    placeholder="描述参考主体如何融合到场景中..."
                    disabled={disabled}
                    className="w-full bg-n0 border border-n40 rounded px-2 py-1 text-[11px] text-n700 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none resize-none min-h-[140px] flex-1"
                />
            )}


            <div className="flex items-center gap-2 text-[10px] text-n300">
                <span className="shrink-0">参考</span>
                <MultiRefRow
                    refs={refs}
                    maxCount={7}
                    accentBorder={theme.accentBorder} accentBg={theme.accentBg}
                    placeholder={currentMode === 'startend'
                        ? '+ 参考图（已通过分镜启用首尾帧通道）'
                        : '+ 参考图 (Vidu 1-7 张)'}
                    onAdd={addRef} onRemove={removeRef}
                    onPreview={onPreviewImage}
                />
            </div>


            <div className={VIDEO_CONTROL_ROW_CLASS} data-testid="vidu-control-row">
                <ModelPicker
                    value={subModel}
                    options={VIDU_MODEL_PICKER_OPTIONS}
                    onChange={model => onChange({ ...params, sub_model_vidu: model })}
                    disabled={disabled}
                    compact
                    className="max-w-[180px]"
                    ariaLabel="Vidu 子模型"
                    title="Vidu 子模型"
                    kind="video"
                />
                <VideoDurationControl
                    value={params.duration ?? 5}
                    min={1}
                    max={maxDuration}
                    onChange={duration => onChange({ ...params, duration })}
                    disabled={disabled}
                    ariaLabel="Vidu 时长"
                />
                <label className={VIDEO_CONTROL_PILL_CLASS}>
                    <Maximize2 className="h-3 w-3" />
                    <select
                        value={params.vidu_resolution || '720P'}
                        onChange={(e) => {
                            const resolution = e.target.value as ViduResolution;
                            const defaultSize: Record<ViduResolution, string> = {
                                '540P': '1024*576',
                                '720P': '1280*720',
                                '1080P': '1920*1080',
                            };
                            onChange({ ...params, vidu_resolution: resolution, vidu_size: defaultSize[resolution] });
                        }}
                        disabled={disabled}
                        className={VIDEO_CONTROL_SELECT_CLASS}
                        aria-label="Vidu 分辨率/清晰度"
                    >
                        <option value="540P">540P</option>
                        <option value="720P">720P</option>
                        <option value="1080P">1080P</option>
                    </select>
                </label>
                <label className={VIDEO_CONTROL_PILL_CLASS}>
                    <input
                        type="checkbox"
                        checked={!!params.watermark}
                        onChange={(e) => onChange({ ...params, watermark: e.target.checked })}
                        disabled={disabled}
                    />
                    水印
                </label>
            <VideoControlPopover title="高级设置" label="更多" disabled={disabled} width={340}>
                <div className="grid grid-cols-2 gap-3">
                    <label className={labelCls}>
                        size
                        <input
                            type="text"
                            value={params.vidu_size || ''}
                            onChange={(e) => onChange({ ...params, vidu_size: e.target.value })}
                            placeholder="1280*720"
                            disabled={disabled}
                            className={`${inputCls} w-20`}
                            aria-label="像素尺寸"
                        />
                    </label>
                    <label className={labelCls}>
                        种子
                        <input
                            type="number" min={0} max={2147483647} step={1}
                            value={params.vidu_seed ?? ''}
                            onChange={(e) => onChange({
                                ...params,
                                vidu_seed: e.target.value === '' ? undefined : Number(e.target.value),
                            })}
                            placeholder="随机"
                            disabled={disabled}
                            className={`${inputCls} w-20`}
                            aria-label="seed"
                        />
                    </label>
                    <label className={`${labelCls} cursor-pointer ${!supportsAudio ? 'opacity-60' : ''}`}>
                        <input
                            type="checkbox"
                            checked={supportsAudio && !!params.vidu_audio}
                            onChange={(e) => onChange({ ...params, vidu_audio: e.target.checked })}
                            disabled={disabled || !supportsAudio}
                            aria-label="audio"
                        />
                        <Volume2 className="w-2.5 h-2.5" /> 有声 {!supportsAudio && <span className="text-[8px] text-warning">(仅 q3)</span>}
                    </label>
                </div>
            </VideoControlPopover>
            </div>
        </DashScopeCardShell>
    );
};



const HH_RATIOS: HappyHorseRatio[] = ['16:9', '9:16', '3:4', '4:3', '4:5', '5:4', '1:1', '9:21', '21:9'];


function closestHhRatio(w: number, h: number): HappyHorseRatio {
    if (!w || !h) return '16:9';
    const target = w / h;
    let best: HappyHorseRatio = '16:9';
    let bestDiff = Infinity;
    for (const r of HH_RATIOS) {
        const [rw, rh] = r.split(':').map(Number);
        const diff = Math.abs(rw / rh - target);
        if (diff < bestDiff) { bestDiff = diff; best = r; }
    }
    return best;
}

export const HappyHorseCard: React.FC<DashScopeCardProps> = (props) => {
    const { params, onChange, onPickImage, onPreviewImage, disabled } = props;
    const theme = THEMES.HappyHorse;
    const { refs } = useMemo(() => splitMedia(params.media_inputs || []), [params.media_inputs]);



    const userSetRatioRef = useRef(false);
    const firstRefUrl = refs[0]?.url || '';
    useEffect(() => {
        if (userSetRatioRef.current || !firstRefUrl) return;
        const src = firstRefUrl.startsWith('data:') || firstRefUrl.startsWith('blob:')
            ? firstRefUrl
            : secureApiUrl(firstRefUrl, { absolute: true, requireAuth: false });
        const im = new Image();
        im.onload = () => {
            if (userSetRatioRef.current) return;
            const r = closestHhRatio(im.naturalWidth, im.naturalHeight);
            if (r && r !== (params.hh_ratio || '16:9')) onChange({ ...params, hh_ratio: r });
        };
        im.src = src;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [firstRefUrl]);

    const addRef = useCallback(() => {
        onPickImage((m) => {
            onChange({
                ...params,
                media_inputs: [...(params.media_inputs || []), { ...m, role: 'reference_image' as const }].slice(0, 9),
            });
        });
    }, [params, onChange, onPickImage]);

    const removeRef = useCallback((idx: number) => {
        onChange({
            ...params,
            media_inputs: (params.media_inputs || []).filter((_, i) => i !== idx),
        });
    }, [params, onChange]);

    return (
        <DashScopeCardShell theme={theme} subtitle="HappyHorse · 多图参考生">
            <div className="flex items-center gap-1 text-[10px] text-n100">
                <Sparkles className="w-3 h-3" />
                提示词中用 <span className={`${theme.accentText} font-mono mx-0.5`}>[Image 1]</span> 等引用第 N 张参考图
            </div>

            {props.PromptEditor ? (
                <props.PromptEditor
                    params={params}
                    onChange={onChange}
                    disabled={disabled}
                    placeholder="[Image 1] 中身着红衣的女性，... 也可 @ 选素材"
                />
            ) : (
                <textarea
                    value={params.prompt || ''}
                    onChange={(e) => onChange({ ...params, prompt: e.target.value })}
                    placeholder="[Image 1] 中身着红衣的女性，... [Image 2] 中的折扇..."
                    disabled={disabled}
                    className="w-full bg-n0 border border-n40 rounded px-2 py-1 text-[11px] text-n700 focus:border-orange-500 focus:outline-none resize-none min-h-[140px] flex-1"
                />
            )}

            <MultiRefRow
                refs={refs}
                maxCount={9}
                accentBorder={theme.accentBorder} accentBg={theme.accentBg}
                placeholder="+ 参考图 (1-9 张)"
                onAdd={addRef} onRemove={removeRef}
                onPreview={onPreviewImage}
            />

            <div className={VIDEO_CONTROL_ROW_CLASS} data-testid="happyhorse-control-row">
                <VideoDurationControl
                    value={params.hh_duration ?? 5}
                    min={3}
                    max={15}
                    onChange={hh_duration => onChange({ ...params, hh_duration })}
                    disabled={disabled}
                    ariaLabel="时长"
                />
                <label className={VIDEO_CONTROL_PILL_CLASS}>
                    <Maximize2 className="h-3 w-3" />
                    <select
                        value={params.hh_resolution || '1080P'}
                        onChange={(e) => onChange({ ...params, hh_resolution: e.target.value as HhResolution })}
                        disabled={disabled}
                        className={VIDEO_CONTROL_SELECT_CLASS}
                        aria-label="分辨率"
                    >
                        <option value="720P">720P</option>
                        <option value="1080P">1080P</option>
                    </select>
                </label>
                <label className={VIDEO_CONTROL_PILL_CLASS}>
                    <RotateCcw className="h-3 w-3" />
                    <select
                        value={params.hh_ratio || '16:9'}
                        onChange={(e) => { userSetRatioRef.current = true; onChange({ ...params, hh_ratio: e.target.value as HhRatio }); }}
                        disabled={disabled}
                        className={VIDEO_CONTROL_SELECT_CLASS}
                        aria-label="比例"
                    >
                        <option value="16:9">16:9 横版宽</option>
                        <option value="9:16">9:16 竖版</option>
                        <option value="4:3">4:3</option>
                        <option value="3:4">3:4</option>
                        <option value="1:1">1:1 方形</option>
                        <option value="4:5">4:5</option>
                        <option value="5:4">5:4</option>
                        <option value="21:9">21:9 影院宽</option>
                        <option value="9:21">9:21</option>
                    </select>
                </label>
            <VideoControlPopover title="高级设置" label="更多" disabled={disabled} width={340}>
                <div className="grid grid-cols-2 gap-3">
                    <label className={labelCls}>
                        <input
                            type="checkbox"
                            checked={params.hh_watermark !== false}
                            onChange={(e) => onChange({ ...params, hh_watermark: e.target.checked })}
                            disabled={disabled}
                            aria-label="watermark"
                        />
                        水印（"Happy Horse" 右下角）
                    </label>
                    <label className={labelCls}>
                        种子
                        <input
                            type="number" min={0} max={2147483647} step={1}
                            value={params.hh_seed ?? ''}
                            onChange={(e) => onChange({
                                ...params,
                                hh_seed: e.target.value === '' ? undefined : Number(e.target.value),
                            })}
                            placeholder="随机"
                            disabled={disabled}
                            className={`${inputCls} w-20`}
                            aria-label="seed"
                        />
                    </label>
                </div>
            </VideoControlPopover>
            </div>
        </DashScopeCardShell>
    );
};



export const DashScopeVideoCard: React.FC<DashScopeCardProps> = (props) => {
    if (props.params.model === 'Kling') return <KlingCard {...props} />;
    if (props.params.model === 'Vidu') return <ViduCard {...props} />;
    if (props.params.model === 'HappyHorse') return <HappyHorseCard {...props} />;
    return null;
};
