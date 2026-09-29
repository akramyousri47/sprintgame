/**
 * Race engine tests: the start rules, the finish, the results and the
 * determinism the replay depends on.
 */

import { describe, expect, it } from 'vitest';
import { Race } from '../src/game/race';
import type { RaceOptions } from '../src/game/race';
import { FINISH, START, TRACK } from '../src/game/config';

function opts(over: Partial<RaceOptions> = {}): RaceOptions {
  return {
    mode: 'quick',
    seed: 12345,
    distance: TRACK.raceDistance,
    fieldSize: 8,
    playerLane: 3,
    playerAthleteId: 0,
    player2Lane: 4,
    player2AthleteId: 1,
    wind: 0,
    ...over,
  };
}

/** run a race to the results screen, simulating the player honestly */
function play(o: RaceOptions, opts: { mash?: boolean; neverStart?: boolean; dip?: boolean } = {}): Race {
  const race = new Race(o);
  race.arm();
  let now = 0;
  const dt = 1 / 120;
  // input() is handed the same clock the engine reads the gun off, so the
  // synthetic player has to start from there rather than from zero
  let clock = performance.now() / 1000;
  let reacted = false;
  let lastTap = 0;
  let lastExpected = race.player.gait.expected;
  let steps = 0;

  for (let t = 0; t < 40; t += dt) {
    now += dt;
    clock += dt;
    // react a human 0.22 s after the gun
    if (!reacted && race.gunAt >= 0 && clock >= race.gunAt + 0.22) {
      race.input('react', clock);
      reacted = true;
    }
    if (opts.mash !== false && race.player.started && !race.player.finished) {
      // tap the correct foot at the right instant, like a player watching the bar
      if (race.player.gait.expected !== lastExpected) {
        lastExpected = race.player.gait.expected;
        if (now - lastTap > 0.05) {
          lastTap = now;
          race.input(lastExpected === 'left' ? 'left' : 'right', clock);
          steps++;
        }
      }
      if (opts.dip !== false && race.remaining <= FINISH.dipWindow && race.remaining > 0.5) {
        race.input('dip', clock);
      }
    }
    race.update(dt);
    if (race.phase === 'results') break;
  }
  return race;
}

describe('the start', () => {
  it('walks through intro, set, hold and then running', () => {
    const race = new Race(opts());
    expect(race.phase).toBe('idle');
    race.arm();
    expect(race.phase).toBe('intro');
    const seen = new Set<string>();
    const dt = 1 / 120;
    for (let t = 0; t < 6; t += dt) {
      race.update(dt);
      seen.add(race.phase);
    }
    expect(seen.has('set')).toBe(true);
    expect(seen.has('hold')).toBe(true);
    expect(seen.has('running')).toBe(true);
  });

  it('holds for between 0.9 and 1.6 seconds on SET', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const race = new Race(opts({ seed }));
      race.arm();
      const dt = 1 / 240;
      let elapsed = 0;
      let holdStart = -1;
      let gunAt = -1;
      for (let t = 0; t < 8; t += dt) {
        elapsed += dt;
        race.update(dt);
        if (race.phase === 'hold' && holdStart < 0) holdStart = elapsed;
        // the gun is the moment the engine flips to running
        if (race.phase === 'running') {
          gunAt = elapsed;
          break;
        }
      }
      expect(holdStart).toBeGreaterThan(0);
      expect(gunAt).toBeGreaterThan(0);
      const hold = gunAt - holdStart;
      expect(hold).toBeGreaterThanOrEqual(START.holdMin - 0.02);
      expect(hold).toBeLessThanOrEqual(START.holdMax + 0.02);
    }
  });

  it('disqualifies a player who moves before the gun', () => {
    const race = new Race(opts());
    race.arm();
    race.update(1 / 120);
    race.input('react', performance.now() / 1000);
    expect(race.player.dq).toBe(true);
    expect(race.player.dqReason).toMatch(/False start/);
  });

  it('disqualifies a reaction under 100 ms', () => {
    const race = new Race(opts());
    race.arm();
    const dt = 1 / 120;
    let clock = 5000;
    for (let t = 0; t < 6; t += dt) {
      clock += dt;
      race.update(dt);
      if (race.gunAt >= 0) break;
    }
    race.input('react', race.gunAt + START.falseStartThreshold * 0.5);
    expect(race.player.dq).toBe(true);
    expect(race.player.dqReason).toMatch(/100 ms/);
  });

  it('accepts a legal reaction and records it', () => {
    const race = new Race(opts());
    race.arm();
    const dt = 1 / 120;
    for (let t = 0; t < 6; t += dt) {
      race.update(dt);
      if (race.gunAt >= 0) break;
    }
    race.input('react', race.gunAt + 0.22);
    expect(race.player.dq).toBe(false);
    expect(race.player.started).toBe(true);
    expect(race.player.reaction).toBeCloseTo(0.22, 2);
  });
});

describe('a full race', () => {
  it('finishes, produces results and times the winner', () => {
    const race = play(opts());
    expect(race.phase).toBe('results');
    expect(race.results).not.toBeNull();
    const rows = race.results!;
    expect(rows.length).toBeGreaterThan(0);
    const winner = rows.find((r) => r.rank === 1)!;
    expect(winner).toBeDefined();
    expect(winner.time).toBeGreaterThan(8);
    expect(winner.time).toBeLessThan(14);
  });

  it('ranks the finish in ascending time order', () => {
    const race = play(opts());
    const valid = race.results!.filter((r) => r.valid);
    for (let i = 1; i < valid.length; i++) {
      expect(valid[i].time).toBeGreaterThanOrEqual(valid[i - 1].time - 1e-9);
    }
  });

  it('has the player finish inside the distance', () => {
    const race = play(opts());
    const me = race.results!.find((r) => r.player)!;
    expect(me).toBeDefined();
    expect(race.player.gait.s.distance).toBeGreaterThanOrEqual(TRACK.raceDistance - 0.5);
  });

  it('awards a dive bonus when the dive is in the window', () => {
    const race = play(opts(), { dip: true });
    const me = race.results!.find((r) => r.player)!;
    expect(me.dip).toBeGreaterThan(0);
    expect(me.dip).toBeLessThanOrEqual(FINISH.dipBonusTime + 1e-9);
  });

  it('ignores a dive that is pressed far too early', () => {
    const race = new Race(opts());
    race.arm();
    const dt = 1 / 120;
    let clock = 0;
    for (let t = 0; t < 6; t += dt) {
      clock += dt;
      race.update(dt);
      if (race.gunAt >= 0) break;
    }
    race.input('react', race.gunAt + 0.2);
    for (let t = 0; t < 1; t += dt) {
      clock += dt;
      race.update(dt);
      race.input('dip', clock);
    }
    expect(race.player.dipAt).toBe(-1);
  });

  it('punishes a headwind', () => {
    const calm = play(opts({ wind: 0, seed: 999 }));
    const windy = play(opts({ wind: 2.0, seed: 999 }));
    const a = calm.player.gait.s.distance;
    const b = windy.player.gait.s.distance;
    // same seed and same field, so only the wind differs
    expect(a).toBeGreaterThanOrEqual(b);
  });
});

describe('determinism', () => {
  it('produces the same result twice from the same seed', () => {
    const a = play(opts({ seed: 4242 }));
    const b = play(opts({ seed: 4242 }));
    expect(a.results!.map((r) => [r.name, r.time.toFixed(6)])).toEqual(
      b.results!.map((r) => [r.name, r.time.toFixed(6)]),
    );
  });

  it('produces a different result from a different seed', () => {
    const a = play(opts({ seed: 1 }));
    const b = play(opts({ seed: 2 }));
    expect(JSON.stringify(a.results)).not.toBe(JSON.stringify(b.results));
  });

  it('records replay samples at 20 Hz', () => {
    const race = play(opts());
    const s = race.player.samples;
    expect(s.length % 8).toBe(0);
    const times: number[] = [];
    for (let i = 0; i < s.length; i += 8) times.push(s[i]);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThan(0.04);
      expect(times[i] - times[i - 1]).toBeLessThan(0.06);
    }
  });
});

describe('modes', () => {
  it('time trial puts the player alone on the track', () => {
    const race = new Race(opts({ mode: 'timeTrial', fieldSize: 1 }));
    expect(race.racers.length).toBe(1);
    expect(race.racers[0].isPlayer).toBe(true);
  });

  it('versus creates two human players in different lanes', () => {
    const race = new Race(opts({ mode: 'versus', fieldSize: 2, playerLane: 2, player2Lane: 5 }));
    expect(race.player2).toBeDefined();
    expect(race.player.lane).not.toBe(race.player2!.lane);
    expect(race.racers.filter((r) => r.isPlayer).length).toBe(2);
  });

  it('gives each versus player their own input path', () => {
    const race = new Race(opts({ mode: 'versus', fieldSize: 2, playerLane: 2, player2Lane: 5 }));
    race.arm();
    const dt = 1 / 120;
    let clock = 7000;
    for (let t = 0; t < 6; t += dt) {
      clock += dt;
      race.update(dt);
      if (race.gunAt >= 0) break;
    }
    race.input('react', race.gunAt + 0.2, 0);
    race.input('react', race.gunAt + 0.3, 1);
    expect(race.player.started).toBe(true);
    expect(race.player2!.started).toBe(true);
    expect(race.player.reaction).not.toBe(race.player2!.reaction);
  });
});
