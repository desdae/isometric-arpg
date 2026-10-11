import * as THREE from 'three';
import { installHeightFog } from './engine/fog';
import { IsoCamera } from './engine/IsoCamera';
import { Renderer } from './engine/Renderer';
import { Mist, Sky } from './engine/Atmosphere';
import { buildTestScene } from './scenes/testScene';
import { perlin2 } from './procgen/noise';

installHeightFog();

const t0 = performance.now();
const { scene, lanterns, moon } = await buildTestScene();
const sky = new Sky();
scene.add(sky.mesh);
const mist = new Mist(40);
scene.add(mist.group);
const genMs = performance.now() - t0;

const cam = new IsoCamera(window.innerWidth / window.innerHeight, document.body);
const renderer = new Renderer(document.body, scene, cam.camera);
const params = new URLSearchParams(location.search);
if (params.has("dist")) cam.distance = Number(params.get("dist"));
cam.target.set(Number(params.get("x") ?? 0), 0, Number(params.get("z") ?? 0));
window.addEventListener('resize', () => cam.resize(window.innerWidth / window.innerHeight));

const hud = document.getElementById('hud')!;
const clock = new THREE.Clock();
let frames = 0;
let fpsTime = 0;
let fps = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  cam.update(dt);
  // Keep the shadow frustum centred on what the camera sees.
  moon.target.position.copy(cam.target);
  moon.position.copy(cam.target).add(new THREE.Vector3(-30, 45, 20));
  // Fit the shadow frustum and fog to the zoom level so the look holds at any distance.
  const half = cam.distance * 1.25;
  const sc = moon.shadow.camera;
  if (sc.right !== half) {
    sc.left = sc.bottom = -half;
    sc.right = sc.top = half;
    sc.updateProjectionMatrix();
  }
  (scene.fog as THREE.FogExp2).density = 0.42 / cam.distance;
  sky.update(t, cam.camera.position);
  mist.update(dt);
  lanterns.forEach((l, i) => {
    const f = 0.8 + 0.2 * perlin2(t * 6, i * 10) + 0.08 * perlin2(t * 23, i * 7);
    l.light.intensity = 30 * f;
    l.flame.scale.set(1, 1.5 * (0.9 + 0.2 * f), 1);
  });
  renderer.render(t);

  frames++;
  fpsTime += dt;
  if (fpsTime > 0.5) {
    fps = frames / fpsTime;
    frames = 0;
    fpsTime = 0;
    hud.textContent = `${fps.toFixed(0)} fps · world generated in ${genMs.toFixed(0)} ms\nWASD pan · wheel zoom · Q/E rotate`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __ready: boolean }).__ready = true;
