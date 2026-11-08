import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import puppeteer from 'puppeteer';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = fileURLToPath(new URL('../../build/visual/', import.meta.url));
await mkdir(output, { recursive: true });
const docs = fileURLToPath(new URL('../../docs/', import.meta.url));
await mkdir(docs, { recursive: true });
const server = await preview({ configFile: false, root, base: './',
  preview: { host: '127.0.0.1', port: 0, strictPort: false } });
const address = server.httpServer.address();
const url = `http://127.0.0.1:${address.port}/`;
const software = process.env.TINYFLOCK_SOFTWARE_RENDERING === '1';
const browser = await puppeteer.launch({ headless: true,
  args: software ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /shader error|VALIDATE_STATUS.*false/i.test(message.text())) errors.push(message.text());
  });
  page.on('requestfailed', request => errors.push(`Request failed: ${request.url()}`));
  page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
  const rust = process.env.TINYFLOCK_CORE === 'rust';
  await page.goto(url + `?view=bird${rust ? '&core=rust' : ''}`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('canvas[data-ready="true"]', { timeout: 60000 });
  assert.equal(await page.$eval('#backend', select => select.value), rust ? 'rust' : 'cpp');
  await page.screenshot({ path: `${output}/bird-study.png` });
  await page.screenshot({ path: `${docs}/bird-study.webp`, type: 'webp', quality: 88 });
  await page.select('#flight-mode', 'glide');
  await page.screenshot({ path: `${output}/bird-glide.png` });
  await page.select('#flight-mode', 'flap');
  assert.equal(await page.$eval('#view', button => button.textContent), 'View flock');
  await page.click('#pause');
  assert.equal(await page.$eval('#status', status => status.value), 'Paused');
  await page.click('#pause');
  await page.click('#view');
  assert.equal(await page.$eval('#view', button => button.textContent), 'Bird study');
  await page.click('#camera');
  assert.equal(await page.$eval('#camera', button => button.getAttribute('aria-pressed')), 'false');
  await page.screenshot({ path: `${output}/follow-center.png` });
  await page.click('#camera');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: `${output}/flock-full.png` });
  await page.screenshot({ path: `${docs}/flock.webp`, type: 'webp', quality: 88 });
  const change = async (id, value) => page.$eval(`#${id}`, (input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input'));
  }, value);
  await page.click('#advanced > summary');
  await page.click('#avoidance-enabled');
  assert.equal(await page.$eval('#lookahead', input => input.disabled), true);
  await page.click('#avoidance-enabled');
  await change('lookahead', 6);
  await change('clearance', 3);
  assert.equal(await page.$eval('#lookahead-value', output => output.value), '6');
  await page.screenshot({ path: `${output}/advanced-avoidance.png` });
  await page.click('#flight-settings > summary');
  await change('view-angle', 360);
  await change('neighbors', 0);
  assert.equal(await page.$eval('#neighbors-value', output => output.value), 'All');
  await change('perception', 8);
  await change('spacing', 9);
  assert.equal(await page.$eval('#perception', input => input.value), '9');
  await change('max-speed', 4);
  assert.equal(await page.$eval('#min-speed', input => input.value), '4');
  await change('min-speed', 8);
  assert.equal(await page.$eval('#max-speed', input => input.value), '8');
  await page.click('#flight-settings > summary');
  await page.click('#airspace-settings > summary');
  await page.click('#altitude-enabled');
  assert.equal(await page.$eval('#altitude', input => input.disabled), true);
  await page.click('#obstacles-enabled');
  assert.equal(await page.$eval('#obstacle-lookahead', input => input.disabled), false);
  await change('obstacle-margin', 2);
  await page.screenshot({ path: `${output}/obstacle-course.png` });
  await page.click('#airspace-settings > summary');
  await page.click('#input-settings > summary');
  await change('force-x', .4);
  await page.click('#spatial-grid');
  await page.$eval('#seed', input => { input.value = '7'; input.dispatchEvent(new Event('change')); });
  await page.click('#reset-defaults');
  for (const [id, value] of [['lookahead', '4'], ['clearance', '2.5'], ['neighbors', '7'], ['force-x', '0'], ['seed', '42']])
    assert.equal(await page.$eval(`#${id}`, input => input.value), value, `restore ${id}`);
  for (const id of ['avoidance-enabled', 'altitude-enabled', 'spatial-grid'])
    assert.equal(await page.$eval(`#${id}`, input => input.checked), true, `restore ${id}`);
  assert.equal(await page.$eval('#obstacles-enabled', input => input.checked), false);
  assert.equal(await page.$eval('#advanced', details => details.open), false);
  // Exercise the population control through a real keyboard interaction.
  await page.focus('#population');
  await page.keyboard.press('Home');
  assert.equal(await page.$eval('#population-value', output => output.value), '16');
  await page.keyboard.down('Shift');
  await page.mouse.move(800, 380);
  await page.keyboard.up('Shift');
  await page.click('#reset');
  await page.screenshot({ path: `${output}/flock.png` });
  // Exercise both pitch limits: the panorama must never become nearby ground.
  await page.mouse.move(900, 400);
  await page.mouse.down();
  await page.mouse.move(900, 990, { steps: 12 });
  await page.mouse.up();
  await page.screenshot({ path: `${output}/sky-pitch-limit-a.png` });
  await page.mouse.move(900, 800);
  await page.mouse.down();
  await page.mouse.move(900, 20, { steps: 12 });
  await page.mouse.up();
  await page.screenshot({ path: `${output}/sky-pitch-limit-b.png` });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.click('#view');
  await page.screenshot({ path: `${output}/mobile-study.png` });
  await page.select('#flight-mode', 'glide');
  await page.click('#pause');
  await page.$eval('#separation', input => { input.value = '2.7'; input.dispatchEvent(new Event('input')); });
  await page.click('#reset-defaults');
  assert.equal(await page.$eval('#population', input => input.value), '96');
  for (const [id, value] of [['separation', '1.8'], ['alignment', '0.8'], ['cohesion', '0.4']]) {
    assert.equal(await page.$eval(`#${id}`, input => input.value), value);
    assert.equal(await page.$eval(`#${id}-value`, output => output.value), value);
  }
  assert.equal(await page.$eval('#status', output => output.value), 'Live · 60 Hz');
  assert.equal(await page.$eval('#pause', button => button.textContent), 'Pause');
  assert.equal(await page.$eval('#camera', button => button.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval('#view', button => button.textContent), 'Bird study');
  assert.equal(await page.$eval('#flight-mode', select => select.value), 'flap');
  await page.screenshot({ path: `${output}/mobile-defaults.png` });
  await page.click('#advanced > summary');
  await page.screenshot({ path: `${output}/advanced-mobile.png` });
  assert(await page.$eval('aside', panel => panel.getBoundingClientRect().top >= 0), 'expanded controls stay inside mobile viewport');
  await page.click('#advanced > summary');
  await page.click('#hide-ui');
  assert.equal(await page.$eval('aside', panel => getComputedStyle(panel).display), 'none');
  assert.equal(await page.$eval('header', header => getComputedStyle(header).display), 'none');
  await page.click('#show-ui');
  assert.notEqual(await page.$eval('aside', panel => getComputedStyle(panel).display), 'none');
  await page.focus('#pause');
  await page.keyboard.press('h');
  assert.equal(await page.$eval('footer', footer => getComputedStyle(footer).display), 'none');
  await page.keyboard.press('Escape');
  assert.notEqual(await page.$eval('aside', panel => getComputedStyle(panel).display), 'none');
  await page.focus('#population');
  await page.keyboard.press('h');
  assert.notEqual(await page.$eval('aside', panel => getComputedStyle(panel).display), 'none', 'editing controls must not toggle the interface');
  await page.click('#advanced > summary');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }),
    page.select('#backend', rust ? 'cpp' : 'rust'),
  ]);
  await page.waitForSelector('canvas[data-ready="true"]', { timeout: 60000 });
  assert.equal(await page.$eval('#backend', select => select.value), rust ? 'cpp' : 'rust');
  assert((await page.$eval('#backend-badge', badge => badge.textContent)).includes(rust ? 'C++23' : 'Rust'));
  assert.deepEqual(errors, [], 'No failed assets, runtime errors, or shader errors');
  console.log(`Browser checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
