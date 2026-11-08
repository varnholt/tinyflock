import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PhaseClock } from './motion';

export type FlightMode = 'natural' | 'flap' | 'glide';
export interface BirdVisual {
  object: THREE.Group;
  update(index: number, matrix: THREE.Matrix4, time: number, effort: number): void;
  commit(count: number): void;
  updateLight(camera: THREE.Camera, direction: THREE.Vector3, irradiance: THREE.Color): void;
  setMode(mode: FlightMode): void;
  resetAnimation(): void;
  setShadows(enabled: boolean): void;
  dispose(): void;
}

/** Shared GLB geometry/materials; transforms and authored morph poses vary per bird. */
export async function loadBirds(url: string, capacity: number): Promise<BirdVisual> {
  const asset = await new GLTFLoader().loadAsync(url);
  const object = new THREE.Group();
  const sourceMeshes: THREE.Mesh[] = [];
  const batches: THREE.InstancedMesh[] = [];
  const sunView = { value: new THREE.Vector3() };
  const sunIrradiance = { value: new THREE.Color() };
  let mode: FlightMode = 'natural';
  const clocks = Array.from({ length: capacity }, (_, index) => new PhaseClock(index * 0.61803398875));
  asset.scene.updateMatrixWorld(true);
  asset.scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    if (node instanceof THREE.SkinnedMesh) throw new Error('Bake the flight rig to morph targets before instancing.');
    const geometry = node.geometry.clone();
    geometry.applyMatrix4(node.matrixWorld);
    const original = node.material as THREE.MeshStandardMaterial;
    let material: THREE.MeshStandardMaterial = original;
    if (original.name === 'Plumage') {
      material = new THREE.MeshPhysicalMaterial({
        name: original.name, color: original.color, map: original.map,
        normalMap: original.normalMap, normalScale: original.normalScale,
        vertexColors: true, side: THREE.FrontSide, roughness: 0.74,
        metalness: 0, sheen: 0.08, sheenRoughness: 0.85, sheenColor: new THREE.Color(0xc7c8c3),
      });
      // A small thin-feather light contribution. Both vectors are in view space;
      // moving the camera must not move the light relative to the bird.
      material.onBeforeCompile = shader => {
        shader.uniforms.sunView = sunView;
        shader.uniforms.sunIrradiance = sunIrradiance;
        shader.vertexShader = 'varying float featherThinness;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
          // Exported glTF uses +Z forward, so local X spans the wings.
          featherThinness = smoothstep(0.10, 0.24, abs(transformed.x));
          #include <project_vertex>
        `);
        shader.fragmentShader = 'uniform vec3 sunView;\nuniform vec3 sunIrradiance;\nvarying float featherThinness;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
          #include <lights_fragment_end>
          float featherBacklight = pow(max(0.0, dot(-normal, sunView)), 2.0);
          float forwardScatter = pow(max(0.0, dot(-geometryViewDir, sunView)), 4.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * sunIrradiance * featherBacklight
            * featherThinness * (0.12 + 0.28 * forwardScatter);
        `);
      };
      material.customProgramCacheKey = () => 'tinyflock-thin-feathers-v3';
    } else {
      material.roughness = Math.max(material.roughness, 0.55);
      material.metalness = 0;
    }
    const batch = new THREE.InstancedMesh(geometry, material, capacity);
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    batch.frustumCulled = false;
    // Allocate for the full capacity before count is reduced to a single study bird.
    if (node.morphTargetInfluences) batch.setMorphAt(0, node);
    object.add(batch);
    sourceMeshes.push(node);
    batches.push(batch);
  });
  if (batches.length === 0) throw new Error('The bird GLB contains no meshes.');
  const clip = asset.animations.find(animation => animation.name === 'Flight');
  const track = clip?.tracks.find(animation => animation.name.endsWith('.morphTargetInfluences'));
  if (!clip || !track || clip.duration <= 0) throw new Error('The bird GLB must contain a Flight morph animation.');
  // KeyframeTrack's interpolant factory is supplied by the glTF loader.
  const interpolant = (track as THREE.KeyframeTrack & {
    createInterpolant(result?: Float32Array): THREE.Interpolant;
  }).createInterpolant();
  return {
    object,
    update(index, matrix, time, effort) {
      const phase = clocks[index].sample(time, 0.86 + effort * 0.22, clip.duration);
      const influences = interpolant.evaluate(phase) as Float32Array;
      // Individual glide windows, smoothly blended in and out of the authored clip.
      const glideCycle = Math.sin(time * 0.57 + index * 2.39996);
      const flap = mode === 'flap' ? 1 : mode === 'glide' ? 0
        : THREE.MathUtils.smoothstep(glideCycle, -0.45, 0.25);
      for (let i = 0; i < batches.length; ++i) {
        batches[i].setMatrixAt(index, matrix);
        const source = sourceMeshes[i];
        if (source.morphTargetInfluences) {
          for (let j = 0; j < influences.length; ++j) source.morphTargetInfluences[j] = influences[j] * flap;
          batches[i].setMorphAt(index, source);
        }
      }
    },
    commit(count) {
      for (const batch of batches) {
        batch.count = count;
        batch.instanceMatrix.needsUpdate = true;
        if (batch.morphTexture) batch.morphTexture.needsUpdate = true;
      }
    },
    updateLight(camera, direction, irradiance) {
      sunView.value.copy(direction).transformDirection(camera.matrixWorldInverse);
      sunIrradiance.value.copy(irradiance);
    },
    setMode(value) { mode = value; },
    resetAnimation() { for (const clock of clocks) clock.reset(); },
    setShadows(enabled) {
      for (const batch of batches) { batch.castShadow = enabled; batch.receiveShadow = enabled; }
    },
    dispose() {
      const textures = new Set<THREE.Texture>();
      for (const batch of batches) {
        batch.geometry.dispose();
        const material = batch.material as THREE.MeshStandardMaterial;
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
        material.dispose();
        batch.dispose();
      }
      for (const texture of textures) texture.dispose();
    },
  };
}
