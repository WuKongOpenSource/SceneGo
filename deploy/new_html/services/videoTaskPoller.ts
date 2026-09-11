



















import * as videoTaskService from '@runtime/videoTaskService';
import { taskRegistry } from './taskRegistry';
import type { SourcePage, TaskKind, GlobalTaskStatus } from '../types';
import { sanitizeProcessingTerminology } from '../utils/processingTerminology';

export type VideoPollStatus = 'queued' | 'running' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface VideoPollCompletePayload {

    status: videoTaskService.VideoTask;
}

export interface VideoPollCallbacks {

    onProgress?: (progress: number, status: VideoPollStatus, undo?: { canCancel?: boolean; cancelDeadline?: number }) => void;

    onComplete?: (payload: VideoPollCompletePayload) => void;

    onFail?: (error: string) => void;
}

interface PollerEntry {

    uuid: string;

    backendTaskId: string;
    intervalId: ReturnType<typeof setInterval> | null;
    callbacks: VideoPollCallbacks | null;
    pollIntervalMs: number;
    inFlight: boolean;
    controller: AbortController | null;
}

const entries = new Map<string, PollerEntry>();

export interface StartVideoPollOptions {

    taskId: string;

    title: string;

    kind?: TaskKind;

    targetPage?: SourcePage;
    episodeId?: string | null;
    projectId?: string | null;

    targetEntityId?: string;

    targetEntityType?: string;

    pollIntervalMs?: number;

    callbacks?: VideoPollCallbacks;
}

/** Internal: build a poll function for an entry. */
function buildPollFn(uuid: string): () => Promise<void> {
    return async function poll() {
        const entry = entries.get(uuid);
        if (!entry || entry.inFlight) return;
        const taskId = entry.backendTaskId;
        const isCurrent = () => entries.get(uuid) === entry && entry.backendTaskId === taskId;
        // One response owns one task incarnation. Slow requests must not race
        // completion or update a replacement task that reuses the same card.
        entry.inFlight = true;
        const controller = new AbortController();
        entry.controller = controller;
        // A hung status request must not hold the single-flight slot forever.
        // Aborting a GET only stops observation, never the paid provider task.
        const queryTimeout = setTimeout(() => controller.abort(), 30000);
        try {
            const status = await videoTaskService.getTaskStatus(taskId, controller.signal);
            if (!isCurrent()) return;
            const cbs = entry.callbacks;
            if (status.status === 'completed') {
                stopAndClear(uuid);
                try { taskRegistry.complete(entry.backendTaskId); } catch { /* noop */ }
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('credits:updated'));
                }
                cbs?.onComplete?.({ status });
            } else if (status.status === 'failed' || status.status === 'cancelled') {
                stopAndClear(uuid);
                const err = sanitizeProcessingTerminology(status.error || (status.status === 'cancelled' ? '任务已取消' : '任务失败'));
                try {
                    if (status.status === 'cancelled') taskRegistry.cancel(entry.backendTaskId);
                    else taskRegistry.fail(entry.backendTaskId, err);
                } catch { /* noop */ }
                window.dispatchEvent(new CustomEvent('credits:updated'));
                cbs?.onFail?.(err);
            } else if (['processing', 'running', 'queued', 'pending'].includes(status.status)) {
                const rawProgress = status.progress ?? 0;


                const normalized = rawProgress > 1 ? rawProgress / 100 : rawProgress;
                const queued = status.status === 'queued' || status.status === 'pending';
                const mapped: VideoPollStatus = queued ? 'queued' : 'processing';
                const regStatus: GlobalTaskStatus = queued ? 'queued' : 'running';
                try {
                    taskRegistry.update(entry.backendTaskId, {
                        status: regStatus,
                        progress: normalized,
                        metadata: { canCancel: status.can_cancel, cancelDeadline: status.cancel_deadline },
                    });
                } catch { /* noop */ }
                if (status.cancel_deadline) cbs?.onProgress?.(rawProgress, mapped, { canCancel: status.can_cancel, cancelDeadline: status.cancel_deadline });
                else cbs?.onProgress?.(rawProgress, mapped);
            }
        } catch (error: any) {
            if (!isCurrent()) return;
            if (error?.message === 'TASK_NOT_FOUND') {

                const cbs = entry.callbacks;
                stopAndClear(uuid);
                try { taskRegistry.fail(entry.backendTaskId, '任务不存在'); } catch { /* noop */ }
                cbs?.onFail?.('任务不存在');
            }

        } finally {
            clearTimeout(queryTimeout);
            entry.controller = null;
            entry.inFlight = false;
        }
    };
}

function stopAndClear(uuid: string): void {
    const entry = entries.get(uuid);
    if (!entry) return;
    entry.controller?.abort();
    if (entry.intervalId !== null) {
        clearInterval(entry.intervalId);
        entry.intervalId = null;
    }
    entries.delete(uuid);
}







export function startVideoPoll(uuid: string, options: StartVideoPollOptions): void {
    const existing = entries.get(uuid);

    const registerInput = {
        taskId: options.taskId,
        kind: options.kind ?? ('video-i2v' as TaskKind),
        title: options.title,
        targetPage: options.targetPage ?? ('video' as SourcePage),
        initialStatus: 'running' as GlobalTaskStatus,
        progress: 0,
        targetEntityType: options.targetEntityType ?? 'video_segment',
        targetEntityId: options.targetEntityId ?? uuid,
        targetProjectId: options.projectId ?? undefined,
        episodeId: options.episodeId ?? undefined,
    };

    if (existing?.backendTaskId === options.taskId) {
        existing.callbacks = options.callbacks ?? existing.callbacks;
        try { taskRegistry.register(registerInput); } catch { /* noop */ }
        return;
    }
    if (existing) stopAndClear(uuid);

    const entry: PollerEntry = {
        uuid,
        backendTaskId: options.taskId,
        intervalId: null,
        callbacks: options.callbacks ?? existing?.callbacks ?? null,
        pollIntervalMs: options.pollIntervalMs ?? 3000,
        inFlight: false,
        controller: null,
    };
    entries.set(uuid, entry);

    try { taskRegistry.register(registerInput); } catch { /* noop */ }

    const poll = buildPollFn(uuid);
    entry.intervalId = setInterval(poll, entry.pollIntervalMs);
    void poll();
}


export function detachVideoPollCallbacks(uuid: string): void {
    const entry = entries.get(uuid);
    if (!entry) return;
    entry.callbacks = null;
}


export function attachVideoPollCallbacks(uuid: string, callbacks: VideoPollCallbacks): boolean {
    const entry = entries.get(uuid);
    if (!entry) return false;
    entry.callbacks = callbacks;
    return true;
}


export function stopVideoPoll(uuid: string): void {
    stopAndClear(uuid);
}


export function getKnownVideoTaskIds(): string[] {
    return Array.from(entries.keys());
}


export function isVideoPollActive(uuid: string): boolean {
    return entries.has(uuid);
}


export function getVideoPollTaskId(uuid: string): string | null {
    return entries.get(uuid)?.backendTaskId ?? null;
}


export function __resetVideoTaskPollerForTesting(): void {
    for (const uuid of Array.from(entries.keys())) stopAndClear(uuid);
}
