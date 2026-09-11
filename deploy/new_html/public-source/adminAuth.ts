/** Public-edition administrator UI state; authentication stays in HttpOnly cookies. */

export const ADMIN_USERNAME_KEY = 'admin_session_username';
export const ADMIN_LOGIN_AT_KEY = 'admin_session_login_at';
export const ADMIN_ROLE_KEY = 'admin_session_role';

export function getAdminUsername(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_USERNAME_KEY);
  } catch {
    return null;
  }
}

export function getAdminRole(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_ROLE_KEY);
  } catch {
    return null;
  }
}

export function setAdminSession(username: string, role?: string): void {
  try {
    sessionStorage.setItem(ADMIN_USERNAME_KEY, username);
    sessionStorage.setItem(ADMIN_LOGIN_AT_KEY, String(Date.now()));
    if (role) sessionStorage.setItem(ADMIN_ROLE_KEY, role);
  } catch {
    // UI metadata is optional; server-side authorization remains authoritative.
  }
}

export function clearAdminSession(): void {
  try {
    sessionStorage.removeItem(ADMIN_USERNAME_KEY);
    sessionStorage.removeItem(ADMIN_LOGIN_AT_KEY);
    sessionStorage.removeItem(ADMIN_ROLE_KEY);
  } catch {
    // UI metadata cleanup must not interfere with the server-side logout path.
  }
}

export function pickTokenForCurrentRoute(): null {
  return null;
}
