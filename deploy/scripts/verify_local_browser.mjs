import { spawn } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.LOCAL_BASE_URL || 'http://127.0.0.1:6006';
const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outDir = process.env.VERIFY_OUT_DIR || path.resolve('logs');
const profileDir = path.join(outDir, 'edge-cdp-profile');
const screenshotPath = path.join(outDir, 'projects-auth-page.png');
const cdpPort = Number(process.env.CDP_PORT || (9300 + Math.floor(Math.random() * 500)));
const adminPassword = process.env.ADMIN_PASSWORD;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function describeError(err) {
  if (!err) return 'unknown error';
  const parts = [err.message || String(err)];
  if (err.cause?.message) parts.push(`cause=${err.cause.message}`);
  if (err.cause?.code) parts.push(`code=${err.cause.code}`);
  return parts.join(' ');
}

async function waitForJson(url, timeoutMs = 15000, label = url) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}: ${describeError(lastError)}`);
}

async function createTarget() {
  const newTargetUrl = `http://127.0.0.1:${cdpPort}/json/new?about:blank`;
  const start = Date.now();
  let lastError;
  while (Date.now() - start < 15000) {
    for (const method of ['PUT', 'GET']) {
      try {
        const res = await fetch(newTargetUrl, { method });
        if (res.ok) return await res.json();
        lastError = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastError = err;
      }
    }
    await sleep(250);
  }
  throw new Error(`Could not create CDP target: ${describeError(lastError)}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    events.push(msg);
  });

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      resolve({
        events,
        send(method, params = {}) {
          const callId = ++id;
          ws.send(JSON.stringify({ id: callId, method, params }));
          return new Promise((callResolve, callReject) => {
            pending.set(callId, { resolve: callResolve, reject: callReject });
          });
        },
        close() {
          ws.close();
        },
      });
    }, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP websocket error')), { once: true });
  });
}

async function main() {
  if (!adminPassword) {
    throw new Error('ADMIN_PASSWORD must be set for authenticated browser verification');
  }
  await rm(profileDir, { recursive: true, force: true });

  const edge = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`, 30000, 'Edge CDP version');
    const target = await createTarget();
    const tab = await connect(target.webSocketDebuggerUrl);

    await tab.send('Page.enable');
    await tab.send('Runtime.enable');

    let loginRes;
    try {
      loginRes = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: adminPassword }),
      });
    } catch (err) {
      throw new Error(`Login fetch failed for ${baseUrl}: ${describeError(err)}`);
    }
    if (!loginRes.ok) throw new Error(`Login failed: HTTP ${loginRes.status}`);
    const login = await loginRes.json();
    if (!login.token) throw new Error('Login response did not include token');

    await tab.send('Page.navigate', { url: `${baseUrl}/login` });
    await sleep(1500);
    await tab.send('Runtime.evaluate', {
      expression: `localStorage.setItem('auth_token', ${JSON.stringify(login.token)}); localStorage.setItem('username', 'admin');`,
      awaitPromise: true,
    });

    await tab.send('Page.navigate', { url: `${baseUrl}/projects` });
    await sleep(6000);

    const textEval = await tab.send('Runtime.evaluate', {
      expression: `JSON.stringify({ title: document.title, url: location.href, text: document.body.innerText.slice(0, 2000), rootText: document.querySelector('#root')?.innerText?.slice(0, 2000) || '' })`,
      returnByValue: true,
    });
    const pageState = JSON.parse(textEval.result.value);

    const shot = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));

    tab.close();
    console.log(JSON.stringify({
      ok: pageState.rootText.length > 0,
      url: pageState.url,
      title: pageState.title,
      hasProjectManagement: pageState.text.includes('项目管理'),
      hasSmokeProject: pageState.text.includes('local-deploy-smoke'),
      screenshot: screenshotPath,
      textPreview: pageState.text.slice(0, 500),
    }, null, 2));
  } finally {
    if (process.platform === 'win32' && edge.pid) {
      spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      edge.kill();
    }
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
