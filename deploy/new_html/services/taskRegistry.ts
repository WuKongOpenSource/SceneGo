// Global task registry. Ownership layers:




// Core behavior:







import type { RegisteredTask, GlobalTaskStatus, SourcePage, TaskKind } from '../types';

const STORAGE_KEY_PREFIX = 'ostory:task-registry:v1';
const ANONYMOUS_USER_SCOPE = 'anonymous';

const COMPLETED_RETAIN_MS = 30 * 60 * 1000;
// Rehydrated active tasks expire so a browser cannot display abandoned local
// queue state forever after a worker or page session disappears.
const STALE_ACTIVE_MS = 60 * 60 * 1000;

const MAX_COMPLETED_KEEP = 50;
const FRONTEND_QUEUE_TASK_ID_RE = /^comfyui_\d+_\d+$/;
const FRONTEND_QUEUE_TASK_LOST_MESSAGE = '页面刷新后，本地排队任务已失效，请重新提交';

export type TaskRegistryEvent =
    | { type: 'register'; task: RegisteredTask }
    | { type: 'update'; task: RegisteredTask }
    | { type: 'complete'; task: RegisteredTask }
    | { type: 'fail'; task: RegisteredTask }
    | { type: 'cancel'; task: RegisteredTask }
    | { type: 'remove'; taskId: string }
    | { type: 'rehydrate'; tasks: RegisteredTask[] };

export type RegistryListener = (event: TaskRegistryEvent, snapshot: RegisteredTask[]) => void;
export type TaskCompleteListener = (task: RegisteredTask) => void;

export interface TaskFilter {
    status?: GlobalTaskStatus | GlobalTaskStatus[];
    targetPage?: SourcePage | SourcePage[];
    kind?: TaskKind | TaskKind[];
    episodeId?: string;
}

export interface RegisterInput {
    taskId: string;
    kind: TaskKind;
    title: string;
    targetPage: SourcePage;

    initialStatus?: GlobalTaskStatus;
    progress?: number;
    queuePosition?: number;
    targetEntityType?: string;
    targetEntityId?: string;
    targetItemId?: string;
    targetProjectId?: string;
    episodeId?: string;
    fileRole?: string;
    metadata?: Record<string, unknown>;
}

class TaskRegistry {
    private tasks: Map<string, RegisteredTask> = new Map();
    private listeners: Set<RegistryListener> = new Set();
    /** taskId -> Set of complete callbacks */
    private completeCallbacks: Map<string, Set<TaskCompleteListener>> = new Map();
    /** taskId -> Set of fail callbacks */
    private failCallbacks: Map<string, Set<TaskCompleteListener>> = new Map();

    private storage: Storage | null = null;
    private storageInitialized = false;
    private userScope = ANONYMOUS_USER_SCOPE;





    constructor(storage?: Storage | null) {
        if (storage !== undefined) {
            this.setStorage(storage);
        }
    }


    setStorage(storage: Storage | null): void {
        this.storage = storage;
        this.storageInitialized = true;
    }

    /**
     * Browser task state is account-scoped. Without this boundary, switching users
     * in the same tab can rehydrate the previous user's locally cached tasks.
     */
    setUserScope(scope?: string | null, emit = true): void {
        const nextScope = (scope || '').trim() || ANONYMOUS_USER_SCOPE;
        if (nextScope === this.userScope) return;
        this.userScope = nextScope;
        this.tasks.clear();
        this.completeCallbacks.clear();
        this.failCallbacks.clear();
        if (emit) this.emit({ type: 'rehydrate', tasks: [] });
    }

    private storageKey(): string {
        return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(this.userScope)}`;
    }

    private resolveStorage(): Storage | null {
        if (this.storageInitialized) return this.storage;

        try {
            if (typeof window !== 'undefined' && window.sessionStorage) {
                this.storage = window.sessionStorage;
            } else {
                this.storage = null;
            }
        } catch {
            this.storage = null;
        }
        this.storageInitialized = true;
        return this.storage;
    }






    register(input: RegisterInput): RegisteredTask {
        const now = Date.now();
        const existing = this.get(input.taskId);

        const task: RegisteredTask = existing
            ? { ...existing, ...this.toTaskFields(input),
                status: existing.status === 'completed' || existing.status === 'cancelled'
                    ? existing.status : input.initialStatus || existing.status,
                metadata: { ...existing.metadata, ...input.metadata } }
            : {
                taskId: input.taskId,
                kind: input.kind,
                title: input.title,
                status: input.initialStatus || 'queued',
                createdAt: now,
                progress: input.progress,
                queuePosition: input.queuePosition,
                targetPage: input.targetPage,
                targetEntityType: input.targetEntityType,
                targetEntityId: input.targetEntityId,
                targetItemId: input.targetItemId,
                targetProjectId: input.targetProjectId,
                episodeId: input.episodeId,
                fileRole: input.fileRole,
                metadata: input.metadata,
            };

        this.tasks.set(task.taskId, task);
        this.collapseBackendDuplicate(task);
        this.persist();
        this.emit({ type: existing ? 'update' : 'register', task });
        return this.get(task.taskId)!;
    }

    private toTaskFields(input: RegisterInput): Partial<RegisteredTask> {
        const out: Partial<RegisteredTask> = {
            kind: input.kind,
            title: input.title,
            targetPage: input.targetPage,
        };
        if (input.initialStatus) out.status = input.initialStatus;
        if (input.progress !== undefined) out.progress = input.progress;
        if (input.queuePosition !== undefined) out.queuePosition = input.queuePosition;
        if (input.targetEntityType !== undefined) out.targetEntityType = input.targetEntityType;
        if (input.targetEntityId !== undefined) out.targetEntityId = input.targetEntityId;
        if (input.targetItemId !== undefined) out.targetItemId = input.targetItemId;
        if (input.targetProjectId !== undefined) out.targetProjectId = input.targetProjectId;
        if (input.episodeId !== undefined) out.episodeId = input.episodeId;
        if (input.fileRole !== undefined) out.fileRole = input.fileRole;
        if (input.metadata !== undefined) out.metadata = input.metadata;
        return out;
    }






    update(taskId: string, updates: Partial<RegisteredTask>): RegisteredTask | null {
        const existing = this.get(taskId);
        if (!existing) return null;
        if (existing.status === 'cancelled' && updates.status && updates.status !== 'cancelled') return existing;
        if (existing.status === 'completed' && updates.status && updates.status !== 'completed') return existing;
        // A failed local query can still recover from the authoritative server;
        // completed/cancelled work must never be resurrected by late polling.

        const next: RegisteredTask = { ...existing, ...updates, taskId: existing.taskId };
        if (taskId !== existing.taskId) {
            // Backend rows often carry only a raw workflow name and partial scope.
            // Keep the richer submission identity when updating via its alias.
            next.kind = existing.kind;
            next.title = existing.title;
            next.targetPage = existing.targetPage;
        }



        if (updates.metadata !== undefined) {
            next.metadata = { ...(existing.metadata || {}), ...updates.metadata };
        }
        const now = Date.now();

        if (updates.status === 'running' && !existing.startedAt) {
            next.startedAt = now;
        }

        const becameComplete = existing.status !== 'completed' && next.status === 'completed';
        const becameFailed = existing.status !== 'failed' && next.status === 'failed';

        if ((becameComplete || becameFailed) && !next.completedAt) {
            next.completedAt = now;
        }

        this.tasks.set(next.taskId, next);
        this.persist();

        if (becameComplete) {
            this.emit({ type: 'complete', task: next });
            this.runCallbacks(this.completeCallbacks, next.taskId, next);
        } else if (becameFailed) {
            this.emit({ type: 'fail', task: next });
            this.runCallbacks(this.failCallbacks, next.taskId, next);
        } else {
            this.emit({ type: 'update', task: next });
        }
        return next;
    }


    complete(taskId: string, result?: { resultUrls?: string[]; progress?: number }): RegisteredTask | null {
        return this.update(taskId, {
            status: 'completed',
            progress: result?.progress ?? 1,
            ...(result?.resultUrls ? { resultUrls: result.resultUrls } : {}),
        });
    }





    updateMetadata(taskId: string, partial: Record<string, unknown>): RegisteredTask | null {
        return this.update(taskId, { metadata: partial });
    }


    fail(taskId: string, error: string): RegisteredTask | null {
        return this.update(taskId, { status: 'failed', error });
    }


    cancel(taskId: string): RegisteredTask | null {
        const existing = this.get(taskId);
        if (!existing) return null;
        const next: RegisteredTask = {
            ...existing,
            status: 'cancelled',
            completedAt: Date.now(),
        };
        this.tasks.set(next.taskId, next);
        this.persist();
        this.emit({ type: 'cancel', task: next });
        return next;
    }


    remove(taskId: string): void {
        taskId = this.get(taskId)?.taskId || taskId;
        if (!this.tasks.has(taskId)) return;
        this.tasks.delete(taskId);
        this.completeCallbacks.delete(taskId);
        this.failCallbacks.delete(taskId);
        this.persist();
        this.emit({ type: 'remove', taskId });
    }


    clearCompleted(olderThanMs: number = COMPLETED_RETAIN_MS): number {
        const cutoff = Date.now() - olderThanMs;
        let removed = 0;
        for (const [taskId, t] of this.tasks) {
            if ((t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
                && t.completedAt
                && t.completedAt < cutoff) {
                this.tasks.delete(taskId);
                this.completeCallbacks.delete(taskId);
                this.failCallbacks.delete(taskId);
                removed++;
            }
        }
        if (removed > 0) {
            this.persist();
            this.emit({ type: 'rehydrate', tasks: this.list() });
        }
        return removed;
    }



    get(taskId: string): RegisteredTask | undefined {
        for (const task of this.tasks.values()) {
            if (task.taskId !== taskId && task.metadata?.backendTaskId === taskId) return task;
        }
        return this.tasks.get(taskId);
    }

    /** Only an explicit submission-to-backend link may collapse two records. */
    private collapseBackendDuplicate(task: RegisteredTask): void {
        const backendId = task.metadata?.backendTaskId;
        if (typeof backendId !== 'string' || !backendId || backendId === task.taskId) return;
        const duplicate = this.tasks.get(backendId);
        if (!duplicate) return;
        this.tasks.delete(backendId);
        for (const callbacks of [this.completeCallbacks, this.failCallbacks]) {
            const source = callbacks.get(backendId);
            if (!source) continue;
            const target = callbacks.get(task.taskId) || new Set<TaskCompleteListener>();
            source.forEach(callback => target.add(callback));
            callbacks.set(task.taskId, target);
            callbacks.delete(backendId);
        }
        if (isActive(task.status)) {
            this.update(backendId, {
                status: duplicate.status,
                progress: duplicate.progress ?? task.progress,
                completedAt: duplicate.completedAt,
                error: duplicate.error,
                notificationId: duplicate.notificationId,
                metadata: { ...duplicate.metadata, ...task.metadata },
            });
        }
    }

    list(filter?: TaskFilter): RegisteredTask[] {
        const all = Array.from(this.tasks.values());
        let out = all;
        if (filter?.status) {
            const allowed = Array.isArray(filter.status) ? filter.status : [filter.status];
            out = out.filter(t => allowed.includes(t.status));
        }
        if (filter?.targetPage) {
            const allowed = Array.isArray(filter.targetPage) ? filter.targetPage : [filter.targetPage];
            out = out.filter(t => allowed.includes(t.targetPage));
        }
        if (filter?.kind) {
            const allowed = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
            out = out.filter(t => allowed.includes(t.kind));
        }
        if (filter?.episodeId) {
            out = out.filter(t => t.episodeId === filter.episodeId);
        }

        return out.sort((a, b) => {
            const aActive = isActive(a.status);
            const bActive = isActive(b.status);
            if (aActive !== bActive) return aActive ? -1 : 1;
            if (aActive) return a.createdAt - b.createdAt;
            return (b.completedAt || 0) - (a.completedAt || 0);
        });
    }


    countActiveByPage(): Record<SourcePage, number> {
        const counts = {} as Record<SourcePage, number>;
        for (const t of this.tasks.values()) {
            if (isActive(t.status)) {
                counts[t.targetPage] = (counts[t.targetPage] || 0) + 1;
            }
        }
        return counts;
    }


    summaryByPage(): Record<SourcePage, { running: number; queued: number; pending: number }> {
        const out = {} as Record<SourcePage, { running: number; queued: number; pending: number }>;
        for (const t of this.tasks.values()) {
            if (!isActive(t.status)) continue;
            const bucket = (out[t.targetPage] = out[t.targetPage] || { running: 0, queued: 0, pending: 0 });
            if (t.status === 'running') bucket.running++;
            else if (t.status === 'queued') bucket.queued++;
            else if (t.status === 'pending') bucket.pending++;
        }
        return out;
    }



    subscribe(listener: RegistryListener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }


    onComplete(taskId: string, callback: TaskCompleteListener): () => void {
        taskId = this.get(taskId)?.taskId || taskId;
        const existing = this.tasks.get(taskId);
        if (existing && existing.status === 'completed') {

            try { callback(existing); } catch (e) { console.error('[taskRegistry] onComplete callback error', e); }
            return () => {};
        }
        const set = this.completeCallbacks.get(taskId) || new Set<TaskCompleteListener>();
        set.add(callback);
        this.completeCallbacks.set(taskId, set);
        return () => {
            const s = this.completeCallbacks.get(taskId);
            if (s) {
                s.delete(callback);
                if (s.size === 0) this.completeCallbacks.delete(taskId);
            }
        };
    }

    onFail(taskId: string, callback: TaskCompleteListener): () => void {
        taskId = this.get(taskId)?.taskId || taskId;
        const existing = this.tasks.get(taskId);
        if (existing && existing.status === 'failed') {
            try { callback(existing); } catch (e) { console.error('[taskRegistry] onFail callback error', e); }
            return () => {};
        }
        const set = this.failCallbacks.get(taskId) || new Set<TaskCompleteListener>();
        set.add(callback);
        this.failCallbacks.set(taskId, set);
        return () => {
            const s = this.failCallbacks.get(taskId);
            if (s) {
                s.delete(callback);
                if (s.size === 0) this.failCallbacks.delete(taskId);
            }
        };
    }



    private persist(): void {
        const storage = this.resolveStorage();
        if (!storage) return;
        try {

            const all = Array.from(this.tasks.values());
            const active = all.filter(t => isActive(t.status));
            const done = all
                .filter(t => !isActive(t.status))
                .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
                .slice(0, MAX_COMPLETED_KEEP);
            const payload = { active, done, savedAt: Date.now() };
            storage.setItem(this.storageKey(), JSON.stringify(payload));
        } catch (err) {

            console.warn('[taskRegistry] persist failed:', err);
        }
    }

    rehydrate(): RegisteredTask[] {
        const storage = this.resolveStorage();
        if (!storage) return [];
        try {
            // The legacy unscoped cache has unknown ownership and must never be
            // shown after an account switch.
            storage.removeItem(STORAGE_KEY_PREFIX);
            const raw = storage.getItem(this.storageKey());
            if (!raw) return [];
            const data = JSON.parse(raw) as { active?: RegisteredTask[]; done?: RegisteredTask[] };
            const all = [...(data.active || []), ...(data.done || [])];
            const linkedBackendIds = new Set(all.map(t => t.metadata?.backendTaskId).filter(Boolean));
            this.tasks.clear();

            const cutoff = Date.now() - COMPLETED_RETAIN_MS;
            const staleCutoff = Date.now() - STALE_ACTIVE_MS;
            let mutated = false;
            for (const t of all) {
                // Earlier versions incorrectly failed submitted local IDs on reload.
                // Their backend task still owns the actual outcome.
                if (t.metadata?.backendTaskId && t.error === FRONTEND_QUEUE_TASK_LOST_MESSAGE) {
                    t.status = 'running';
                    t.error = undefined;
                    t.completedAt = undefined;
                    mutated = true;
                }
                if (!isActive(t.status)) {
                    if (t.completedAt && t.completedAt < cutoff) { mutated = true; continue; }
                    this.tasks.set(t.taskId, t);
                    continue;
                }

                if (isFrontendOnlyQueueTask(t)) {
                    this.tasks.set(t.taskId, {
                        ...t,
                        status: 'failed',
                        completedAt: Date.now(),
                        error: FRONTEND_QUEUE_TASK_LOST_MESSAGE,
                    });
                    mutated = true;
                } else if (t.createdAt < staleCutoff && !t.metadata?.backendTaskId && !linkedBackendIds.has(t.taskId)) {
                    this.tasks.set(t.taskId, { ...t, status: 'failed', completedAt: Date.now(), error: '任务超时，已自动清理' });
                    mutated = true;
                } else {
                    this.tasks.set(t.taskId, t);
                }
            }
            for (const task of this.tasks.values()) this.collapseBackendDuplicate(task);
            if (mutated) this.persist();
            const snapshot = this.list();
            this.emit({ type: 'rehydrate', tasks: snapshot });
            return snapshot;
        } catch (err) {
            console.warn('[taskRegistry] rehydrate failed:', err);
            return [];
        }
    }












    mergeFromServer(serverTasks: RegisteredTask[]): { added: number; skipped: number; updated: number } {
        let added = 0;
        let skipped = 0;
        let updated = 0;
        for (const incoming of serverTasks) {
            if (!incoming || !incoming.taskId) {
                skipped++;
                continue;
            }
            const existing = this.get(incoming.taskId);
            if (!existing) {
                this.tasks.set(incoming.taskId, incoming);
                added++;
            } else if (isActive(existing.status) && isActive(incoming.status)) {

                skipped++;
            } else if (isActive(existing.status) || (existing.status === 'failed' && incoming.status === 'completed')) {


                this.update(incoming.taskId, {
                    ...existing,
                    ...incoming,
                    createdAt: existing.createdAt || incoming.createdAt,
                    startedAt: existing.startedAt || incoming.startedAt,
                    targetProjectId: incoming.targetProjectId || existing.targetProjectId,
                    targetItemId: incoming.targetItemId || existing.targetItemId,
                    targetEntityType: incoming.targetEntityType || existing.targetEntityType,
                    targetEntityId: incoming.targetEntityId || existing.targetEntityId,
                    episodeId: incoming.episodeId || existing.episodeId,
                    fileRole: incoming.fileRole || existing.fileRole,
                    metadata: {
                        ...(existing.metadata || {}),
                        ...(incoming.metadata || {}),
                    },
                });
                updated++;
            } else {

                this.tasks.set(existing.taskId, {
                    ...incoming,
                    ...existing,
                    createdAt: existing.createdAt || incoming.createdAt,
                    startedAt: existing.startedAt || incoming.startedAt,
                    completedAt: existing.completedAt || incoming.completedAt,
                    notificationId: incoming.notificationId || existing.notificationId,
                    metadata: {
                        ...(incoming.metadata || {}),
                        ...(existing.metadata || {}),
                    },
                });
                updated++;
            }
        }
        if (added > 0 || updated > 0) {
            this.persist();
            this.emit({ type: 'rehydrate', tasks: this.list() });
        }
        return { added, skipped, updated };
    }


    reset(): void {
        this.tasks.clear();
        this.completeCallbacks.clear();
        this.failCallbacks.clear();
        const storage = this.resolveStorage();
        if (storage) {
            try { storage.removeItem(this.storageKey()); } catch { /* ignore */ }
        }
        this.emit({ type: 'rehydrate', tasks: [] });
    }



    private emit(event: TaskRegistryEvent): void {
        const snapshot = this.list();
        this.listeners.forEach(l => {
            try { l(event, snapshot); } catch (e) {
                console.error('[taskRegistry] listener error', e);
            }
        });
    }

    private runCallbacks(
        map: Map<string, Set<TaskCompleteListener>>,
        taskId: string,
        task: RegisteredTask,
    ): void {
        const set = map.get(taskId);
        if (!set) return;

        const callbacks = Array.from(set);
        for (const cb of callbacks) {
            try { cb(task); } catch (e) {
                console.error('[taskRegistry] task callback error', e);
            }
        }

        map.delete(taskId);
    }
}

function isActive(status: GlobalTaskStatus): boolean {
    return status === 'pending' || status === 'queued' || status === 'running';
}

function isFrontendOnlyQueueTask(task: RegisteredTask): boolean {
    return FRONTEND_QUEUE_TASK_ID_RE.test(task.taskId) && !task.metadata?.backendTaskId;
}


export const taskRegistry = new TaskRegistry();


export { TaskRegistry };
