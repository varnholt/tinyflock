import assert from 'node:assert/strict';
import * as THREE from 'three';
import { extractSun } from '../src/lighting.ts';

const width = 256, height = 128;
const data = new Uint16Array(width * height * 4);
for (let i = 0; i < data.length; i += 4) {
  data[i] = THREE.DataUtils.toHalfFloat(.2);
  data[i + 1] = THREE.DataUtils.toHalfFloat(.3);
  data[i + 2] = THREE.DataUtils.toHalfFloat(.4);
  data[i + 3] = THREE.DataUtils.toHalfFloat(1);
}
const peak = (48 * width + 160) * 4;
for (const [channel, value] of [20, 12, 4].entries()) data[peak + channel] = THREE.DataUtils.toHalfFloat(value);
const original = data.slice();
const result = extractSun({ data, width, height });
assert.deepEqual(data, original, 'background radiance must remain unchanged');
const removed = [0, 0, 0];
for (let y = 0; y < height; ++y) {
  const area = Math.PI * Math.PI * 2 / (width * height) * Math.cos((.5 - (y + .5) / height) * Math.PI);
  for (let x = 0; x < width; ++x) for (let c = 0; c < 3; ++c) {
    const offset = (y * width + x) * 4 + c;
    const ambient = THREE.DataUtils.fromHalfFloat(result.ambient[offset]);
    assert(ambient >= 0, 'ambient radiance cannot be negative');
    removed[c] += (THREE.DataUtils.fromHalfFloat(data[offset]) - ambient) * area;
  }
}
for (const [c, value] of [result.irradiance.r, result.irradiance.g, result.irradiance.b].entries()) {
  assert(Math.abs(value - removed[c]) < 1e-10, 'sun must reintroduce exactly the energy removed from ambient');
}
assert(result.irradiance.r > result.irradiance.g && result.irradiance.g > result.irradiance.b,
  'the measured sun color must follow the warm HDR source');
const longitude = ((160.5 / width) - .5) * Math.PI * 2;
const latitude = (.5 - 48.5 / height) * Math.PI;
const expected = new THREE.Vector3(Math.cos(longitude) * Math.cos(latitude), Math.sin(latitude),
  Math.sin(longitude) * Math.cos(latitude));
assert(result.direction.dot(expected) > .9999, 'sun direction must align with the visible panorama');
console.log('HDR lighting alignment and energy-accounting checks passed');
