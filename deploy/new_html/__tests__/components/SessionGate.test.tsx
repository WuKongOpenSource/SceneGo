import React, { StrictMode, useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionGate } from '../../components/SessionGate';
import { expectSessionTransport } from '../../test/sessionTransport';

function response(status = 200) {
  return new Response(JSON.stringify({ username: 'test-user' }), { status, headers: { 'content-type': 'application/json' } });
}

describe('server-authenticated workspace entry', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });

  it('does not mount writable children until a cookie-only session is confirmed', async () => {
    let resolve!: (value: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(done => { resolve = done; }));
    const mounted = vi.fn();
    function Workspace() { useEffect(mounted, []); return <p>workspace</p>; }
    render(<SessionGate><Workspace /></SessionGate>);
    expect(screen.getByRole('status')).toHaveTextContent('正在确认登录状态');
    expect(mounted).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith('/api/user/info', expect.objectContaining({ credentials: 'same-origin' }));
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
    await act(async () => { resolve(response()); });
    expect(screen.getByText('workspace')).toBeInTheDocument();
    expect(mounted).toHaveBeenCalledOnce();
  });

  it('still asks the server when a legacy token is present', async () => {
    localStorage.setItem('auth_token', 'test-token');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    render(<SessionGate>workspace</SessionGate>);
    await screen.findByText('workspace');
    expectSessionTransport(fetchSpy.mock.calls[0][1]!);
  });

  it.each([403, 500, 503])('keeps HTTP %i failures outside the workspace and supports retry', async status => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(status)).mockResolvedValueOnce(response());
    render(<SessionGate>workspace</SessionGate>);
    await screen.findByRole('alert');
    expect(screen.queryByText('workspace')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText('workspace');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not treat a network failure as authenticated', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    render(<SessionGate>workspace</SessionGate>);
    await screen.findByRole('alert');
    expect(screen.queryByText('workspace')).not.toBeInTheDocument();
  });

  it('keeps an expired session out and clears stale account identity', async () => {
    const previousPath = window.location.pathname;
    window.history.replaceState({}, '', '/login');
    try {
      localStorage.setItem('username', 'stale-user');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(401));
      render(<SessionGate>workspace</SessionGate>);
      await screen.findByRole('alert');
      expect(screen.queryByText('workspace')).not.toBeInTheDocument();
      expect(localStorage.getItem('username')).toBeNull();
      expect(fetchSpy).toHaveBeenCalledOnce();
    } finally { window.history.replaceState({}, '', previousPath); }
  });

  it('aborts a stalled request and ignores its late success after timeout', async () => {
    vi.useFakeTimers();
    let resolve!: (value: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(done => { resolve = done; }));
    render(<SessionGate>workspace</SessionGate>);
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await act(async () => { resolve(response()); });
    expect(screen.queryByText('workspace')).not.toBeInTheDocument();
  });

  it('aborts the request and clears its deadline on unmount', () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    const view = render(<SessionGate>workspace</SessionGate>);
    view.unmount();
    expect(fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores stale successes from the StrictMode cleanup request', async () => {
    const pending: Array<(value: Response) => void> = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(done => { pending.push(done); }));
    render(<StrictMode><SessionGate>workspace</SessionGate></StrictMode>);
    expect(fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { pending[0](response()); });
    expect(screen.queryByText('workspace')).not.toBeInTheDocument();
    await act(async () => { pending[1](response()); });
    await waitFor(() => expect(screen.getByText('workspace')).toBeInTheDocument());
  });
});
