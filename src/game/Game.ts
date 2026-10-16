import * as THREE from 'three';
import { audio } from '../audio/Audio';
import { loading } from '../engine/Loading';
import type { IsoCamera } from '../engine/IsoCamera';
import type { Renderer } from '../engine/Renderer';
import { Mist, type Sky } from '../engine/Atmosphere';
import { Dialogue } from '../engine/Dialogue';
import { Player } from '../actors/Player';
import { Monster } from '../actors/Monster';
import { createMonster } from '../actors/Boss';
import type { Npc } from '../actors/Npc';
import { monsterMaterials, type MonsterMaterials } from '../actors/monsters/materials';
import type { AreaName, Exit, Interactable, ScriptContext, World } from '../world/World';
import { Effects } from './Effects';
import { FloatingText } from './Combat';
import { LootLayer, type GroundItem } from './Loot';
import { Hud } from './Hud';
import { Inventory } from './Inventory';
import { Stats } from './Stats';
import { SkillTree } from './SkillTree';
import { SK } from './Skills';
import { cutaway } from '../engine/cutaway';
import { makeGold, makeItem, makePotion, makeQuestItem, rollRarity } from './Items';
import { QuestLog, type Quest } from './Quests';
import { WaypointMenu } from './WaypointMenu';
import { GameMenu } from './GameMenu';
import { applySave, captureSave, writeSave, type CharacterSave } from './Save';
import { Shop } from './Shop';
import { PortalFx } from './Portal';
import type { DialogueAction } from '../engine/Dialogue';
import type { Character } from '../actors/Character';
import { telemetry } from './Telemetry';
import { heroLevel } from './Balance';
import { Minimap, buildMapBase, type MapBase } from './Minimap';

// Runs the playable game: keeps each area (town, wasteland) alive once built,
// moves the hero between them through the gates, routes mouse and keyboard
// input to moving, fighting, talking and looting, and drives the HUD.

interface AreaState {
  name: AreaName;
  world: World;
  mist: Mist;
  effects: Effects;
  loot: LootLayer;
  monsters: Monster[];
  exitLabels: { exit: Exit; el: HTMLButtonElement }[];
  useLabels: { it: Interactable; el: HTMLButtonElement }[];
  /** The area's pre-drawn map ground, built once with the area. */
  mapBase: MapBase | null;
}

export type AreaBuilder = () => Promise<World>;

/** What the loading splash says while an area is generated. */
/** Areas with a waypoint, in the order the travel list shows them. */
const WAYPOINT_AREAS: AreaName[] = ['town', 'zone', 'swamp'];

const AREA_TITLES: Record<AreaName, [string, string]> = {
  town: ['Saint Orsolya', 'The last lit town at the edge of the blight'],
  zone: ['The Blighted Fields', 'Where the dead were buried, they do not rest'],
  dungeon: ['Into the Crypt', 'A new dark is dug for every soul that descends'],
  swamp: ['The Bleeding Mire', 'It is never the same swamp twice'],
  gaol1: ['The Drowned Gaol', 'Torture halls flooded with blood, dug anew for every soul that descends'],
  gaol2: ['The Lower Cells', 'Where the Inquisitor passes judgement'],
};

/** Stands in for a frozen rig's updateMatrixWorld, so scene updates skip it. */
const frozenMatrices = () => {};

export class Game {
  readonly stats = new Stats();
  readonly player: Player;
  readonly hud = new Hud();
  readonly minimap = new Minimap(this.hud.root);
  readonly floaters = new FloatingText();
  readonly dialogue = new Dialogue();
  readonly inventory: Inventory;
  readonly tree: SkillTree;
  /** Where the cursor last was, to aim skills at. */
  private pointer = { clientX: -1, clientY: -1 };
  readonly quests = new QuestLog();
  readonly shop: Shop;
  /** The open town portal: one end out in the world, the other in the square. */
  private portal: { area: AreaName; there: PortalFx; home: PortalFx; exitThere: Exit; exitHome: Exit } | null = null;
  private portalBusy = false;
  private lastPortal = -10;
  private townVisits = 0;
  private markers = new Map<Npc, HTMLDivElement>();
  private talkingTo: Npc | null = null;
  private areas = new Map<AreaName, AreaState>();
  private building = new Map<AreaName, Promise<AreaState>>();
  area!: AreaState;
  private monsterMats!: MonsterMaterials;
  private travelling = false;
  private hovered: Monster | null = null;
  private lastHit: { m: Monster; t: number } | null = null;
  private time = 0;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private exitLayer: HTMLDivElement;
  private v = new THREE.Vector3();
  private viewFrustum = new THREE.Frustum();
  private viewMat = new THREE.Matrix4();
  private viewSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  private deathTimer = -1;
  readonly menu = new GameMenu();
  private waypointMenu = new WaypointMenu();
  /** The hero being played; null for views opened straight from the URL, which never save. */
  private character: CharacterSave | null = null;
  /** The hero's mire seed and when they last left it (the save's copy, or a scratch one for unsaved views). */
  private worldState: CharacterSave['world'] = { swampSeed: Math.floor(Math.random() * 1e9), swampLeftAt: null, waypoints: ['town'], fog: {} };
  get swampSeed(): number {
    return this.worldState.swampSeed;
  }
  set swampSeed(v: number) {
    this.worldState.swampSeed = v;
  }
  private playTime = 0;
  private saveTimer = 0;

  constructor(
    private builders: Partial<Record<AreaName, AreaBuilder>>,
    hero: Character,
    private cam: IsoCamera,
    private renderer: Renderer,
    private sky: Sky,
    private environment: THREE.Texture,
  ) {
    this.player = new Player(hero, this.stats);
    this.inventory = new Inventory(this.stats);
    this.inventory.onChange = () => this.hud.update(0, this.stats, (id) => this.player.cooldownFrac(id));
    this.tree = new SkillTree(this.stats);
    this.tree.onLearn = () => {
      audio.click();
      this.inventory.render();
    };
    this.shop = new Shop(this.stats, this.inventory);
    this.shop.onTrade = (kind, item) => {
      if (kind === 'poor') {
        this.say(this.stats.bag.length >= this.stats.bagSize && item.slot !== 'potion' ? 'My bag is full' : 'I cannot afford that');
        return;
      }
      audio.coins();
      this.inventory.render();
    };
    this.hud.onPortal = () => void this.openPortal();
    this.hud.onJournal = () => this.toggleJournal();
    this.hud.onInventory = () => this.inventory.toggle();
    this.hud.onPotion = () => this.player.drinkPotion(this.playerCtx());
    this.hud.onSkill = (i) => this.castSlot(i);
    this.hud.onSkills = () => this.toggleTree();
    this.hud.onRevive = () => this.revive();
    this.hud.onMute = () => audio.toggleMute();
    this.hud.onMenu = () => this.toggleMenu();
    this.minimap.npcMark = (n) => {
      const name = n.def.name;
      return this.quests.ready(name) ? 3 : this.quests.available(name) ? 1 : this.quests.current(name) ? 2 : 0;
    };
    this.waypointMenu.onTravel = (to) => {
      if (!this.travelling && !this.player.dead) void this.enter(to as AreaName, 'waypoint');
    };
    this.menu.onQuit = () => {
      this.saveNow();
      location.reload();
    };
    // Save whenever the page is hidden or closed, so nothing since the last autosave is lost.
    const flush = () => this.saveNow();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
    audio.onMuteChange = (m) => this.hud.setMuted(m);
    this.hud.setMuted(audio.muted);
    this.exitLayer = document.createElement('div');
    this.exitLayer.className = 'loot-layer';
    document.body.appendChild(this.exitLayer);
    const style = document.createElement('style');
    style.textContent = `.exit-label { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: pointer; white-space: nowrap;
      font: 600 13px/1 'Cinzel', Georgia, serif; letter-spacing: .08em; color: #f0d8b0; padding: 6px 10px; background: rgba(20,8,6,.8);
      border: 1px solid #8a5a34; box-shadow: 0 0 12px rgba(200,120,40,.25); }
      .exit-label:hover { border-color: #e0a060; }
      .exit-label.portal { color: #d0e4ff; border-color: #4a6aa8; box-shadow: 0 0 14px rgba(80,140,255,.35); }
      .quest-mark { position: absolute; left: 0; top: 0; font: 700 30px/1 'Cinzel', Georgia, serif; color: #f4c850; pointer-events: none;
        text-shadow: 0 0 10px rgba(240,180,60,.7), 0 2px 3px #000; animation: quest-bob 1.6s ease-in-out infinite; }
      .quest-mark.wait { color: #9a9088; text-shadow: 0 2px 3px #000; animation: none; }
      @keyframes quest-bob { 50% { margin-top: -5px; } }`;
    document.head.appendChild(style);
    this.bindInput();
  }

  /** Loads a saved hero into the game; from now on progress is saved to it. */
  useCharacter(save: CharacterSave) {
    this.character = save;
    this.worldState = save.world;
    this.minimap.reset();
    this.playTime = save.playTime;
    applySave(save, this.stats, this.quests);
  }

  /** Writes the hero's progress to storage now (a no-op for unsaved views). */
  saveNow() {
    if (!this.character) return;
    this.minimap.store(this.worldState.fog);
    captureSave(this.character, this.stats, this.quests, this.area?.name ?? 'town', this.playTime);
    writeSave(this.character);
    this.saveTimer = 0;
  }

  private toggleMenu(on = !this.menu.open) {
    audio.click();
    if (on) this.saveNow();
    this.menu.toggle(on, this.character ? `${this.character.name} · saved` : 'This view is not saved');
  }

  async start(name: AreaName, entry: string) {
    await loading.step('Sculpting flesh, chitin and bone', 0);
    this.monsterMats = await monsterMaterials();
    await this.enter(name, entry, false);
    // Build the other area in the background so the first trip is quick.
    const other: AreaName = name === 'town' ? 'zone' : 'town';
    this.preloadSoon(other, 1500);
  }

  /** Background building pauses while this is false (the benchmark holds it off so builds don't skew the run). */
  private preloadOn = true;
  private preloadQueue: AreaName[] = [];
  private preloadSoon(name: AreaName, ms: number) {
    setTimeout(() => (this.preloadOn ? void this.load(name) : this.preloadQueue.push(name)), ms);
  }
  set preload(on: boolean) {
    this.preloadOn = on;
    if (on) for (const n of this.preloadQueue.splice(0)) void this.load(n);
  }

  private load(name: AreaName): Promise<AreaState> {
    const cached = this.building.get(name);
    if (cached) return cached;
    let p: Promise<AreaState> | null = null;
    p = (async () => {
      telemetry.mark(`build:${name}`);
      const world = await this.builders[name]!();
      const scene = world.scene;
      scene.environment = this.environment;
      scene.environmentIntensity = 0.45;
      if (world.indoor) scene.environmentIntensity = 0.15;
      // Underground the fog is thicker and bloodier.
      const mist = world.indoor
        ? new Mist(Math.min(world.extent, 60), world.heightAt, 90, new THREE.Color(0.42, 0.05, 0.035), 13)
        : new Mist(Math.min(world.extent, 60), world.heightAt, 110);
      scene.add(mist.group);
      const effects = new Effects(world.heightAt);
      scene.add(effects.group);
      const loot = new LootLayer(world.heightAt, (g) => this.pickUp(g), world.nav);
      loot.setVisible(false);
      scene.add(loot.group);
      // The map's ground, drawn from the nav grid a few rows at a time.
      let mapBase: MapBase | null = null;
      try {
        mapBase = await buildMapBase(world, 'Charting the paths', 0.96);
      } catch {
        /* the map shows markers and fog only */
      }
      await loading.step('Summoning the monsters', 0.97);
      // A few monsters at a time, so building an area in the background
      // doesn't freeze the one being played.
      const monsters: Monster[] = [];
      for (const s of world.monsterSpawns ?? []) {
        monsters.push(createMonster(s, this.monsterMats, scene));
        if (monsters.length % (loading.active ? 4 : 1) === 0) await loading.step('Summoning the monsters', 0.97);
      }
      const exitLabels = (world.exits ?? []).map((exit) => ({ exit, el: this.label(exit.label, () => this.player.moveTo(exit.pos)) }));
      const usable = [...(world.script?.interactables ?? [])];
      const wp = world.waypoint;
      if (wp) usable.push({ pos: wp.pos, radius: 2.6, label: 'Waypoint', active: () => true, use: () => this.openWaypoints() });
      const useLabels = usable.map((it) => ({
        it,
        el: this.label(it.label, () => this.player.interact(it.pos, it.radius, () => it.active() && it.use())),
      }));
      const state: AreaState = { name, world, mist, effects, loot, monsters, exitLabels, useLabels, mapBase };
      // A build that was thrown away while it ran (the mire rerolled) doesn't replace the new one.
      if (!p || this.building.get(name) === p) this.areas.set(name, state);
      telemetry.mark(`built:${name}`);
      return state;
    })();
    this.building.set(name, p);
    return p;
  }

  /** A clickable world-space label (gates, levers, quest objects). */
  private label(text: string, onClick: () => void): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'exit-label';
    el.textContent = text;
    el.hidden = true;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button === 0 && !this.player.dead) onClick();
    });
    this.exitLayer.appendChild(el);
    return el;
  }

  private say(text: string, life = 1.6) {
    this.floaters.spawn(text, this.player.position.clone().setY(this.player.position.y + 2.3), 'info', life);
  }

  /** Forgets an area so it is generated afresh next time (a cleared dungeon). */
  private discard(a: AreaState) {
    if (this.portal?.area === a.name) this.closePortal();
    for (const x of [...a.exitLabels, ...a.useLabels]) x.el.remove();
    this.areas.delete(a.name);
    this.building.delete(a.name);
    // Free its GPU memory. Anything shared with another area (monster
    // materials, the sky) is simply uploaded again when next drawn.
    if (this.area !== a) {
      a.world.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || o === this.sky.mesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture && v !== this.environment) v.dispose();
          mat.dispose();
        }
      });
    }
  }

  /**
   * The mire is laid out anew once the hero has spent this long (in play
   * time) away from it; come back sooner and it is as they left it.
   */
  private static readonly SWAMP_FORGET = 15 * 60;
  private rerollSwampIfForgotten() {
    const ws = this.worldState;
    if (ws.swampLeftAt === null || this.playTime - ws.swampLeftAt < Game.SWAMP_FORGET) return;
    ws.swampSeed = Math.floor(Math.random() * 1e9);
    ws.swampLeftAt = null;
    const old = this.areas.get('swamp');
    if (old) this.discard(old);
    else this.building.delete('swamp');
  }

  private scriptCtx(): ScriptContext {
    const p = this.player;
    return {
      player: { position: p.position, alive: !p.dead },
      monsters: this.area.monsters,
      effects: this.area.effects,
      banner: (title, sub) => this.hud.showBanner(title, sub),
      say: (text) => this.floaters.spawn(text, p.position.clone().setY(p.position.y + 2.4), 'info', 2),
    };
  }

  /** Moves the hero to `name` at `entry`, fading out and in. */
  async enter(name: AreaName, entry: string, fade = true) {
    telemetry.mark(`enter:${name}`);
    void telemetry.flush('area');
    this.travelling = true;
    if (this.area) audio.travel();
    if (name === 'swamp' && this.area?.name !== 'swamp') this.rerollSwampIfForgotten();
    // Leaving the mire starts its clock.
    if (this.area?.name === 'swamp' && name !== 'swamp') this.worldState.swampLeftAt = this.playTime;
    const ready = this.areas.get(name);
    // An area that still has to be generated gets the loading splash.
    const splash = !ready || loading.active;
    if (fade && !loading.active) await this.hud.fade(true, '');
    if (splash && !loading.active) await loading.show(...AREA_TITLES[name]);
    if (splash) loading.range(loading.progress, 0.86);
    const area = ready ?? (await this.load(name));
    if (this.area) {
      const prev = this.area;
      prev.loot.setVisible(false);
      for (const x of [...prev.exitLabels, ...prev.useLabels]) x.el.hidden = true;
      prev.effects.group.visible = false;
      if (prev !== area && prev.world.indoor && prev.world.script?.finished) this.discard(prev);
    }
    this.area = area;
    // The gaol is one run, both levels: walk out of it (other than by town
    // portal) and the next descent digs a new one.
    if (name !== 'gaol1' && name !== 'gaol2' && !(name === 'town' && entry === 'portal')) {
      for (const n of ['gaol1', 'gaol2'] as const) {
        const g = this.areas.get(n);
        if (g) this.discard(g);
        else this.building.delete(n);
      }
    }
    audio.setArea(name);
    this.dialogue.close();
    this.shop.close();
    this.waypointMenu.toggle(false);
    this.floaters.clear();
    if (name === 'town') this.townVisits++;
    const w = area.world;
    if (!w.indoor) w.scene.add(this.sky.mesh);
    this.renderer.setScene(w.scene);
    area.loot.setVisible(true);
    area.effects.group.visible = true;
    // Monsters regroup whenever you come back (underground, the dead stay dead).
    if (!w.indoor) for (const m of area.monsters) m.reset();
    this.hud.setObjectives(w.script ? w.script.title : null, w.script?.objectives());
    w.waypoint?.setActive(this.worldState.waypoints.includes(name));
    const e = (entry === 'waypoint' && w.waypoint ? this.besideWaypoint(w) : w.entries?.[entry]) ?? { pos: w.spawn ?? new THREE.Vector3(), yaw: w.spawnYaw ?? 0 };
    this.player.enter({ scene: w.scene, nav: w.nav!, heightAt: w.heightAt }, e.pos, e.yaw);
    if (w.cameraYaw !== undefined) this.cam.yaw = this.cam.targetYawValue = w.cameraYaw;
    this.cam.target.copy(this.player.position);
    this.cam.update(0);
    this.minimap.setArea(name, AREA_TITLES[name][0], AREA_TITLES[name][1], area, area.mapBase, this.worldState.fog);
    if (splash) {
      // Compile every shader now, behind the splash, instead of stuttering
      // through the first seconds of play.
      loading.range(0.86, 1);
      await loading.step('Lighting the scene', 0.1);
      try {
        await this.renderer.renderer.compileAsync(w.scene, this.cam.camera);
      } catch {
        /* compiled lazily on first draw instead */
      }
      this.warmUp(area);
      if (fade) void this.hud.fade(false);
      await loading.hide();
    } else if (fade) {
      this.warmUp(area);
      await this.hud.fade(false);
    }
    if (w.title && entry !== 'portal') this.hud.showBanner(w.title, w.subtitle ?? '');
    // Stepping back through from town closes the portal behind you.
    if (entry === 'portal' && name !== 'town') this.closePortal();
    // Dig the crypt while the hero is out in the fields, so going down is quick.
    if (name === 'zone') {
      this.preloadSoon('dungeon', 4000);
      const left = this.worldState.swampLeftAt;
      if (left === null || this.playTime - left < Game.SWAMP_FORGET - 60) this.preloadSoon('swamp', 10000);
    }
    if (name === 'swamp') this.preloadSoon('gaol1', 8000);
    if (name === 'gaol1') this.preloadSoon('gaol2', 6000);
    this.travelling = false;
    this.saveNow();
  }

  // ---- Waypoints ---------------------------------------------------------

  /** Where a hero stepping off a waypoint stands: just in front of the dais, facing the camera. */
  private besideWaypoint(w: AreaState['world']): { pos: THREE.Vector3; yaw: number } {
    const at = w.waypoint!.pos;
    let x = at.x;
    let z = at.z + 2.9;
    if (w.nav && !w.nav.walkable(x, z)) {
      const n = w.nav.nearestWalkable(x, z);
      if (n) [x, z] = [n.x, n.y];
    }
    return { pos: new THREE.Vector3(x, 0, z), yaw: 0 };
  }

  /** Walking up to a waypoint for the first time marks it found, for good. */
  private discoverWaypoint() {
    const a = this.area;
    const wp = a.world.waypoint;
    const found = this.worldState.waypoints;
    if (!wp || found.includes(a.name) || this.player.dead) return;
    if (Math.hypot(this.player.position.x - wp.pos.x, this.player.position.z - wp.pos.z) > 3.2) return;
    found.push(a.name);
    wp.setActive(true);
    audio.runeLit(wp.pos);
    this.hud.showBanner('Waypoint found', AREA_TITLES[a.name][0]);
    this.saveNow();
  }

  private openWaypoints() {
    if (this.travelling) return;
    audio.click();
    const found = this.worldState.waypoints;
    this.waypointMenu.show(
      WAYPOINT_AREAS.map((area) => ({ area, name: AREA_TITLES[area][0], found: found.includes(area), here: this.area.name === area })),
    );
  }

  /**
   * Draws one frame with everything in the area forced into view, while the
   * screen is covered. Some browsers (Firefox on Windows) only finish building
   * a shader on its first real draw, which otherwise stalls play for seconds
   * the first time each kind of monster comes into view.
   */
  private warmUp(area: AreaState) {
    const roots = area.monsters.map((m) => [m.body.rig.root, m.body.rig.root.visible] as const);
    for (const [r] of roots) r.visible = true;
    const culled: THREE.Object3D[] = [];
    // One of every spell and skill effect, so the first cast doesn't stall.
    const rehearsed = area.effects.rehearse(this.player.position);
    if (rehearsed) area.effects.update(1 / 60);
    area.world.scene.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
    });
    this.renderer.render(this.time, true);
    if (rehearsed) area.effects.clearAll();
    for (const o of culled) o.frustumCulled = true;
    for (const [r, v] of roots) r.visible = v;
  }

  private playerCtx() {
    return {
      monsters: this.area.monsters,
      effects: this.area.effects,
      floaters: this.floaters,
      onKill: (m: Monster) => this.onKill(m),
    };
  }

  private onKill(m: Monster) {
    telemetry.kill(m);
    const s = this.stats;
    // Experience falls off against monsters well below your level.
    const diff = m.level - s.level;
    const xp = Math.round(m.def.xp * (1 + (m.level - 1) * 0.3) * (m.elite ? 5 : 1) * Math.max(0.2, Math.min(1.5, 1 + diff * 0.15)));
    const levels = s.gainXp(xp);
    const siphon = SK.siphon(s.rank('siphon'));
    if (siphon) s.mana = Math.min(s.maxMana, s.mana + siphon);
    if (levels > 0) {
      this.area.effects.pillar(this.player.position.clone());
      audio.levelUp();
      this.floaters.spawn(`Level ${s.level} · skill point`, this.player.position.clone().setY(this.player.position.y + 2.6), 'info', 2.2);
      this.inventory.render();
    }
    // Loot.
    const at = m.position.clone();
    const loot = this.area.loot;
    const itemChance = { ghoul: 0.14, crawler: 0.1, cultist: 0.32, brute: 0.55, spider: 0.45, horror: 0.6, wraith: 0.4, abomination: 1, lich: 1, nightwing: 1, toad: 0.22, croc: 0.35, rootHorror: 0.65, mireWraith: 0.4, butcher: 0.6, chainWraith: 0.42, gaunt: 0.14, bonePriest: 0.38, gaolCroc: 0.42, leech: 0.25, hanged: 0.35, weeper: 0.5, maiden: 0.6, inquisitor: 1 }[m.kind];
    if (Math.random() < (m.elite ? 1 : 0.55)) loot.drop(makeGold(m.level, m.elite ? 6 : m.kind === 'brute' ? 2.5 : 1), at);
    if (Math.random() < (m.kind === 'brute' ? 0.4 : 0.15) || (m.elite && Math.random() < 0.8)) loot.drop(makePotion(), at);
    if (m.elite) {
      loot.drop(makeItem(m.level + 1, Math.random() < 0.35 ? 'unique' : 'rare'), at);
      loot.drop(makeItem(m.level + 1, rollRarity(m.level + 2, 1.5)), at);
      loot.drop(makeItem(m.level, rollRarity(m.level + 2, 1)), at);
    } else if (Math.random() < itemChance) {
      loot.drop(makeItem(m.level, rollRarity(m.level)), at);
    }
    for (const g of loot.items) if (!g.announced) {
      g.announced = true;
      if (g.item.rarity === 'rare' || g.item.rarity === 'unique') audio.drop(g.pos, g.item.rarity);
    }
    // Errands: kills count, and things asked for start dropping.
    for (const q of this.quests.onKill(m.kind, !!m.spawn.boss)) this.questFinished(q);
    const want = this.quests.dropFor(m.kind, this.area.name, (name) => loot.items.filter((g) => g.item.name === name).length);
    if (want) loot.drop(makeQuestItem(want), at);
    if (m.elite && !this.area.world.script) this.hud.showBanner(`${m.name} Is Slain`, 'The fields fall quiet, for now');
    this.area.world.script?.onKill(m, this.scriptCtx());
  }

  private pickUp(g: GroundItem) {
    if (this.player.dead) return;
    this.player.interact(g.pos, 1.0, () => this.take(g));
  }

  private take(g: GroundItem) {
    if (!this.area.loot.items.includes(g)) return;
    if (!this.stats.take(g.item)) {
      this.floaters.spawn('My bag is full', this.player.position.clone().setY(this.player.position.y + 2.3), 'info', 1.6);
      return;
    }
    this.area.loot.remove(g);
    if (g.item.slot === 'quest') {
      const q = this.quests.gather(g.item.name);
      audio.pickup('magic');
      if (q) {
        this.say(`${g.item.name} (${q.progress}/${q.def.count})`, 1.4);
        if (q.progress >= q.def.count) this.questFinished(q);
      }
      return;
    }
    if (g.item.slot === 'gold') audio.coins();
    else audio.pickup(g.item.slot === 'potion' ? 'common' : g.item.rarity);
    const text = g.item.slot === 'gold' ? `+${g.item.amount} gold` : g.item.slot === 'potion' ? '+1 draught' : g.item.name;
    this.floaters.spawn(text, this.player.position.clone().setY(this.player.position.y + 2.3), 'info', 1.3);
    this.inventory.render();
  }

  private onPlayerHit(amount: number, crit: boolean, from: THREE.Vector3) {
    const dealt = this.player.takeDamage(amount, crit, from);
    telemetry.playerHit(dealt, from, this.area.monsters, this.player.dead);
    if (dealt <= 0) return;
    audio.hit(this.player.position, crit, true);
    if (!this.player.dead) audio.playerHurt();
    const at = this.player.position.clone().setY(this.player.position.y + 1.2);
    this.floaters.spawn(String(dealt), at.clone().setY(at.y + 0.9), 'hurt');
    this.area.effects.blood(at, from, 10);
    this.hud.flashHurt(dealt / this.stats.maxHp);
    if (this.player.dead) {
      this.deathTimer = 2.2;
      this.area.effects.splat(this.player.position.x, this.player.position.z, 2.4);
    }
  }

  private async revive() {
    this.hud.showDeath(false);
    this.stats.gold = Math.floor(this.stats.gold * 0.9);
    this.player.revive();
    await this.enter('town', 'square');
  }

  // ---- Townsfolk: quests, trade, healing ----------------------------------

  /** Opens a conversation, leading with whatever errand is between you. */
  private talk(npc: Npc, text?: string) {
    npc.talking = true;
    this.talkingTo = npc;
    const d = npc.def;
    const q = this.quests;
    const lv = this.stats.level;
    const actions: DialogueAction[] = [];
    const ready = q.ready(d.name);
    const offer = q.available(d.name);
    const current = q.current(d.name);
    if (ready) {
      text ??= 'You are back, and in one piece. Is it done?';
      actions.push({ label: `Turn in: ${ready.def.title}`, run: () => this.turnIn(npc, ready) });
    } else if (offer) {
      text ??= offer.offer;
      actions.push({
        label: `Accept: ${offer.title}`,
        run: () => {
          q.accept(offer);
          audio.click();
          this.talk(npc, `${offer.waiting} ${q.rewardText(offer, lv)}.`);
        },
      });
    } else if (current) {
      text ??= current.def.waiting;
    }
    if (d.name === 'Brother Anselm') actions.push({ label: 'Be healed', run: () => this.heal(npc) });
    if (d.name === 'Mirela' || d.name === 'Dusan') {
      actions.push({
        label: 'Trade',
        run: () => {
          audio.click();
          this.shop.show(d.name, this.townVisits);
        },
      });
    }
    this.dialogue.show(d.name, d.role, text ?? npc.nextLine(), () => this.dialogue.setText(npc.nextLine()), () => {
      npc.talking = false;
      if (this.talkingTo === npc) this.talkingTo = null;
      this.shop.close();
    }, actions);
  }

  private turnIn(npc: Npc, quest: Quest) {
    const s = this.stats;
    const r = this.quests.reward(quest.def, s.level);
    this.quests.turnIn(quest);
    s.gold += r.gold;
    s.potions += r.potions;
    if (r.gift) {
      const it = makeItem(s.level + 1, r.gift);
      if (!s.take(it)) this.area.loot.drop(it, this.player.position);
    }
    audio.objective();
    audio.coins();
    const levels = s.gainXp(r.xp);
    if (levels > 0) {
      this.area.effects.pillar(this.player.position.clone());
      audio.levelUp();
      this.floaters.spawn(`Level ${s.level} · skill point`, this.player.position.clone().setY(this.player.position.y + 2.6), 'info', 2.2);
    }
    this.say(`+${r.gold} gold · +${r.xp} experience`, 2);
    this.inventory.render();
    const next = this.quests.available(npc.def.name);
    this.talk(npc, next && next.id !== quest.def.id ? `${quest.def.thanks} There is something else, if you have the stomach for it.` : quest.def.thanks);
  }

  private questFinished(q: Quest) {
    audio.objective();
    this.hud.showBanner(q.def.title, `Return to ${q.def.giver} in Saint Orsolya`);
  }

  /** Brother Anselm's blessing: life and mana made whole, free of charge. */
  private heal(npc: Npc) {
    const s = this.stats;
    const hurt = s.hp < s.maxHp - 0.5 || s.mana < s.maxMana - 0.5;
    s.hp = s.maxHp;
    s.mana = s.maxMana;
    audio.heal();
    const at = this.player.position.clone();
    this.area.effects.sparks(at.clone().setY(at.y + 0.4), 30, new THREE.Color(1.8, 1.5, 0.9), 2.2, 1.2);
    this.area.effects.flash(at.clone().setY(at.y + 1.6), 0xffe0a0, 18, 6, 0.9);
    this.say(hurt ? 'Life and mana restored' : 'Blessed', 1.6);
    this.talk(npc, hurt ? 'There. The saint still listens, even now. Go carefully.' : 'You are whole already. Still, take the blessing. You will need it out there.');
  }

  /** "!" over townsfolk with an errand to give, "?" over those waiting on one. */
  private updateMarkers(W: number, H: number) {
    const npcs = this.area.name === 'town' ? (this.area.world.npcs ?? []) : [];
    for (const [n, el] of this.markers) if (!npcs.includes(n)) el.hidden = true;
    for (const n of npcs) {
      const name = n.def.name;
      const ready = this.quests.ready(name);
      const mark = ready ? '?' : this.quests.available(name) ? '!' : this.quests.current(name) ? '?' : '';
      let el = this.markers.get(n);
      if (!el) {
        el = document.createElement('div');
        el.className = 'quest-mark';
        this.exitLayer.appendChild(el);
        this.markers.set(n, el);
      }
      this.v.set(n.position.x, n.position.y + 2.55, n.position.z).project(this.cam.camera);
      const show = mark !== '' && this.v.z < 1 && n.position.distanceTo(this.player.position) < 34 && !this.travelling;
      el.hidden = !show;
      if (!show) continue;
      if (el.textContent !== mark) el.textContent = mark;
      el.classList.toggle('wait', mark === '?' && !ready);
      el.style.transform = `translate(${Math.round((this.v.x * 0.5 + 0.5) * W)}px, ${Math.round((-this.v.y * 0.5 + 0.5) * H)}px) translate(-50%, -100%)`;
    }
  }

  private toggleJournal() {
    audio.click();
    if (this.hud.journalOpen) {
      this.hud.showJournal(null);
      return;
    }
    const lv = this.stats.level;
    this.hud.showJournal(
      this.quests.active.map((q) => ({
        title: q.def.title,
        giver: `From ${q.def.giver}`,
        text: q.def.offer,
        progress: q.progress >= q.def.count ? 'Done, return' : q.def.kind === 'clear' ? 'Not yet' : `${q.progress}/${q.def.count}`,
        reward: this.quests.rewardText(q.def, lv),
      })),
    );
  }

  // ---- Town portal -------------------------------------------------------

  /** Tears open a way home in front of the hero, with its twin in the square. */
  private async openPortal() {
    if (this.travelling || this.portalBusy || !this.area || this.player.dead) return;
    const a = this.area;
    if (a.name === 'town') {
      this.say('I am already in town');
      return;
    }
    if (this.time - this.lastPortal < 1.5) return;
    this.lastPortal = this.time;
    this.portalBusy = true;
    try {
      this.closePortal();
      const nav = a.world.nav!;
      const p = this.player.position;
      const yaw = this.player.facingYaw;
      // Open it a stride ahead, on floor the hero can reach and see.
      let pos: THREE.Vector3 | null = null;
      for (const turn of [0, 0.6, -0.6, 1.3, -1.3, 2.2, -2.2, Math.PI]) {
        const x = p.x + Math.sin(yaw + turn) * 1.9;
        const z = p.z + Math.cos(yaw + turn) * 1.9;
        if (nav.walkable(x, z) && nav.lineOfSight(p.x, p.z, x, z)) {
          pos = new THREE.Vector3(x, a.world.heightAt(x, z), z);
          break;
        }
      }
      if (!pos) {
        this.say('There is no room here');
        return;
      }
      const town = await this.load('town');
      if (this.area !== a || this.player.dead) return;
      const tw = town.world;
      const tn = tw.nav!;
      const spot = tn.nearestWalkable(-3.5, 6.5) ?? new THREE.Vector2(-3.5, 6.5);
      const homePos = new THREE.Vector3(spot.x, tw.heightAt(spot.x, spot.y), spot.y);
      const arrive = tn.nearestWalkable(spot.x, spot.y + 2) ?? new THREE.Vector2(spot.x, spot.y + 2);
      const there = new PortalFx(pos);
      const home = new PortalFx(homePos);
      a.world.scene.add(there.group);
      tw.scene.add(home.group);
      const exitThere: Exit = { pos, radius: 0.7, to: 'town', entry: 'portal', label: 'Town Portal' };
      const exitHome: Exit = { pos: homePos, radius: 0.7, to: a.name, entry: 'portal', label: `Portal to ${AREA_TITLES[a.name][0]}` };
      (a.world.exits ??= []).push(exitThere);
      (tw.exits ??= []).push(exitHome);
      // Coming back, you step out where you stood when you cast it.
      (a.world.entries ??= {}).portal = { pos: p.clone(), yaw };
      (tw.entries ??= {}).portal = { pos: new THREE.Vector3(arrive.x, 0, arrive.y), yaw: 0 };
      this.portal = { area: a.name, there, home, exitThere, exitHome };
      audio.portal(pos);
      a.effects.flash(pos.clone().setY(pos.y + 1.3), 0x6aa0ff, 26, 7, 0.8);
      a.effects.sparks(pos.clone().setY(pos.y + 1.2), 24, new THREE.Color(0.6, 0.9, 2.0), 2.5, 0.9);
    } finally {
      this.portalBusy = false;
    }
  }

  private closePortal() {
    const pt = this.portal;
    if (!pt) return;
    this.portal = null;
    pt.there.dispose();
    pt.home.dispose();
    const there = this.areas.get(pt.area)?.world;
    const town = this.areas.get('town')?.world;
    if (there?.exits) there.exits.splice(there.exits.indexOf(pt.exitThere) >>> 0, 1);
    if (town?.exits) town.exits.splice(town.exits.indexOf(pt.exitHome) >>> 0, 1);
    if (there?.entries) delete there.entries.portal;
    if (town?.entries) delete town.entries.portal;
  }

  // ---- Input -------------------------------------------------------------

  private pick(e: PointerEvent) {
    const dom = this.renderer.renderer.domElement;
    const r = dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.cam.camera);
    const a = this.area;
    const monsters = a.monsters.filter((m) => m.alive && !m.removed).map((m) => m.hit);
    const mHit = monsters.length ? this.ray.intersectObjects(monsters, false)[0] : undefined;
    const npcs = (a.world.npcs ?? []).map((n) => n.hit);
    const nHit = npcs.length ? this.ray.intersectObjects(npcs, false)[0] : undefined;
    const gHit = this.ray.intersectObject(a.world.ground, false)[0];
    return {
      monster: mHit ? (mHit.object.userData.monster as Monster | null) : null,
      npc: nHit && (!mHit || nHit.distance < mHit.distance) ? (nHit.object.userData.npc as Npc) : null,
      ground: gHit?.point ?? null,
    };
  }

  private toggleTree() {
    this.tree.toggle();
    audio.click();
  }

  private aimAt(hit: { monster: Monster | null; ground: THREE.Vector3 | null }) {
    const p = hit.monster ? hit.monster.position : hit.ground;
    if (p) this.player.aim.copy(p);
  }

  /** Uses the skill on belt slot `i` (0 is right click), aimed at the cursor. */
  private castSlot(i: number) {
    if (this.travelling || !this.area || this.player.dead) return;
    const id = this.stats.belt[i];
    const above = this.player.position.clone().setY(this.player.position.y + 2.3);
    if (!id) {
      this.floaters.spawn('No skill on that key', above, 'info', 1);
      return;
    }
    if (this.pointer.clientX >= 0) this.aimAt(this.pick(this.pointer as PointerEvent));
    else this.player.aim.copy(this.player.position);
    const why = this.player.cast(id, this.playerCtx());
    if (why) this.floaters.spawn(why, above, 'info', 1);
  }

  private bindInput() {
    const dom = this.renderer.renderer.domElement;
    let held = false;
    let lastIssue = 0;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    // Audio may only start after a gesture.
    for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => audio.unlock(), { capture: true });
    dom.addEventListener('pointerdown', (e) => {
      if (this.travelling || !this.area || this.player.dead) return;
      const hit = this.pick(e);
      this.pointer = { clientX: e.clientX, clientY: e.clientY };
      if (e.button === 2) {
        // Right click: the skill on the first belt slot, aimed at the cursor.
        this.castSlot(0);
        return;
      }
      if (e.button !== 0) return;
      this.dialogue.close();
      this.shop.close();
      if (hit.monster) {
        this.player.holdAttack = true;
        this.player.attack(hit.monster);
        held = false;
        return;
      }
      if (hit.npc) {
        const npc = hit.npc;
        this.player.interact(npc.position, 1.8, () => this.talk(npc));
        return;
      }
      if (hit.ground) {
        held = true;
        this.player.moveTo(hit.ground, true);
      }
    });
    window.addEventListener('pointerup', () => {
      held = false;
      this.player.holdAttack = false;
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.area || this.travelling) return;
      this.pointer = { clientX: e.clientX, clientY: e.clientY };
      const hit = this.pick(e);
      this.hovered = hit.monster;
      if (this.player.busyAiming) this.aimAt(hit);
      dom.style.cursor = hit.monster ? 'crosshair' : hit.npc ? 'pointer' : '';
      if (!held) return;
      const now = performance.now();
      if (now - lastIssue < 120) return;
      lastIssue = now;
      if (hit.ground) this.player.moveTo(hit.ground, false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === '1') this.player.drinkPotion(this.playerCtx());
      if (k >= '2' && k <= '5') this.castSlot(Number(k) - 1);
      if (k === 'k') this.toggleTree();
      if (k === 'i' || k === 'b') {
        this.inventory.toggle();
        audio.click();
      }
      if (k === 'n') audio.toggleMute();
      if (k === 'm' || e.key === 'Tab') {
        e.preventDefault();
        if (this.area) {
          audio.click();
          this.minimap.toggleOverlay();
        }
      }
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') this.minimap.zoom(1);
      if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') this.minimap.zoom(-1);
      if (k === 't') void this.openPortal();
      if (k === 'l' || k === 'j') this.toggleJournal();
      if (k === 'escape') {
        // Escape closes whatever is open; with nothing open it brings up the menu.
        const any = this.inventory.open || this.hud.journalOpen || this.tree.open || this.menu.open || this.waypointMenu.open || this.minimap.overlayOpen;
        this.minimap.toggleOverlay(false);
        this.waypointMenu.toggle(false);
        this.inventory.toggle(false);
        this.hud.showJournal(null);
        this.tree.toggle(false);
        if (this.menu.open) this.menu.toggle(false);
        else if (!any) this.toggleMenu(true);
      }
    });
  }

  // ---- Frame -------------------------------------------------------------

  update(dt: number, t: number) {
    if (!this.area) return;
    // The world holds still while the menu is up.
    if (this.menu.open) return;
    this.time = t;
    this.playTime += dt;
    // Autosave every few seconds; a save is a small JSON write.
    if ((this.saveTimer += dt) > 10 && !this.travelling) this.saveNow();
    const a = this.area;
    const w = a.world;
    const p = this.player;
    const ctx = this.playerCtx();
    p.update(dt, ctx);
    audio.setListener(p.position, this.cam.camera);
    cutaway.hero.value.copy(p.position).setY(p.position.y + 1.1);
    cutaway.amount.value = 1;
    // Monsters near the hero think and move; far ones sleep, hidden in the fog.
    const mctx = {
      player: p,
      nav: w.nav!,
      height: w.heightAt,
      monsters: a.monsters,
      effects: a.effects,
      floaters: this.floaters,
      onKilled: () => {},
      onPlayerHit: (amount: number, crit: boolean, from: THREE.Vector3) => {
        this.onPlayerHit(amount, crit, from);
      },
      banner: (title: string, sub: string) => this.hud.showBanner(title, sub),
    };
    // Sleeping monsters off screen and away from the hero just wait: no AI,
    // no animation. Near ones still update so they can spot the hero.
    const cam = this.cam.camera;
    this.viewFrustum.setFromProjectionMatrix(this.viewMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (const m of a.monsters) {
      if (m.removed) continue;
      const d = m.position.distanceTo(p.position);
      m.body.rig.root.visible = d < 60 && !m.hidden;
      this.viewSphere.center.copy(m.position);
      const root = m.body.rig.root;
      if (m.awake || !m.alive || d < 16 || (d < 46 && this.viewFrustum.intersectsSphere(this.viewSphere))) {
        if (root.updateMatrixWorld === frozenMatrices) Reflect.deleteProperty(root, 'updateMatrixWorld');
        m.update(dt, mctx);
      } else if (root.updateMatrixWorld !== frozenMatrices) {
        // A waiting monster holds its pose, so its ~85 rig nodes need no
        // matrix updates until it moves again: settle them once, then let the
        // per-frame scene walk skip the whole rig.
        root.updateMatrixWorld(true);
        root.updateMatrixWorld = frozenMatrices;
      }
    }
    // Music swells when something is hunting the hero.
    const hunted = a.monsters.some((m) => m.alive && m.awake && (m.state === 'chase' || m.state === 'attack') && m.position.distanceTo(p.position) < 26);
    audio.setMood(hunted && !p.dead ? 'combat' : 'explore');
    telemetry.tick(dt, a.name, this.stats, hunted && !p.dead);
    heroLevel.value = this.stats.level;
    audio.update(dt);
    if (w.npcs) for (const n of w.npcs) n.update(dt, p.position);
    a.effects.update(dt);
    a.mist.update(dt);
    w.update(dt, t);
    a.loot.update(dt, this.cam.camera, p.position);
    // Walk over gold and potions to scoop them up.
    for (const g of [...a.loot.items]) {
      if ((g.item.slot === 'gold' || g.item.slot === 'potion' || g.item.slot === 'quest') && g.age > 0.7 && g.pos.distanceTo(p.position) < 1.1) this.take(g);
    }
    // Exits: labels over the gates, and travel when the hero walks in.
    const W = window.innerWidth;
    const H = window.innerHeight;
    // Scripted areas: objectives, usable things, and exits that open up.
    const script = w.script;
    if (script) {
      script.update(dt, this.scriptCtx());
      this.hud.setObjectives(script.title, script.objectives());
    }
    for (const exit of w.exits ?? []) {
      if (a.exitLabels.some((x) => x.exit === exit)) continue;
      const el = this.label(exit.label, () => this.player.moveTo(exit.pos));
      if (exit.entry === 'portal') el.classList.add('portal');
      a.exitLabels.push({ exit, el });
    }
    // A closed portal takes its label with it.
    a.exitLabels = a.exitLabels.filter((x) => {
      if (w.exits?.includes(x.exit)) return true;
      x.el.remove();
      return false;
    });
    if (this.portal) for (const fx of [this.portal.there, this.portal.home]) fx.update(dt, this.cam.camera);
    this.updateMarkers(W, H);
    this.hud.setQuests(this.quests.lines());
    this.discoverWaypoint();
    if (this.waypointMenu.open && w.waypoint && p.position.distanceTo(w.waypoint.pos) > 5) this.waypointMenu.toggle(false);
    // Walking off ends a conversation or a trade.
    if (this.talkingTo && this.talkingTo.position.distanceTo(p.position) > 4.5) {
      this.dialogue.close();
      this.shop.close();
    }
    for (const { it, el } of a.useLabels) {
      this.v.set(it.pos.x, w.heightAt(it.pos.x, it.pos.z) + 2.2, it.pos.z).project(this.cam.camera);
      const show = it.active() && this.v.z < 1 && p.position.distanceTo(it.pos) < 20;
      el.hidden = !show;
      if (show) el.style.transform = `translate(${Math.round((this.v.x * 0.5 + 0.5) * W)}px, ${Math.round((-this.v.y * 0.5 + 0.5) * H)}px) translate(-50%, -100%)`;
    }
    for (const { exit, el } of a.exitLabels) {
      const y = w.heightAt(exit.pos.x, exit.pos.z);
      this.v.set(exit.pos.x, y + 3.2, exit.pos.z).project(this.cam.camera);
      const show = this.v.z < 1 && p.position.distanceTo(exit.pos) < 30;
      el.hidden = !show;
      if (show) el.style.transform = `translate(${Math.round((this.v.x * 0.5 + 0.5) * W)}px, ${Math.round((-this.v.y * 0.5 + 0.5) * H)}px) translate(-50%, -100%)`;
      if (!this.travelling && !p.dead && Math.hypot(p.position.x - exit.pos.x, p.position.z - exit.pos.z) < exit.radius) void this.enter(exit.to, exit.entry);
    }
    // Target frame: what's under the cursor, else what we're fighting.
    if (p.target) this.lastHit = { m: p.target, t };
    const shown = this.hovered?.alive ? this.hovered : this.lastHit && t - this.lastHit.t < 3 && this.lastHit.m.alive ? this.lastHit.m : null;
    this.hud.showTarget(shown ? { name: shown.name, hp: shown.hp, maxHp: shown.maxHp, level: shown.level, elite: shown.elite, kind: shown.def.name } : null);
    this.floaters.update(dt, this.cam.camera);
    this.hud.update(dt, this.stats, (id) => this.player.cooldownFrac(id));
    this.minimap.update(dt, p.position.x, p.position.z, p.facingYaw, this.cam.yaw);
    if (this.deathTimer > 0) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.hud.showDeath(true);
    }
  }

  /** Camera shake from the current area's effects. */
  shake(): THREE.Vector3 {
    return this.area ? this.area.effects.shakeOffset(this.time) : new THREE.Vector3();
  }

  get world(): World | null {
    return this.area?.world ?? null;
  }
}
