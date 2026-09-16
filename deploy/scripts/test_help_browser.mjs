/** Isolated help-page browser acceptance; no live account or external API calls. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deploy = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.VERIFY_OUT_DIR || path.join(tmpdir(), 'help-browser-results'));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'help-browser-'));
const browserPath = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(p => p && existsSync(p));
assert(browserPath, 'Set BROWSER_PATH to an installed Chromium browser');
const writes = [], missing = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  try {
    if (request.method !== 'GET') { writes.push(url.pathname); response.writeHead(405); return response.end(); }
    if (url.pathname.startsWith('/api/')) {
      const data = url.pathname.includes('balance') ? { available_credits: 0 } :
        url.pathname.includes('/user/info') ? { success: true, username: '文档演示', role: 'user', user_id: 'help-demo' } :
          { success: true, projects: [], workspaces: [], tasks: [], notifications: [], items: [], data: [], total: 0, role: 'user' };
      response.writeHead(200, { 'Content-Type': 'application/json' }); return response.end(JSON.stringify(data));
    }
    let file = url.pathname.startsWith('/assets/') ? path.join(deploy, 'dist', decodeURIComponent(url.pathname)) :
      url.pathname.startsWith('/static/') ? path.join(deploy, decodeURIComponent(url.pathname)) : path.join(deploy, 'dist/index.html');
    assert(file.startsWith(deploy + path.sep));
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': mime + (mime.startsWith('text/') ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store' });
    response.end(await readFile(file));
  } catch { missing.push(url.pathname); if (!response.headersSent) response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) { try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { await pause(100); } }
  assert(port, 'Browser did not start');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const pending = new Map(), errors = [], external = [];
  let serial = 0;
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url) && !message.params.request.url.startsWith(origin + '/')) external.push(message.params.request.url);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => reject(new Error('Browser command timed out: ' + method)), 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  const until = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100); } throw new Error('Page condition failed: ' + expression); };
  const screenshot = async name => { const result = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(output, name + '.png'), Buffer.from(result.data, 'base64')); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin + '/tools/help' });
  await until(`document.querySelectorAll('.help-card').length === 62`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="帮助文档中心"]').getAttribute('href')`), '/tools/help');
  await screenshot('help-desktop');
  await evaluate(`(() => { const input = document.querySelector('[aria-label="搜索帮助文档"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'PostgreSQL'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until(`document.querySelectorAll('.help-card').length > 0 && document.querySelectorAll('.help-card').length < 62`);
  await screenshot('help-search');
  await send('Page.navigate', { url: origin + '/tools/help/manual-02' });
  await until(`document.querySelector('.help-article h1')?.textContent === '登录注册'`);
  await until(`document.querySelector('.help-prose img')?.naturalWidth > 0`);
  await screenshot('help-article');
  await send('Page.reload');
  await until(`document.querySelector('.help-article h1')?.textContent === '登录注册'`);
  await send('Page.navigate', { url: origin + '/tools/help/doc-open-source-manual-installation-zh-cn#help-4-创建最小权限运行账号和目录' });
  await until(`document.querySelector('.help-prose pre') && document.querySelector('.help-toc a')`);
  await until(`(() => { const top = document.getElementById('help-4-创建最小权限运行账号和目录')?.getBoundingClientRect().top; return top > 20 && top < 300; })()`);
  const headingPosition = await evaluate(`document.getElementById('help-4-创建最小权限运行账号和目录')?.getBoundingClientRect().top`);
  assert(headingPosition > 20 && headingPosition < 300, 'Direct fragment did not scroll to the section');
  await screenshot('help-deployment-anchor');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: origin + '/tools/help' });
  await until(`document.querySelectorAll('.help-card').length === 62`);
  await evaluate(`document.querySelector('[aria-label="收起左侧导航"]')?.click()`);
  await until(`document.querySelector('[data-collapsed="true"]')`);
  await until(`document.querySelector('[data-collapsed="true"]')?.getBoundingClientRect().width <= 73`);
  assert(await evaluate(`document.querySelector('.help-center').getBoundingClientRect().width >= 300`), 'Mobile reading column is too narrow');
  assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'Mobile document overflow');
  await screenshot('help-mobile');
  await send('Page.navigate', { url: origin + '/tools/help/manual-02' });
  await until(`document.querySelector('.help-prose img')?.naturalWidth > 0`);
  assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'Mobile article overflow');
  await screenshot('help-mobile-article');
  assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(external, []); assert.deepEqual(missing, []);
  console.log(JSON.stringify({ result: 'passed', articleCount: 62, search: true, deepLink: true, refresh: true, fragment: true, mobile: true, liveAccount: false, writes: 0, externalRequests: 0, output }));
} finally {
  ws?.close(); browser.kill(); await new Promise(resolve => server.close(resolve));
}
