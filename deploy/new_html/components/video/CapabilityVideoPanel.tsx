import React from 'react';
import { AtSign, Settings2 } from 'lucide-react';
import type {
    VideoCapabilityNumberRule,
    VideoModelCapability,
} from '../../services/videoWorkflowService';
import {
    VIDEO_CONTROL_BAR_CLASS,
    VIDEO_CONTROL_INPUT_CLASS,
    VIDEO_CONTROL_PILL_CLASS,
    VIDEO_CONTROL_SELECT_CLASS,
} from './videoControlStyles';
import { VideoPromptField } from './VideoPromptField';
import { VideoControlPopover } from './VideoControlPopover';
import { VideoDurationControl } from './VideoDurationControl';

interface CapabilityVideoPanelProps {
    capability?: VideoModelCapability;
    value?: Record<string, string | number | boolean>;
    prompt: string;
    onChange: (next: Record<string, string | number | boolean>) => void;
    onPromptChange: (next: string) => void;
}

const CONTROL_LABELS: Record<string, string> = {
    duration: '时长',
    resolution: '清晰度',
    ratio: '画面比例',
    aspect_ratio: '画面比例',
    shot_type: '镜头模式',
    seed: '随机种子',
    negative_prompt: '排除内容',
};

const OPTION_LABELS: Record<string, string> = {
    multi: '智能多镜头',
    single: '单镜头',
};

function isRuleObject(rule: unknown): rule is Record<string, unknown> {
    return !!rule && typeof rule === 'object' && !Array.isArray(rule);
}

export function resolveCapabilityParamValue(
    rule: unknown,
    current: string | number | boolean | undefined,
): string | number | boolean {
    if (current !== undefined) return current;
    if (Array.isArray(rule)) return rule[0] ?? '';
    if (isRuleObject(rule) && rule.default !== undefined) {
        return rule.default as string | number | boolean;
    }
    return '';
}

export const CapabilityVideoPanel: React.FC<CapabilityVideoPanelProps> = ({
    capability,
    value = {},
    prompt,
    onChange,
    onPromptChange,
}) => {
    const rules = capability?.parameter_rules || {};
    const fieldEntries = Object.entries(rules).filter(([key]) => key !== 'normalization_policy');
    const setField = (key: string, next: string | number | boolean) => {
        onChange({ ...value, [key]: next });
    };

    const renderField = ([key, rule]: [string, unknown]) => {
        const label = CONTROL_LABELS[key] || key;
        const current = resolveCapabilityParamValue(rule, value[key]);
        if (Array.isArray(rule)) {
            return (
                <label key={key} className={VIDEO_CONTROL_PILL_CLASS}>
                    <span>{label}</span>
                    <select
                        value={String(current)}
                        onChange={event => setField(key, event.target.value)}
                        className={VIDEO_CONTROL_SELECT_CLASS}
                    >
                        {rule.map(option => (
                            <option key={String(option)} value={String(option)}>
                                {OPTION_LABELS[String(option)] || String(option)}
                            </option>
                        ))}
                    </select>
                </label>
            );
        }
        if (isRuleObject(rule) && rule.type === 'boolean') {
            return (
                <label key={key} className="inline-flex min-w-0 items-center">
                    <span className={VIDEO_CONTROL_PILL_CLASS}>
                        <input
                            type="checkbox"
                            checked={Boolean(current)}
                            onChange={event => setField(key, event.target.checked)}
                            className="h-3.5 w-3.5 rounded border-n40 text-primary"
                        />
                        {label}
                    </span>
                </label>
            );
        }
        if (isRuleObject(rule) && (rule.options as unknown[] | undefined)?.length) {
            const options = rule.options as Array<string | number>;
            return (
                <label key={key} className={VIDEO_CONTROL_PILL_CLASS}>
                    <span>{label}</span>
                    <select
                        value={String(current)}
                        onChange={event => setField(key, rule.type === 'integer' || rule.type === 'number' ? Number(event.target.value) : event.target.value)}
                        className={VIDEO_CONTROL_SELECT_CLASS}
                    >
                        {options.map(option => (
                            <option key={String(option)} value={String(option)}>{option}{key === 'duration' ? ' 秒' : ''}</option>
                        ))}
                    </select>
                </label>
            );
        }
        if (isRuleObject(rule) && (rule.type === 'integer' || rule.type === 'number')) {
            const numericRule = rule as VideoCapabilityNumberRule;
            if (key === 'duration') {
                return (
                    <VideoDurationControl
                        key={key}
                        value={Number(current)}
                        min={numericRule.minimum ?? 1}
                        max={numericRule.maximum ?? 60}
                        onChange={next => setField(key, next)}
                        ariaLabel={label}
                    />
                );
            }
            return (
                <label key={key} className={VIDEO_CONTROL_PILL_CLASS}>
                    <span>{label}</span>
                    <input
                        type="number"
                        value={Number(current)}
                        min={numericRule.minimum}
                        max={numericRule.maximum}
                        onChange={event => setField(key, Number(event.target.value))}
                        className={VIDEO_CONTROL_INPUT_CLASS}
                    />
                </label>
            );
        }
        return (
            <label key={key} className={VIDEO_CONTROL_PILL_CLASS}>
                <span>{label}</span>
                <input
                    value={String(current)}
                    onChange={event => setField(key, event.target.value)}
                    className="w-24 border-0 bg-transparent p-0 text-[10px] font-semibold text-n700 focus:outline-none"
                />
            </label>
        );
    };
    const primary = new Set(['duration', 'resolution', 'ratio', 'aspect_ratio', 'shot_type']);
    const advanced = fieldEntries.filter(([key]) => !primary.has(key));

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-card" data-testid="capability-video-panel">
            <VideoPromptField value={prompt} onChange={onPromptChange} hint="输入文字描述画面、动作和运镜；使用上方分镜图作为参考" />
            <div className={VIDEO_CONTROL_BAR_CLASS} data-testid="capability-control-row">
                <span className={VIDEO_CONTROL_PILL_CLASS}>
                    <AtSign className="h-3 w-3" />分镜图参考
                </span>
            {fieldEntries.length > 0 ? (
                <>
                    {fieldEntries.filter(([key]) => primary.has(key)).map(renderField)}
                    {advanced.length > 0 && <VideoControlPopover title="高级设置" label={<><Settings2 size={12} />更多</>}>
                        <div className="flex flex-col items-start gap-3">{advanced.map(renderField)}</div>
                    </VideoControlPopover>}
                </>
            ) : (
                <span className={`${VIDEO_CONTROL_PILL_CLASS} text-n100`}><Settings2 className="h-3 w-3" />后台固定参数</span>
            )}
            </div>
        </div>
    );
};
