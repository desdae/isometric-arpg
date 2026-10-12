import * as THREE from 'three';
import { audio } from './audio/Audio';
import { loading } from './engine/Loading';
import { installHeightFog } from './engine/fog';
import { IsoCamera } from './engine/IsoCamera';
import { Renderer } from './engine/Renderer';
import { Sky } from './engine/Atmosphere';
import { buildEnvironment } from './engine/environment';
import { buildTestScene } from './scenes/testScene';
import { buildWastelandZone } from './scenes/wastelandZone';
import { buildCharacterPreview } from './scenes/characterPreview';
import { buildTown } from './scenes/town';
import { buildDungeon } from './scenes/dungeon';
import { bakeSurfaces, pbrMaterial } from './procgen/textures';
import { Character } from './actors/Character';
import { dressKnight } from './actors/outfits/knight';
import { bakeRig } from './actors/bake';
import { addSilhouette } from './actors/silhouette';
import { KINDS, type MonsterKind } from './actors/Monster';
import { monsterMaterials } from './actors/monsters/materials';
import type { Rig } from './actors/Rig';
import { Game } from './game/Game';
import { MOON_OFFSET, type World } from './world/World';

installHeightFog();

const params = new URLSearchParams(location.search);
const hud = document.getElementById('hud')!;
hud.textContent = 'Generating world…';
if (!params.has('debug')) hud.style.visibility = 'hidden';

const t0 = performance.now();
// Artifacts only pass a bare #anchor, so the hash also picks the starting area.
const sceneName = params.get('scene') ?? (location.hash.slice(1) || 'town');

const cam = new IsoCamera(window.innerWidth / window.innerHeight, document.body);
const renderer = new Renderer(document.body, new THREE.Scene(), cam.camera);
const environment = buildEnvironment(renderer.renderer);
const sky = new Sky();
window.addEventListener('resize', () => cam.resize(window.innerWidth / window.innerHeight));

async function knight(): Promise<Character> {
  const [metal, cloth, mail] = await bakeSurfaces([
    { kind: 'wornMetal', seed: 21, size: 512, normalStrength: 2 },
    { kind: 'cloth', seed: 22, size: 512, normalStrength: 1.5 },
    { kind: 'chainmail', seed: 23, size: 256, normalStrength: 6 },
  ]);
  const c = dressKnight(new Character(), {
    steel: pbrMaterial(metal, 2, { color: 0xb4aea6 }),
    darkSteel: pbrMaterial(metal, 2, { color: 0x4a4642 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x1c120c, roughness: 0.75 }),
    cloth: pbrMaterial(cloth, 2),
    dark: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    brass: new THREE.MeshStandardMaterial({ color: 0x9a7438, metalness: 1, roughness: 0.42 }),
    tabard: pbrMaterial(cloth, 3, { color: new THREE.Color(0.55, 0.06, 0.05), metalness: 0 }),
    mail: pbrMaterial(mail, 6, { color: 0x56524d }),
  });
  bakeRig(c.root);
  return c;
}

/** ARPG "light radius": a soft light that travels with the hero so they always read. */
function heroLight(c: THREE.Object3D) {
  const l = new THREE.PointLight(0xffd2b0, 7, 9.5, 1.6);
  l.position.set(0, 3.8, 0);
  c.add(l);
}

let game: Game | null = null;
let world: World;
let preview: Rig | null = null;
let previewAttack: (() => void) | null = null;

if (sceneName === 'test' || sceneName === 'character') {
  // Inspection stages: the test scene, or one model animating in place
  // (?model=knight|ghoul|brute|crawler|cultist, ?speed=m/s, ?anim=attack|die).
  world = sceneName === 'test' ? await buildTestScene() : await buildCharacterPreview();
  document.getElementById('boot')?.remove();
  world.scene.add(sky.mesh);
  world.scene.environment = environment;
  world.scene.environmentIntensity = 0.45;
  renderer.setScene(world.scene);
  if (world.spawn) {
    const model = params.get('model') ?? 'knight';
    if (model in KINDS) {
      const body = KINDS[model as MonsterKind].build(await monsterMaterials(), Number(params.get('seed') ?? 3), params.has('elite'), params.has('boss'));
      preview = body.rig;
      const anim = params.get('anim');
      if (anim === 'attack') previewAttack = () => body.attack(() => {});
      if (anim === 'die') setTimeout(() => body.die(), 300);
    } else {
      const c = await knight();
      preview = c;
      heroLight(c.root);
    }
    world.scene.add(preview.root);
    cam.target.copy(world.spawn).add(new THREE.Vector3(0, 1, 0));
  }
} else {
  const startArea = sceneName === 'zone' || sceneName === 'dungeon' ? sceneName : 'town';
  await loading.show(startArea === 'town' ? 'Saint Orsolya' : startArea === 'zone' ? 'The Blighted Fields' : 'Into the Crypt', 'Forging a world out of nothing');
  loading.range(0, 0.12);
  await loading.step("Forging the knight's armour", 0);
  const hero = await knight();
  loading.range(0.12, 0.22);
  heroLight(hero.root);
  addSilhouette(hero.body);
  game = new Game({ town: buildTown, zone: buildWastelandZone, dungeon: () => buildDungeon(Number(params.get('dseed') ?? Math.floor(Math.random() * 1e9))) }, hero, cam, renderer, sky, environment);
  await game.start(startArea, startArea === 'zone' ? 'gate' : 'start');
  world = game.world!;
}
const genMs = performance.now() - t0;
cam.update(0);

if (params.has('dist')) {
  cam.distance = Number(params.get('dist'));
  cam.minDistance = Math.min(cam.minDistance, cam.distance);
  cam.maxDistance = Math.max(cam.maxDistance, cam.distance);
}
if (params.has('yaw')) cam.yaw = cam.targetYawValue = THREE.MathUtils.degToRad(Number(params.get('yaw')));
if (params.has('pitch')) cam.pitch = THREE.MathUtils.degToRad(Number(params.get('pitch')));
const freeCam = params.has('x') || params.has('z');
if (freeCam) cam.target.set(Number(params.get('x') ?? 0), 0, Number(params.get('z') ?? 0));
if (params.has('ty')) cam.target.y += Number(params.get('ty'));
// Scripting hooks for automated screenshots.
(window as unknown as { __game: Game | null; __THREE: typeof THREE }).__game = game;
(window as unknown as { __THREE: typeof THREE }).__THREE = THREE;
(window as unknown as { __audio: typeof audio }).__audio = audio;
if (params.has('walk') && game) {
  const [wx, wz] = params.get('walk')!.split(',').map(Number);
  setTimeout(() => game!.player.moveTo(new THREE.Vector3(wx, 0, wz)), 500);
}

const shadowBasis = new THREE.Matrix4();
const shadowInv = new THREE.Matrix4();
const shadowFocus = new THREE.Vector3();
const ORIGIN = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const clock = new THREE.Clock();
let frames = 0;
let fpsTime = 0;
let attackTimer = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  if (game) {
    world = game.world!;
    game.update(dt, t);
    if (!freeCam) cam.target.copy(game.player.position);
  } else {
    // Fixed step keeps preview poses deterministic even on slow machines.
    if (preview) preview.update(1 / 30, Number(params.get('speed') ?? 0));
    if (previewAttack && (attackTimer -= 1 / 30) <= 0) {
      attackTimer = 2;
      previewAttack();
    }
    world.update(dt, t);
  }
  cam.update(dt);
  if (game) cam.camera.position.add(game.shake());
  const moon = world.moon;
  // Keep the shadow frustum centred on what the camera sees, sized to the zoom.
  const half = Math.ceil(cam.distance * 1.25);
  const sc = moon.shadow.camera;
  if (sc.right !== half) {
    sc.left = sc.bottom = -half;
    sc.right = sc.top = half;
    sc.updateProjectionMatrix();
  }
  // Snap the shadow focus to whole shadow-map texels in light space so shadow
  // edges stay put instead of crawling as the camera moves.
  const texel = (2 * half) / moon.shadow.mapSize.x;
  shadowBasis.lookAt(MOON_OFFSET, ORIGIN, UP);
  shadowInv.copy(shadowBasis).invert();
  shadowFocus.copy(cam.target).applyMatrix4(shadowInv);
  shadowFocus.x = Math.round(shadowFocus.x / texel) * texel;
  shadowFocus.y = Math.round(shadowFocus.y / texel) * texel;
  shadowFocus.applyMatrix4(shadowBasis);
  moon.target.position.copy(shadowFocus);
  moon.position.copy(shadowFocus).add(MOON_OFFSET);
  (world.scene.fog as THREE.FogExp2).density = (0.42 / cam.distance) * (world.fogScale ?? 1);
  sky.update(t, cam.camera.position);
  renderer.render(t);

  frames++;
  fpsTime += dt;
  if (fpsTime > 0.5) {
    const fps = frames / fpsTime;
    frames = 0;
    fpsTime = 0;
    hud.textContent = `${fps.toFixed(0)} fps · world generated in ${genMs.toFixed(0)} ms`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __ready: boolean }).__ready = true;
