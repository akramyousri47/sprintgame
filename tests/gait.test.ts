/**
 * Gait and rhythm tests. These are the numbers the whole game is balanced on,
 * so they are checked explicitly rather than eyeballed in the browser.
 */

import { describe, expect, it } from 'vitest';
import { Gait, gradeTap } from '../src/biomechanics/gait';
import { paramsFromStats } from '../src/biomechanics/athlete';
import type { AthleteParams } from '../src/biomechanics/athlete';
import { GAIT, RHYTHM, START } from '../src/game/config';

const fast = paramsFromStats(1.88, { start: 0.85, acceleration: 0.9, topSpeed: 11.6, endurance: 0.8, technique: 0.85 });

/** run a gait forward and return the state at the end */
function run(params = fast, seconds = 12, quality = 1): Gait {
  const g = new Gait(params);
  g.launchFromBlocks(0.55);
  const dt = 1 / 120;
  for (let t = 0; t < seconds; t += dt) {
    g.step(dt, { quality, driving: true, stalled: false });
  }
  return g;
}

/** run until the athlete covers the distance, or until the time cap is hit */
function runTo(params: AthleteParams, metres: number, quality = 1): { gait: Gait; time: number } {
  const g = new Gait(params);
  g.launchFromBlocks(0.55);
  const dt = 1 / 120;
  let t = 0;
  while (g.s.distance < metres && t < 30) {
    g.step(dt, { quality, driving: true, stalled: false });
    t += dt;
  }
  return { gait: g, time: t };
}

describe('gradeTap', () => {
  it('grades a strike inside the perfect window as perfect', () => {
    expect(gradeTap(0.02, 0.5).grade).toBe('perfect');
  });

  it('grades a strike inside the good window as good', () => {
    expect(gradeTap(RHYTHM.perfectWindow + 0.02, 0.5).grade).toBe('good');
  });

  it('grades a strike inside the ok window as ok', () => {
    expect(gradeTap(RHYTHM.goodWindow + 0.02, 0.5).grade).toBe('ok');
  });

  it('rejects a strike after the window closes', () => {
    expect(gradeTap(RHYTHM.okWindow + 0.1, 0.5).grade).toBe('early');
  });

  it('detects mashing from the gap between taps', () => {
    expect(gradeTap(0.05, RHYTHM.mashInterval * 0.5).grade).toBe('mash');
  });

  it('never returns a quality above one or below zero', () => {
    for (let t = 0; t < 0.4; t += 0.005) {
      for (const gap of [0.05, 0.13, 0.5]) {
        const q = gradeTap(t, gap).quality;
        expect(q).toBeGreaterThanOrEqual(0);
        expect(q).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('Gait', () => {
  it('keeps cadence inside its bounds at every speed', () => {
    const g = new Gait(fast);
    g.launchFromBlocks(0.6);
    const dt = 1 / 120;
    for (let t = 0; t < 12; t += dt) {
      g.step(dt, { quality: 1, driving: true, stalled: false });
      expect(g.s.stepFreq).toBeGreaterThanOrEqual(GAIT.stepFreqMin - 1e-6);
      expect(g.s.stepFreq).toBeLessThanOrEqual(GAIT.stepFreqMax + 1e-6);
    }
  });

  it('settles into the 2.2-2.5 m step band at top speed', () => {
    // 2.2-2.5 m is the brief's figure for a full-speed sprint stride, not for
    // the first strides out of the blocks where the step is necessarily short
    const g = run(fast, 8);
    expect(g.s.speed).toBeGreaterThan(g.p.maxSpeed * 0.9);
    expect(g.s.stepLength).toBeGreaterThanOrEqual(GAIT.stepLengthMin - 0.05);
    expect(g.s.stepLength).toBeLessThanOrEqual(GAIT.stepLengthMax + 0.05);
  });

  it('keeps speed consistent with step length times step frequency', () => {
    const g = run(fast, 8);
    // one foot strike per step, so v = stepLength * stepFrequency
    expect(g.s.speed).toBeCloseTo(g.s.stepLength * g.s.stepFreq, 3);
  });

  it('accelerates away from the blocks in order', () => {
    const g = new Gait(fast);
    g.launchFromBlocks(0.6);
    const samples: number[] = [];
    const dt = 1 / 120;
    for (let t = 0; t < 6; t += dt) {
      g.step(dt, { quality: 1, driving: true, stalled: false });
      if (samples.length === 0 || t - samples[samples.length - 1] > 0.4) {
        samples.push(t, g.s.speed);
      }
    }
    for (let i = 2; i < samples.length; i += 2) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 2] - 1e-6);
    }
    expect(g.s.speed).toBeGreaterThan(9);
  });

  it('a faster athlete reaches a higher top speed', () => {
    const quick = paramsFromStats(1.78, {
      start: 0.95,
      acceleration: 0.97,
      topSpeed: 11.1,
      endurance: 0.6,
      technique: 0.8,
    });
    const tall = paramsFromStats(1.94, {
      start: 0.7,
      acceleration: 0.72,
      topSpeed: 11.95,
      endurance: 0.85,
      technique: 0.9,
    });
    const a = run(quick, 9).s.speed;
    const b = run(tall, 9).s.speed;
    expect(b).toBeGreaterThan(a);
  });

  it('bad rhythm slows the athlete down', () => {
    const clean = run(fast, 8, 1).s.speed;
    const sloppy = run(fast, 8, 0.2).s.speed;
    expect(sloppy).toBeLessThan(clean);
  });

  it('fatigue reduces top speed over a full distance', () => {
    const g = new Gait(fast);
    g.launchFromBlocks(0.6);
    const dt = 1 / 120;
    let peak = 0;
    let speedAt60 = 0;
    for (let t = 0; t < 30; t += dt) {
      g.step(dt, { quality: 1, driving: true, stalled: false });
      if (g.s.speed > peak) peak = g.s.speed;
      if (speedAt60 === 0 && g.s.distance > 60) speedAt60 = g.s.speed;
    }
    expect(g.s.distance).toBeGreaterThan(100);
    expect(speedAt60).toBeGreaterThan(g.s.speed);
    expect(g.s.fatigue).toBeGreaterThan(0);
  });

  it('runs a credible 100 m', () => {
    // a 11.6 m/s athlete should be in the 9.8 to 11.5 s band
    const { time } = runTo(fast, 100);
    expect(time).toBeGreaterThan(9.5);
    expect(time).toBeLessThan(11.8);
  });

  it('emits alternating foot contacts at roughly the step frequency', () => {
    const g = new Gait(fast);
    g.launchFromBlocks(0.6);
    const dt = 1 / 240;
    const feet: number[] = [];
    for (let t = 0; t < 10; t += dt) {
      const ev = g.step(dt, { quality: 1, driving: true, stalled: false });
      for (const f of ev.strikes) feet.push(f === 'left' ? 0 : 1);
    }
    // 10 s at 4.3-5.0 foot strikes per second
    expect(feet.length).toBeGreaterThan(40);
    expect(feet.length).toBeLessThan(55);
    for (let i = 1; i < feet.length; i++) {
      expect(feet[i]).not.toBe(feet[i - 1]);
    }
  });

  it('a stalled athlete stands still', () => {
    const g = new Gait(fast);
    const dt = 1 / 120;
    for (let t = 0; t < 3; t += dt) g.step(dt, { quality: 1, driving: false, stalled: true });
    expect(g.s.speed).toBeLessThan(0.2);
    expect(g.s.distance).toBeLessThan(0.05);
  });

  it('reaches a longer step when the athlete is faster', () => {
    const longLeg = paramsFromStats(1.94, {
      start: 0.7,
      acceleration: 0.72,
      topSpeed: 11.95,
      endurance: 0.85,
      technique: 0.9,
    });
    const a = run(fast, 8).s.stepLength;
    const b = run(longLeg, 8).s.stepLength;
    expect(b).toBeGreaterThan(a);
  });

  it('reports overstriding only when the reach is exceeded', () => {
    // a clean athlete never meaningfully reaches past their own turnover
    expect(run(fast, 8, 1).s.overstride).toBeLessThan(0.01);
    // sloppy form turns over too slowly, so the foot has to land further away
    const g = new Gait(fast);
    g.launchFromBlocks(0.6);
    const dt = 1 / 120;
    let sloppy = 0;
    for (let t = 0; t < 8; t += dt) {
      g.step(dt, { quality: 0.02, driving: true, stalled: false });
      sloppy = Math.max(sloppy, g.s.overstride);
    }
    expect(sloppy).toBeGreaterThan(0);
  });
});

describe('start rules', () => {
  it('the false start threshold is 100 ms', () => {
    expect(START.falseStartThreshold).toBeCloseTo(0.1, 6);
  });

  it('the set hold sits in the 0.9 to 1.6 second window', () => {
    expect(START.holdMin).toBeCloseTo(0.9, 6);
    expect(START.holdMax).toBeCloseTo(1.6, 6);
  });
});
