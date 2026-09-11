export const AUTH_TOKEN_KEY = 'auth_token';
export const USERNAME_KEY = 'username';
export const USER_ID_KEY = 'user_id';

export interface AccountIdentity {
  token?: string | null;
  username?: string | null;
  userId?: string | null;
}

export function getStoredUsername(fallback = 'User'): string {
  try {
    return localStorage.getItem(USERNAME_KEY)?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export function getStoredUserId(fallback = ''): string {
  try {
    return (
      localStorage.getItem(USER_ID_KEY)?.trim()
      || localStorage.getItem(USERNAME_KEY)?.trim()
      || fallback
    );
  } catch {
    return fallback;
  }
}

export function applyAccountIdentity(identity: AccountIdentity): void {
  try {
    // Authentication is held by an HttpOnly cookie. A token may still be
    // returned temporarily for non-browser API compatibility, but must never
    // be persisted in script-readable browser storage.
    localStorage.removeItem(AUTH_TOKEN_KEY);
    if (identity.username) localStorage.setItem(USERNAME_KEY, identity.username);
    if (identity.userId) localStorage.setItem(USER_ID_KEY, identity.userId);
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('account:updated', { detail: identity }));
  }
}

export function clearAccountIdentity(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem(USER_ID_KEY);
  } catch {}
}
