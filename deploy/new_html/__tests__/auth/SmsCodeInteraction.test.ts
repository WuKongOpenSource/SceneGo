// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve(__dirname, '../../../login.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1];
const instances: JSDOM[] = [];
const flush = async () => { for (let i = 0; i < 18; i++) await Promise.resolve(); };
const token = 'slider.' + 'A'.repeat(43);

async function boot(options: { path?: string; enabled?: boolean; configPending?: boolean } = {}) {
  const dom = new JSDOM(html, { url: `https://tv.example.com${options.path || '/register'}`, runScripts: 'outside-only' });
  instances.push(dom);
  const win = dom.window as any;
  let accept!: (value: any) => void, cancel!: (error: any) => void;
  const widget = {
    verify: vi.fn(() => new Promise((resolve, reject) => { accept = resolve; cancel = reject; })),
    cancel: vi.fn(() => { if (cancel) { const error = new Error('cancel'); error.name = 'CaptchaCancelled'; cancel(error); } }),
  };
  const fetchMock = vi.fn(async (url: string, _options?: any): Promise<any> => {
    if (url === '/api/user/info') return { ok: false, headers: new Headers() };
    if (url === '/api/auth/captcha-config') {
      if (options.configPending) return new Promise((_resolve, reject) => _options.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError'))));
      return { ok: true, json: async () => ({ enabled: options.enabled !== false, provider: 'slider' }) };
    }
    return { ok: true, json: async () => ({ success: true, sent: true, resend_in: 60 }) };
  });
  win.fetch = fetchMock;
  win.AbortController = AbortController;
  win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
  win.setInterval = setInterval; win.clearInterval = clearInterval;
  win.OstorySliderCaptcha = function () { return widget; };
  win.eval(script);
  await flush();
  const phone = win.document.getElementById('phone') || win.document.getElementById('identity');
  phone.value = '13800000000';
  return { win, widget, fetchMock, accept: () => accept({ captcha_verification: token, expires_in: 60 }), smsCalls: () => fetchMock.mock.calls.filter(([url]) => url === '/api/auth/sms-code') };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const instance of instances.splice(0)) instance.window.close();
  vi.clearAllTimers(); vi.useRealTimers();
});

describe('SMS code interaction', () => {
  it('opens the puzzle on click and never sends before server verification', async () => {
    const { win, widget, smsCalls } = await boot();
    const pending = win.sendCode();
    await flush();
    expect(widget.verify).toHaveBeenCalledWith('sms_register');
    expect(win.document.getElementById('codeMessage').textContent).toContain('拖动滑块');
    expect(smsCalls()).toHaveLength(0);
    widget.cancel();
    await pending;
    expect(win.document.getElementById('codeMessage').textContent).toContain('已取消');
    expect(win.document.getElementById('sendCodeBtn').disabled).toBe(false);
  });

  it('does not submit before configuration loads and reports its timeout', async () => {
    const { win, smsCalls } = await boot({ configPending: true });
    const pending = win.sendCode();
    await vi.advanceTimersByTimeAsync(10000);
    await pending;
    expect(smsCalls()).toHaveLength(0);
    expect(win.document.getElementById('codeMessage').textContent).toContain('超时');
    expect(win.document.getElementById('sendCodeBtn').disabled).toBe(false);
  });

  it('deduplicates clicks through verification and pending SMS, then starts cooldown', async () => {
    const { win, widget, accept, fetchMock, smsCalls } = await boot();
    const sending = win.sendCode();
    await flush();
    await win.sendCode();
    expect(widget.verify).toHaveBeenCalledTimes(1);
    let complete!: (value: any) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    accept(); await flush();
    await win.sendCode();
    expect(smsCalls()).toHaveLength(1);
    expect(win.document.getElementById('sendCodeBtn').textContent).toContain('发送中');
    complete({ ok: true, json: async () => ({ success: true, sent: true, resend_in: 60 }) });
    await sending;
    expect(win.document.getElementById('sendCodeBtn').textContent).toBe('60 秒后重发');
    expect(win.document.getElementById('codeMessage').textContent).toContain('已发送');
    expect(JSON.parse(smsCalls()[0][1].body).captcha_verification).toBe(token);
    await win.sendCode();
    expect(smsCalls()).toHaveLength(1);
  });

  it('shows server failures and releases the button without claiming delivery', async () => {
    const { win, accept, fetchMock } = await boot();
    const sending = win.sendCode(); await flush();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ detail: '短信发送失败，请稍后重试' }) });
    accept(); await sending;
    expect(win.document.getElementById('codeMessage').textContent).toContain('短信发送失败');
    expect(win.document.getElementById('sendCodeBtn').disabled).toBe(false);
    expect(win.document.getElementById('successMessage').classList.contains('hidden')).toBe(true);
    expect(win.document.getElementById('phone').value).toBe('13800000000');
  });

  it('does not reuse an accepted one-time proof on the next SMS request', async () => {
    const { win, widget, accept } = await boot();
    let sending = win.sendCode(); await flush(); accept(); await sending;
    await vi.advanceTimersByTimeAsync(60000);
    sending = win.sendCode(); await flush();
    expect(widget.verify).toHaveBeenCalledTimes(2);
    widget.cancel(); await sending;
  });

  it('keeps form contents when the puzzle is cancelled', async () => {
    const { win, widget } = await boot();
    win.document.getElementById('password').value = 'test-password';
    const sending = win.sendCode(); await flush(); widget.cancel(); await sending;
    expect(win.document.getElementById('phone').value).toBe('13800000000');
    expect(win.document.getElementById('password').value).toBe('test-password');
  });

  it('does not submit a stale intent after switching pages', async () => {
    const { win, smsCalls } = await boot();
    const sending = win.sendCode(); await flush();
    win.setView('login'); await sending;
    expect(smsCalls()).toHaveLength(0);
    expect(win.document.getElementById('authTitle').textContent).toBe('欢迎回来');
  });

  it.each(['/register', '/password-reset'])('hides login-only tabs on %s', async path => {
    const { win } = await boot({ path });
    expect(win.getComputedStyle(win.document.getElementById('authTabs')).display).toBe('none');
  });

  it.each(['/login', '/register', '/bind-phone', '/password-reset'])('hides the inline CAPTCHA explanation on %s', async path => {
    const { win } = await boot({ path });
    expect(win.document.body.textContent).not.toContain('操作时弹出拼图，无需等待第三方验证');
    expect(win.document.getElementById('captchaVerifyBtn')).toBeNull();
    expect(win.document.getElementById('captchaStatus').classList.contains('visually-hidden')).toBe(true);
  });

  it('shows the redesigned reset action only for password login', async () => {
    const { win } = await boot({ path: '/login' });
    const resetButton = win.document.querySelector('.forgot-password-button');
    expect(resetButton).not.toBeNull();
    expect(resetButton.textContent).toContain('忘记密码？');
    expect(resetButton.getAttribute('type')).toBe('button');
    win.eval(resetButton.getAttribute('onclick'));
    expect(win.document.getElementById('authTitle').textContent).toBe('重置密码');
    expect(win.document.querySelector('.forgot-password-button')).toBeNull();

    win.setView('login');
    win.document.querySelector('[data-method="sms_code"]').click();
    expect(win.document.querySelector('.forgot-password-button')).toBeNull();
  });

  it('retains both methods on login and sends the correct SMS-login action', async () => {
    const { win, widget } = await boot({ path: '/login' });
    expect(win.getComputedStyle(win.document.getElementById('authTabs')).display).not.toBe('none');
    win.document.querySelector('[data-method="sms_code"]').click(); await flush();
    win.document.getElementById('identity').value = '13800000000';
    const sending = win.sendCode(); await flush();
    expect(widget.verify).toHaveBeenCalledWith('sms_login');
    widget.cancel(); await sending;
  });

  it('does not request any third-party CAPTCHA script', async () => {
    const { win } = await boot();
    expect(html).not.toContain('challenges.cloudflare.com');
    expect([...win.document.scripts].every((element: any) => !element.src || new URL(element.src).origin === win.location.origin)).toBe(true);
  });
});
