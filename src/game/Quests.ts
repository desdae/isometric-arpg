import type { MonsterKind } from '../actors/Monster';
import type { AreaName } from '../world/World';

// Errands the townsfolk hand out: slay so many of a kind, bring back so many
// of a thing that only drops while you're looking for it, or clear the crypt.
// Each giver has a chain; finishing one quest unlocks their next.

export type QuestKind = 'kill' | 'gather' | 'clear';

export interface QuestDef {
  id: string;
  giver: string;
  title: string;
  kind: QuestKind;
  count: number;
  /** Kill quests: which monsters count. */
  target?: MonsterKind[];
  /** Gather quests: the item, who drops it, where, and how often. */
  item?: { name: string; from: MonsterKind[] | 'any'; area?: AreaName; chance: number };
  /** What the giver says when offering it. */
  offer: string;
  /** What they say while you're still at it. */
  waiting: string;
  /** What they say when you hand it in. */
  thanks: string;
  gold: number;
  xp: number;
  /** Healing draughts handed over with the gold. */
  potions?: number;
  /** Something from the giver's own keeping. */
  gift?: 'magic' | 'rare';
  /** Offered again once done (the crypt is dug anew each time). */
  repeat?: boolean;
}

export interface Quest {
  def: QuestDef;
  progress: number;
}

const DEFS: QuestDef[] = [
  {
    id: 'ilja-ghouls',
    giver: 'Ilja',
    title: 'Thin the Ghouls',
    kind: 'kill',
    target: ['ghoul'],
    count: 12,
    offer: 'The ghouls come right up to the gate at night and scratch at it. Put a dozen of them back in the ground and I will pay you from the watch purse.',
    waiting: 'I still hear them at the gate. A dozen, I said.',
    thanks: 'Quieter already. Here, the watch purse, what is left of it.',
    gold: 60,
    xp: 150,
  },
  {
    id: 'ilja-crawlers',
    giver: 'Ilja',
    title: 'Crawlers in the Dead Trees',
    kind: 'kill',
    target: ['crawler'],
    count: 15,
    offer: 'The blood crawlers nest in the dead trees and drop on anyone passing under. Fifteen of them and the road to the crypt is ours again.',
    waiting: 'The crawlers still hang in the trees. Fifteen, if you can stomach it.',
    thanks: 'Good. I saw one of the trees burning from the wall. Take this.',
    gold: 80,
    xp: 220,
  },
  {
    id: 'ilja-priests',
    giver: 'Ilja',
    title: 'The Blood Priests',
    kind: 'kill',
    target: ['cultist'],
    count: 6,
    offer: 'Those hooded ones in the blood pools are calling the dead up. Six of them. Kill the priests and the rest will wander.',
    waiting: 'The red fire still burns out there. The priests are not done.',
    thanks: 'The pools have gone still. Whatever they were singing to, it has stopped listening. For now.',
    gold: 130,
    xp: 360,
  },
  {
    id: 'petra-moss',
    giver: 'Old Petra',
    title: 'Grave Moss',
    kind: 'gather',
    count: 6,
    item: { name: 'Grave Moss', from: 'any', area: 'zone', chance: 0.4 },
    offer: 'Grave moss grows on the dead out in the fields, on the ones that walk. Cut six clumps off them and I will brew you draughts to close your wounds.',
    waiting: 'Six clumps of grave moss, from the walking dead out past the gate. Mind the smell.',
    thanks: 'Ah, fat and wet, just right. Here, three draughts, and a few coins for your trouble.',
    gold: 30,
    xp: 140,
    potions: 3,
  },
  {
    id: 'petra-ichor',
    giver: 'Old Petra',
    title: 'Ichor Sacs',
    kind: 'gather',
    count: 5,
    item: { name: 'Ichor Sac', from: ['crawler', 'spider'], chance: 0.35 },
    offer: 'The crawlers and the tomb spiders carry a sac of ichor under the jaw. Five of them. It thins the blood rot, if you boil it long enough.',
    waiting: 'Five ichor sacs. Crawlers have them, and the big spiders in the crypt.',
    thanks: 'Careful, careful, they burst. Good. That will keep the sick ones in the cathedral alive another week.',
    gold: 90,
    xp: 300,
    potions: 2,
  },
  {
    id: 'marek-horrors',
    giver: 'Marek',
    title: 'What Was Buried',
    kind: 'kill',
    target: ['horror'],
    count: 3,
    offer: 'Down in the crypt there are things stitched out of the ones I buried. Flesh horrors, the brothers call them. Kill three and let my dead rest.',
    waiting: 'Three of those stitched things. They are down in the crypt.',
    thanks: 'Thank you. I will dig them proper graves this time. Deeper.',
    gold: 110,
    xp: 380,
  },
  {
    id: 'marek-wraiths',
    giver: 'Marek',
    title: 'Unquiet Spirits',
    kind: 'kill',
    target: ['wraith'],
    count: 6,
    offer: 'There are wraiths in the deep vaults now. Six of them. A body you can bury. A wraith you can only cut down.',
    waiting: 'Six wraiths. You will find them where it is coldest.',
    thanks: 'The cold has gone out of the graveyard. I can feel it. Take this, I have no use for it.',
    gold: 160,
    xp: 520,
    gift: 'rare',
  },
  {
    id: 'hana-scarf',
    giver: 'Hana',
    title: 'The Red Scarf',
    kind: 'gather',
    count: 1,
    item: { name: 'Red Scarf', from: 'any', area: 'dungeon', chance: 0.12 },
    offer: 'My boy, Tomas. He wore a red scarf, I knitted it. The others say they took the lost ones down into the crypt. If you find it, bring it back to me. Please.',
    waiting: 'A red scarf. If he is down there, it will be on one of them.',
    thanks: 'That is his. That is his. Thank you. At least now I know. Take this, it was his father\'s.',
    gold: 50,
    xp: 260,
    gift: 'rare',
  },
  {
    id: 'vasko-crypt',
    giver: 'Elder Vasko',
    title: 'Seal the Crypt',
    kind: 'clear',
    count: 1,
    offer: 'There is a crypt in the fields, and every night something new crawls out of it. Go down, break whatever seal they have set, and kill what waits at the bottom.',
    waiting: 'The crypt still breathes. Find what waits at the bottom of it.',
    thanks: 'You came back. Saint Orsolya will remember. Take this, from the town chest.',
    gold: 300,
    xp: 800,
    repeat: true,
  },
];

export class QuestLog {
  readonly active: Quest[] = [];
  private done = new Set<string>();
  /** Bumps every time something changes, so the HUD knows when to redraw. */
  version = 0;

  /** Quest state for the save file, by quest id so text and rewards can change freely. */
  toSave() {
    return { active: this.active.map((q) => ({ id: q.def.id, progress: q.progress })), done: [...this.done] };
  }

  /** Loads saved quest state. Quests that no longer exist are skipped. */
  restore(data: { active?: unknown; done?: unknown } | undefined) {
    this.active.length = 0;
    this.done.clear();
    if (Array.isArray(data?.done)) for (const id of data.done) if (typeof id === 'string') this.done.add(id);
    if (Array.isArray(data?.active)) {
      for (const a of data.active as { id?: unknown; progress?: unknown }[]) {
        const def = DEFS.find((d) => d.id === a?.id);
        if (!def || this.active.some((q) => q.def.giver === def.giver)) continue;
        const p = typeof a.progress === 'number' && Number.isFinite(a.progress) ? Math.round(a.progress) : 0;
        this.active.push({ def, progress: Math.max(0, Math.min(def.count, p)) });
      }
    }
    this.version++;
  }

  /** The next quest `giver` has to offer, if any. */
  available(giver: string): QuestDef | null {
    if (this.active.some((q) => q.def.giver === giver)) return null;
    return DEFS.find((d) => d.giver === giver && (d.repeat || !this.done.has(d.id))) ?? null;
  }

  /** `giver`'s quest that is finished and waiting to be handed in. */
  ready(giver: string): Quest | null {
    return this.active.find((q) => q.def.giver === giver && q.progress >= q.def.count) ?? null;
  }

  current(giver: string): Quest | null {
    return this.active.find((q) => q.def.giver === giver) ?? null;
  }

  accept(def: QuestDef) {
    this.active.push({ def, progress: 0 });
    this.version++;
  }

  turnIn(q: Quest) {
    this.active.splice(this.active.indexOf(q), 1);
    this.done.add(q.def.id);
    this.version++;
  }

  /** Counts a kill; returns the quests it just completed. */
  onKill(kind: MonsterKind, boss: boolean): Quest[] {
    const finished: Quest[] = [];
    for (const q of this.active) {
      if (q.progress >= q.def.count) continue;
      const counts = (q.def.kind === 'kill' && q.def.target!.includes(kind)) || (q.def.kind === 'clear' && boss);
      if (!counts) continue;
      q.progress++;
      this.version++;
      if (q.progress >= q.def.count) finished.push(q);
    }
    return finished;
  }

  /** A quest item this kill drops, if any errand wants one from it. */
  dropFor(kind: MonsterKind, area: AreaName, onGround: (name: string) => number): string | null {
    for (const q of this.active) {
      const it = q.def.item;
      if (!it || (it.area && it.area !== area) || (it.from !== 'any' && !it.from.includes(kind))) continue;
      if (q.progress + onGround(it.name) >= q.def.count) continue;
      if (Math.random() < it.chance) return it.name;
    }
    return null;
  }

  /** Picks up a quest item; returns the quest it belongs to. */
  gather(name: string): Quest | null {
    const q = this.active.find((x) => x.def.item?.name === name && x.progress < x.def.count);
    if (!q) return null;
    q.progress++;
    this.version++;
    return q;
  }

  /** What handing in `def` pays at the hero's level (the crypt pays more as it grows deadlier). */
  reward(def: QuestDef, level: number) {
    const k = def.repeat ? 1 + (level - 1) * 0.2 : 1;
    return { gold: Math.round(def.gold * k), xp: Math.round(def.xp * k), potions: def.potions ?? 0, gift: def.gift };
  }

  rewardText(def: QuestDef, level: number): string {
    const r = this.reward(def, level);
    const parts = [`${r.gold} gold`, `${r.xp} experience`];
    if (r.potions) parts.push(`${r.potions} draughts`);
    if (r.gift) parts.push(`a ${r.gift} keepsake`);
    return `Reward: ${parts.join(', ')}`;
  }

  /** One line per active quest for the on-screen tracker. */
  lines(): { text: string; done: boolean }[] {
    return this.active.map((q) => {
      const finished = q.progress >= q.def.count;
      const text = finished
        ? `${q.def.title}: return to ${q.def.giver}`
        : q.def.kind === 'clear'
          ? `${q.def.title}: kill the crypt's master`
          : `${q.def.title}: ${q.progress}/${q.def.count}`;
      return { text, done: finished };
    });
  }
}
