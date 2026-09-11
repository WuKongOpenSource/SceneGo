// Page-scoped transient state that survives navigation and reload.







import { useCallback, useEffect, useRef, useState } from 'react';

export interface PersistedPageStateOptions<T> {

    page: string;

    episodeId?: string | null;

    version: number;

    defaultValue: T;

    storage?: Storage | null;
}

const STORAGE_KEY_PREFIX = 'ostory:page-state';

export function buildStorageKey(page: string, episodeId: string | null | undefined, version: number): string {
    const epi = episodeId == null || episodeId === '' ? 'global' : episodeId;
    return `${STORAGE_KEY_PREFIX}:v${version}:${page}:${epi}`;
}

function safeGetStorage(custom?: Storage | null): Storage | null {
    if (custom !== undefined) return custom;
    if (typeof window === 'undefined') return null;
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

function loadInitial<T>(
    page: string,
    episodeId: string | null | undefined,
    version: number,
    defaultValue: T,
    storage: Storage | null,
): T {
    if (!storage) return defaultValue;
    try {
        const key = buildStorageKey(page, episodeId, version);
        const raw = storage.getItem(key);
        if (raw == null) return defaultValue;
        const parsed = JSON.parse(raw);
        return parsed as T;
    } catch (err) {
        console.warn(`[usePersistedPageState] load failed for ${page}:`, err);
        return defaultValue;
    }
}

/**
 * Persist a piece of React state to sessionStorage scoped by page + episodeId.
 *
 * Switching episodeId loads that episode's value (or default if first visit).
 * Refreshing keeps the value. Closing the tab clears (sessionStorage semantics).
 */
export function usePersistedPageState<T>(
    options: PersistedPageStateOptions<T>,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
    const { page, episodeId, version, defaultValue, storage: customStorage } = options;
    const storageRef = useRef<Storage | null>(safeGetStorage(customStorage));

    const skipNextSaveRef = useRef<boolean>(false);

    const [value, setValue] = useState<T>(() =>
        loadInitial(page, episodeId, version, defaultValue, storageRef.current),
    );

    const lastEpiRef = useRef<string | null | undefined>(episodeId);
    useEffect(() => {
        if (lastEpiRef.current !== episodeId) {
            lastEpiRef.current = episodeId;
            const next = loadInitial(page, episodeId, version, defaultValue, storageRef.current);

            skipNextSaveRef.current = true;
            setValue(next);
        }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, episodeId, version]);

    useEffect(() => {
        if (skipNextSaveRef.current) {
            skipNextSaveRef.current = false;
            return;
        }
        const storage = storageRef.current;
        if (!storage) return;
        try {
            const key = buildStorageKey(page, episodeId, version);
            storage.setItem(key, JSON.stringify(value));
        } catch (err) {
            console.warn(`[usePersistedPageState] save failed for ${page}:`, err);
        }
    }, [page, episodeId, version, value]);

    const clear = useCallback(() => {
        const storage = storageRef.current;
        if (storage) {
            try {
                const key = buildStorageKey(page, episodeId, version);
                storage.removeItem(key);
            } catch (err) {
                console.warn(`[usePersistedPageState] clear failed for ${page}:`, err);
            }
        }

        skipNextSaveRef.current = true;
        setValue(defaultValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, episodeId, version]);

    return [value, setValue, clear];
}
