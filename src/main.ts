import * as THREE from 'three';
import { installHeightFog } from './engine/fog';
import { IsoCamera } from './engine/IsoCamera';
import { Renderer } from './engine/Renderer';
import { Mist, Sky } from './engine/Atmosphere';
import { buildEnvironment } from './engine/environment';
import { buildTestScene } from './scenes/testScene';
import { buildWastelandZone } from './scenes/wastelandZone';
import { buildCharacterPreview } from './scenes/characterPreview';
import { buildTown } from './scenes/town';
import { Dialogue } from './engine/Dialogue';
import { dressKnight } from './actors/outfits/knight';
import type { Npc } from './actors/Npc';
import { bakeSurfaces, pbrMaterial } from './procgen/textures';
import { Character } from './actors/Character';
import { Player, bindClickToMove } from './actors/Player';
import { MOON_OFFSET, type World } from './world/World';

installHeightFog();

const params = new URLSearchParams(location.search);
const hud = document.getElementById('hud')!;
hud.textContent = 'Generating world…';

const t0 = performance.now();
// Artifacts only pass a bare #anchor, so the hash also selects the area.
const sceneName = params.get('scene') ?? (location.hash.slice(1) || 'town');
const world: World =
  sceneName === 'test'
    ? await buildTestScene()
    : sceneName === 'character'
      ? await buildCharacterPreview()
      : sceneName === 'zone'
        ? await buildWastelandZone()
        : await buildTown();
window.addEventListener('hashchange', () => location.reload());
const { scene, moon } = world;
const sky = new Sky();
scene.add(sky.mesh);
const mist = new Mist(Math.min(world.extent, 60), world.heightAt, 110);
scene.add(mist.group);

const cam = new IsoCamera(window.innerWidth / window.innerHeight, document.body);
const renderer = new Renderer(document.body, scene, cam.camera);
scene.environment = buildEnvironment(renderer.renderer);
scene.environmentIntensity = 0.45;
window.addEventListener('resize', () => cam.resize(window.innerWidth / window.innerHeight));

const dialogue = new Dialogue();
let player: Player | null = null;
let preview: Character | null = null;
if (world.spawn) {
  const [metal, cloth] = await bakeSurfaces([
    { kind: 'wornMetal', seed: 21, size: 512, normalStrength: 2 },
    { kind: 'cloth', seed: 22, size: 512, normalStrength: 1.5 },
  ]);
  const steel = pbrMaterial(metal, 2);
  const character = dressKnight(new Character(), {
    steel,
    darkSteel: pbrMaterial(metal, 2, { color: 0x5a5550 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x1c120c, roughness: 0.75 }),
    cloth: pbrMaterial(cloth, 2),
    dark: new THREE.MeshBasicMaterial({ color: 0x000000 }),
  });
  if (!world.nav) {
    // Character preview: animate in place at a fixed speed (?speed=m/s).
    preview = character;
    scene.add(character.root);
  } else player = new Player(character, world.nav, world.heightAt, scene, world.spawn, world.spawnYaw ?? 0);
  // ARPG "light radius": a soft light that travels with the hero so they always read.
  const heroLight = new THREE.PointLight(0xffd2b0, 9, 9, 1.6);
  heroLight.position.set(0.4, 3.6, -0.6);
  character.root.add(heroLight);
  if (player) {
    const p = player;
    const npcs = world.npcs ?? [];
    const talkTo = (npc: Npc) => {
      dialogue.close();
      p.interact(npc.position, 1.8, () => {
        npc.talking = true;
        dialogue.show(npc.def.name, npc.def.role, npc.nextLine(), () => dialogue.setText(npc.nextLine()), () => (npc.talking = false));
      });
    };
    // Scripted conversation for automated screenshots: ?talk=index
    if (params.has('talk')) setTimeout(() => talkTo(npcs[Number(params.get('talk'))]), 500);
    bindClickToMove(
      renderer.renderer.domElement,
      cam.camera,
      world.ground,
      p,
      npcs.map((n) => n.hit),
      (obj) => talkTo(obj.userData.npc as Npc),
      () => dialogue.close(),
    );
  }
  cam.target.copy(world.spawn).add(new THREE.Vector3(0, preview ? 1 : 0, 0));
  cam.update(0);
}
const genMs = performance.now() - t0;

if (world.cameraYaw !== undefined) cam.yaw = cam.targetYawValue = world.cameraYaw;
if (params.has('dist')) {
  cam.distance = Number(params.get('dist'));
  cam.minDistance = Math.min(cam.minDistance, cam.distance);
  cam.maxDistance = Math.max(cam.maxDistance, cam.distance);
}
if (params.has('yaw')) cam.yaw = cam.targetYawValue = THREE.MathUtils.degToRad(Number(params.get('yaw')));
if (params.has('pitch')) cam.pitch = THREE.MathUtils.degToRad(Number(params.get('pitch')));
if (params.has('x') || params.has('z')) {
  player = null; // free camera for inspection shots
  cam.target.set(Number(params.get('x') ?? 0), 0, Number(params.get('z') ?? 0));
}
// Scripted walk for automated screenshots: ?walk=x,z
if (params.has('walk') && world.nav && world.spawn) {
  const [wx, wz] = params.get('walk')!.split(',').map(Number);
  setTimeout(() => (window as unknown as { __player: Player }).__player?.moveTo(new THREE.Vector3(wx, 0, wz)), 500);
}
(window as unknown as { __player: Player | null }).__player = player;

const shadowBasis = new THREE.Matrix4();
const shadowInv = new THREE.Matrix4();
const shadowFocus = new THREE.Vector3();
const ORIGIN = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const clock = new THREE.Clock();
let frames = 0;
let fpsTime = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  // Fixed step keeps preview poses deterministic even on slow machines.
  if (preview) preview.update(1 / 30, Number(params.get('speed') ?? 0));
  if (player) {
    player.update(dt);
    cam.target.copy(player.position);
  }
  cam.update(dt);
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
  (scene.fog as THREE.FogExp2).density = 0.42 / cam.distance;
  sky.update(t, cam.camera.position);
  mist.update(dt);
  if (world.npcs) for (const n of world.npcs) n.update(dt, player ? player.position : null);
  world.update(dt, t);
  renderer.render(t);

  frames++;
  fpsTime += dt;
  if (fpsTime > 0.5) {
    const fps = frames / fpsTime;
    frames = 0;
    fpsTime = 0;
    const controls = player
      ? `Click to move${world.npcs ? ' · click townsfolk to talk' : ''} · wheel zoom · Q/E rotate`
      : 'WASD pan · wheel zoom · Q/E rotate';
    hud.textContent = `${fps.toFixed(0)} fps · world generated in ${genMs.toFixed(0)} ms\n${controls}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __ready: boolean }).__ready = true;
