import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectSessionTransport } from '../../test/sessionTransport';
import {
  createUser,
  deleteUser,
  getGenerationLogs,
  getSystemStats,
  getUsers,
  updateUserPermissions,
} from '../../services/adminCompatService';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse(data: any) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => data,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.setItem('auth_token', 'test-token');
});

describe('admin compatibility service', () => {
  it('loads admin users', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, users: [] }));

    await getUsers();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/admin/users');
    expect(opts.method).toBe('GET');
    expectSessionTransport(opts);
  });

  it('creates admin users', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, user: { id: 'u1' } }));

    await createUser({ username: 'new-user', password: 'test-placeholder-credential' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/admin/users');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).username).toBe('new-user');
  });

  it('updates user permissions by id', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await updateUserPermissions('user_1', { can_generate: true });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/admin/users/user_1/permissions');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body).permissions.can_generate).toBe(true);
  });

  it('deletes users by id', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await deleteUser('user_1');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/admin/users/user_1');
    expect(opts.method).toBe('DELETE');
  });

  it('loads generation logs with explicit limit', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, logs: [] }));

    await getGenerationLogs(1000);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/admin/logs?limit=1000');
    expect(opts.method).toBe('GET');
  });

  it('loads system stats with grouping', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, stats: {}, group_by: 'user' }));

    await getSystemStats('user');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/admin/stats?group_by=user');
    expect(opts.method).toBe('GET');
  });
});
