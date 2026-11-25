// Turul ecranelor pe emulator, după testul de pornire: aplicația pe un ecran de telefon
// obișnuit, condusă din pagină ca de un om (Playwright pentru Android; depanarea WebView e
// pornită doar în tipul de build „smoke”, vezi MainActivity). Câte o captură din fiecare
// ecran important, căutare și o întrebare; la final: n-a căzut, n-a înghețat, iar erorile
// din pagină sunt listate. Capturile ajung în ramura ci-ecrane (workflow-ul).
// Emulatorul e în engleză, deci textele sunt cele din en.ts.
import { _android as android } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = `${process.argv[2] || 'smoke-out'}/tur`;
const PKG = 'com.luminculler.app';
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const [device] = await android.devices();
if (!device) { console.log('::error::Turul: niciun emulator'); process.exit(1); }
// 720×1600 la 300 dpi = același ecran logic ca un telefon de 1080×2400 (≈384×853 dp), dar
// emulatorul fără placă video nu mai cedează la randare (cădea la Galerie la 1080×2400).
await device.shell('wm size 720x1600');
await device.shell('wm density 300');
await device.shell(`am force-stop ${PKG}`);
await device.shell('logcat -c');
await device.shell(`am start -W -n ${PKG}/.MainActivity`);
const webview = await device.webView({ pkg: PKG }, { timeout: 90_000 });
const page = await webview.page();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
await sleep(8000);

let n = 0;
const shot = async name => {
  n++;
  const file = `${OUT}/${String(n).padStart(2, '0')}-${name}.png`;
  try { writeFileSync(file, await page.screenshot({ timeout: 20_000 })); } catch (e) { console.log(`captură ${name}: ${e.message.split('\n')[0]}`); }
};
const warn = msg => console.log(`::warning::Turul: ${msg}`);
const step = async (name, fn) => {
  try { await fn(); await sleep(2500); await shot(name); } catch (e) { warn(`${name}: ${e.message.split('\n')[0]}`); }
};
const scroll = async () => { await page.mouse.wheel(0, 700); await sleep(1500); };
// Foile care apar singure (descărcarea motorului AI, sfaturi): „Later” / „Not now”, dacă sunt.
const dismiss = async () => {
  for (const label of ['Later', 'Not now', 'Got it']) {
    const b = page.getByRole('button', { name: label, exact: true });
    if (await b.count().catch(() => 0)) { await b.last().click({ timeout: 3000 }).catch(() => {}); await sleep(1200); }
  }
};
const nav = async label => { await dismiss(); await page.getByRole('button', { name: label, exact: true }).last().click({ timeout: 8000 }); };

await shot('bun-venit');
await step('pas2', () => page.getByText('Start', { exact: true }).click({ timeout: 8000 }));
await step('motor-ai', () => page.getByText('Later', { exact: true }).click({ timeout: 8000 }));
await step('azi', dismiss);
await step('azi-jos', scroll);
await step('galerie', () => nav('Gallery'));
await step('galerie-jos', scroll);
await step('cautare-dog', async () => { const s = page.locator('input[type=search]').first(); await s.fill('dog'); await sleep(3000); });
await step('cautare-bicycle', async () => { const s = page.locator('input[type=search]').first(); await s.fill('bicycle'); await sleep(3000); });
await page.locator('input[type=search]').first().fill('').catch(() => {});
await step('poza', async () => { await page.locator('.lx-wall-wrap img').first().click({ timeout: 8000 }); });
await step('poza-detalii', scroll);
await page.keyboard.press('Escape').catch(() => {});
await device.shell('input keyevent 4').catch(() => {}); await sleep(2000);
await step('curatenie', () => nav('Clean up'));
await step('curatenie-jos', scroll);
await step('studio', () => nav('Studio'));
await step('studio-jos', scroll);
await step('intreaba', () => page.getByRole('button', { name: /^Ask/ }).last().click({ timeout: 8000 }));
await step('intreaba-raspuns', async () => {
  const q = page.locator('input[enterkeyhint=send]').first();
  await q.fill('how many photos with a dog?'); await q.press('Enter'); await sleep(3000);
});
await device.shell('input keyevent 4').catch(() => {}); await sleep(2000);
await step('azi-2', () => nav('Today'));
await step('setari', () => page.getByRole('button', { name: 'Settings', exact: true }).first().click({ timeout: 8000 }));
await step('pro', () => page.getByText('Cherrypic Pro', { exact: true }).first().click({ timeout: 8000 }));
await step('pro-jos', scroll);
await step('pro-jos2', scroll);

const log = await device.shell('logcat -d').catch(() => Buffer.from('(emulatorul nu mai răspunde)'));
writeFileSync(`${OUT}/logcat.txt`, log);
const txt = log.toString();
const pid = (await device.shell(`pidof ${PKG}`).catch(() => Buffer.from('?'))).toString().trim();
let fail = false;
if (pid === '?') console.log('::warning::Turul: emulatorul nu mai răspunde (cedează uneori fără placă video); capturile de până aici sunt valabile.');
else if (!pid) { console.log('::error::Aplicația s-a închis în turul ecranelor'); fail = true; }
if (/FATAL EXCEPTION[\s\S]{0,3000}com\.luminculler\.app/.test(txt)) { console.log('::error::Aplicația a căzut în turul ecranelor'); fail = true; }
if (txt.includes(`ANR in ${PKG}`)) { console.log('::error::Aplicația a înghețat (ANR) în turul ecranelor'); fail = true; }
console.log(`── Erori din pagină în tur (${errors.length}) ──`);
for (const e of [...new Set(errors)].slice(0, 30)) console.log(e);
await device.close().catch(() => {});
if (!fail) console.log('Turul ecranelor: în regulă.');
process.exit(fail ? 1 : 0);
