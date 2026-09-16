import React, { useEffect, useRef, useState } from 'react';
import { SeedreamSourceBadge } from './SeedreamSourceBadge';
import { createPortal } from 'react-dom';
import { AlertCircle, Film, ImagePlus, Info, Loader2, Maximize2, Plus, Settings2, Upload, Volume2, X } from 'lucide-react';
import { uploadAudio, uploadImage, uploadVideoFile } from '@runtime/videoMediaService';
import { getModelDisplayName, getSeedanceOutputError, normalizeSeedanceOutputResolution, type SeedanceMediaInput, type SeedanceParams } from '../services/videoModelService';
import { removeMediaInput, type SeedanceAssetCandidate } from '../utils/seedanceMedia';
import { audioDurationLabel, probeUploadedAudioDuration, seedanceAudioBudget, seedanceAudioError } from '../utils/seedanceAudio';
import { SeedanceMentionPromptEditor } from './SeedanceMentionPromptEditor';
import { SeedanceAssetPickerModal } from './SeedanceAssetPickerModal';
import { VideoControlPopover } from './video/VideoControlPopover';
import { VideoDurationControl } from './video/VideoDurationControl';
import { VIDEO_CONTROL_BAR_CLASS, VIDEO_CONTROL_PILL_CLASS, VIDEO_CONTROL_SELECT_CLASS } from './video/videoControlStyles';

interface Props {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    disabled?: boolean;
    candidates: SeedanceAssetCandidate[];
    autoOpenMentionOnMount?: boolean;
    onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
    onUsePreviousVideoAudio?: () => void;
    previousVideoAudioBusy?: boolean;
    audioReferenceNotice?: string;
    supportsMultimodal?: boolean;
    durationControl?: React.ReactNode;
}

const RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const;
const LABELS = { agent_plan: 'Seedance15', standard: 'Seedance2', fast: 'Seedance2Fast', mini: 'Seedance2Mini', jimeng_mini: 'JimengSeedance2' } as const;

export const SeedanceMultimodalPanel: React.FC<Props> = ({
    value, onChange, disabled, candidates, autoOpenMentionOnMount, onPreviewMedia,
    onUsePreviousVideoAudio, previousVideoAudioBusy, audioReferenceNotice,
    supportsMultimodal = true, durationControl,
}) => {
    const [uploadBusy, setUploadBusy] = useState(false);
    const [error, setError] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);
    const [targetFrame, setTargetFrame] = useState<'first_frame' | 'last_frame' | undefined>();
    const [promptModalOpen, setPromptModalOpen] = useState(false);
    const firstInput = useRef<HTMLInputElement>(null);
    const lastInput = useRef<HTMLInputElement>(null);
    const imageInput = useRef<HTMLInputElement>(null);
    const videoInput = useRef<HTMLInputElement>(null);
    const audioInput = useRef<HTMLInputElement>(null);
    const current = useRef(value);
    current.current = value;
    const isAgentPlan = value.sub_model === 'agent_plan';
    const isJimeng = value.sub_model === 'jimeng_mini';
    const omni = supportsMultimodal && !isAgentPlan;
    const images = value.media_inputs.filter(item => item.kind === 'image');
    const audios = value.media_inputs.filter(item => item.kind === 'audio');
    const trimAudio = value.reference_audio_policy === 'trim_to_15';
    const audioBudget = seedanceAudioBudget(audios.map(item => item.duration_seconds ?? NaN));
    const videos = value.media_inputs.filter(item => item.kind === 'video');
    const mode = isJimeng ? 'reference' : !omni ? 'first_last' : value.reference_mode
        || (images.some(item => item.role === 'first_frame' || item.role === 'last_frame') ? 'first_last' : 'reference');
    const first = images.find(item => item.role === 'first_frame') || images.find(item => item.role !== 'last_frame');
    const last = images.find(item => item.role === 'last_frame') || images.find(item => item !== first);
    const imageLimit = mode === 'first_last' ? 2 : 9;
    const hint = mode === 'reference'
        ? `最多输入 ${isJimeng ? 12 : 15} 个参考素材（图片 9、视频 3、配音 3）；输入文字，或输入 @ 选择参考内容。`
        : '最多 2 张图片：首帧 + 可选尾帧；输入文字描述动作和运镜，或输入 @ 引用文字。';
    const audioNotice = audioReferenceNotice || (!omni ? '参考配音会保留在卡片中，当前通道提交时不发送。' : '');
    const resolution = normalizeSeedanceOutputResolution(value.resolution);
    const ratio = value.ratio || (isAgentPlan || isJimeng ? '16:9' : 'adaptive');
    const editorCandidates = mode === 'first_last' ? candidates.filter(item => item.kind === 'text') : candidates;
    const patch = (next: Partial<SeedanceParams>) => onChange({ ...current.current, ...next });

    useEffect(() => {
        if (!promptModalOpen) return;
        const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setPromptModalOpen(false); };
        document.addEventListener('keydown', key);
        return () => document.removeEventListener('keydown', key);
    }, [promptModalOpen]);

    const setMode = (nextMode: 'reference' | 'first_last') => {
        let imageIndex = 0;
        patch({
            reference_mode: nextMode,
            media_inputs: current.current.media_inputs.map(item => item.kind !== 'image' ? item : {
                ...item,
                role: nextMode === 'reference' ? 'reference_image'
                    : ++imageIndex === 1 ? 'first_frame' : imageIndex === 2 ? 'last_frame' : undefined,
            }),
        });
    };
    const remove = (index: number) => { if (!disabled) onChange(removeMediaInput(current.current, index)); };
    const acceptReferences = (next: SeedanceParams) => {
        if (isJimeng && next.media_inputs.length > 12) { setError('即梦参考素材总数不能超过 12 个，请保留需要的原素材。'); return; }
        const nextImages = next.media_inputs.filter(item => item.kind === 'image');
        if (nextImages.length > Math.max(imageLimit, images.length) || next.media_inputs.filter(item => item.kind === 'video').length > Math.max(3, videos.length) || next.media_inputs.filter(item => item.kind === 'audio').length > Math.max(3, audios.length)) {
            setError(`当前模式最多支持 ${imageLimit} 张图片、3 段视频和 3 段配音，请减少新增素材。`);
            return;
        }
        setError('');
        onChange(next);
    };

    const upload = async (kind: 'image' | 'video' | 'audio', files: FileList | null, role?: 'first_frame' | 'last_frame') => {
        if (!files?.length || disabled || uploadBusy) return;
        const max = role || (isAgentPlan && kind === 'audio') ? 1
            : Math.max(0, (kind === 'image' ? imageLimit : 3) - current.current.media_inputs.filter(item => item.kind === kind).length);
        setUploadBusy(true);
        setError('');
        const added: SeedanceMediaInput[] = [];
        try {
            for (const file of Array.from(files).slice(0, max)) {
                if (kind === 'image') {
                    const result = await uploadImage(file);
                    added.push({ kind, url: result.url || (result as any).storage_url, role: role || 'reference_image' });
                } else if (kind === 'video') {
                    const result = await uploadVideoFile(file);
                    added.push({ kind, url: result.url || (result as any).storage_url, role: 'reference_video', duration_seconds: result.duration_seconds ?? undefined });
                } else {
                    const duration = await probeUploadedAudioDuration(file);
                    const result = await uploadAudio(file, 0, 5);
                    added.push({ kind, url: result.url, role: 'reference_audio', duration_seconds: duration });
                }
            }
        } catch {
            setError('部分素材上传失败，已上传的素材会保留，请重试失败的文件。');
        } finally {
            // Merge once against the latest edit; a batch must not overwrite its own earlier uploads.
            if (added.length) {
                const latest = current.current;
                let kept = latest.media_inputs;
                if (role) {
                    const oldImages = kept.filter(item => item.kind === 'image');
                    const oldFirst = oldImages.find(item => item.role === 'first_frame') || oldImages.find(item => item.role !== 'last_frame');
                    const target = role === 'first_frame' ? oldFirst
                        : oldImages.find(item => item.role === 'last_frame') || oldImages.find(item => item !== oldFirst);
                    if (target) {
                        patch({ media_inputs: kept.map(item => item === target ? { ...added[0], role } : item) });
                    } else patch({ media_inputs: [...kept, ...added], reference_mode: 'first_last' });
                } else {
                    if (isAgentPlan && kind === 'audio') kept = kept.filter(item => item.kind !== 'audio');
                    patch({ media_inputs: [...kept, ...added] });
                }
            }
            setUploadBusy(false);
        }
    };
    const fileInput = (ref: React.RefObject<HTMLInputElement | null>, kind: 'image' | 'video' | 'audio', role?: 'first_frame' | 'last_frame') =>
        <input ref={ref} type="file" accept={`${kind}/*`} multiple={!role && !(isAgentPlan && kind === 'audio')} hidden
            aria-label={role ? `上传${role === 'first_frame' ? '首帧' : '尾帧'}` : `上传${kind === 'image' ? '参考图片' : kind === 'video' ? '参考视频' : '参考配音'}`}
            onChange={event => { void upload(kind, event.target.files, role); event.target.value = ''; }} />;

    const frame = (media: SeedanceMediaInput | undefined, label: string, ref: React.RefObject<HTMLInputElement | null>) =>
        <div className="relative h-[80px] w-[64px] shrink-0 overflow-hidden rounded-xl border border-n40 bg-n20/60">
            {media ? <>
                <button type="button" title={`预览${label}`} onClick={() => onPreviewMedia?.(media.url, 'image')} className="h-full w-full"><img src={media.url} alt={label} className="h-full w-full object-cover" /></button>
                <span className="pointer-events-none absolute inset-x-0 top-0 bg-white/95 px-0.5"><SeedreamSourceBadge reference={media.file_id || media.url} /></span>
                <button type="button" disabled={disabled || uploadBusy} onClick={() => { setTargetFrame(label === '首帧' ? 'first_frame' : 'last_frame'); setPickerOpen(true); }} className="absolute inset-x-0 bottom-0 bg-n0/95 py-1 text-[9px] text-n700">{label} · 替换</button>
                <button type="button" aria-label={`删除${label}`} disabled={disabled} onClick={() => remove(value.media_inputs.indexOf(media))} className="absolute right-1 top-1 rounded-full bg-n900/65 text-white"><X size={12} /></button>
            </> : <button type="button" title={`添加${label}`} disabled={disabled || uploadBusy} onClick={() => { setTargetFrame(label === '首帧' ? 'first_frame' : 'last_frame'); setPickerOpen(true); }} className="flex h-full w-full flex-col items-center justify-center gap-1 text-n100 hover:text-primary"><ImagePlus size={18} /><span className="text-[10px]">+ {label}</span></button>}
        </div>;
    const referenceList = <div className="space-y-2">
        {value.media_inputs.length === 0 && <p className="text-n100">还没有参考素材，可从素材库或本机添加。</p>}
        {value.media_inputs.map((item, index) => <div key={`${item.url}-${index}`} className="flex items-center gap-2 rounded-xl bg-n20 p-2">
            <button type="button" onClick={() => onPreviewMedia?.(item.url, item.kind)} className="flex h-9 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-n0">
                {item.kind === 'image' ? <img src={item.url} alt="" className="h-full w-full object-cover" /> : item.kind === 'video' ? <Film size={14} /> : <Volume2 size={14} />}
            </button>
            <span className="min-w-0 flex-1 truncate" title={item.url}>{item.url.split('/').pop() || '参考素材'}</span>
            {item.kind === 'image' && <SeedreamSourceBadge reference={item.file_id || item.url} />}
            <button type="button" aria-label={`移除素材 ${index + 1}`} disabled={disabled} onClick={() => remove(index)} className="rounded p-1 text-n100 hover:text-danger"><X size={13} /></button>
        </div>)}
    </div>;
    const validation = isJimeng && value.media_inputs.length > 12 ? '即梦参考素材总数不能超过 12 个。'
        : images.length > imageLimit ? `当前模式最多使用 ${imageLimit} 张图片，多余素材暂存于“素材”中，请移除或切换全能参考。`
        : getSeedanceOutputError(value.sub_model, resolution) || (omni ? seedanceAudioError(value.media_inputs, value.reference_audio_policy) : null) || (
        !isJimeng && images.some(item => item.role === 'last_frame') && !images.some(item => item.role === 'first_frame') ? '请先添加首帧，再使用尾帧。' : '');
    const editor = (expanded = false) => <SeedanceMentionPromptEditor value={value} onChange={acceptReferences}
        candidates={editorCandidates} disabled={disabled} autoOpenOnMount={autoOpenMentionOnMount}
        fillHeight compactFillHeight={!expanded} rows={expanded ? 20 : 7} hideTokensRow={!expanded} openUpward={expanded}
        placeholder={mode === 'reference' ? '输入文字描述，或输入 @ 选择参考内容……' : '描述首帧到尾帧的变化、动作与运镜……'} onPreviewMedia={onPreviewMedia} />;

    return <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-card" data-testid="seedance-jimeng-composer">
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3" data-testid="seedance-composer-content">
            <div className="flex shrink-0 items-center justify-between gap-2">
                <p className="min-w-0 text-[10px] leading-4 text-n100" title={getModelDisplayName(LABELS[value.sub_model])}>{hint}</p>
                <button type="button" onClick={() => setPromptModalOpen(true)} className="inline-flex shrink-0 items-center gap-1 text-[10px] text-primary"><Maximize2 size={12} />放大编辑</button>
            </div>
            <div className="flex min-h-0 flex-1 gap-3" data-testid="seedance-composer-body">
                <div
                    className="flex shrink-0 items-start gap-1 pt-1"
                    data-testid="seedance-media-rail"
                >
                    {mode === 'first_last' ? <>{frame(first, '首帧', firstInput)}{frame(last, '尾帧', lastInput)}</>
                        : <VideoControlPopover title="添加参考内容" dismissKey={pickerOpen} disabled={disabled} hideChevron triggerClassName="flex h-[80px] w-[64px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-n40 bg-n20/70 text-[10px] text-n100 transition hover:border-primary hover:text-primary disabled:opacity-40" label={<><Plus size={18} />参考内容</>}>
                            <button type="button" disabled={disabled} onClick={() => setPickerOpen(true)} className={VIDEO_CONTROL_PILL_CLASS}>从素材库选择</button>
                            <button type="button" disabled={disabled || uploadBusy || images.length >= 9} onClick={() => imageInput.current?.click()} className={VIDEO_CONTROL_PILL_CLASS}>上传图片</button>
                            <button type="button" disabled={disabled || uploadBusy || videos.length >= 3} onClick={() => videoInput.current?.click()} className={VIDEO_CONTROL_PILL_CLASS}>上传视频</button>
                            <p className="text-[10px] text-n100">{hint}</p>
                        </VideoControlPopover>}
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{editor()}</div>
            </div>
            {(value.sub_model === 'standard' && mode === 'reference' || value.portrait_reference_mode) && <label className="shrink-0 text-[11px] leading-5 text-n300">
                <input type="checkbox" className="mr-1" checked={!!value.portrait_reference_mode} disabled={disabled}
                    onChange={event => patch({ portrait_reference_mode: event.target.checked ? 'character_background' : undefined,
                        ...(event.target.checked ? { reference_mode: 'reference' } : {}) })} />
                真人文生图参考（人物四视图 + 纯背景）
                {value.portrait_reference_mode && <span className="block text-[10px]">仅限标准版全能参考；从素材库选取 30 天内专用入口生成的原图。图生图、上传图和参考视频不可用，已有素材不会被自动替换。</span>}
            </label>}
            {mode === 'reference' && value.media_inputs.length > 0 && <div className="flex h-12 min-h-12 w-full shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden pb-1" data-testid="seedance-reference-strip" aria-label="已选参考素材">
                {value.media_inputs.map((item, index) => <div key={`${item.url}-${index}`} className="flex h-10 shrink-0 items-center gap-1 overflow-hidden rounded-lg border border-n40 bg-n20/50 px-1 py-0.5 text-[9px]">
                    <button type="button" title={`预览素材 ${index + 1}`} onClick={() => onPreviewMedia?.(item.url, item.kind)} className="flex min-w-0 items-center gap-1">
                        {item.kind === 'image' ? <img src={item.url} alt={`图片${index + 1}`} className="h-7 w-9 shrink-0 rounded object-cover" /> : item.kind === 'video' ? <Film size={13} className="shrink-0" /> : <Volume2 size={13} className="shrink-0" />}
                        <span className="whitespace-nowrap">{item.kind === 'image' ? '图片' : item.kind === 'video' ? '视频' : '配音'}{value.media_inputs.slice(0, index + 1).filter(row => row.kind === item.kind).length}</span>
                    </button>
                    <button type="button" aria-label={`移除素材 ${index + 1}`} onClick={() => remove(index)} disabled={disabled} className="shrink-0 text-n100 hover:text-danger"><X size={10} /></button>
                </div>)}
            </div>}
        </div>
        <div className={VIDEO_CONTROL_BAR_CLASS} data-testid={isAgentPlan ? 'seedance15-control-row' : 'seedance-control-row'}>
            <label className={VIDEO_CONTROL_PILL_CLASS}><Film size={12} />
                <select aria-label="Seedance 生成模式" value={mode} onChange={event => setMode(event.target.value as 'reference' | 'first_last')} disabled={disabled || !omni} className={VIDEO_CONTROL_SELECT_CLASS}>
                    {omni && <option value="reference">全能参考</option>}{!isJimeng && <option value="first_last">首尾帧</option>}
                </select>
            </label>
            <VideoControlPopover title="画面规格" disabled={disabled} label={<><Maximize2 size={12} />{ratio === 'adaptive' ? '自动' : ratio}<span className="text-n40">|</span>{resolution.toUpperCase()}</>}>
                <label className="flex items-center justify-between gap-3">画面比例
                    <select value={ratio} onChange={event => patch({ ratio: event.target.value as SeedanceParams['ratio'] })} className="rounded-lg border border-n40 px-2 py-1.5" aria-label={isAgentPlan ? 'Seedance 1.5 画面比例' : '选择比例'}>
                        {RATIOS.filter(item => !(isAgentPlan || isJimeng) || item !== 'adaptive').map(item => <option key={item} value={item}>{item === 'adaptive' ? '自动' : item}</option>)}
                    </select>
                </label>
                <label className="flex items-center justify-between gap-3">清晰度
                    <select value={resolution} onChange={event => patch({ resolution: event.target.value as SeedanceParams['resolution'] })} className="rounded-lg border border-n40 px-2 py-1.5" aria-label={isAgentPlan ? 'Seedance 1.5 清晰度' : '选择清晰度'}>
                        {(isJimeng ? ['720p'] : isAgentPlan ? ['720p', '1080p'] : ['480p', '720p', '1080p']).map(item => <option key={item} value={item} disabled={item === '1080p' && (value.sub_model === 'mini' || value.sub_model === 'fast')}>{item.toUpperCase()}</option>)}
                    </select>
                </label>
            </VideoControlPopover>
            {durationControl || <VideoDurationControl value={value.duration || 5} min={4} max={isAgentPlan ? 12 : 15} onChange={duration => patch({ duration })} disabled={disabled} ariaLabel="视频时长" />}
            <VideoControlPopover title="素材管理" dismissKey={pickerOpen} disabled={disabled} label={<><Plus size={12} />素材 {value.media_inputs.length}</>}>
                {referenceList}
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setPickerOpen(true)} className={VIDEO_CONTROL_PILL_CLASS}>素材库</button>
                    <button type="button" disabled={uploadBusy || images.length >= imageLimit} onClick={() => mode === 'first_last' ? (!first ? firstInput : lastInput).current?.click() : imageInput.current?.click()} className={VIDEO_CONTROL_PILL_CLASS}><Upload size={12} />图片</button>
                    {omni && mode === 'reference' && <button type="button" disabled={uploadBusy || videos.length >= 3} onClick={() => videoInput.current?.click()} className={VIDEO_CONTROL_PILL_CLASS}><Upload size={12} />视频</button>}
                </div>
                <p className="text-[10px] text-n100">{mode === 'first_last' ? '首尾帧模式最多 2 张图片；更多参考图请手动选择支持全能参考的模型。' : '单个镜头与合并镜头都可继续添加参考图片。'}</p>
                {mode === 'first_last' && videos.length > 0 && <p className="text-[10px] text-warning">视频参考暂存，首尾帧模式不提交。</p>}
            </VideoControlPopover>
            <VideoControlPopover title="声音与参考配音" disabled={disabled} label={<><Volume2 size={12} />声音 {value.generate_audio !== false ? '开' : '关'}{audios.length > 0 && <span className="text-primary">· {audios.length}</span>}</>}>
                {isJimeng ? <p>声音由即梦模型生成，官方 CLI 暂无声音开关。</p> : <label className="flex items-center gap-2"><input type="checkbox" checked={value.generate_audio !== false} onChange={event => patch({ generate_audio: event.target.checked })} />AI 生成配音</label>}
                <div className="font-semibold">参考配音</div>
                {omni && <>
                    <p className="text-[10px] leading-5 text-n100">每段 2–15 秒，最多 3 段，合计不超过 15 秒；与输出视频时长分别计算。合并卡片也按全部配音累计，由服务器读取原始文件复核。</p>
                    {!isJimeng && <label className="flex items-center gap-2"><input type="checkbox" checked={trimAudio} disabled={disabled} onChange={event => patch({ reference_audio_policy: event.target.checked ? 'trim_to_15' : 'preserve' })} />仅裁剪参考副本至 15 秒内</label>}
                    {isJimeng ? <p className="text-[10px] text-n100">保留完整原始参考配音；超限时请手动裁剪参考副本，不会自动丢弃或截断台词。</p> : <p className="text-[10px] leading-5 text-n100">勾选后，仅在生成视频时取各段配音的开头作为音色参考：按原时长占比分配，每段至少保留 2 秒，合计不超过 15 秒。原始完整配音、台词、合并镜头和历史结果均不变；不变速、不拆视频、不增加生成次数。不勾选则超限时提示调整。</p>}
                    {trimAudio && <p className="text-[10px] text-primary">{audioBudget ? `预计提交参考：${audioBudget.map((d, i) => `配音 ${i + 1} ${d.toFixed(3)} 秒`).join('；')}；合计 ${audioBudget.reduce((s, d) => s + d, 0).toFixed(3)} 秒（以服务器实测为准）` : '提交前将根据原文件真实时长分配参考片段；无法读取或不足 2 秒会提示，不会直接生成。'}</p>}
                </>}
                {omni && audios.length > 0 && <p className="text-xs text-primary">参考配音合计：{audios.every(item => typeof item.duration_seconds === 'number' && Number.isFinite(item.duration_seconds) && item.duration_seconds > 0) ? audioDurationLabel(audios.reduce((sum, item) => sum + item.duration_seconds!, 0)) : '部分时长待服务器校验'}</p>}
                <div className="flex flex-wrap gap-2">
                    {onUsePreviousVideoAudio && <button type="button" disabled={previousVideoAudioBusy} onClick={onUsePreviousVideoAudio} className={VIDEO_CONTROL_PILL_CLASS}>{previousVideoAudioBusy ? <Loader2 size={12} className="animate-spin" /> : <Volume2 size={12} />}上一条原声</button>}
                    <button type="button" disabled={uploadBusy || (!isAgentPlan && audios.length >= 3)} onClick={() => audioInput.current?.click()} className={VIDEO_CONTROL_PILL_CLASS}><Upload size={12} />上传配音</button>
                </div>
                {audios.length === 0 && <p className="text-n100">暂未选择参考配音</p>}
                {audios.map(item => <div key={item.url} className="flex items-center gap-2 rounded-lg bg-n20 p-2"><button type="button" onClick={() => onPreviewMedia?.(item.url, 'audio')} className="min-w-0 flex-1 truncate text-left">{item.url.split('/').pop()}</button><span className="shrink-0 text-[10px] text-n100">{audioDurationLabel(item.duration_seconds)}</span><button type="button" aria-label="移除配音" onClick={() => remove(value.media_inputs.indexOf(item))}><X size={12} /></button></div>)}
                {audioNotice && <p className="text-[10px] leading-5 text-warning">{audioNotice}</p>}
            </VideoControlPopover>
            {!isJimeng && <VideoControlPopover title="高级设置" disabled={disabled} width={280} label={<><Settings2 size={12} />更多</>}>
                <label className="flex items-center justify-between">随机种子<input aria-label="随机种子" type="number" value={value.seed ?? -1} onChange={event => patch({ seed: Number(event.target.value) })} className="w-24 rounded-lg border border-n40 px-2 py-1.5" /></label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!value.watermark} onChange={event => patch({ watermark: event.target.checked })} />添加水印</label>
                {isAgentPlan && <label className="flex items-center gap-2"><input type="checkbox" checked={!!value.camera_fixed} onChange={event => patch({ camera_fixed: event.target.checked })} />固定镜头</label>}
                <p className="text-[10px] leading-5 text-n100"><Info size={11} className="mr-1 inline" />{getModelDisplayName(LABELS[value.sub_model])} · 请使用已获授权的素材。随机种子 -1 表示随机生成。</p>
                {audioNotice && <p className="text-[10px] text-warning">{audioNotice}</p>}
            </VideoControlPopover>}
        </div>
        {isJimeng && <p className="shrink-0 border-t border-n40 px-3 py-2 text-[10px] leading-5 text-n100">实际执行 seedance2.0mini · 4–15 秒整数，不足 4 秒按 4 秒生成，小数向上取整；原剧本、配音和时间轴不变。平台点数为 Seedance 2.0 标准模型同参数的 2 倍。请使用已获授权的素材，真人素材仍受即梦审核限制。</p>}
        {(error || validation) && <div role="alert" className="flex shrink-0 items-start gap-1 border-t border-r100 bg-r50 px-3 py-1.5 text-[10px] text-danger"><AlertCircle size={12} className="shrink-0" />{error || validation}</div>}
        {fileInput(firstInput, 'image', 'first_frame')}{fileInput(lastInput, 'image', 'last_frame')}
        {fileInput(imageInput, 'image')}{fileInput(videoInput, 'video')}{fileInput(audioInput, 'audio')}
        {pickerOpen && createPortal(<div className="relative z-[9700]"><SeedanceAssetPickerModal open onClose={() => { setPickerOpen(false); setTargetFrame(undefined); }} value={value} onChange={acceptReferences} candidates={mode === 'first_last' ? candidates.filter(item => item.kind === 'image') : candidates} imageLimit={imageLimit} firstLast={mode === 'first_last'} targetFrame={targetFrame} onUploadImage={targetFrame ? () => { (targetFrame === 'first_frame' ? firstInput : lastInput).current?.click(); setPickerOpen(false); setTargetFrame(undefined); } : undefined} /></div>, document.body)}
        {promptModalOpen && createPortal(<div className="fixed inset-0 z-[9500] flex items-center justify-center bg-n900/50 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) setPromptModalOpen(false); }}>
            <div role="dialog" aria-modal="true" aria-label="放大编辑提示词" className="flex h-[min(720px,90vh)] w-full max-w-5xl flex-col gap-3 rounded-2xl bg-n0 p-4 shadow-bottom">
                <div className="flex items-center justify-between"><div className="text-sm font-semibold">提示词 · 放大编辑</div><button type="button" aria-label="关闭" onClick={() => setPromptModalOpen(false)}><X size={16} /></button></div>
                <p className="text-xs text-n100">{hint}</p><div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{editor(true)}</div>
                <button type="button" onClick={() => setPromptModalOpen(false)} className="self-end rounded-full bg-primary px-5 py-2 text-xs text-white">完成</button>
            </div>
        </div>, document.body)}
    </div>;
};
export default SeedanceMultimodalPanel;
