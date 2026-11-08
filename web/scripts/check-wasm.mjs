import { access } from 'node:fs/promises';

try {
  await Promise.all(['wasm/tinyflock.js', 'wasm/tinyflock.wasm', 'assets/gull.glb',
    'assets/kloppenheim_landscape_2k.hdr', 'assets/kloppenheim_landscape_4k.hdr']
    .map(file => access(new URL(`../public/${file}`, import.meta.url))));
} catch {
  console.error('Missing WebAssembly or demo assets. Build the WASM target and check public/assets. See README.md.');
  process.exitCode = 1;
}
