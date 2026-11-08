import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { extractSun, type HDRPixels } from './lighting';

/** The photographed sky supplies both the visible background and surrounding light. */
export async function loadEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, url: string) {
  const sky = await new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(url);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  const image = sky.image as unknown as HDRPixels;
  const { ambient, direction, irradiance } = extractSun(image);
  const ambientMap = new THREE.DataTexture(ambient, image.width, image.height, THREE.RGBAFormat, THREE.HalfFloatType);
  ambientMap.mapping = THREE.EquirectangularReflectionMapping;
  ambientMap.colorSpace = THREE.LinearSRGBColorSpace;
  ambientMap.flipY = sky.flipY;
  ambientMap.minFilter = ambientMap.magFilter = THREE.LinearFilter;
  ambientMap.needsUpdate = true;
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = generator.fromEquirectangular(ambientMap);
  ambientMap.dispose();
  generator.dispose();
  scene.background = sky;
  scene.backgroundIntensity = 1;
  scene.environment = environment.texture;
  scene.environmentIntensity = 1;
  const strength = Math.max(irradiance.r, irradiance.g, irradiance.b);
  const sunColor = strength > 0 ? irradiance.clone().multiplyScalar(1 / strength) : new THREE.Color(0xffffff);
  const sun = new THREE.DirectionalLight(sunColor, strength);
  sun.castShadow = true;
  sun.shadow.autoUpdate = false;
  sun.position.copy(direction).multiplyScalar(200);
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -2;
  sun.shadow.camera.right = 2;
  sun.shadow.camera.top = 2;
  sun.shadow.camera.bottom = -2;
  sun.shadow.camera.near = 190;
  sun.shadow.camera.far = 210;
  sun.shadow.bias = -0.00002;
  sun.shadow.normalBias = 0.001;
  sun.shadow.radius = 3;
  scene.add(sun);
  // Keep the light/shader layout stable across views. Only the shadow-map
  // updates and the bird batches' casting/receiving flags need to change.
  return { direction, irradiance, studyShadows(enabled: boolean) {
    sun.shadow.autoUpdate = enabled;
    sun.shadow.needsUpdate = enabled;
  },
    dispose() { sky.dispose(); environment.dispose(); sun.shadow.dispose(); } };
}
