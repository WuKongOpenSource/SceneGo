#!/usr/bin/env node
/** Non-mutating browser smoke checks through the Chrome DevTools Protocol. */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = (process.argv[2] || process.env.OSTORY_BASE_URL || 'https://tv.ostory.ai').replace(/\/$/, '');
const outDir = path.resolve(process.env.VERIFY_OUT_DIR || 'logs/browser-smoke');
const cdpPort = Number(process.env.CDP_PORT || (9400 + Math.floor(Math.random() * 400)));
const profileDir = path.join(outDir, `cdp-profile-${cdpPort}`);
const viewports = [
  { name: 'desktop-1366', width: 1366, height: 768, mobile: false },
  { name: 'desktop-1920', width: 1920, height: 1080, mobile: false },
  { name: 'mobile-390', width: 390, height: 844, mobile: true },
];
const requestedViewport = process.env.BROWSER_SMOKE_VIEWPORT;
const selectedViewports = requestedViewport
  ? viewports.filter((viewport) => viewport.name === requestedViewport)
  : viewports;

const browserCandidates = [
  process.env.BROWSER_PATH,
  process.env.EDGE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const browserPath = browserCandidates.find(existsSync);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function describeError(error) {
  if (!error) return 'unknown error';
  return [error.message || String(error), error.cause?.message, error.cause?.code]
    .filter(Boolean)
    .join(' ');
}

async function waitForJson(url, timeoutMs, label) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}: ${describeError(lastError)}`);
}

async function createTarget() {
  const url = `http://127.0.0.1:${cdpPort}/json/new?about:blank`;
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 15000) {
    for (const method of ['PUT', 'GET']) {
      try {
        const response = await fetch(url, { method });
        if (response.ok) return await response.json();
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    }
    await sleep(250);
  }
  throw new Error(`Could not create CDP target: ${describeError(lastError)}`);
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let callId = 0;
  const pending = new Map();
  const events = [];

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
      return;
    }
    events.push(message);
  });

  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({
      events,
      send(method, params = {}, timeoutMs = 8000) {
        const id = ++callId;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((callResolve, callReject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            callReject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
          pending.set(id, { resolve: callResolve, reject: callReject, timer });
        });
      },
      close() {
        socket.close();
      },
    }), { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP websocket error')), { once: true });
  });
}

async function waitForRenderedPage(tab, timeoutMs = 20000) {
  const started = Date.now();
  let lastError;
  let lastState = {};
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await tab.send('Runtime.evaluate', {
        expression: `JSON.stringify({
          readyState: document.readyState,
          title: document.title,
          url: location.href,
          rootText: document.querySelector('#root')?.innerText?.trim() || '',
          bodyText: document.body?.innerText?.trim() || '',
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth
        })`,
        returnByValue: true,
      });
      const state = JSON.parse(result.result.value || '{}');
      lastState = state;
      const reachedLogin = /\/login(?:[?#]|$)/.test(state.url || '');
      if (state.readyState === 'complete' && reachedLogin) {
        return { ...state, timedOut: false };
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  return {
    ...lastState,
    timedOut: true,
    evaluationError: lastError ? describeError(lastError) : null,
  };
}

async function main() {
  if (!browserPath) throw new Error('Chrome or Edge executable was not found');
  if (selectedViewports.length === 0) {
    throw new Error(`Unknown BROWSER_SMOKE_VIEWPORT: ${requestedViewport}`);
  }
  await mkdir(outDir, { recursive: true });
  await rm(profileDir, { recursive: true, force: true });

  const browser = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-extensions',
    '--hide-scrollbars',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let tab;
  try {
    await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`, 30000, 'browser CDP endpoint');
    const target = await createTarget();
    tab = await connect(target.webSocketDebuggerUrl);
    await tab.send('Page.enable');
    await tab.send('Runtime.enable');
    await tab.send('Network.enable');
    await tab.send('Log.enable');

    const results = [];
    for (const viewport of selectedViewports) {
      process.stderr.write(`[browser-smoke] checking ${viewport.name}\n`);
      tab.events.length = 0;
      await tab.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.mobile,
      });
      await tab.send('Page.navigate', { url: `${baseUrl}/projects` }, 30000);
      const state = await waitForRenderedPage(tab);
      await sleep(500);

      const exceptions = tab.events
        .filter((event) => event.method === 'Runtime.exceptionThrown')
        .map((event) => event.params?.exceptionDetails?.text || 'Runtime exception');
      const consoleErrors = tab.events
        .filter((event) => event.method === 'Runtime.consoleAPICalled' && event.params?.type === 'error')
        .map((event) => (event.params?.args || []).map((arg) => arg.value || arg.description || '').join(' '));
      const logErrors = tab.events
        .filter((event) => event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error')
        .map((event) => event.params.entry.text);
      const networkFailures = tab.events
        .filter((event) => event.method === 'Network.loadingFailed')
        .map((event) => ({
          requestId: event.params?.requestId,
          errorText: event.params?.errorText,
          blockedReason: event.params?.blockedReason,
        }));
      const httpErrors = tab.events
        .filter((event) => event.method === 'Network.responseReceived' && event.params?.response?.status >= 400)
        .map((event) => ({
          status: event.params.response.status,
          url: event.params.response.url,
        }));
      const redirectedToLogin = /\/login(?:[?#]|$)/.test(state.url || '');
      const loginUiPresent = ['账号 / Email', '密码', '进入系统']
        .every((marker) => String(state.bodyText || '').includes(marker));
      const expectedAuthConsoleErrors = redirectedToLogin
        ? consoleErrors.filter((message) => (
            message.includes('缺少登录 token')
            || message.includes('未授权，请重新登录')
            || message.includes('加载项目列表失败')
          ))
        : [];
      const unexpectedConsoleErrors = consoleErrors.filter(
        (message) => !expectedAuthConsoleErrors.includes(message),
      );
      const unexpectedNetworkFailures = redirectedToLogin
        ? networkFailures.filter((failure) => failure.errorText !== 'net::ERR_ABORTED')
        : networkFailures;
      const combinedText = `${state.rootText}\n${state.bodyText}`;
      const forbiddenMarkers = [
        'Application is not built',
        "Can't find variable",
        'ChunkLoadError',
        'ReferenceError:',
      ].filter((marker) => combinedText.includes(marker));
      const overflowPixels = Math.max(0, Number(state.scrollWidth || 0) - Number(state.clientWidth || 0));
      const screenshotPath = path.join(outDir, `${viewport.name}.png`);
      const screenshot = await tab.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

      results.push({
        viewport: viewport.name,
        url: state.url,
        title: state.title,
        rendered: Boolean(state.rootText || state.bodyText),
        redirectedToLogin,
        loginUiPresent,
        timedOut: Boolean(state.timedOut),
        bodyPreview: String(state.bodyText || '').slice(0, 500),
        overflowPixels,
        exceptions,
        consoleErrors,
        unexpectedConsoleErrors,
        logErrors,
        networkFailures,
        unexpectedNetworkFailures,
        httpErrors,
        forbiddenMarkers,
        screenshot: screenshotPath,
        ok: Boolean(state.rootText || state.bodyText)
          && redirectedToLogin
          && loginUiPresent
          && exceptions.length === 0
          && unexpectedConsoleErrors.length === 0
          && logErrors.length === 0
          && unexpectedNetworkFailures.length === 0
          && httpErrors.length === 0
          && forbiddenMarkers.length === 0
          && overflowPixels <= 2,
      });
    }

    const output = {
      ok: results.every((result) => result.ok),
      mode: 'public-read-only',
      browser: browserPath,
      baseUrl,
      results,
    };
    console.log(JSON.stringify(output, null, 2));
    if (!output.ok) process.exitCode = 1;
  } finally {
    tab?.close();
    if (process.platform === 'win32' && browser.pid) {
      await new Promise((resolve) => {
        const killer = spawn('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
        const timer = setTimeout(() => {
          killer.kill();
          resolve();
        }, 5000);
        killer.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        killer.once('error', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } else {
      browser.kill();
    }
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
