/** Offline native-range regression. Install Playwright and its WebKit/Chromium engines first.
 * PLAYWRIGHT_MODULE may name an existing package; CHROMIUM_CHANNEL may select installed Edge.
 * All challenges/proofs are fixtures: this never contacts or bypasses a live captcha.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { webkit, chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('../static/js/slider-captcha.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../static/css/slider-captcha.css', import.meta.url), 'utf8');
const actions = ['login', 'register', 'sms_register', 'sms_login', 'sms_bind_phone', 'sms_password_reset'];
let cases = 0;
for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) {
  const browser = await engine.launch({ headless: true,
    ...(name === 'chromium' && process.env.CHROMIUM_CHANNEL ? { channel: process.env.CHROMIUM_CHANNEL } : {}) });
  try {
    for (const width of [390, 1280]) for (const action of actions) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.setContent('<button id="origin">登录或注册</button>');
        await page.addStyleTag({ content: css });
        await page.evaluate(() => {
          window.checks = []; window.failNext = true;
          window.fetch = async (url, init) => {
            const check = url.endsWith('/check');
            if (check) window.checks.push(JSON.parse(init.body));
            const fail = check && window.failNext;
            if (check) window.failNext = false;
            return { ok: !fail, json: async () => !check ? {
              challenge_id: 'B'.repeat(43), background: 'data:image/jpeg;base64,eA==', piece: 'data:image/png;base64,eA==',
              width: 320, height: 160, piece_size: 56, y: 40, expires_in: 120,
            } : fail ? { detail: '未对齐缺口，请换一张重试' }
              : { captcha_verification: 'slider.' + 'A'.repeat(43), expires_in: 60 } };
          };
        });
        await page.addScriptTag({ content: source });
        await page.evaluate(action => {
          document.querySelector('#origin').focus();
          window.widget = new window.OstorySliderCaptcha();
          window.widget.verify(action).then(result => { window.proof = result; }).catch(() => {});
        }, action);
        await page.waitForFunction(() => !document.querySelector('[data-slider]')?.disabled);
        const range = page.locator('[data-slider]');
        const box = await range.boundingBox();
        const x = box.x + 22, y = box.y + box.height / 2;
        await page.mouse.click(x, y);
        assert.equal(await page.evaluate(() => window.checks.length), 0, 'A stationary click must not consume a challenge');
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + (box.width - 44) / 2, y, { steps: 10 });
        const moved = Number(await range.inputValue());
        assert(moved >= 129 && moved <= 135, `${name}: native range did not follow the drag (${moved})`);
        // Native thumb continues receiving events; release can happen outside the track.
        await page.mouse.move(x + (box.width - 44) / 2, box.y - 12);
        await page.mouse.up();
        await page.waitForFunction(() => window.checks.length === 1);
        assert.equal(await range.isDisabled(), true, 'Consumed challenges must remain unusable');
        assert.deepEqual(await page.evaluate(() => window.checks[0]), { action, challenge_id: 'B'.repeat(43), x: moved });
        await page.locator('[data-refresh]').click();
        await page.waitForFunction(() => !document.querySelector('[data-slider]').disabled);
        assert.equal(await range.inputValue(), '0');
        await range.press('ArrowRight');
        await range.press('Enter');
        await page.waitForFunction(() => Boolean(window.proof));
        assert.equal(await page.locator('[role="dialog"]').count(), 0);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'origin');
        assert.equal(await page.evaluate(() => window.checks.length), 2);
        cases++;
      } finally { await page.close(); }
    }
    console.log(`${name}: native drag, outside release, no-move click, failure refresh and keyboard confirmation passed`);
  } finally { await browser.close(); }
}
console.log(`Slider browser regression passed: ${cases} cases; no live API requests`);
