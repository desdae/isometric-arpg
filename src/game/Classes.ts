import type { SkillId } from './Skills';

// Playable classes. A save stores only the class id, so a new class is one
// more entry here (plus its outfit and skills); saves of a class that is
// later removed fall back to the first one rather than failing to load.

export interface ClassDef {
  id: string;
  name: string;
  /** One line for the class card. */
  blurb: string;
  /** Skills known from the start (they cost no points). */
  startRanks: Partial<Record<SkillId, number>>;
  /** Belt at creation: right click, then keys 2 to 5. */
  startBelt: (SkillId | null)[];
}

export const CLASSES: ClassDef[] = [
  {
    id: 'knight',
    name: 'Knight',
    blurb: 'A sworn sword of the fallen cathedral. Heavy steel, a heavier oath.',
    startRanks: { cleave: 1 },
    startBelt: ['cleave', null, null, null, null],
  },
];

export const classDef = (id: string): ClassDef => CLASSES.find((c) => c.id === id) ?? CLASSES[0];

/** Heraldic colours for the knight's tabard. Saved by id; unknown ids fall back to crimson. */
export const TABARDS: { id: string; name: string; rgb: [number, number, number] }[] = [
  { id: 'crimson', name: 'Crimson', rgb: [0.55, 0.06, 0.05] },
  { id: 'sable', name: 'Sable', rgb: [0.05, 0.045, 0.045] },
  { id: 'azure', name: 'Azure', rgb: [0.06, 0.12, 0.42] },
  { id: 'vert', name: 'Vert', rgb: [0.06, 0.24, 0.08] },
  { id: 'or', name: 'Or', rgb: [0.62, 0.42, 0.08] },
  { id: 'purpure', name: 'Purpure', rgb: [0.3, 0.06, 0.32] },
  { id: 'argent', name: 'Argent', rgb: [0.62, 0.6, 0.56] },
];

export const tabard = (id: string | undefined) => TABARDS.find((t) => t.id === id) ?? TABARDS[0];
