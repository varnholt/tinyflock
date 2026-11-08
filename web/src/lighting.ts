import * as THREE from 'three';

export interface HDRPixels { data: Uint16Array; width: number; height: number }

/** Split the dominant bright sky lobe from the ambient HDR, in linear radiance.
 * Its removed solid-angle-weighted energy becomes the directional source;
 * the visible panorama stays untouched. This avoids adding a second arbitrary sun.
 * HDR values are relative exposure units, not an absolute lux calibration.
 */
export function extractSun(image: HDRPixels) {
  const { data, width, height } = image;
  const read = (offset: number) => THREE.DataUtils.fromHalfFloat(data[offset]);
  let peak = 0, peakPixel = 0;
  for (let pixel = 0; pixel < width * height; ++pixel) {
    const light = read(pixel * 4) * .2126 + read(pixel * 4 + 1) * .7152 + read(pixel * 4 + 2) * .0722;
    if (light > peak) { peak = light; peakPixel = pixel; }
  }
  const longitude = ((peakPixel % width + .5) / width - .5) * Math.PI * 2;
  const latitude = (.5 - (Math.floor(peakPixel / width) + .5) / height) * Math.PI;
  const peakDirection = new THREE.Vector3(Math.cos(longitude) * Math.cos(latitude),
    Math.sin(latitude), Math.sin(longitude) * Math.cos(latitude));
  const ring: number[][] = [[], [], []];
  const samples: { offset: number; direction: THREE.Vector3; angle: number; solidAngle: number }[] = [];
  const angularStep = Math.PI * Math.PI * 2 / (width * height);
  // Only a small neighborhood around the dominant sky lobe needs angular work.
  const cx = peakPixel % width, cy = Math.floor(peakPixel / width);
  const radius = Math.ceil(height * 14 / 180);
  const xRadius = Math.ceil(radius / Math.max(.15, Math.cos(latitude)));
  for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); ++y) {
    const lat = (.5 - (y + .5) / height) * Math.PI;
    const cosLat = Math.cos(lat);
    for (let dx = -xRadius; dx <= xRadius; ++dx) {
      const x = (cx + dx + width) % width;
      const lon = ((x + .5) / width - .5) * Math.PI * 2;
      const direction = new THREE.Vector3(Math.cos(lon) * cosLat, Math.sin(lat), Math.sin(lon) * cosLat);
      const angle = Math.acos(THREE.MathUtils.clamp(direction.dot(peakDirection), -1, 1)) * 180 / Math.PI;
      const offset = (y * width + x) * 4;
      if (angle >= 9 && angle <= 13) for (let c = 0; c < 3; ++c) ring[c].push(read(offset + c));
      if (angle < 8) samples.push({ offset, direction, angle, solidAngle: angularStep * cosLat });
    }
  }
  const baseline = ring.map(channel => {
    channel.sort((a, b) => a - b);
    return channel[Math.floor(channel.length / 2)] ?? 0;
  });
  const ambient = data.slice();
  const irradiance = [0, 0, 0];
  const direction = new THREE.Vector3();
  for (const sample of samples) {
    const fade = 1 - THREE.MathUtils.smoothstep(sample.angle, 6, 8);
    let removedLight = 0;
    for (let c = 0; c < 3; ++c) {
      const original = read(sample.offset + c);
      const remainder = original - Math.max(0, original - baseline[c]) * fade;
      ambient[sample.offset + c] = THREE.DataUtils.toHalfFloat(remainder);
      // Integrate the actual quantized removal, so the accounting matches the texture.
      const removed = Math.max(0, original - THREE.DataUtils.fromHalfFloat(ambient[sample.offset + c]));
      irradiance[c] += removed * sample.solidAngle;
      removedLight += removed * [.2126, .7152, .0722][c];
    }
    direction.addScaledVector(sample.direction, removedLight * sample.solidAngle);
  }
  if (direction.lengthSq() < 1e-12) direction.copy(peakDirection); else direction.normalize();
  return { ambient, direction, irradiance: new THREE.Color().setRGB(irradiance[0], irradiance[1], irradiance[2]) };
}
