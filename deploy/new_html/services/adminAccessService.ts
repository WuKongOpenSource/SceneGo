import { apiJson } from './httpClient';

export interface CurrentAdminSession {
  user_id: string;
  username: string;
  role: 'admin' | 'super_admin';
}

let cachedRequest: Promise<CurrentAdminSession | null> | null = null;

/**
 * Resolve whether the currently logged-in creator account may enter the admin
 * shell. This controls visibility only; every admin API still performs its own
 * server-side role check.
 */
export function getCurrentAdminSession(): Promise<CurrentAdminSession | null> {
  if (cachedRequest) return cachedRequest;

  cachedRequest = apiJson<CurrentAdminSession>('/api/admin/session', { method: 'GET' }, '后台入口权限校验')
    .then(session => session?.role === 'admin' || session?.role === 'super_admin' ? session : null)
    .catch(() => null);
  return cachedRequest;
}

export function clearAdminAccessCache(): void {
  cachedRequest = null;
}
