import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import puppeteer from 'puppeteer';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = fileURLToPath(new URL('../../build/visual/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, root, base: './',
  preview: { host: '127.0.0.1', port: 0, strictPort: false } });
let browser;
try {
  browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('canvas[data-ready="true"]');
  const base64 = await page.evaluate(async () => {
    const stream = document.querySelector('canvas').captureStream(30);
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });
    const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    await new Promise(resolve => setTimeout(resolve, 10000));
    recorder.stop();
    await stopped;
    stream.getTracks().forEach(track => track.stop());
    const blob = new Blob(chunks, { type: mimeType });
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });
  });
  const path = `${output}/flight-motion.webm`;
  await writeFile(path, Buffer.from(base64, 'base64'));
  console.log(`Recorded ten seconds of flight: ${path}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
