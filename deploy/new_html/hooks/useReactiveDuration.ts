import { useEffect, useCallback } from 'react';
import { computeReactiveDuration, clampSec } from '../utils/durationMapping';
import type { StoryboardMeta } from '../services/videoWorkspaceService';

export interface UseReactiveDurationProps {
    groupUuid: string;
    durationUserOverride: boolean;
    meta: Partial<StoryboardMeta>;
    currentDuration?: number;
    maxDuration?: number;
    /** Called with (newDuration, override) whenever the hook decides duration must change.
     *  Caller should patch task_groups[groupUuid] = { duration, durationUserOverride: override }. */
    onChange: (duration: number, override: boolean) => void;
}

export interface UseReactiveDurationResult {
    duration: number;
    userOverride: boolean;
    setUserDuration: (sec: number) => void;
    clearOverride: () => void;
}

export function useReactiveDuration(p: UseReactiveDurationProps): UseReactiveDurationResult {
    const reactive = computeReactiveDuration({
        audioDurationMs: p.meta.audioDurationMs,
        plannedDurationMs: p.meta.plannedDurationMs,
    }, p.maxDuration);
    const boundedCurrent = clampSec(p.currentDuration ?? reactive, reactive, p.maxDuration);

    // When override is OFF, sync reactive value into the upstream state via onChange.
    useEffect(() => {
        if (p.durationUserOverride) return;
        if (p.currentDuration === reactive) return;
        p.onChange(reactive, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reactive, p.durationUserOverride, p.groupUuid]);

    useEffect(() => {
        if (p.currentDuration == null) return;
        if (p.currentDuration === boundedCurrent) return;
        p.onChange(boundedCurrent, p.durationUserOverride);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boundedCurrent, p.currentDuration, p.durationUserOverride, p.groupUuid]);

    const setUserDuration = useCallback(
        (sec: number) => p.onChange(clampSec(sec, reactive, p.maxDuration), true),
        [p.onChange, p.maxDuration, reactive],
    );

    const clearOverride = useCallback(() => {
        const next = computeReactiveDuration({
            audioDurationMs: p.meta.audioDurationMs,
            plannedDurationMs: p.meta.plannedDurationMs,
        }, p.maxDuration);
        p.onChange(next, false);
    }, [p.onChange, p.meta.audioDurationMs, p.meta.plannedDurationMs, p.maxDuration]);

    return {
        duration: p.durationUserOverride ? boundedCurrent : reactive,
        userOverride: p.durationUserOverride,
        setUserDuration,
        clearOverride,
    };
}
