/**
 * UI state. The 3D simulation is deliberately *not* in here: the engine owns
 * the race, and this store holds the screens, the settings and a throttled
 * snapshot of the live race for the HUD to read.
 *
 * Persistence is three localStorage keys — settings, personal bests, career.
 */

import { create } from 'zustand';
import { TRACK } from '../game/config';
import type { QualityName } from '../game/config';
import type { RaceMode, RaceSnapshot, RacerResult } from '../game/race';

export type Screen = 'title' | 'athlete' | 'lane' | 'race' | 'results' | 'career' | 'settings' | 'help';

export type CareerStage = 'heat' | 'semi' | 'final';

export interface CareerState {
  round: number;
  stage: CareerStage;
  medal: 'none' | 'gold' | 'silver' | 'bronze';
  history: { stage: CareerStage; place: number; time: number }[];
}

export interface Settings {
  quality: QualityName;
  muted: boolean;
  volume: number;
  showDebug: boolean;
  cameraShake: boolean;
  crowdVolume: number;
}

export interface GameStore {
  screen: Screen;
  mode: RaceMode;
  distance: number;
  playerAthleteId: number;
  playerLane: number;
  /** two player versus only */
  player2AthleteId: number;
  player2Lane: number;
  fieldSize: number;
  wind: number;
  seed: number;
  settings: Settings;
  /** throttled live race data for the HUD */
  live: RaceSnapshot | null;
  results: RacerResult[] | null;
  lastTime: number | null;
  isPb: boolean;
  /** athlete id -> best time in seconds */
  bests: Record<number, number>;
  career: CareerState;
  /** render stats for the debug overlay */
  perf: { fps: number; calls: number; triangles: number; scale: number; drawMs: number };
  /** mirrors GameApp's pause flag so the HUD can show the overlay */
  paused: boolean;
  /** true while the slow-motion finish replay plays */
  replaying: boolean;
  setScreen(screen: Screen): void;
  patchSettings(patch: Partial<Settings>): void;
  patch(patch: Partial<GameStore>): void;
  setLive(live: RaceSnapshot | null): void;
  setPaused(paused: boolean): void;
  setReplaying(replaying: boolean): void;
  recordResult(time: number | null, athleteId: number, results: RacerResult[] | null): boolean;
  resetCareer(): void;
  advanceCareer(place: number): void;
}

const KEY_SETTINGS = 'gsg.settings.v1';
const KEY_BESTS = 'gsg.bests.v1';
const KEY_CAREER = 'gsg.career.v1';

function load<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private browsing or a full quota: settings simply will not persist */
  }
}

const DEFAULT_SETTINGS: Settings = {
  quality: 'medium',
  muted: false,
  volume: 0.75,
  showDebug: false,
  cameraShake: true,
  crowdVolume: 0.7,
};

const DEFAULT_CAREER: CareerState = {
  round: 1,
  stage: 'heat',
  medal: 'none',
  history: [],
};

/** a fresh seed per race, stable while that race is in progress */
function newSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

export const useGame = create<GameStore>((set, get) => ({
  screen: 'title',
  mode: 'quick',
  distance: TRACK.raceDistance,
  playerAthleteId: 0,
  playerLane: 3,
  player2AthleteId: 1,
  player2Lane: 4,
  fieldSize: TRACK.lanes,
  wind: 0,
  seed: newSeed(),
  settings: load<Settings>(KEY_SETTINGS, DEFAULT_SETTINGS),
  live: null,
  results: null,
  lastTime: null,
  isPb: false,
  bests: load<Record<number, number>>(KEY_BESTS, {}),
  career: load<CareerState>(KEY_CAREER, DEFAULT_CAREER),
  perf: { fps: 0, calls: 0, triangles: 0, scale: 1, drawMs: 0 },
  paused: false,
  replaying: false,

  setScreen(screen: Screen): void {
    set({ screen });
  },

  setPaused(paused: boolean): void {
    set({ paused });
  },

  setReplaying(replaying: boolean): void {
    set({ replaying });
  },

  patchSettings(patch: Partial<Settings>): void {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    save(KEY_SETTINGS, settings);
  },

  patch(patch: Partial<GameStore>): void {
    set(patch);
  },

  setLive(live: RaceSnapshot | null): void {
    set({ live });
  },

  /** stores a personal best when the time beats the previous one */
  recordResult(time: number | null, athleteId: number, results: RacerResult[] | null): boolean {
    const bests = { ...get().bests };
    let isPb = false;
    if (time !== null && Number.isFinite(time)) {
      const prev = bests[athleteId];
      if (prev === undefined || time < prev) {
        bests[athleteId] = time;
        isPb = true;
      }
      save(KEY_BESTS, bests);
    }
    set({ bests, results, lastTime: time, isPb });
    return isPb;
  },

  resetCareer(): void {
    const career = { ...DEFAULT_CAREER };
    set({ career });
    save(KEY_CAREER, career);
  },

  /** heat -> semi -> final; only the final awards a medal, to the top three */
  advanceCareer(place: number): void {
    const c = { ...get().career };
    c.history = [...c.history, { stage: c.stage, place, time: get().lastTime ?? 0 }];
    c.round++;
    if (c.stage === 'heat') {
      // only the top two reach the semi-final
      if (place <= 2) c.stage = 'semi';
    } else if (c.stage === 'semi') {
      if (place <= 2) c.stage = 'final';
    } else if (place >= 1 && place <= 3) {
      c.medal = place === 1 ? 'gold' : place === 2 ? 'silver' : 'bronze';
    }
    set({ career: c });
    save(KEY_CAREER, c);
  },
}));

export type { RaceMode, RaceSnapshot, RacerResult, QualityName };
