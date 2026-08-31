const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const base = process.env.APP_URL || 'http://localhost:5000';

  await page.goto(base + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL);
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);

  await page.goto(base + '/app/day-rate-tracker', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/final_check.png' });

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
