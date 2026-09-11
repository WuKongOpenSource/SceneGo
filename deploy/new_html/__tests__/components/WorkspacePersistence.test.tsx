import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLoadBoundary } from '../../components/WorkspaceLoadBoundary';
import { useWorkspaceSave } from '../../hooks/useWorkspaceSave';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function flush() { await act(async () => {}); }
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('read-before-write workspace boundary', () => {
  it('never starts an editor or autosave after a failed read, then allows a valid retry', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const load = vi.fn<() => Promise<{ title: string }>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ title: 'original' });
    function Editor({ value }: { value: { title: string } }) { useWorkspaceSave(save, value); return <p>{value.title}</p>; }
    render(<WorkspaceLoadBoundary load={load} onBack={vi.fn()}>{value => <Editor value={value} />}</WorkspaceLoadBoundary>);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('未启用自动保存');
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('重新加载'));
    await flush();
    expect(screen.getByText('original')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(save).toHaveBeenCalledWith({ title: 'original' });
  });

  it('allows explicit null as a confirmed new workspace, not as a failed read', async () => {
    const load = vi.fn().mockResolvedValue(null);
    render(<WorkspaceLoadBoundary load={load} onBack={vi.fn()}>{value => <p>{value === null ? 'new workspace' : 'existing'}</p>}</WorkspaceLoadBoundary>);
    await flush();
    expect(screen.getByText('new workspace')).toBeInTheDocument();
  });

  it('does not reuse or overwrite the previous episode while the new episode loads', async () => {
    const pending = deferred<string>();
    const loadFirst = vi.fn().mockResolvedValue('first');
    const loadNext = vi.fn(() => pending.promise);
    const child = (value: string) => <p>{value}</p>;
    const view = render(<WorkspaceLoadBoundary load={loadFirst} onBack={vi.fn()}>{child}</WorkspaceLoadBoundary>);
    await flush();
    expect(screen.getByText('first')).toBeInTheDocument();
    view.rerender(<WorkspaceLoadBoundary load={loadNext} onBack={vi.fn()}>{child}</WorkspaceLoadBoundary>);
    expect(screen.queryByText('first')).not.toBeInTheDocument();
    await act(async () => { pending.resolve('second'); });
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('ignores a late result from a discarded episode and exposes a non-saving exit', async () => {
    const old = deferred<string>();
    const next = deferred<string>();
    const loadOld = () => old.promise;
    const loadNext = () => next.promise;
    const back = vi.fn();
    const child = (value: string) => <p>{value}</p>;
    const view = render(<WorkspaceLoadBoundary load={loadOld} onBack={back}>{child}</WorkspaceLoadBoundary>);
    view.rerender(<WorkspaceLoadBoundary load={loadNext} onBack={back}>{child}</WorkspaceLoadBoundary>);
    await act(async () => { old.resolve('stale'); });
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('返回分集'));
    expect(back).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => { next.resolve('also stale'); });
    expect(screen.queryByText('also stale')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('offers retry after a timeout and never accepts the timed-out result', async () => {
    const pending = deferred<string>();
    render(<WorkspaceLoadBoundary load={() => pending.promise} onBack={vi.fn()}>{value => <p>{value}</p>}</WorkspaceLoadBoundary>);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.getByText('重新加载')).toBeInTheDocument();
    await act(async () => { pending.resolve('late'); });
    expect(screen.queryByText('late')).not.toBeInTheDocument();
  });
});

describe('workspace save lifecycle', () => {
  it('debounces updates and persists the latest snapshot', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const first = { title: 'first' }, next = { title: 'next' };
    const view = renderHook(({ value }) => useWorkspaceSave(save, value), { initialProps: { value: first } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    view.rerender({ value: next });
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(save).toHaveBeenCalledExactlyOnceWith(next);
    expect(view.result.current.status).toBe('saved');
  });

  it('keeps save failures dirty and allows retry without changing the in-memory snapshot', async () => {
    const value = { title: 'important draft' };
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const view = renderHook(() => useWorkspaceSave(save, value));
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(view.result.current.status).toBe('error');
    const warning = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(warning);
    expect(warning.defaultPrevented).toBe(true);
    await act(async () => { expect(await view.result.current.saveNow()).toBe(true); });
    expect(save.mock.calls.map(call => call[0])).toEqual([value, value]);
    expect(view.result.current.status).toBe('saved');
    const safeExit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(safeExit);
    expect(safeExit.defaultPrevented).toBe(false);
  });

  it('does not authorize navigation after a rejected final save', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const view = renderHook(() => useWorkspaceSave(save, 'draft'));
    await act(async () => { expect(await view.result.current.saveNow()).toBe(false); });
    expect(view.result.current.status).toBe('error');
  });

  it('waits for edits made during final saving before authorizing navigation', async () => {
    const first = deferred<void>(), second = deferred<void>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = renderHook(({ value }) => useWorkspaceSave(save, value), { initialProps: { value: 'first' } });
    let finished = false;
    let exit!: Promise<boolean>;
    await act(async () => { exit = view.result.current.saveNow(); void exit.then(() => { finished = true; }); });
    view.rerender({ value: 'newest' });
    await act(async () => { first.resolve(); });
    expect(save.mock.calls.map(call => call[0])).toEqual(['first', 'newest']);
    expect(finished).toBe(false);
    await act(async () => { second.resolve(); expect(await exit).toBe(true); });
    expect(view.result.current.status).toBe('saved');
  });

  it('deduplicates autosave and repeated exit clicks for one snapshot', async () => {
    const pending = deferred<void>();
    const save = vi.fn(() => pending.promise);
    const view = renderHook(() => useWorkspaceSave(save, 'draft'));
    await act(() => vi.advanceTimersByTimeAsync(700));
    let first!: Promise<boolean>, second!: Promise<boolean>;
    await act(async () => { first = view.result.current.saveNow(); second = view.result.current.saveNow(); });
    expect(save).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve(); expect(await first).toBe(true); expect(await second).toBe(true); });
  });

  it('cancels debounced writes and navigation acknowledgement after unmount', async () => {
    const pending = deferred<void>();
    const save = vi.fn(() => pending.promise);
    const view = renderHook(() => useWorkspaceSave(save, 'draft'));
    let exit!: Promise<boolean>;
    await act(async () => { exit = view.result.current.saveNow(); });
    view.unmount();
    pending.resolve();
    expect(await exit).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never acknowledges an old owner save for a new workspace owner', async () => {
    const old = deferred<void>();
    const oldSave = vi.fn(() => old.promise), nextSave = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(({ save }) => useWorkspaceSave(save, 'same-value'), { initialProps: { save: oldSave } });
    let previous!: Promise<boolean>;
    await act(async () => { previous = view.result.current.saveNow(); });
    view.rerender({ save: nextSave });
    await act(async () => { expect(await view.result.current.saveNow()).toBe(true); old.resolve(); });
    expect(await previous).toBe(false);
    expect(nextSave).toHaveBeenCalledOnce();
  });

  it('persists an undo after an intervening queued value, even when the original value is still pending', async () => {
    const first = deferred<void>(), middle = deferred<void>(), undo = deferred<void>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(middle.promise).mockReturnValueOnce(undo.promise);
    const view = renderHook(({ value }) => useWorkspaceSave(save, value), { initialProps: { value: 'original' } });
    await act(() => vi.advanceTimersByTimeAsync(700));
    view.rerender({ value: 'changed' });
    await act(() => vi.advanceTimersByTimeAsync(700));
    view.rerender({ value: 'original' });
    let exit!: Promise<boolean>;
    let finished = false;
    await act(async () => { exit = view.result.current.saveNow(); void exit.then(() => { finished = true; }); });
    expect(save.mock.calls.map(call => call[0])).toEqual(['original', 'changed', 'original']);
    await act(async () => { first.resolve(); middle.resolve(); });
    expect(finished).toBe(false);
    const warning = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(warning);
    expect(warning.defaultPrevented).toBe(true);
    await act(async () => { undo.resolve(); expect(await exit).toBe(true); });
    expect(view.result.current.status).toBe('saved');
  });

  it('does not reuse an old acknowledgement while an intervening save is in flight', async () => {
    const middle = deferred<void>();
    const save = vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(middle.promise).mockResolvedValueOnce(undefined);
    const view = renderHook(({ value }) => useWorkspaceSave(save, value), { initialProps: { value: 'original' } });
    await act(() => vi.advanceTimersByTimeAsync(700));
    view.rerender({ value: 'changed' });
    await act(() => vi.advanceTimersByTimeAsync(700));
    view.rerender({ value: 'original' });
    await act(async () => { middle.resolve(); expect(await view.result.current.saveNow()).toBe(true); });
    expect(save.mock.calls.map(call => call[0])).toEqual(['original', 'changed', 'original']);
  });

  it('restores saved status when undoing an edit before its debounce fires', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(({ value }) => useWorkspaceSave(save, value), { initialProps: { value: 'original' } });
    await act(() => vi.advanceTimersByTimeAsync(700));
    view.rerender({ value: 'changed' });
    view.rerender({ value: 'original' });
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(save).toHaveBeenCalledOnce();
    expect(view.result.current.status).toBe('saved');
  });
});
