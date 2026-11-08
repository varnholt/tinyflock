import { readFile } from 'node:fs/promises';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { FloatType } from 'three';

const root = new URL('../public/assets/', import.meta.url);
const glb = await readFile(new URL('gull.glb', root));
const jsonLength = glb.readUInt32LE(12);
const model = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
console.log(JSON.stringify({
  bytes: glb.length,
  meshes: model.meshes.map(mesh => ({name: mesh.name, targets: mesh.extras?.targetNames,
    primitives: mesh.primitives.length})),
  materials: model.materials.map(material => ({name: material.name,
    color: material.pbrMetallicRoughness?.baseColorFactor,
    texture: material.pbrMetallicRoughness?.baseColorTexture,
    doubleSided: material.doubleSided})),
  animations: model.animations?.map(animation => ({name: animation.name, channels: animation.channels})),
}, null, 2));
const binary = glb.subarray(20 + jsonLength + 8);
for (const [index, primitive] of model.meshes[0].primitives.entries()) {
  const accessor = model.accessors[primitive.attributes.COLOR_0];
  if (!accessor) continue;
  const view = model.bufferViews[accessor.bufferView];
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const indices = model.accessors[primitive.indices];
  const indexView = model.bufferViews[indices.bufferView];
  const indexOffset = (indexView.byteOffset ?? 0) + (indices.byteOffset ?? 0);
  const readIndex = indices.componentType === 5125 ? i => binary.readUInt32LE(indexOffset + i * 4) : i => binary.readUInt16LE(indexOffset + i * 2);
  const componentBytes = { 5121: 1, 5123: 2, 5126: 4 }[accessor.componentType];
  if (!componentBytes) throw new Error('Unsupported color component type');
  const stride = view.byteStride ?? componentBytes * (accessor.type === 'VEC4' ? 4 : 3);
  let minimum = Infinity, maximum = -Infinity;
  for (let i = 0; i < indices.count; ++i) {
    const position = offset + readIndex(i) * stride;
    const value = componentBytes === 1 ? binary[position] / 255 : componentBytes === 2
      ? binary.readUInt16LE(position) / 65535 : binary.readFloatLE(position);
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  console.log('color', index, accessor.componentType, accessor.type, accessor.count, minimum, maximum);
}
const bytes = await readFile(new URL('kloppenheim_landscape_2k.hdr', root));
const hdr = new HDRLoader().setDataType(FloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
let brightest = 0, pixel = 0;
for (let i = 0; i < hdr.data.length; i += 4) {
  const luminance = 0.2126 * hdr.data[i] + 0.7152 * hdr.data[i + 1] + 0.0722 * hdr.data[i + 2];
  if (luminance > brightest) { brightest = luminance; pixel = i / 4; }
}
const u = (pixel % hdr.width + 0.5) / hdr.width;
const v = 1 - (Math.floor(pixel / hdr.width) + 0.5) / hdr.height;
const longitude = (u - 0.5) * Math.PI * 2;
const latitude = (v - 0.5) * Math.PI;
console.log('HDR sun', {brightest, u, v, direction: [Math.cos(longitude) * Math.cos(latitude), Math.sin(latitude), Math.sin(longitude) * Math.cos(latitude)]});
