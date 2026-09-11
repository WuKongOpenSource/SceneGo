import React, { useEffect, useState } from 'react';
import { apiJson } from '../services/httpClient';

/** Mount background tasks and writable workspaces only after server authentication. */
export function SessionGate({ children }: React.PropsWithChildren) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // A stalled session check must leave a retry path instead of an endless spinner.
    const timer = window.setTimeout(() => {
      controller.abort();
      setState('error');
    }, 15_000);
    void apiJson('/api/user/info', { method: 'GET', signal: controller.signal }, 'checkSession', {
      includeContentType: false,
    }).then(() => {
      if (!controller.signal.aborted) setState('ready');
    }).catch(() => {
      if (!controller.signal.aborted) setState('error');
    }).finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [attempt]);

  if (state === 'ready') return <>{children}</>;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#141419] px-6 text-white">
      <section className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        {state === 'loading' ? <p role="status">正在确认登录状态…</p> : <>
          <p role="alert">暂时无法确认登录状态，请重试。</p>
          <button type="button" className="mt-6 rounded-lg bg-cyan-500 px-4 py-2" onClick={() => {
            setState('loading');
            setAttempt(value => value + 1);
          }}>重试</button>
        </>}
      </section>
    </main>
  );
}
