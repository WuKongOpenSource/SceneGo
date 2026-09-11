import { describe, expect, it, vi, beforeEach } from 'vitest';
import { apiFetch } from '../../services/httpClient';
import { cancelTask } from '../../services/taskControlService';

vi.mock('../../services/httpClient', () => ({ apiFetch: vi.fn() }));

describe('queued task cancellation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('waits for server confirmation, deduplicates clicks and refreshes credits', async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(apiFetch).mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const updated = vi.fn();
    window.addEventListener('credits:updated', updated);
    const first = cancelTask('queued-1');
    const second = cancelTask('queued-1');
    expect(first).toBe(second);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(updated).not.toHaveBeenCalled();
    resolve(new Response(JSON.stringify({ success: true, status: 'cancelled', refund_status: 'completed', message: '已退还积分' })));
    expect((await first).refund_status).toBe('completed');
    expect(updated).toHaveBeenCalledOnce();
    window.removeEventListener('credits:updated', updated);
  });

  it('surfaces execution conflicts and leaves the request retryable', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ detail: '任务已提交执行，无法取消' }), { status: 409 }));
    await expect(cancelTask('running-1')).rejects.toThrow('任务已提交执行');
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ success: true, status: 'cancelled', refund_status: 'pending', message: '积分退还处理中' })));
    expect((await cancelTask('running-1')).refund_status).toBe('pending');
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
