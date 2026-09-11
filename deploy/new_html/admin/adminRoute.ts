/**
 * Non-discoverable admin shell entry. This is only an obscurity layer; the
 * actual security boundary remains the authenticated role check on /api/admin.
 */
export const ADMIN_BASE_PATH = '/a7k9m3q8x2v6n4p';

export function adminPath(suffix = ''): string {
  if (!suffix) return ADMIN_BASE_PATH;
  return `${ADMIN_BASE_PATH}/${suffix.replace(/^\/+/, '')}`;
}

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_BASE_PATH || pathname.startsWith(`${ADMIN_BASE_PATH}/`);
}
