import React, { useEffect, useState } from 'react';

type LoadState<T> = { load: () => Promise<T>; attempt: number } & (
  { status: 'ready'; value: T } | { status: 'error' }
);

/** Failed or obsolete reads must never mount an editor with default writable state. */
export function WorkspaceLoadBoundary<T>({ load, onBack, children }: {
  load: () => Promise<T>;
  onBack: () => void;
  children: (value: T) => React.ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState<T> | null>(null);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      active = false;
      setState({ load, attempt, status: 'error' });
    }, 30_000);
    void Promise.resolve().then(load).then(value => {
      if (active) setState({ load, attempt, status: 'ready', value });
    }).catch(() => {
      if (active) setState({ load, attempt, status: 'error' });
    }).finally(() => window.clearTimeout(timer));
    return () => { active = false; window.clearTimeout(timer); };
  }, [load, attempt]);

  const current = state?.load === load && state.attempt === attempt ? state : null;
  if (current?.status === 'ready') return <>{children(current.value)}</>;
  return <main className="flex min-h-screen items-center justify-center bg-[#141419] px-6 text-white">
    <section className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
      {current?.status === 'error' ? <>
        <p role="alert">画布加载失败，未启用自动保存。请重试；若仍失败，请联系管理员检查快照。</p>
        <button type="button" className="mt-6 rounded-lg bg-cyan-500 px-4 py-2" onClick={() => setAttempt(value => value + 1)}>重新加载</button>
      </> : <p role="status">正在加载画布…</p>}
      <button type="button" className="ml-3 mt-6 rounded-lg border border-white/20 px-4 py-2" onClick={onBack}>返回分集</button>
    </section>
  </main>;
}
