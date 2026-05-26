require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, 'extension');
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const TEST_VIDEO = 'https://www.youtube.com/watch?v=rE3j_RHkqJc'; // CGP Grey - confirmed captions

if (!API_KEY) {
  console.error('Missing DEEPSEEK_API_KEY in .env');
  process.exit(1);
}

(async () => {
  const userDataDir = path.join(os.tmpdir(), 'yt-distiller-persistent');
  fs.mkdirSync(userDataDir, { recursive: true });

  const CHROMIUM_PATH = chromium.executablePath();
  console.log('Using Chromium:', CHROMIUM_PATH);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: CHROMIUM_PATH,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
    ],
  });

  // Service worker fires immediately on launch — check existing first, then wait briefly
  let sw = context.serviceWorkers().find(w => w.url().includes('chrome-extension://'));
  if (!sw) {
    try {
      sw = await context.waitForEvent('serviceworker', { timeout: 8000 });
    } catch {
      console.log('Service worker did not fire — extension may have failed to load');
    }
  }

  let extensionId = null;
  if (sw) {
    extensionId = sw.url().match(/chrome-extension:\/\/([^/]+)/)?.[1] ?? null;
    sw.on('console', msg => console.log('[SW]', msg.type(), msg.text()));
  }

  // Catch extension service worker restarts (SW dies + revives between requests)
  context.on('serviceworker', (worker) => {
    if (!worker.url().includes('chrome-extension://')) return;
    console.log('[SW-RESTART] extension SW restarted');
    worker.on('console', msg => console.log('[SW]', msg.type(), msg.text()));
  });

  console.log('Extension ID:', extensionId ?? 'NOT FOUND');

  if (extensionId) {
    // Open the popup page and set the API key via the UI
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popupPage.waitForSelector('#apiKey');
    await popupPage.fill('#apiKey', API_KEY);
    await popupPage.click('#saveBtn');
    await popupPage.waitForTimeout(500);
    console.log('API key saved via popup.');
    await popupPage.close();
  } else {
    console.warn('Could not detect extension — check chrome://extensions for load errors.');
  }

  // Mock the timedtext API — YouTube blocks unauthenticated fetches from browsers.
  // Real users are logged in and get real data; we supply a fake transcript for testing.
  // Format: XML timedtext (the default format returned by YouTube's timedtext API).
  const MOCK_TRANSCRIPT_XML = `<?xml version="1.0" encoding="utf-8"?><transcript>
<text start="0" dur="6">Today we ask: why do ideas spread?</text>
<text start="6" dur="5">The internet rewards outrage, not nuance.</text>
<text start="11" dur="5">Every share makes the angry article more visible.</text>
<text start="16" dur="5">This is a well-studied psychological phenomenon.</text>
<text start="21" dur="7">Researchers call it the outrage loop.</text>
<text start="28" dur="6">But understanding it can help you break the cycle.</text>
<text start="34" dur="5">First, recognize your emotional reaction.</text>
<text start="39" dur="6">Second, slow down before sharing.</text>
<text start="45" dur="6">Third, look for sources that disagree with you.</text>
<text start="51" dur="7">Your brain is not designed for the modern information diet.</text>
<text start="58" dur="6">The key insight: algorithms optimize for engagement, not truth.</text>
<text start="64" dur="6">And engagement is driven by emotional arousal.</text>
<text start="70" dur="7">Thanks for watching. Subscribe for more.</text>
</transcript>`;

  await context.route('**/api/timedtext**', async (route) => {
    console.log('[TEST] Intercepted timedtext request — returning mock XML transcript');
    await route.fulfill({ body: MOCK_TRANSCRIPT_XML, contentType: 'text/xml; charset=utf-8' });
  });

  // Open YouTube
  const page = await context.newPage();

  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && !text.includes('doubleclick') && !text.includes('requestStorage')) {
      console.error('[PAGE ERROR]', text);
    }
    if (text.includes('YTD') || text.includes('ytd') || text.includes('transcript') || text.includes('Distill')) {
      console.log('[PAGE LOG]', msg.type(), text);
    }
  });
  page.on('pageerror', (err) => {
    if (!err.message.includes('doubleclick')) console.error('[EXCEPTION]', err.message);
  });

  console.log('\nNavigating to test video...');
  await page.goto(TEST_VIDEO, { waitUntil: 'domcontentloaded' });

  // Wait for player controls
  console.log('Waiting for player controls...');
  try {
    await page.waitForSelector('.ytp-right-controls', { timeout: 15000 });
    console.log('Player controls found.');
  } catch {
    console.error('Player controls never appeared.');
  }

  // On first-install the content script may not inject — reload once to ensure it runs
  const btnEarly = await page.$('#ytd-distill-btn');
  if (!btnEarly) {
    console.log('Button not found on first load, reloading page...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ytp-right-controls', { timeout: 15000 }).catch(() => {});
  }

  // Wait for Distill button
  console.log('Waiting for Distill button...');
  try {
    await page.waitForSelector('#ytd-distill-btn', { timeout: 12000 });
    const text = await page.$eval('#ytd-distill-btn', el => el.textContent);
    console.log('Distill button found! Text:', text);

    // Click it and watch what happens
    console.log('\nClicking Distill...');
    await page.click('#ytd-distill-btn');

    // Watch the button state for 60s (DeepSeek can take a while)
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(1000);
      const btnText = await page.$eval('#ytd-distill-btn', el => el.textContent).catch(() => 'gone');
      const errVisible = await page.$eval('#ytd-error', el => el.style.display !== 'none' ? el.textContent : '').catch(() => '');
      console.log(`[${i+1}s] button="${btnText}"${errVisible ? ' error="' + errVisible + '"' : ''}`);
      if (btnText === 'Distill ✶' && i > 2) { console.log('Flow completed!'); break; }
    }
  } catch {
    console.error('Distill button never appeared.');
    const html = await page.$eval('.ytp-right-controls', el => el.innerHTML).catch(() => 'N/A');
    console.log('[CONTROLS HTML snippet]', html.slice(0, 300));
  }

  console.log('\nDone. Browser stays open — close manually or Ctrl+C.');
  await new Promise(() => {});
})();
