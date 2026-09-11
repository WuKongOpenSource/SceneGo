import React from 'react';
import { Clock3, RotateCcw } from 'lucide-react';
import { DURATION_MIN_SEC, DURATION_MAX_SEC } from '../../utils/durationMapping';
import { VideoControlPopover } from './VideoControlPopover';

export interface CardDurationFieldProps {
    duration: number;
    userOverride: boolean;
    onChange: (sec: number, override: boolean) => void;
    onClear: () => void;
    disabled?: boolean;
    maxDuration?: number;
    minDuration?: number;
    variant?: 'compact' | 'seedance15';
}

export const CardDurationField: React.FC<CardDurationFieldProps> = ({
    duration, userOverride, onChange, onClear, disabled, maxDuration, minDuration, variant = 'compact',
}) => {
    const maxSec = maxDuration ?? DURATION_MAX_SEC;
    const minSec = minDuration ?? DURATION_MIN_SEC;
    if (variant === 'seedance15') {
        const marks = Array.from(new Set([minSec, 5, 10, maxSec]))
            .filter(mark => mark >= minSec && mark <= maxSec)
            .sort((a, b) => a - b);
        return (
            <VideoControlPopover title="Seedance 1.5 Pro 时长设置" disabled={disabled} width={280} label={<><Clock3 size={12} /><span className="font-semibold">{duration} 秒</span></>}>
                <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                            <div className="text-[10px] font-semibold text-n700">选择视频生成时长</div>
                            <div className="text-[9px] text-n100">{minSec}–{maxSec} 秒</div>
                        </div>
                        <div className="flex h-8 w-12 items-center justify-center rounded-lg bg-n20 text-xs font-semibold text-n800">
                            {duration}<span className="ml-0.5 text-[9px] font-normal text-n100">s</span>
                        </div>
                    </div>
                    <input
                        type="range"
                        min={minSec}
                        max={maxSec}
                        step={1}
                        value={duration}
                        disabled={disabled}
                        className="h-1.5 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
                        onChange={event => onChange(Number(event.target.value), true)}
                        aria-label="Seedance 1.5 Pro 视频时长"
                    />
                    <div className="mt-1 flex justify-between text-[8px] leading-none text-n100">
                        {marks.map(mark => <span key={mark}>{mark}</span>)}
                    </div>
                    {userOverride && (
                        <button type="button" onClick={onClear} disabled={disabled} className="mt-3 inline-flex items-center gap-1 text-[10px] text-n300 hover:text-primary">
                            <RotateCcw size={11} />恢复跟随分镜时长
                        </button>
                    )}
                </div>
            </VideoControlPopover>
        );
    }
    return (
        <VideoControlPopover title="视频时长设置" disabled={disabled} width={280} label={<><Clock3 size={12} /><span className="font-semibold">{duration} 秒</span></>}>
            <div>
                <label className="flex items-center justify-between gap-2 text-[10px] text-n500">
                    <span>视频时长</span>
                    <span className="inline-flex items-center gap-1 rounded-lg border border-n40 bg-n20 px-2 py-1">
                        <input
                            type="number"
                            min={minSec}
                            max={maxSec}
                            step={1}
                            value={duration}
                            disabled={disabled}
                            className="w-10 border-0 bg-transparent p-0 text-center font-semibold text-n800 outline-none"
                            onChange={e => {
                                const n = parseInt(e.target.value, 10);
                                if (!Number.isFinite(n)) return;
                                onChange(Math.max(minSec, Math.min(maxSec, n)), true);
                            }}
                        />
                        <span className="text-n100">秒</span>
                    </span>
                </label>
                {userOverride && (
                    <button type="button" onClick={onClear} disabled={disabled} className="mt-3 inline-flex items-center gap-1 text-[10px] text-n300 hover:text-primary">
                        <RotateCcw size={11} />恢复跟随
                    </button>
                )}
            </div>
        </VideoControlPopover>
    );
};
