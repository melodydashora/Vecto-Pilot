// 2026-05-15: TOC-focused screenshot to compare directly against Melody's reference shot.
import { chromium } from 'playwright';
const URL = 'http://localhost:5000';
const VIEWPORT = { width: 1366, height: 1024 };
const UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const OUT = '/home/runner/workspace/tmp-screenshots';

const browser = await chromium.launch({ executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
const ctx = await browser.newContext({ viewport: VIEWPORT, userAgent: UA });
const page = await ctx.newPage();
page.on('pageerror', () => {});

await page.goto(`${URL}/welcome`, { waitUntil: 'networkidle', timeout: 30000 });
await page.locator('button').first().click({ force: true });
await page.waitForTimeout(700);

// TOC is slide #4 (hero=0, autismNote=1, stats=2, toc=3) — 3 ArrowRight presses
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(350);
}
console.log('→ TOC (What is Ride Share?) — new Vecto Pilot palette + subtle nav');
await page.screenshot({ path: `${OUT}/E-toc-new-palette.png` });

await browser.close();
console.log('✓ Done.');
