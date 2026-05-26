// Tests real YouTube transcript extraction — no YouTube endpoint mocking.
// Only mocks DeepSeek so we don't need credits.
require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, 'extension');
const API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key';
const TEST_VIDEO = 'https://www.youtube.com/watch?v=rE3j_RHkqJc';

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-distiller-real-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: chromium.executablePath(),
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
    ],
  });

  let sw = context.serviceWorkers().find(w => w.url().includes('chrome-extension://'));
  if (!sw) {
    try { sw = await context.waitForEvent('serviceworker', { timeout: 8000 }); } catch {}
  }
  let extensionId = null;
  if (sw) {
    extensionId = sw.url().match(/chrome-extension:\/\/([^/]+)/)?.[1] ?? null;
    sw.on('console', msg => console.log('[SW]', msg.type(), msg.text()));
  }
  context.on('serviceworker', (worker) => {
    if (!worker.url().includes('chrome-extension://')) return;
    worker.on('console', msg => console.log('[SW]', msg.type(), msg.text()));
  });
  console.log('Extension ID:', extensionId ?? 'NOT FOUND');

  if (extensionId) {
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popupPage.waitForSelector('#apiKey');
    await popupPage.fill('#apiKey', API_KEY);
    await popupPage.click('#saveBtn');
    await popupPage.waitForTimeout(500);
    console.log('API key saved.');
    await popupPage.close();
  }

  // Only mock DeepSeek — let all YouTube requests (innertube, timedtext) through real
  await context.route('**/api.deepseek.com/**', (route) => {
    console.log('[MOCK] DeepSeek call intercepted — returning fake segments');
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: '[{"start":10,"end":20}]' } }],
      }),
    });
  });

  const page = await context.newPage();
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[YTD]')) console.log('[PAGE]', msg.type(), text);
    if (msg.type() === 'error' && !text.includes('doubleclick') && !text.includes('requestStorage') && !text.includes('favicon')) {
      console.error('[PAGE ERROR]', text);
    }
  });
  page.on('pageerror', (err) => {
    if (!err.message.includes('doubleclick')) console.error('[EXCEPTION]', err.message);
  });

  console.log('\nNavigating to test video (real YouTube)...');
  await page.goto(TEST_VIDEO, { waitUntil: 'domcontentloaded' });

  console.log('Waiting for player controls...');
  try {
    await page.waitForSelector('.ytp-right-controls', { timeout: 20000 });
    console.log('Player controls found.');
  } catch {
    console.error('Player controls never appeared.');
  }
  await page.waitForTimeout(4000);

  console.log('Waiting for Distill button...');
  try {
    await page.waitForFunction(() => !!document.getElementById('ytd-distill-btn'), null, { timeout: 15000 });
    const text = await page.$eval('#ytd-distill-btn', el => el.textContent);
    console.log('Distill button found! Text:', text);

    console.log('\nClicking Distill...');
    await page.evaluate(() => document.getElementById('ytd-distill-btn')?.click());

    let passed = false;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(1000);
      const btnText = await page.$eval('#ytd-distill-btn', el => el.textContent).catch(() => 'gone');
      const errText = await page.$eval('#ytd-error', el => el.style.display !== 'none' ? el.textContent : '').catch(() => '');
      console.log(`[${i + 1}s] button="${btnText}"${errText ? ' error="' + errText + '"' : ''}`);
      if (errText) { console.error('\nTEST FAILED — error shown:', errText); break; }
      if (btnText === 'Distill ✶' && i > 2) { console.log('\nTEST PASSED — flow completed!'); passed = true; break; }
      if (btnText.includes('/')) { console.log('\nTEST PASSED — playing segments!'); passed = true; break; }
    }
    await page.screenshot({ path: '/tmp/ytd-real-test.png' });
    console.log('Screenshot: /tmp/ytd-real-test.png');
  } catch (e) {
    console.error('Distill button never appeared:', e.message);
  }

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  console.log('Done.');
})();
