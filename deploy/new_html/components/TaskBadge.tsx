






import React from 'react';
import type { SourcePage } from '../types';
import { useTaskManager } from '../contexts/TaskContext';

export interface TaskBadgeProps {
    page: SourcePage;

    disablePulse?: boolean;

    compact?: boolean;
}

export const TaskBadge: React.FC<TaskBadgeProps> = ({ page, disablePulse, compact }) => {
    const { summaryByPage } = useTaskManager();
    const summary = summaryByPage[page];

    if (!summary) return null;
    const total = summary.running + summary.queued + summary.pending;
    if (total === 0) return null;

    const hasRunning = summary.running > 0;
    const dotColor = hasRunning ? 'bg-b400' : 'bg-warning';
    const ringColor = hasRunning ? 'bg-b400/40' : 'bg-warning/40';
    const textColor = hasRunning ? 'text-b400' : 'text-warning';
    const shouldPulse = hasRunning && !disablePulse;

    return (
        <span
            className="inline-flex items-center gap-1 ml-1 align-middle"
            role="status"
            aria-label={`${total} 个任务${hasRunning ? '运行中' : '排队中'}`}
        >
            {!compact && (
                <span className="relative inline-flex w-2 h-2">
                    {shouldPulse && (
                        <span
                            className={`absolute inset-0 rounded-full ${ringColor} animate-ping motion-reduce:hidden`}
                        />
                    )}
                    <span className={`relative inline-block w-2 h-2 rounded-full ${dotColor}`} />
                </span>
            )}
            <span className={`text-[10px] font-semibold tabular-nums leading-none ${textColor}`}>
                {total}
            </span>
        </span>
    );
};
