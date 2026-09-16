#!/usr/bin/env node
/** Local-only browser regression: real auth HTML/assets, fake API, no SMS provider. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserPath = [process.env.BROWSER_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(p => p && existsSync(p));
assert(browserPath, 'Set BROWSER_PATH to an installed Chromium browser');
const output = path.resolve(process.env.VERIFY_OUT_DIR || path.join(root, 'logs/slider-browser'));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'ostory-slider-browser-'));
// The expected answer is fixture-only and never returned by the mock HTTP API.
const fixture = JSON.parse(execFileSync(process.env.PYTHON_PATH || 'python', ['-c', 'import json; from services.slider_captcha_service import _puzzle_images; images, answer = _puzzle_images(); print(json.dumps({"images": images, "answer": answer}))'], { cwd: root, encoding: 'utf8', windowsHide: true }));
const csp = execFileSync(process.env.PYTHON_PATH || 'python', ['-c', 'from core.security_headers import _content_security_policy; print(_content_security_policy("/register", "/admin"))'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
let smsCount = 0, checkCount = 0;
const proof = 'slider.' + 'T'.repeat(43);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('Cache-Control', 'no-store');
    const json = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
    if (url.pathname === '/api/user/info') return json(401, {});
    if (url.pathname === '/api/auth/captcha-config') return json(200, { enabled: true, provider: 'slider', site_key: null });
    if (request.method === 'POST') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (url.pathname === '/api/auth/captcha/challenge') return json(200, { ...fixture.images, challenge_id: 'C'.repeat(43), expires_in: 120 });
      if (url.pathname === '/api/auth/captcha/check') {
        checkCount++;
        return Math.abs(body.x - fixture.answer) <= 5 ? json(200, { captcha_verification: proof, expires_in: 60 }) : json(400, { detail: '未对齐，请换一张' });
      }
      if (url.pathname === '/api/auth/sms-code') {
        assert.equal(body.captcha_verification, proof);
        smsCount++;
        return json(200, { success: true, sent: true, resend_in: 60 });
      }
      return json(404, {});
    }
    const files = {
      '/register': ['login.html', 'text/html; charset=utf-8'],
      '/login': ['login.html', 'text/html; charset=utf-8'],
      '/static/js/slider-captcha.js': ['static/js/slider-captcha.js', 'application/javascript'],
      '/static/css/slider-captcha.css': ['static/css/slider-captcha.css', 'text/css'],
      '/static/css/tab-navigation.css': ['static/css/tab-navigation.css', 'text/css'],
      '/static/branding/chuangju-logo-on-dark.svg': ['static/branding/chuangju-logo-on-dark.svg', 'image/svg+xml'],
      '/static/branding/chuangju-logo-on-light.svg': ['static/branding/chuangju-logo-on-light.svg', 'image/svg+xml'],
    };
    const file = files[url.pathname];
    if (!file) { response.writeHead(204); return response.end(); }
    response.setHeader('Content-Security-Policy', csp);
    response.writeHead(200, { 'Content-Type': file[1] });
    response.end(await readFile(path.join(root, file[0])));
  } catch (error) { response.writeHead(500); response.end(String(error.message)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let port;
  for (let i = 0; i < 80 && !port; i++) {
    try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { await pause(100); }
  }
  assert(port, 'Browser did not start');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map(), errors = [], externalRequests = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id); clearTimeout(waiter.timer); message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url) && !message.params.request.url.startsWith(origin + '/')) externalRequests.push(message.params.request.url);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 8000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await pause(50); }
    throw new Error(`Page condition failed: ${expression}`);
  };
  const screenshot = async name => {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(path.join(output, name + '.png'), Buffer.from(result.data, 'base64'));
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  for (const viewport of [{ name: 'desktop', width: 1366, height: 900, mobile: false }, { name: 'mobile', width: 390, height: 844, mobile: true }]) {
    await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1 });
    await send('Emulation.setTouchEmulationEnabled', { enabled: viewport.mobile });
    await send('Page.navigate', { url: origin + '/register' });
    await until(`document.getElementById('phone') && typeof captchaReady !== 'undefined' && captchaReady`);
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('authTabs')).display`), 'none');
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Page overflow');
    await screenshot(`${viewport.name}-register`);
    await evaluate(`document.getElementById('phone').value = '13800000000'; document.getElementById('sendCodeBtn').click()`);
    await until(`document.querySelector('[data-slider]') && !document.querySelector('[data-slider]').disabled`);
    assert(await evaluate(`document.querySelector('[data-background]').naturalWidth === 320`), 'Puzzle blocked by CSP');
    await screenshot(`${viewport.name}-puzzle`);
    const rect = await evaluate(`(() => { const r = document.querySelector('[data-slider]').getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()`);
    // Native range travel excludes the 42px thumb and 1px border on either side.
    const startX = rect.x + 22, y = rect.y + rect.height / 2;
    const endX = startX + fixture.answer / 264 * (rect.width - 44);
    const beforeSms = smsCount, beforeCheck = checkCount;
    if (viewport.mobile) await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
    else { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y, button: 'left', clickCount: 1 }); }
    for (let step = 1; step <= 12; step++) {
      const x = startX + (endX - startX) * step / 12;
      if (viewport.mobile) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      else await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    }
    if (viewport.mobile) await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: endX, y, button: 'left', clickCount: 1 });
    await until(`!document.querySelector('[role=dialog]') && document.getElementById('codeMessage').textContent.includes('已发送')`);
    assert.equal(checkCount, beforeCheck + 1); assert.equal(smsCount, beforeSms + 1);
    await evaluate(`document.getElementById('sendCodeBtn').click()`);
    assert.equal(smsCount, beforeSms + 1, 'Duplicate SMS request during cooldown');
    await screenshot(`${viewport.name}-sent`);
    await send('Page.navigate', { url: origin + '/login' });
    await until(`document.getElementById('identity') && document.getElementById('authTabs')`);
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('authTabs')).display`), 'flex');
  }
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  console.log(JSON.stringify({ result: 'passed', desktopMouseDrag: true, mobileTouchDrag: true, registrationTabsHidden: true, loginTabsRetained: true, mockSmsCount: smsCount, realSmsCount: 0, externalRequests: externalRequests.length, screenshots: output }, null, 2));
} finally {
  ws?.close(); browser.kill(); await new Promise(resolve => server.close(resolve));
  // Keep the isolated temporary browser profile for failure diagnosis; no user profile is touched.
}
