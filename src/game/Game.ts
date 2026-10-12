import * as THREE from 'three';
import type { IsoCamera } from '../engine/IsoCamera';
import type { Renderer } from '../engine/Renderer';
import { Mist, type Sky } from '../engine/Atmosphere';
import { Dialogue } from '../engine/Dialogue';
import { Player } from '../actors/Player';
import { Monster } from '../actors/Monster';
import type { Npc } from '../actors/Npc';
import { monsterMaterials, type MonsterMaterials } from '../actors/monsters/materials';
import type { AreaName, Exit, World } from '../world/World';
import { Effects } from './Effects';
import { FloatingText } from './Combat';
import { LootLayer, type GroundItem } from './Loot';
import { Hud } from './Hud';
import { Inventory } from './Inventory';
import { Stats } from './Stats';
import { cutaway } from '../engine/cutaway';
import { makeGold, makeItem, makePotion, rollRarity } from './Items';
import type { Character } from '../actors/Character';

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
}

export type AreaBuilder = () => Promise<World>;

export class Game {
  readonly stats = new Stats();
  readonly player: Player;
  readonly hud = new Hud();
  readonly floaters = new FloatingText();
  readonly dialogue = new Dialogue();
  readonly inventory: Inventory;
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
  private deathTimer = -1;

  constructor(
    private builders: Record<AreaName, AreaBuilder>,
    hero: Character,
    private cam: IsoCamera,
    private renderer: Renderer,
    private sky: Sky,
    private environment: THREE.Texture,
  ) {
    this.player = new Player(hero, this.stats);
    this.inventory = new Inventory(this.stats);
    this.inventory.onChange = () => this.hud.update(0, this.stats);
    this.hud.onInventory = () => this.inventory.toggle();
    this.hud.onPotion = () => this.player.drinkPotion(this.playerCtx());
    this.hud.onCleave = () => this.player.cleave(this.playerCtx());
    this.hud.onRevive = () => this.revive();
    this.exitLayer = document.createElement('div');
    this.exitLayer.className = 'loot-layer';
    document.body.appendChild(this.exitLayer);
    const style = document.createElement('style');
    style.textContent = `.exit-label { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: pointer; white-space: nowrap;
      font: 600 13px/1 'Cinzel', Georgia, serif; letter-spacing: .08em; color: #f0d8b0; padding: 6px 10px; background: rgba(20,8,6,.8);
      border: 1px solid #8a5a34; box-shadow: 0 0 12px rgba(200,120,40,.25); }
      .exit-label:hover { border-color: #e0a060; }`;
    document.head.appendChild(style);
    this.bindInput();
  }

  async start(name: AreaName, entry: string) {
    this.monsterMats = await monsterMaterials();
    await this.enter(name, entry, false);
    // Build the other area in the background so the first trip is quick.
    const other: AreaName = name === 'town' ? 'zone' : 'town';
    setTimeout(() => void this.load(other), 1500);
  }

  private load(name: AreaName): Promise<AreaState> {
    const cached = this.building.get(name);
    if (cached) return cached;
    const p = (async () => {
      const world = await this.builders[name]();
      const scene = world.scene;
      scene.environment = this.environment;
      scene.environmentIntensity = 0.45;
      const mist = new Mist(Math.min(world.extent, 60), world.heightAt, 110);
      scene.add(mist.group);
      const effects = new Effects(world.heightAt);
      scene.add(effects.group);
      const loot = new LootLayer(world.heightAt, (g) => this.pickUp(g));
      loot.setVisible(false);
      scene.add(loot.group);
      const monsters = (world.monsterSpawns ?? []).map((s) => new Monster(s, this.monsterMats, scene));
      const exitLabels = (world.exits ?? []).map((exit) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'exit-label';
        el.textContent = exit.label;
        el.hidden = true;
        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          if (e.button === 0) this.player.moveTo(exit.pos);
        });
        this.exitLayer.appendChild(el);
        return { exit, el };
      });
      const state: AreaState = { name, world, mist, effects, loot, monsters, exitLabels };
      this.areas.set(name, state);
      return state;
    })();
    this.building.set(name, p);
    return p;
  }

  /** Moves the hero to `name` at `entry`, fading out and in. */
  async enter(name: AreaName, entry: string, fade = true) {
    this.travelling = true;
    if (fade) await this.hud.fade(true, '');
    const ready = this.areas.get(name);
    if (!ready) this.hud.setFadeText('The mists part…');
    const area = ready ?? (await this.load(name));
    if (this.area) {
      this.area.loot.setVisible(false);
      for (const x of this.area.exitLabels) x.el.hidden = true;
      this.area.effects.group.visible = false;
    }
    this.area = area;
    this.dialogue.close();
    this.floaters.clear();
    const w = area.world;
    w.scene.add(this.sky.mesh);
    this.renderer.setScene(w.scene);
    area.loot.setVisible(true);
    area.effects.group.visible = true;
    // Monsters regroup whenever you come back.
    for (const m of area.monsters) m.reset();
    const e = w.entries?.[entry] ?? { pos: w.spawn ?? new THREE.Vector3(), yaw: w.spawnYaw ?? 0 };
    this.player.enter({ scene: w.scene, nav: w.nav!, heightAt: w.heightAt }, e.pos, e.yaw);
    if (w.cameraYaw !== undefined) this.cam.yaw = this.cam.targetYawValue = w.cameraYaw;
    this.cam.target.copy(this.player.position);
    this.cam.update(0);
    if (fade) await this.hud.fade(false);
    if (w.title) this.hud.showBanner(w.title, w.subtitle ?? '');
    this.travelling = false;
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
    const s = this.stats;
    // Experience falls off against monsters well below your level.
    const diff = m.level - s.level;
    const xp = Math.round(m.def.xp * (1 + (m.level - 1) * 0.3) * (m.elite ? 5 : 1) * Math.max(0.2, Math.min(1.5, 1 + diff * 0.15)));
    const levels = s.gainXp(xp);
    if (levels > 0) {
      this.area.effects.pillar(this.player.position.clone());
      this.floaters.spawn(`Level ${s.level}`, this.player.position.clone().setY(this.player.position.y + 2.6), 'info', 2.2);
      this.inventory.render();
    }
    // Loot.
    const at = m.position.clone();
    const loot = this.area.loot;
    const itemChance = { ghoul: 0.14, crawler: 0.1, cultist: 0.32, brute: 0.55 }[m.kind];
    if (Math.random() < (m.elite ? 1 : 0.55)) loot.drop(makeGold(m.level, m.elite ? 6 : m.kind === 'brute' ? 2.5 : 1), at);
    if (Math.random() < (m.kind === 'brute' ? 0.4 : 0.15) || (m.elite && Math.random() < 0.8)) loot.drop(makePotion(), at);
    if (m.elite) {
      loot.drop(makeItem(m.level + 1, Math.random() < 0.35 ? 'unique' : 'rare'), at);
      loot.drop(makeItem(m.level + 1, rollRarity(m.level + 2, 1.5)), at);
      loot.drop(makeItem(m.level, rollRarity(m.level + 2, 1)), at);
    } else if (Math.random() < itemChance) {
      loot.drop(makeItem(m.level, rollRarity(m.level)), at);
    }
    if (m.elite) this.hud.showBanner(`${m.name} Is Slain`, 'The fields fall quiet, for now');
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
    const text = g.item.slot === 'gold' ? `+${g.item.amount} gold` : g.item.slot === 'potion' ? '+1 draught' : g.item.name;
    this.floaters.spawn(text, this.player.position.clone().setY(this.player.position.y + 2.3), 'info', 1.3);
    this.inventory.render();
  }

  private onPlayerHit(amount: number, crit: boolean, from: THREE.Vector3) {
    const dealt = this.player.takeDamage(amount, crit, from);
    if (dealt <= 0) return;
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

  private bindInput() {
    const dom = this.renderer.renderer.domElement;
    let held = false;
    let lastIssue = 0;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (this.travelling || !this.area || this.player.dead) return;
      const hit = this.pick(e);
      if (e.button === 2) {
        // Cleave: turn toward the cursor and spin.
        if (hit.ground) this.player.faceToward(hit.ground, 1, 100);
        if (!this.player.cleave(this.playerCtx())) this.floaters.spawn('Not enough mana', this.player.position.clone().setY(this.player.position.y + 2.3), 'info', 1);
        return;
      }
      if (e.button !== 0) return;
      this.dialogue.close();
      if (hit.monster) {
        this.player.holdAttack = true;
        this.player.attack(hit.monster);
        held = false;
        return;
      }
      if (hit.npc) {
        const npc = hit.npc;
        this.player.interact(npc.position, 1.8, () => {
          npc.talking = true;
          this.dialogue.show(npc.def.name, npc.def.role, npc.nextLine(), () => this.dialogue.setText(npc.nextLine()), () => (npc.talking = false));
        });
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
      const hit = this.pick(e);
      this.hovered = hit.monster;
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
      if (k === 'i' || k === 'b') this.inventory.toggle();
      if (k === 'escape') this.inventory.toggle(false);
    });
  }

  // ---- Frame -------------------------------------------------------------

  update(dt: number, t: number) {
    if (!this.area) return;
    this.time = t;
    const a = this.area;
    const w = a.world;
    const p = this.player;
    const ctx = this.playerCtx();
    p.update(dt, ctx);
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
    };
    for (const m of a.monsters) {
      if (m.removed) continue;
      const d = m.position.distanceTo(p.position);
      m.body.rig.root.visible = d < 60;
      if (d < 46 || m.awake) m.update(dt, mctx);
    }
    if (w.npcs) for (const n of w.npcs) n.update(dt, p.position);
    a.effects.update(dt);
    a.mist.update(dt);
    w.update(dt, t);
    a.loot.update(dt, this.cam.camera, p.position);
    // Walk over gold and potions to scoop them up.
    for (const g of [...a.loot.items]) {
      if ((g.item.slot === 'gold' || g.item.slot === 'potion') && g.age > 0.7 && g.pos.distanceTo(p.position) < 1.1) this.take(g);
    }
    // Exits: labels over the gates, and travel when the hero walks in.
    const W = window.innerWidth;
    const H = window.innerHeight;
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
    this.hud.update(dt, this.stats);
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
