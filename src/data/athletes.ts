/**
 * The Global Sprint Games field: eight invented nations and eight invented
 * athletes. No real federations, no real athletes — every nation, flag and
 * name here is original to this game, which keeps the whole thing clear of any
 * real-world competition identity.
 *
 * Stats are the five-attribute model from the brief: start, acceleration,
 * top speed, endurance, technique. Top speed is m/s and the rest are 0..1
 * ratings that the gait solver turns into a velocity profile.
 */

import { normaliseStats, paramsFromStats } from '../biomechanics/athlete';
import type { AthleteParams, AthleteStats } from '../biomechanics/athlete';
import type { Appearance, BodyShape } from '../characters/humanoid';

export type FlagPattern = 'triband' | 'stripes-h' | 'stripes-v' | 'diagonal' | 'cross' | 'disc' | 'chevron' | 'halved';

export interface Nation {
  code: string;
  name: string;
  colors: readonly [string, string, string];
  pattern: FlagPattern;
}

export const NATIONS: readonly Nation[] = [
  { code: 'AVL', name: 'Aveline', colors: ['#1b4f9c', '#f2f4f7', '#e8a33d'], pattern: 'chevron' },
  { code: 'NDH', name: 'Nordhavn', colors: ['#0d2a4d', '#dfe7f0', '#c8342f'], pattern: 'cross' },
  { code: 'KSL', name: 'Kestrel Rep.', colors: ['#12603a', '#f4d03f', '#111417'], pattern: 'diagonal' },
  { code: 'SLM', name: 'Solmara', colors: ['#e8b23a', '#8c1d2f', '#fdf6e3'], pattern: 'halved' },
  { code: 'RHV', name: 'Rhun Valley', colors: ['#2c3e50', '#9fb8c8', '#d64545'], pattern: 'stripes-h' },
  { code: 'CIN', name: 'Cintra Isles', colors: ['#123c63', '#3fa7d6', '#f2f2f2'], pattern: 'disc' },
  { code: 'VNT', name: 'Vantara', colors: ['#5b2a86', '#f0a202', '#f7f7f7'], pattern: 'triband' },
  { code: 'ORC', name: 'Orsted Coast', colors: ['#0f5257', '#f4f1de', '#e07a5f'], pattern: 'stripes-v' },
] as const;

export interface Athlete {
  id: number;
  name: string;
  nation: Nation;
  height: number;
  stats: AthleteStats;
  params: AthleteParams;
  look: Appearance;
  shape: BodyShape;
  /** 0..1 lane bias, purely cosmetic flavour for the draw */
  laneBias: number;
}

interface Seed {
  name: string;
  nation: number;
  height: number;
  stats: AthleteStats;
  skin: number;
  hair: number;
  hairStyle: Appearance['hairStyle'];
  shape: BodyShape;
  shoeA: number;
  shoeB: number;
  headband: number;
  laneBias: number;
}

const SEEDS: readonly Seed[] = [
  {
    name: 'Kester Marlow',
    nation: 0,
    height: 1.88,
    stats: { start: 0.82, acceleration: 0.84, topSpeed: 11.5, endurance: 0.66, technique: 0.86 },
    skin: 0xd9a37a,
    hair: 0x2b1d14,
    hairStyle: 'crop',
    shape: { limbScale: 1.02, mass: 1.04, shoulders: 1.06, muscle: 1.05 },
    shoeA: 0xf2f4f7,
    shoeB: 0x1b4f9c,
    headband: 0xe8a33d,
    laneBias: 0.5,
  },
  {
    name: 'Sindre Aaltonen',
    nation: 1,
    height: 1.94,
    stats: { start: 0.74, acceleration: 0.79, topSpeed: 11.7, endurance: 0.72, technique: 0.8 },
    skin: 0xe8c4a4,
    hair: 0xc9a468,
    hairStyle: 'buzz',
    shape: { limbScale: 1.05, mass: 0.98, shoulders: 1.04, muscle: 0.96 },
    shoeA: 0xc8342f,
    shoeB: 0xf2f4f7,
    headband: 0,
    laneBias: 0.1,
  },
  {
    name: 'Omari Bexley',
    nation: 2,
    height: 1.78,
    stats: { start: 0.95, acceleration: 0.95, topSpeed: 10.9, endurance: 0.55, technique: 0.78 },
    skin: 0x6b4327,
    hair: 0x140d08,
    hairStyle: 'buzz',
    shape: { limbScale: 0.97, mass: 1.06, shoulders: 1.08, muscle: 1.12 },
    shoeA: 0xf4d03f,
    shoeB: 0x111417,
    headband: 0xf4d03f,
    laneBias: 0.9,
  },
  {
    name: 'Teo Ferrante',
    nation: 3,
    height: 1.72,
    stats: { start: 0.88, acceleration: 0.9, topSpeed: 10.6, endurance: 0.6, technique: 0.88 },
    skin: 0xc98f63,
    hair: 0x3a2314,
    hairStyle: 'crop',
    shape: { limbScale: 0.95, mass: 0.94, shoulders: 0.98, muscle: 0.98 },
    shoeA: 0x8c1d2f,
    shoeB: 0xfdf6e3,
    headband: 0,
    laneBias: 0.7,
  },
  {
    name: 'Isaak Brenner',
    nation: 4,
    height: 1.85,
    stats: { start: 0.7, acceleration: 0.76, topSpeed: 11.4, endurance: 0.88, technique: 0.92 },
    skin: 0xefc9a8,
    hair: 0x8a5a2b,
    hairStyle: 'fade',
    shape: { limbScale: 1.01, mass: 0.96, shoulders: 1, muscle: 0.92 },
    shoeA: 0xd64545,
    shoeB: 0x2c3e50,
    headband: 0x9fb8c8,
    laneBias: 0.3,
  },
  {
    name: 'Emeka Nwosu',
    nation: 5,
    height: 1.8,
    stats: { start: 0.79, acceleration: 0.97, topSpeed: 10.8, endurance: 0.5, technique: 0.72 },
    skin: 0x5a3820,
    hair: 0x120b06,
    hairStyle: 'locs',
    shape: { limbScale: 0.99, mass: 1.05, shoulders: 1.07, muscle: 1.08 },
    shoeA: 0x3fa7d6,
    shoeB: 0xf2f2f2,
    headband: 0,
    laneBias: 0.8,
  },
  {
    name: 'Luka Petrov',
    nation: 6,
    height: 1.9,
    stats: { start: 0.68, acceleration: 0.72, topSpeed: 11.9, endurance: 0.8, technique: 0.85 },
    skin: 0xe5bb95,
    hair: 0x50331c,
    hairStyle: 'crop',
    shape: { limbScale: 1.04, mass: 1, shoulders: 1.02, muscle: 0.95 },
    shoeA: 0xf0a202,
    shoeB: 0x5b2a86,
    headband: 0xf7f7f7,
    laneBias: 0.2,
  },
  {
    name: 'Niilo Rantanen',
    nation: 7,
    height: 1.76,
    stats: { start: 0.85, acceleration: 0.87, topSpeed: 11.0, endurance: 0.7, technique: 0.9 },
    skin: 0xf0d2b4,
    hair: 0xd8c48a,
    hairStyle: 'fade',
    shape: { limbScale: 0.99, mass: 0.93, shoulders: 0.97, muscle: 0.94 },
    shoeA: 0xf4f1de,
    shoeB: 0xe07a5f,
    headband: 0x0f5257,
    laneBias: 0.6,
  },
] as const;

export const ATHLETES: readonly Athlete[] = SEEDS.map((s, i) => {
  const nation = NATIONS[s.nation];
  const stats = normaliseStats(s.stats);
  return {
    id: i,
    name: s.name,
    nation,
    height: s.height,
    stats,
    params: paramsFromStats(s.height, stats),
    shape: s.shape,
    laneBias: s.laneBias,
    look: {
      skin: s.skin,
      hair: s.hair,
      hairStyle: s.hairStyle,
      kitPrimary: hexToInt(nation.colors[0]),
      kitSecondary: hexToInt(nation.colors[1]),
      shoeA: s.shoeA,
      shoeB: s.shoeB,
      bib: i + 1,
      nation: nation.code,
      headband: s.headband,
    },
  };
});

function hexToInt(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** the player can pick any of the eight; `id` is the athlete index */
export function athleteById(id: number): Athlete {
  return ATHLETES[((id % ATHLETES.length) + ATHLETES.length) % ATHLETES.length];
}
