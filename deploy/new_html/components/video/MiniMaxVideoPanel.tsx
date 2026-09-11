import React from 'react';
import { Clock3, Monitor, Wand2 } from 'lucide-react';
import {
    DEFAULT_MINIMAX_VIDEO_PARAMS,
    getMiniMaxVideoParamsError,
    normalizeMiniMaxVideoParams,
    type MiniMaxVideoDuration,
    type MiniMaxVideoModelName,
    type MiniMaxVideoParams,
    type MiniMaxVideoResolution,
} from '../../services/videoModelService';
import {
    VIDEO_CONTROL_BAR_CLASS,
    VIDEO_CONTROL_PILL_CLASS,
    VIDEO_CONTROL_SELECT_CLASS,
} from './videoControlStyles';
import { VideoPromptField } from './VideoPromptField';
import { ModelPicker, type ModelPickerOption } from '../ModelPicker';

interface MiniMaxVideoPanelProps {
    value: MiniMaxVideoParams;
    prompt: string;
    onChange: (next: MiniMaxVideoParams) => void;
    onPromptChange: (next: string) => void;
    modelOptions?: Array<{ value: MiniMaxVideoModelName; label?: string }>;
    compact?: boolean;
}

const MODEL_OPTIONS: Array<{ value: MiniMaxVideoModelName; label: string }> = [
    { value: 'MiniMax-Hailuo-2.3', label: 'MiniMax-Hailuo-2.3' },
    { value: 'MiniMax-Hailuo-2.3-Fast', label: 'MiniMax-Hailuo-2.3-Fast' },
];

function normalizeModelOptions(
    options: Array<{ value: MiniMaxVideoModelName; label?: string }> | undefined,
    currentModel: MiniMaxVideoModelName,
): Array<{ value: MiniMaxVideoModelName; label: string }> {
    const seen = new Set<string>();
    const rows = (options && options.length ? options : MODEL_OPTIONS)
        .map(option => ({
            value: String(option.value || '').trim(),
            label: String(option.label || option.value || '').trim(),
        }))
        .filter(option => {
            if (!option.value || seen.has(option.value)) return false;
            seen.add(option.value);
            return true;
        });
    if (currentModel && !rows.some(option => option.value === currentModel)) {
        rows.unshift({ value: currentModel, label: currentModel });
    }
    return rows.length ? rows : MODEL_OPTIONS;
}

export const MiniMaxVideoPanel: React.FC<MiniMaxVideoPanelProps> = ({
    value,
    prompt,
    onChange,
    onPromptChange,
    modelOptions,
    compact = false,
}) => {
    const defaultModel = modelOptions?.[0]?.value || DEFAULT_MINIMAX_VIDEO_PARAMS.model;
    const params = normalizeMiniMaxVideoParams(value, defaultModel);
    const panelModelOptions = React.useMemo(
        () => normalizeModelOptions(modelOptions, params.model),
        [modelOptions, params.model],
    );
    const pickerModelOptions = React.useMemo<readonly ModelPickerOption<MiniMaxVideoModelName>[]>(
        () => panelModelOptions.map(option => ({
            value: option.value,
            label: option.label,
            description: option.value.endsWith('-Fast') ? '速度优先的视频生成模型' : '质量优先的视频生成模型',
            group: '在线 API',
        })),
        [panelModelOptions],
    );
    const validationError = getMiniMaxVideoParamsError(params);

    const setDuration = (duration: MiniMaxVideoDuration) => {
        onChange({ ...params, duration });
    };

    const setResolution = (resolution: MiniMaxVideoResolution) => {
        onChange({ ...params, resolution });
    };

    if (compact) {
        return (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" title={validationError || undefined}>
                <ModelPicker
                    value={params.model}
                    options={pickerModelOptions}
                    onChange={model => onChange(normalizeMiniMaxVideoParams({ ...params, model }))}
                    compact
                    className="max-w-[190px]"
                    ariaLabel="MiniMax 模型"
                    title="MiniMax 模型"
                    kind="video"
                />
                <label className={VIDEO_CONTROL_PILL_CLASS}>
                    <Clock3 className="h-3 w-3" />
                    <select
                        value={params.duration}
                        onChange={(event) => setDuration(Number(event.target.value) as MiniMaxVideoDuration)}
                        className={VIDEO_CONTROL_SELECT_CLASS}
                        aria-label="MiniMax 时长"
                    >
                        <option value={6}>6 秒</option>
                        <option value={10} disabled={params.resolution === '1080P'}>10 秒</option>
                    </select>
                </label>
                <label className={VIDEO_CONTROL_PILL_CLASS}>
                    <Monitor className="h-3 w-3" />
                    <select
                        value={params.resolution}
                        onChange={(event) => setResolution(event.target.value as MiniMaxVideoResolution)}
                        className={VIDEO_CONTROL_SELECT_CLASS}
                        aria-label="MiniMax 清晰度"
                    >
                        <option value="768P">768P</option>
                        <option value="1080P" disabled={params.duration === 10}>1080P</option>
                    </select>
                </label>
                <label className={VIDEO_CONTROL_PILL_CLASS}>
                    <Wand2 className="h-3 w-3 text-primary" />
                    <input
                        type="checkbox"
                        checked={params.promptOptimizer}
                        onChange={(event) => onChange({ ...params, promptOptimizer: event.target.checked })}
                        className="h-3.5 w-3.5 rounded border-n40 text-primary"
                    />
                    优化
                </label>
                <textarea
                    value={prompt}
                    onChange={(event) => onPromptChange(event.target.value)}
                    placeholder="描述动作内容..."
                    className="h-10 min-w-[160px] flex-1 resize-none rounded border border-n40 bg-n20 px-2 py-1 text-xs text-n700 focus:border-primary focus:outline-none"
                />
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-card">
            <VideoPromptField value={prompt} onChange={onPromptChange} hint="首帧/首尾帧生成；输入文字描述动作、镜头和变化过程" />
            <div className={VIDEO_CONTROL_BAR_CLASS} data-testid="minimax-control-row">
                <ModelPicker
                    value={params.model}
                    options={pickerModelOptions}
                    onChange={model => onChange({ ...params, model })}
                    compact
                    className="max-w-[190px]"
                    ariaLabel="MiniMax 模型"
                    title="MiniMax 模型"
                    kind="video"
                />
                <label className={VIDEO_CONTROL_PILL_CLASS}>
                    <Clock3 className="h-3 w-3" />
                    <select
                        value={params.duration}
                        onChange={(event) => setDuration(Number(event.target.value) as MiniMaxVideoDuration)}
                        className={VIDEO_CONTROL_SELECT_CLASS}
                    >
                        <option value={6}>6 秒</option>
                        <option value={10} disabled={params.resolution === '1080P'}>10 秒</option>
                    </select>
                </label>
                <label className={VIDEO_CONTROL_PILL_CLASS}>
                    <Monitor className="h-3 w-3" />
                    <select
                        value={params.resolution}
                        onChange={(event) => setResolution(event.target.value as MiniMaxVideoResolution)}
                        className={VIDEO_CONTROL_SELECT_CLASS}
                    >
                        <option value="768P">768P</option>
                        <option value="1080P" disabled={params.duration === 10}>1080P</option>
                    </select>
                </label>
                <label className="inline-flex items-center">
                    <span className={VIDEO_CONTROL_PILL_CLASS}>
                        <Wand2 className="h-3 w-3 text-primary" />
                        <input
                            type="checkbox"
                            checked={params.promptOptimizer}
                            onChange={(event) => onChange({ ...params, promptOptimizer: event.target.checked })}
                            className="h-3.5 w-3.5 rounded border-n40 text-primary"
                        />
                        提示优化
                    </span>
                </label>
            </div>
            {validationError && (
                <div className="shrink-0 border-t border-r100 bg-r50 px-3 py-1.5 text-[10px] text-danger">
                    {validationError}
                </div>
            )}
        </div>
    );
};
