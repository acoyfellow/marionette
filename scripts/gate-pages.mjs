import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5181';
const live = base.startsWith('https://');
const only = process.argv[3];
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1280, height: 800 },
];

const launched = await chromium.launch();
const context = await launched.newContext();
if (live) {
  await context.route(/customer0\.dev/, async (route) => {
    const request = route.request();
    const response = await fetch(request.url(), { headers: { 'user-agent': 'marionette-gate' } });
    const body = Buffer.from(await response.arrayBuffer());
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body });
  });
}
const browser = {
  newPage: async (options) => {
    const page = await context.newPage();
    if (options?.viewport) await page.setViewportSize(options.viewport);
    return page;
  },
  close: () => launched.close(),
};
const probe = await browser.newPage();
await probe.goto(`${base}/#1`, { waitUntil: 'commit' });
await probe.waitForSelector('#tabs a', { state: 'attached', timeout: 30000 });
const total = await probe.locator('#tabs a').count();
await probe.close();
const pages = only ? only.split(',').map(Number) : Array.from({ length: total }, (_, i) => i + 1);

let failed = 0;
for (const n of pages) {
  const problems = [];
  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/?v=${viewport.name}#${n}`, { waitUntil: 'commit' });
    try {
      await page.waitForSelector('#cells canvas', { timeout: 20000 });
    } catch {
      problems.push(`${viewport.name}: no cell panel`);
      await page.close();
      continue;
    }
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) problems.push(`${viewport.name}: horizontal scroll ${overflow}px`);
    const control = page.locator('#controls button, #controls input').first();
    if ((await control.count()) > 0) {
      const tag = await control.evaluate((el) => el.tagName);
      if (tag === 'INPUT') await control.fill(String(await control.getAttribute('max')));
      else await control.click();
    } else {
      const box = await page.locator('#stage').boundingBox();
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'replay from inputs only' }).click();
    const status = (await page.locator('#cells p').last().textContent()) ?? '';
    if (!status.includes('identical')) problems.push(`${viewport.name}: replay "${status}"`);
    if (errors.length > 0) problems.push(`${viewport.name}: ${errors[0]}`);
    if (viewport.name === 'phone' && process.env.SHOTS) await page.screenshot({ path: new URL(`../.real/gate-${n}-phone.png`, import.meta.url).pathname, fullPage: true });
    await page.close();
  }
  if (problems.length === 0) console.log(`PAGE ${n} ✓ ${live ? 'live' : 'local'}`);
  else {
    failed += 1;
    console.log(`PAGE ${n} ✗ ${problems.join('; ')}`);
  }
}

if (live) {
  const index = await browser.newPage();
  await index.goto('https://customer0.dev/', { waitUntil: 'domcontentloaded' });
  const linked = await index.locator('a[href*="marionette.customer0.dev"]').count();
  console.log(linked > 0 ? 'INDEX ✓ customer0.dev links marionette' : 'INDEX ✗ no marionette link');
  if (linked === 0) failed += 1;
}
await launched.close();
process.exit(failed === 0 ? 0 : 1);
