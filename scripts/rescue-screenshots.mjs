/**
 * 360px screenshots of every cleaner screen, dark and light.
 * Run against a preview of the production build:
 *   npx vite preview --outDir /tmp/lumin-after --host 127.0.0.1 --port 4173
 *   node scripts/rescue-screenshots.mjs
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.RESCUE_URL ?? 'http://127.0.0.1:4173/';
const out = new URL('../docs/screenshots/rescue-360/', import.meta.url);

const screens = [
  ['intro-1', '?screen=intro1', /Eliberează spațiu/],
  ['intro-2', '?screen=intro2', 'Ce face'],
  ['intro-3', '?screen=intro3', 'Cum te ajută'],
  ['scan', '?screen=scan', /Deja poți elibera/],
  ['home', '?screen=home', /Poți elibera 2\.4 GB/],
  ['trash', '?screen=trash', /e în Coș/],
  ['freed', '?screen=freed', 'Browserul nu a șters nimic de pe telefon.'],
  ['settings', '?screen=settings', 'Setări'],
  ['paywall', '?screen=paywall', 'Eliberează restul']
];

async function assertNoOverflow(page, name) {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('.rescue-main');
    const frame = document.querySelector('.rescue-frame');
    const wide = (el) => !!el && el.scrollWidth > el.clientWidth + 1;
    return wide(main) || wide(frame);
  });
  if (overflow) throw new Error(`horizontal overflow on ${name}`);
}

async function shot(page, file) {
  await assertNoOverflow(page, file);
  const banned = await page.locator('body').innerText();
  for (const word of ['ÎNCEPE ACUM', 'Mod Pro', 'XMP', 'Bibliotecă', 'Toate uneltele']) {
    if (banned.includes(word)) throw new Error(`${file} still shows ${word}`);
  }
  await page.screenshot({ path: new URL(file, out).pathname, fullPage: false });
}

const browser = await chromium.launch();
await mkdir(out, { recursive: true });

for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: theme
  });
  await context.addInitScript(value => {
    localStorage.setItem('lumin-theme', value);
    localStorage.setItem('lumin-locale', 'ro');
    localStorage.removeItem('lumin-rescue-intro');
  }, theme);
  const page = await context.newPage();

  for (const [name, query, ready] of screens) {
    await page.goto(base + query);
    await page.getByText(ready).first().waitFor();
    if (name === 'settings') {
      await page.getByRole('switch', { name: 'Memento' }).click();
      await page.locator('select').waitFor();
    }
    await shot(page, `${name}-${theme}.png`);
  }

  await page.goto(base + '?screen=home');
  await page.getByRole('button', { name: 'Verifică WhatsApp, Telegram, Messenger' }).click();
  await page.getByRole('checkbox', { name: /WA0004/ }).waitFor();
  await shot(page, `review-${theme}.png`);
  await page.getByRole('button', { name: 'Glisează una câte una' }).click();
  await page.getByText(/nu consumă limita gratuită/).waitFor();
  await shot(page, `swipe-${theme}.png`);

  await page.setViewportSize({ width: 412, height: 800 });
  await page.goto(base + '?screen=home');
  await page.getByRole('heading', { name: /Poți elibera/ }).waitFor();
  await assertNoOverflow(page, `home-412-${theme}`);

  await context.close();
}

const flow = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1 });
await flow.addInitScript(() => {
  localStorage.setItem('lumin-theme', 'dark');
  localStorage.setItem('lumin-locale', 'ro');
  localStorage.removeItem('lumin-rescue-intro');
});
const page = await flow.newPage();
await page.goto(base);
await page.getByRole('heading', { name: 'Eliberează spațiu, întâi ce e mai mare.' }).waitFor();
await page.getByRole('button', { name: 'Continuă' }).click();
await page.getByRole('heading', { name: 'Ce face' }).waitFor();
await page.getByRole('button', { name: 'Continuă' }).click();
await page.getByRole('heading', { name: 'Cum te ajută' }).waitFor();
const started = Date.now();
await page.getByRole('button', { name: 'Scanează' }).click();
await page.getByRole('heading', { name: /Poți elibera 2\.4 GB/ }).waitFor({ timeout: 3000 });
const elapsed = Date.now() - started;
if (elapsed > 2500) throw new Error(`scan took ${elapsed}ms`);
console.log(`scan-to-home ${elapsed}ms`);
await flow.close();
await browser.close();
console.log('screenshots ok');
