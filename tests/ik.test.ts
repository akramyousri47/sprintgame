/**
 * IK tests: the leg solver has to be valid, respect its reach, and place the
 * foot so the shoe never skates.
 *
 * The solver returns bone rotations rather than joint positions, so these
 * checks reconstruct the joint positions from the returned angles and verify
 * the two-bone geometry, which is the property that actually has to hold.
 */

import { describe, expect, it } from 'vitest';
import { ANKLE_REST, footTarget, pelvisHeightFor, solveLegIK, stanceGeometry } from '../src/biomechanics/ik';
import { paramsFromStats } from '../src/biomechanics/athlete';
import { GAIT, rad } from '../src/game/config';

const p = paramsFromStats(1.88, { start: 0.85, acceleration: 0.9, topSpeed: 11.6, endurance: 0.8, technique: 0.85 });

/**
 * Rebuild the knee and ankle from the bone rotations. The thigh rotates about
 * X from straight down, then the shank adds the knee flexion.
 */
function joints(hipY: number, hipZ: number, sol: { thigh: number; knee: number }) {
  // thigh tip: rotate (0,-l1,0) by `thigh` about X
  const kneeY = hipY - p.limb.thigh * Math.cos(sol.thigh);
  const kneeZ = hipZ - p.limb.thigh * Math.sin(sol.thigh);
  // shank direction continues from the thigh, then flexes by the knee angle
  const a = sol.thigh + sol.knee;
  const ankleY = kneeY - p.limb.shank * Math.cos(a);
  const ankleZ = kneeZ - p.limb.shank * Math.sin(a);
  return { knee: [kneeY, kneeZ], ankle: [ankleY, ankleZ] };
}

// every case here has to be inside the leg's reach, otherwise the solver is
// *meant* to clamp and the ankle deliberately misses the target
const LIMITS = [
  { hipY: 0.9, hipZ: 0, footY: 0.075, footZ: 0.3 },
  { hipY: 0.9, hipZ: 0, footY: 0.075, footZ: -0.3 },
  { hipY: 0.85, hipZ: 0.1, footY: 0.1, footZ: 0.4 },
  { hipY: 0.8, hipZ: -0.2, footY: 0.075, footZ: 0.15 },
  { hipY: 0.9, hipZ: 0, footY: 0.2, footZ: 0.4 },
];

describe('solveLegIK', () => {
  it('holds the thigh and shank lengths for every reachable target', () => {
    for (const c of LIMITS) {
      const sol = solveLegIK(c.hipY, c.hipZ, c.footY, c.footZ, p.limb.thigh, p.limb.shank);
      const j = joints(c.hipY, c.hipZ, sol);
      const thigh = Math.hypot(j.knee[0] - c.hipY, j.knee[1] - c.hipZ);
      const shank = Math.hypot(j.ankle[0] - j.knee[0], j.ankle[1] - j.knee[1]);
      expect(thigh).toBeCloseTo(p.limb.thigh, 4);
      expect(shank).toBeCloseTo(p.limb.shank, 4);
    }
  });

  it('lands the ankle on the target', () => {
    for (const c of LIMITS) {
      const sol = solveLegIK(c.hipY, c.hipZ, c.footY, c.footZ, p.limb.thigh, p.limb.shank);
      const j = joints(c.hipY, c.hipZ, sol);
      expect(j.ankle[0]).toBeCloseTo(c.footY, 3);
      expect(j.ankle[1]).toBeCloseTo(c.footZ, 3);
    }
  });

  it('bulges the knee to the +z side of the hip-foot line for a sprint', () => {
    // the knee is judged against the straight hip->foot line, not against z=0:
    // a foot behind the hip puts that line behind the hip too
    for (const footZ of [0.45, 0.2, -0.2, -0.45]) {
      const hipY = 0.9;
      const sol = solveLegIK(hipY, 0, ANKLE_REST, footZ, p.limb.thigh, p.limb.shank, 1);
      const j = joints(hipY, 0, sol);
      const onLine = footZ * ((hipY - j.knee[0]) / (hipY - ANKLE_REST));
      expect(j.knee[1]).toBeGreaterThan(onLine);
    }
  });

  it('mirrors the solution for the opposite pole', () => {
    const hipY = 0.9;
    const fwd = solveLegIK(hipY, 0, ANKLE_REST, 0.3, p.limb.thigh, p.limb.shank, 1);
    const back = solveLegIK(hipY, 0, ANKLE_REST, 0.3, p.limb.thigh, p.limb.shank, -1);
    const jf = joints(hipY, 0, fwd);
    const jb = joints(hipY, 0, back);
    // the mirror puts the knee on the other side but still hits the foot
    const onLine = 0.3 * ((hipY - jb.knee[0]) / (hipY - ANKLE_REST));
    expect(jb.knee[1]).toBeLessThan(onLine);
    expect(jb.ankle[0]).toBeCloseTo(ANKLE_REST, 3);
    expect(jb.ankle[1]).toBeCloseTo(0.3, 3);
    expect(jf.knee[1]).toBeGreaterThan(onLine);
  });

  it('clamps a target beyond the reach rather than producing nonsense', () => {
    const far = { hipY: 0.9, hipZ: 0, footY: 0.9, footZ: 6 };
    const sol = solveLegIK(far.hipY, far.hipZ, far.footY, far.footZ, p.limb.thigh, p.limb.shank);
    const j = joints(far.hipY, far.hipZ, sol);
    for (const v of [...j.knee, ...j.ankle]) expect(Number.isFinite(v)).toBe(true);
    // the leg is fully extended, so there is essentially no knee bend left
    expect(sol.reach).toBeGreaterThan(1);
    expect(sol.knee).toBeLessThan(0.05);
  });

  it('reports reach as the fraction of full extension', () => {
    const folded = solveLegIK(0.9, 0, 0.85, 0.05, p.limb.thigh, p.limb.shank);
    const straight = solveLegIK(0.9, 0, 0.2, 0.4, p.limb.thigh, p.limb.shank);
    expect(folded.reach).toBeLessThan(straight.reach);
    // a target inside the leg's reach can never need more than all of it
    expect(straight.reach).toBeLessThanOrEqual(1);
  });

  it('never reports a negative knee angle', () => {
    for (let fz = -0.8; fz <= 0.8; fz += 0.05) {
      const sol = solveLegIK(0.9, 0, ANKLE_REST, fz, p.limb.thigh, p.limb.shank);
      expect(sol.knee).toBeGreaterThanOrEqual(0);
      expect(sol.knee).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});

describe('stanceGeometry', () => {
  it('never asks for more reach than the leg has at a running hip height', () => {
    const leg = p.limb.thigh + p.limb.shank;
    for (const strikeFraction of [0, 0.5, 1]) {
      for (const hipY of [0.7, 0.9, 1.05]) {
        const geo = stanceGeometry(p.limb, hipY, 11, 0.1, strikeFraction);
        // stanceGeometry works from the hip lowered into the running posture
        const spanY = Math.max(0.2, hipY * 0.88 - ANKLE_REST);
        const maxReach = Math.sqrt(Math.max(0.01, leg * leg - spanY * spanY));
        expect(geo.contactReach).toBeLessThanOrEqual(maxReach + 1e-6);
        expect(geo.contactReach).toBeGreaterThan(0);
      }
    }
  });

  it('leaves the ankle somewhere plantable behind the hip', () => {
    for (const speed of [4, 8, 11, 12.5]) {
      const geo = stanceGeometry(p.limb, p.limb.hipHeight, speed, GAIT.contactMax, 0.5);
      expect(geo.behindLimit).toBeGreaterThan(0);
      // at sprint speed the raw roll-over lands further back than the leg can
      // reach, which is exactly the case the cap exists for
      const raw = geo.contactReach + geo.roll - geo.slip;
      if (speed >= 11) expect(raw).toBeLessThan(-geo.behindLimit);
      // and the ankle is never asked to go further back than that
      expect(footTarget(0.399, 0.4, geo, speed).z).toBeGreaterThanOrEqual(-geo.behindLimit);
    }
  });

  it('grows the strike reach through the stride', () => {
    const early = stanceGeometry(p.limb, 0.9, 11, 0.1, 0.1);
    const late = stanceGeometry(p.limb, 0.9, 11, 0.1, 0.9);
    expect(late.contactReach).toBeGreaterThan(early.contactReach);
  });

  it('reports slip as speed times contact time', () => {
    const geo = stanceGeometry(p.limb, 0.9, 11, 0.1, 0.5);
    expect(geo.slip).toBeCloseTo(1.1, 6);
  });
});

describe('footTarget', () => {
  const geo = stanceGeometry(p.limb, 0.9, 11, 0.1, 0.5);

  it('keeps the foot on or above the track through the whole stride', () => {
    for (let phase = 0; phase <= 1.0001; phase += 0.01) {
      const t = footTarget(phase, 0.4, geo, 11);
      expect(t.y).toBeGreaterThanOrEqual(ANKLE_REST - 1e-6);
    }
  });

  it('rolls the ankle from dorsiflexion to plantarflexion through stance', () => {
    const atContact = footTarget(0.001, 0.4, geo, 11);
    const atToeOff = footTarget(0.399, 0.4, geo, 11);
    expect(atContact.pitch).toBeLessThan(0);
    expect(atToeOff.pitch).toBeGreaterThan(0);
  });

  it('loads the foot during stance and unloads it in flight', () => {
    const stance = footTarget(0.15, 0.4, geo, 11);
    const flight = footTarget(0.7, 0.4, geo, 11);
    expect(stance.load).toBeGreaterThan(0);
    expect(flight.load).toBe(0);
  });

  it('lifts the foot clear of the track in flight', () => {
    const peak = footTarget(0.62, 0.4, geo, 11);
    const stance = footTarget(0.05, 0.4, geo, 11);
    expect(peak.y).toBeGreaterThan(stance.y);
  });

  it('holds the foot still in the world while the body runs past it', () => {
    // in hip space the ankle travels backward as the body passes over the
    // planted ball; the world position must stay put apart from the roll-over
    const first = footTarget(0.001, 0.4, geo, 11);
    const last = footTarget(0.399, 0.4, geo, 11);
    expect(last.z).toBeLessThan(first.z);
    // the ankle never leaves the ground, and never ends up behind the leg's reach
    const dropped = first.z - last.z;
    expect(dropped).toBeGreaterThan(0);
    expect(last.z).toBeGreaterThanOrEqual(-geo.behindLimit);
  });

  it('is deterministic and clamps out-of-range phases', () => {
    expect(footTarget(0.3, 0.4, geo, 11)).toEqual(footTarget(0.3, 0.4, geo, 11));
    const low = footTarget(-5, 0.4, geo, 11);
    const high = footTarget(5, 0.4, geo, 11);
    for (const t of [low, high]) {
      expect(Number.isFinite(t.y)).toBe(true);
      expect(Number.isFinite(t.z)).toBe(true);
      expect(Number.isFinite(t.pitch)).toBe(true);
    }
  });

  it('a limp keeps the foot down through flight', () => {
    const normal = footTarget(0.62, 0.4, geo, 11, 0);
    const limp = footTarget(0.62, 0.4, geo, 11, 1);
    expect(limp.y).toBeLessThan(normal.y);
  });
});

describe('pelvisHeightFor', () => {
  // the real reach the animator asks for: the stance strike point
  const REACH = stanceGeometry(p.limb, p.limb.hipHeight, 11, GAIT.contactMax, 0.5).contactReach;

  it('keeps the hips inside a plausible band while running', () => {
    for (const stridePhase of [0, 0.2, 0.4, 0.6, 0.8]) {
      const h = pelvisHeightFor(p.limb, REACH, 1, stridePhase, 0);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(p.limb.hipHeight * 0.7);
      expect(h).toBeLessThanOrEqual(p.limb.hipHeight);
    }
  });

  it('bobs no more than a few centimetres', () => {
    const hs = [0, 0.2, 0.4, 0.6, 0.8].map((ph) => pelvisHeightFor(p.limb, REACH, 1, ph, 0));
    expect(Math.max(...hs) - Math.min(...hs)).toBeLessThan(0.12);
  });

  it('drops lower in a crouch', () => {
    const tall = pelvisHeightFor(p.limb, REACH, 1, 0.25, 0);
    const low = pelvisHeightFor(p.limb, REACH, 1, 0.25, 1);
    expect(low).toBeLessThan(tall);
    expect(low).toBeGreaterThan(0.2);
  });

  it('folds the hips forward in the drive and stands tall at top speed', () => {
    // hip height peaks near top speed: a folded acceleration posture is lower
    const driving = pelvisHeightFor(p.limb, REACH, 1, 0.2, 0);
    const sprinting = pelvisHeightFor(p.limb, REACH, 0, 0.2, 0);
    expect(sprinting).toBeGreaterThan(driving);
  });

  it('keeps the foot inside the leg\'s reach for every phase it asks for', () => {
    const geo = stanceGeometry(p.limb, p.limb.hipHeight, 11, GAIT.contactMax, 0.5);
    const pelvisY = pelvisHeightFor(p.limb, geo.contactReach, 1, 0, 0);
    for (let phase = 0; phase <= 1; phase += 0.02) {
      const t = footTarget(phase, 0.4, geo, 11);
      const sol = solveLegIK(pelvisY, 0, t.y, t.z, p.limb.thigh, p.limb.shank);
      expect(sol.reach).toBeLessThanOrEqual(1);
    }
  });
});

describe('the two agree', () => {
  it('a foot target is always reachable from the pelvis height it implies', () => {
    for (let strikeFraction = 0.1; strikeFraction <= 1; strikeFraction += 0.1) {
      for (const speed of [4, 8, 11, 12.5]) {
        const geo = stanceGeometry(p.limb, p.limb.hipHeight, speed, GAIT.contactMax, strikeFraction);
        const pelvisY = pelvisHeightFor(p.limb, geo.contactReach, 1, 0, 0);
        const t = footTarget(0.001, 0.4, geo, speed);
        const sol = solveLegIK(pelvisY, 0, t.y, t.z, p.limb.thigh, p.limb.shank);
        // the foot is inside the leg's reach, so the knee keeps a real bend
        expect(sol.reach).toBeLessThan(1);
        expect(sol.knee).toBeGreaterThan(0);
      }
    }
  });
});
