import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadBirds, type FlightMode } from './birds';
import { loadEnvironment } from './environment';
import { FlightMotion } from './motion';
import { installInterfaceToggle } from './interface';
import { installBehaviorControls } from './behavior';
import type { Simulation } from './simulation';
import { createRustSimulation } from './rust-adapter';
import './style.css';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = element<HTMLOutputElement>('status');
const canvas = element<HTMLCanvasElement>('scene');
const setInterfaceVisible = installInterfaceToggle();

async function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // Supersample even on 1x displays: distant feathers are often subpixel geometry.
  const resizeRenderer = () => {
    renderer.setPixelRatio(Math.max(1, Math.min(2, Math.sqrt(4_000_000 / (innerWidth * innerHeight)))));
    renderer.setSize(innerWidth, innerHeight);
  };
  resizeRenderer();
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 0.85;
  const scene = new THREE.Scene();
  const flockAltitude = 40;
  const flockCamera: [number, number, number] = [-64, -9, -87];
  scene.fog = new THREE.FogExp2(0xb6a496, 0.002);
  const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 1500);
  camera.position.set(...flockCamera);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 2;
  controls.maxDistance = 220;
  controls.maxPolarAngle = Math.PI * 0.66;
  controls.target.set(0, flockAltitude, 0);
  const assetUrl = (name: string) => new URL(`${import.meta.env.BASE_URL}assets/${name}`, document.baseURI).href;
  status.value = 'Loading sky & bird…';
  const [environment, birds] = await Promise.all([
    loadEnvironment(renderer, scene, assetUrl(renderer.capabilities.maxTextureSize >= 4096
      ? 'kloppenheim_landscape_4k.hdr' : 'kloppenheim_landscape_2k.hdr')),
    loadBirds(assetUrl('gull.glb'), 384),
  ]);
  scene.add(birds.object);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xeed3a2, transparent: true, opacity: 0.7 }));
  marker.visible = false;
  scene.add(marker);

  // Resolve against the page, not the bundled script's /assets/ directory.
  const moduleUrl = new URL(`${import.meta.env.BASE_URL}wasm/tinyflock.js`, document.baseURI).href;
  const rustBackend = new URLSearchParams(location.search).get('core') === 'rust';
  const backend = element<HTMLSelectElement>('backend');
  backend.value = rustBackend ? 'rust' : 'cpp';
  backend.addEventListener('change', () => {
    const url = new URL(location.href);
    if (backend.value === 'rust') url.searchParams.set('core', 'rust'); else url.searchParams.delete('core');
    location.assign(url.href);
  });
  let simulation: Simulation;
  if (rustBackend) {
    simulation = await createRustSimulation(new URL(`${import.meta.env.BASE_URL}wasm-rust/tinyflock_web.js`, document.baseURI).href);
  } else {
    const { default: createTinyflock } = await import(/* @vite-ignore */ moduleUrl);
    const wasm = await createTinyflock();
    simulation = new wasm.Simulation();
  }
  element('backend-badge').textContent = `${rustBackend ? 'Rust' : 'C++23'} · WebAssembly`;
  const obstacleVisuals = new THREE.Group();
  obstacleVisuals.position.y = flockAltitude;
  scene.add(obstacleVisuals);
  const obstacleGeometry = new THREE.SphereGeometry(1, 24, 16);
  const obstacleMaterial = new THREE.MeshBasicMaterial({ color: 0xd09b4a, wireframe: true, transparent: true, opacity: .4, depthWrite: false });
  const updateObstacleVisuals = () => {
    obstacleVisuals.clear();
    for (const obstacle of simulation.obstacles()) {
      const visual = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
      visual.position.set(obstacle.x, obstacle.y, obstacle.z);
      visual.scale.setScalar(obstacle.radius);
      obstacleVisuals.add(visual);
    }
  };
  simulation.reset(96, 42);
  let current = simulation.state().slice();
  let previous = current.slice();
  let paused = false;
  let accumulator = 0;
  const timestep = 1 / 60;
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane();
  const normal = new THREE.Vector3();
  const point = new THREE.Vector3();
  let shift = false;
  let repel = false;
  let study = new URLSearchParams(location.search).get('view') === 'bird';
  let flightTime = 0;
  let follow = true;
  let interacting = false;
  let resumeCameraAt = 0;
  controls.addEventListener('start', () => { interacting = true; });
  controls.addEventListener('end', () => { interacting = false; resumeCameraAt = performance.now() + 6000; });
  const center = new THREE.Vector3();
  const cameraMotion = new THREE.Vector3();
  const cameraButton = element<HTMLButtonElement>('camera');
  cameraButton.textContent = 'Camera: drifting';
  cameraButton.setAttribute('aria-pressed', 'true');
  cameraButton.disabled = false;
  const setFollow = (value: boolean) => {
    follow = value;
    cameraButton.textContent = follow ? 'Camera: drifting' : 'Camera: fixed';
    cameraButton.setAttribute('aria-pressed', String(follow));
  };
  cameraButton.addEventListener('click', () => setFollow(!follow));
  const motion = new FlightMotion(384);

  const view = element<HTMLButtonElement>('view');
  const flightMode = element<HTMLSelectElement>('flight-mode');
  flightMode.addEventListener('change', () => birds.setMode(study ? flightMode.value as FlightMode : 'natural'));
  const setView = () => {
    release();
    view.textContent = study ? 'View flock' : 'Bird study';
    view.setAttribute('aria-pressed', String(study));
    controls.target.set(0, study ? 0 : flockAltitude, 0);
    birds.object.position.y = study ? 0 : flockAltitude;
    obstacleVisuals.visible = !study;
    const studyCamera: [number, number, number] = innerWidth / innerHeight < 0.8 ? [1.9, 0.6, 2.6] : [1.4, 0.45, 1.9];
    camera.position.set(...(study ? studyCamera : flockCamera));
    controls.minDistance = study ? 1 : 65;
    controls.maxDistance = study ? 12 : 220;
    // The photographed ground has no parallax. Keep the flock framed in sky,
    // with at most a narrow strip of distant horizon at the bottom of the image.
    controls.minPolarAngle = study ? 0.05 : Math.PI / 2 + THREE.MathUtils.degToRad(22);
    controls.maxPolarAngle = study ? Math.PI * .66 : Math.PI / 2 + THREE.MathUtils.degToRad(38);
    controls.update();
    element('intro').hidden = study;
    document.body.dataset.view = study ? 'bird' : 'flock';
    birds.setMode(study ? flightMode.value as FlightMode : 'natural');
    birds.setShadows(study);
    environment.studyShadows(study);
    element('view-note').textContent = study ? 'Herring gull / Flight study' : 'Collective motion / 001';
  };

  const release = () => { shift = false; marker.visible = false; controls.enabled = true; simulation.clearTarget(); };
  view.addEventListener('click', () => { study = !study; setView(); });
  setView();
  view.disabled = false;
  window.addEventListener('keydown', event => { shift = event.shiftKey; repel = event.altKey; controls.enabled = !shift; });
  window.addEventListener('keyup', event => { shift = event.shiftKey; repel = event.altKey; if (!shift) release(); });
  window.addEventListener('blur', release);
  canvas.addEventListener('pointerleave', release);
  canvas.addEventListener('pointermove', event => {
    pointer.set(event.clientX / innerWidth * 2 - 1, 1 - event.clientY / innerHeight * 2);
    shift = event.shiftKey;
    repel = event.altKey;
    controls.enabled = !shift;
  });
  const population = element<HTMLInputElement>('population');
  const rules = ['separation', 'alignment', 'cohesion'] as const;
  for (const id of rules) {
    element<HTMLInputElement>(id).addEventListener('input', event => {
      element<HTMLOutputElement>(`${id}-value`).value = Number((event.target as HTMLInputElement).value).toFixed(1);
      const values = rules.map(rule => Number(element<HTMLInputElement>(rule).value));
      if (!simulation.weights(values[0], values[1], values[2])) throw new Error('Invalid rule weights');
    });
  }
  const reset = () => {
    simulation.reset(Number(population.value), behavior.seed);
    current = simulation.state().slice();
    previous = current.slice();
    accumulator = 0;
    motion.reset();
  };
  const behavior = installBehaviorControls(simulation, reset, updateObstacleVisuals);
  population.addEventListener('input', () => {
    element<HTMLOutputElement>('population-value').value = population.value;
    reset();
  });
  const pause = element<HTMLButtonElement>('pause');
  pause.disabled = false;
  element<HTMLButtonElement>('reset').disabled = false;
  const setPaused = (value: boolean) => {
    paused = value;
    pause.textContent = paused ? 'Resume' : 'Pause';
    status.value = paused ? 'Paused' : 'Live · 60 Hz';
  };
  pause.addEventListener('click', () => setPaused(!paused));
  element('reset').addEventListener('click', reset);
  const resetDefaults = element<HTMLButtonElement>('reset-defaults');
  resetDefaults.disabled = false;
  resetDefaults.addEventListener('click', () => {
    setInterfaceVisible(true);
    behavior.restoreDefaults();
    population.value = population.defaultValue;
    element<HTMLOutputElement>('population-value').value = population.value;
    const values = rules.map(rule => {
      const input = element<HTMLInputElement>(rule);
      input.value = input.defaultValue;
      element<HTMLOutputElement>(`${rule}-value`).value = Number(input.value).toFixed(1);
      return Number(input.value);
    });
    if (!simulation.weights(values[0], values[1], values[2])) throw new Error('Invalid default rule weights');
    flightMode.value = [...flightMode.options].find(option => option.defaultSelected)?.value ?? 'flap';
    setPaused(false);
    setFollow(true);
    interacting = false;
    resumeCameraAt = performance.now();
    controls.autoRotate = false;
    controls.reset();
    study = false;
    setView();
    flightTime = 0;
    birds.resetAnimation();
    reset();
  });
  window.addEventListener('resize', () => {
    resizeRenderer();
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
  const transform = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  let lastTime = performance.now();
  let nextStats = 0;
  status.value = 'Live · 60 Hz';

  renderer.setAnimationLoop((time: number) => {
    const delta = Math.max(0, Math.min((time - lastTime) / 1000, 0.1));
    lastTime = time;
    if (shift && !study) {
      camera.getWorldDirection(normal);
      plane.setFromNormalAndCoplanarPoint(normal, controls.target);
      raycaster.setFromCamera(pointer, camera);
      marker.visible = raycaster.ray.intersectPlane(plane, point) !== null;
      if (marker.visible) {
        marker.position.copy(point);
        simulation.target(point.x, point.y - flockAltitude, point.z, behavior.pointerStrength * (repel ? -1.5 : 1));
      } else simulation.clearTarget();
    } else { marker.visible = false; simulation.clearTarget(); }
    if (!paused) {
      flightTime += delta;
      accumulator += delta;
      while (accumulator >= timestep) {
        previous.set(current);
        if (!simulation.step(timestep)) throw new Error('Simulation rejected timestep');
        // Copy immediately: WASM views can be invalidated by memory growth/reset.
        current.set(simulation.state());
        accumulator -= timestep;
      }
    }
    const alpha = accumulator / timestep;
    if (follow && !study) {
      center.set(0, 0, 0);
      for (let offset = 0; offset < current.length; offset += 6) {
        center.x += THREE.MathUtils.lerp(previous[offset], current[offset], alpha);
        center.y += THREE.MathUtils.lerp(previous[offset + 1], current[offset + 1], alpha);
        center.z += THREE.MathUtils.lerp(previous[offset + 2], current[offset + 2], alpha);
      }
      center.divideScalar(Math.max(1, current.length / 6));
      center.y += flockAltitude;
      cameraMotion.copy(center).sub(controls.target).multiplyScalar(1 - Math.exp(-delta * 0.8));
      controls.target.add(cameraMotion);
      camera.position.add(cameraMotion);
    }
    controls.autoRotate = follow && !study && !paused && !interacting && time > resumeCameraAt;
    controls.autoRotateSpeed = .12 * THREE.MathUtils.smoothstep(time - resumeCameraAt, 0, 2000);
    controls.update(delta);
    const count = study ? 1 : current.length / 6;
    for (let i = 0; i < count; i++) {
      let effort = 0;
      if (study) {
        transform.position.set(0, 0, 0);
        transform.quaternion.setFromAxisAngle(up, -0.6);
        transform.scale.setScalar(1.2);
      } else {
        effort = motion.sample(i, previous, current, alpha, timestep, paused ? 0 : delta, transform);
        transform.scale.setScalar(1.6 + (i % 7) * 0.035);
      }
      transform.updateMatrix();
      birds.update(i, transform.matrix, flightTime, effort);
    }
    birds.commit(count);
    if (time >= nextStats) { behavior.updateStats(); nextStats = time + 250; }
    camera.updateMatrixWorld();
    birds.updateLight(camera, environment.direction, environment.irradiance);
    renderer.render(scene, camera);
    canvas.dataset.ready = 'true';
  });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    renderer.setAnimationLoop(null);
    simulation.delete();
    birds.dispose();
    environment.dispose();
    controls.dispose();
    obstacleGeometry.dispose();
    obstacleMaterial.dispose();
    renderer.dispose();
  }, { once: true });
}

start().catch(error => {
  setInterfaceVisible(true);
  console.error(error);
  status.value = 'Unable to start';
  const message = element('error');
  message.hidden = false;
  message.textContent = 'The simulation could not load. Build the WebAssembly target and use a browser with WebGL 2 support. See the repository README for setup.';
});
