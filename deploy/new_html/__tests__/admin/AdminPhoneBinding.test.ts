import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicLogin = readFileSync(resolve(__dirname, '../../../login.html'), 'utf-8');

describe('admin main-login and verified-phone contract', () => {
  it('preserves a validated admin return path through phone binding', () => {
    expect(publicLogin).toContain("const BINDING_RETURN_KEY = 'legacy_phone_binding_return_to'");
    expect(publicLogin).toContain("state.view === 'bind' && Boolean(sessionStorage.getItem(BINDING_TOKEN_KEY))");
    expect(publicLogin).toContain('function safeLoginRedirect');
    expect(publicLogin).toContain('target.origin !== location.origin');
    expect(publicLogin).toContain('target.pathname === ADMIN_ENTRY_PATH || target.pathname.startsWith(`${ADMIN_ENTRY_PATH}/`)');
    expect(publicLogin).toContain('if (!adminTarget && !studioTarget) return');
    expect(publicLogin).toContain('saveSession(result)');
    expect(publicLogin).toContain('sessionStorage.removeItem(BINDING_TOKEN_KEY)');
    expect(publicLogin).toContain("window.location.href = returnTo || '/projects'");
    expect(publicLogin).not.toContain("sessionStorage.setItem('admin_session_token', result.token)");
  });
});
