import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const loginHtml = readFileSync(resolve(__dirname, '../../../login.html'), 'utf-8').replace(/\r\n/g, '\n');

describe('login return destination', () => {
  const redirectSource = loginHtml.match(/function safeLoginRedirect[\s\S]*?(?=\n        const hasPendingPhoneBinding)/)?.[0];
  function redirect(value: string): string {
    expect(redirectSource).toBeTruthy();
    const sandbox = { URL, URLSearchParams, location: { origin: 'https://app.example.test', search: '' }, ADMIN_ENTRY_PATH: '/admin', value };
    return runInNewContext(`${redirectSource}\nsafeLoginRedirect(value)`, sandbox);
  }
  it.each(['/studio', '/studio/?projectId=p-1&episodeId=e-1#canvas', '/admin/settings'])('allows the same-origin workspace or administrator destination %s', path => {
    expect(redirect(path)).toBe(path);
  });
  it.each(['https://outside.example.test/studio/', '//outside.example.test/studio/', 'javascript:alert(1)', '/studio-other/', '/login', '/projects', '',
    '/\\outside.example.test/studio/', '/\t/outside.example.test/studio/', '/studio/..//outside.example.test/',
    '/studio/%2e%2e//outside.example.test/', '/admin/../login', 'https://app.example.test@outside.example.test/studio/',
  ])('rejects an unapproved destination %s', path => {
    expect(redirect(path)).toBe('');
  });
});

describe('unified account and phone login contract', () => {
  it('uses one password-login identity field without a separate legacy entry', () => {
    expect(loginHtml).toContain("authSubtitle.textContent = '使用手机号继续完成你的故事'");
    expect(loginHtml).toContain("state.method === 'password' ? 'text' : 'tel',\n                    '手机号',");
    expect(loginHtml).not.toContain('手机号或原账号');
    expect(loginHtml).toContain("authFooter.innerHTML = `还没有账号？ ${footerButton('创建账号', 'register')}`");
    expect(loginHtml).not.toContain("footerButton('旧账号登录', 'legacy')");
    expect(loginHtml).not.toContain("state.view === 'legacy'");
  });

  it('routes password identities by phone shape and preserves mandatory binding', () => {
    expect(loginHtml).toContain("const identity = field('identity')");
    expect(loginHtml).toContain("const phoneLogin = isMainlandPhone(identity)");
    expect(loginHtml).toContain("await api('/api/login', { username: identity, password: field('password'), captcha_verification: captchaVerification })");
    expect(loginHtml).toContain("await api('/api/auth/phone/login'");
    expect(loginHtml).toContain('result.requires_phone_binding && result.binding_token');
    expect(loginHtml).toContain("setView('bind')");
  });

  it('keeps verification-code login phone-only and normalizes old bookmarks', () => {
    expect(loginHtml).toContain("state.method === 'sms_code' && !phoneLogin");
    expect(loginHtml).toContain("location.pathname === '/legacy-login'");
    expect(loginHtml).toContain("history.replaceState(null, '', '/login')");
  });

  it('uses an HttpOnly server session instead of persisting JWTs in localStorage', () => {
    expect(loginHtml).toContain("credentials: 'same-origin'");
    expect(loginHtml).toContain("response.headers.get('x-ostory-session-upgraded') === '1'");
    expect(loginHtml).toContain("localStorage.removeItem('auth_token')");
    expect(loginHtml).not.toContain("localStorage.setItem('auth_token'");
    expect(loginHtml).not.toContain("const TOKEN_KEY = 'auth_token'");
  });

  it('validates new passwords locally and renders structured API errors readably', () => {
    expect(loginHtml).toContain('minlength="8" maxlength="128"');
    expect(loginHtml).toContain("if (field('password').length < 8) throw new Error('密码至少需要 8 位')");
    expect(loginHtml).toContain('function validationErrorMessage(payload');
    expect(loginHtml).toContain("item.type === 'string_too_short'");
    expect(loginHtml).toContain('throw new Error(validationErrorMessage(payload))');
    expect(loginHtml).not.toContain("throw new Error(payload.detail || payload.error || '请求失败，请稍后重试')");
  });
});

describe('login card secondary actions', () => {
  it('keeps slider verification on demand without rendering explanatory chrome', () => {
    expect(loginHtml).toContain("await requireCaptcha('login')");
    expect(loginHtml).toContain("await requireCaptcha(`sms_${purpose}`)");
    expect(loginHtml).toContain('id="captchaStatus" class="visually-hidden"');
    expect(loginHtml).not.toContain('操作时弹出拼图，无需等待第三方验证');
    expect(loginHtml).not.toContain('id="captchaVerifyBtn"');
  });

  it('renders a styled password-reset action only for password login', () => {
    expect(loginHtml).toContain('class="forgot-password-button"');
    expect(loginHtml).toContain('.forgot-password-button:focus-visible');
    expect(loginHtml).toContain('min-height: 40px');
    expect(loginHtml).toContain("(state.method === 'password' ? forgotPasswordButton() : '')");
    expect(loginHtml).not.toContain('class="form-row"');
  });
});
