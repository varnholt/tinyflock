import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('canvas[data-ready=true]');
  await page.screenshot({ path: '../build/visual/gpu-live.png' });
  console.log(await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    const gl = canvas.getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';
    // Exclude initial texture uploads and driver shader warm-up from the sample.
    await new Promise(resolve => setTimeout(resolve, 2000));
    const durations = [];
    const start = performance.now(); let last = start;
    await new Promise(resolve => { const frame = now => {
      durations.push(now - last); last = now;
      if (now - start > 3000) resolve(); else requestAnimationFrame(frame);
    }; requestAnimationFrame(frame); });
    durations.shift(); durations.sort((a, b) => a - b);
    return { renderer, frames: durations.length, medianMs: durations[Math.floor(durations.length * .5)],
      p95Ms: durations[Math.floor(durations.length * .95)], maxMs: durations.at(-1) };
  }));
  await page.click('#view');
  await page.click('#view');
  await page.screenshot({ path: '../build/visual/gpu-after-study.png' });
} finally { await browser.close(); }
