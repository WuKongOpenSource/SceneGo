import { useCallback, useEffect, useRef, useState } from 'react';

/** Serialize through the supplied store and keep dirty state until the latest value is acknowledged. */
export function useWorkspaceSave<T>(save: (value: T) => Promise<void>, value: T, delay = 700) {
  const current = useRef({ save, value });
  current.current = { save, value };
  const mounted = useRef(false);
  const acknowledged = useRef<{ save: typeof save; value: T } | null>(null);
  const pending = useRef<{ save: typeof save; value: T; promise: Promise<boolean> } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<'pending' | 'saving' | 'saved' | 'error'>('pending');

  useEffect(() => {
    mounted.current = true;
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      const saved = acknowledged.current;
      if (saved?.save !== current.current.save || saved?.value !== current.current.value) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warnUnsaved);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', warnUnsaved); };
  }, []);

  const persist = useCallback((snapshot: T): Promise<boolean> => {
    const existing = pending.current;
    // Deduplicate only the newest queued write. An undo to an older in-flight
    // value still needs a fresh write after any intervening snapshots.
    if (existing?.save === save && existing.value === snapshot) return existing.promise;
    if (!existing && acknowledged.current?.save === save && acknowledged.current.value === snapshot) {
      if (mounted.current) setStatus('saved');
      return Promise.resolve(true);
    }
    acknowledged.current = null;
    if (mounted.current) setStatus('saving');
    const request = Promise.resolve().then(() => save(snapshot)).then(() => {
      if (!mounted.current || current.current.save !== save) return false;
      if (pending.current?.promise === request) {
        acknowledged.current = { save, value: snapshot };
        if (current.current.value === snapshot) setStatus('saved');
      }
      return true;
    }).catch(() => {
      if (mounted.current && current.current.save === save && current.current.value === snapshot && pending.current?.promise === request) setStatus('error');
      return false;
    }).finally(() => { if (pending.current?.promise === request) pending.current = null; });
    pending.current = { save, value: snapshot, promise: request };
    return request;
  }, [save]);

  useEffect(() => {
    setStatus('pending');
    timer.current = window.setTimeout(() => { void persist(value); }, delay);
    return () => window.clearTimeout(timer.current);
  }, [value, persist, delay]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    // Editing can continue during a slow save. Navigation must wait for the
    // newest snapshot too, not only the one captured by the original click.
    while (mounted.current && current.current.save === save) {
      const latest = current.current.value;
      if (!await persist(latest)) return false;
      if (current.current.value === latest && acknowledged.current?.save === save && acknowledged.current.value === latest) return true;
    }
    return false;
  }, [save, persist]);

  return { status, saveNow };
}
