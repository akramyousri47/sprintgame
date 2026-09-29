/**
 * Animation tests: the things that make a procedural sprinter read as a
 * sprinter rather than a puppet.
 *
 * These are not regression guards on magic numbers so much as checks on the
 * *shape* of the motion, because shape is what the eye actually rejects:
 *   - an arm swing that reaches as far forward as it does back
 *   - an arm that pulses to a standstill between beats
 *   - an elbow locked at one angle
 *   - a head that tips over with a folded trunk
 *   - a swing leg that travels forward in a straight line
 *   - a trunk that is folded at the line and upright out of the blocks
 */

import { describe, expect, it } from 'vitest';
import { clipSprint } from '../src/biomechanics/pose';
import type { PoseContext, PoseMap } from '../src/biomechanics/pose';
import { footTarget, pelvisHeightFor, solveLegIK, stanceGeometry } from '../src/biomechanics/ik';
import { Gait } from '../src/biomechanics/gait';
import { paramsFromStats } from '../src/biomechanics/athlete';
import { GAIT, deg } from '../src/game/config';

const p = paramsFromStats(1.88, { start: 0.85, acceleration: 0.9, topSpeed: 11.6, endurance: 0.8, technique: 0.85 });

/** the sprint clip at maximum velocity, at a given stride phase */
function sprintAt(stridePhase: number, over: Partial<PoseContext> = {}): PoseMap {
  const ctx: PoseContext = {
    stridePhase,
    lean: GAIT.leanMaxVelocity,
    quality: 1,
    fatigue: 0,
    speed: 11,
    launch: 0,
    crouch: 0,
    t: 1,
    ...over,
  };
  const out: PoseMap = {};
  clipSprint(ctx, out);
  return out;
}

const angle = (pose: PoseMap, bone: string, axis: 'x' | 'y' | 'z'): number => deg(pose[bone]?.[axis] ?? 0);

describe('arm action', () => {
  it('drives the hand much further in front than behind the hip', () => {
    // the right arm leads with the left foot, so it peaks forward at phase 0
    const forward = angle(sprintAt(0), 'upperArmR', 'x');
    const back = angle(sprintAt(0.5), 'upperArmR', 'x');
    expect(forward).toBeLessThan(-55);
    expect(back).toBeGreaterThan(18);
    // flexion has to exceed extension: a symmetric swing is the puppet tell
    expect(-forward).toBeGreaterThan(back * 1.6);
  });

  it('swings continuously instead of pulsing between beats', () => {
    // a keyed track smooth-steps to a standstill at every key, which is
    // visible as the arm hitching; a warped cosine has no such dead point
    const N = 240;
    const shoulder: number[] = [];
    for (let i = 0; i <= N; i++) shoulder.push(angle(sprintAt(i / N), 'upperArmR', 'x'));
    let maxStep = 0;
    let maxTurn = 0;
    for (let i = 2; i < N; i++) {
      const a = shoulder[i] - shoulder[i - 1];
      maxStep = Math.max(maxStep, Math.abs(a));
      maxTurn = Math.max(maxTurn, Math.abs(a - (shoulder[i - 1] - shoulder[i - 2])));
    }
    expect(maxStep).toBeGreaterThan(0.5);
    expect(maxTurn).toBeLessThan(maxStep * 0.2);
  });

  it('folds the elbow as the hand drives up and straightens it at the back', () => {
    const forward = Math.abs(angle(sprintAt(0), 'foreArmR', 'x'));
    const back = Math.abs(angle(sprintAt(0.5), 'foreArmR', 'x'));
    expect(forward).toBeGreaterThan(85);
    expect(back).toBeGreaterThan(55);
    expect(back).toBeLessThan(forward);
  });

  it('swings the two arms in true antiphase', () => {
    // the arms are half a cycle apart, so the pair always sums to a constant:
    // the mean of the two is just the offset between flexion and extension
    let sum = 0;
    for (let i = 0; i < 64; i++) {
      const l = angle(sprintAt(i / 64), 'upperArmL', 'x');
      const r = angle(sprintAt(i / 64), 'upperArmR', 'x');
      if (i === 0) sum = l + r;
      expect(l + r).toBeCloseTo(sum, 6);
    }
    // ...and at the extremes one is fully forward while the other is fully back
    expect(angle(sprintAt(0), 'upperArmR', 'x')).toBeLessThan(-60);
    expect(angle(sprintAt(0), 'upperArmL', 'x')).toBeGreaterThan(20);
    expect(angle(sprintAt(0.5), 'upperArmL', 'x')).toBeLessThan(-60);
    expect(angle(sprintAt(0.5), 'upperArmR', 'x')).toBeGreaterThan(20);
  });

  it('keeps the arms inside the midline', () => {
    // adducted: the left arm (+z) and right arm (-z) lean toward each other
    expect(angle(sprintAt(0), 'upperArmL', 'z')).toBeGreaterThan(0);
    expect(angle(sprintAt(0), 'upperArmR', 'z')).toBeLessThan(0);
  });
});

describe('trunk posture', () => {
  it('holds the head level while the trunk is genuinely folded forward', () => {
    const pose = sprintAt(0, { lean: GAIT.leanMaxVelocity });
    const trunkPitch = angle(pose, 'hips', 'x') + angle(pose, 'spine', 'x') + angle(pose, 'chest', 'x');
    const headPitch = trunkPitch + angle(pose, 'neck', 'x') + angle(pose, 'head', 'x');
    expect(trunkPitch).toBeGreaterThan(12);
    expect(trunkPitch).toBeLessThan(30);
    expect(Math.abs(headPitch)).toBeLessThan(6);
  });

  it('separates the shoulders from the hips', () => {
    const pose = sprintAt(0.25);
    expect(Math.sign(angle(pose, 'hips', 'y'))).not.toBe(Math.sign(angle(pose, 'chest', 'y')));
    expect(Math.abs(angle(pose, 'hips', 'y'))).toBeGreaterThan(4);
  });

  it('is folded out of the blocks and rises into the top-speed posture', () => {
    // the blocks push is a long lever over the front knee; as the force fades
    // the torso comes up. Folding *further* forward with speed is backwards
    const g = new Gait(p);
    g.launchFromBlocks(0.55);
    const dt = 1 / 120;
    let early = 0;
    for (let i = 0; i < 8 / dt; i++) {
      g.step(dt, { quality: 1, driving: true });
      if (i === Math.round(0.4 / dt)) early = g.s.lean;
    }
    expect(early).toBeGreaterThan(g.s.lean);
    expect(early).toBeGreaterThan(GAIT.leanMaxVelocity);
    expect(g.s.lean).toBeGreaterThan(GAIT.leanUpright);
    expect(g.s.lean).toBeLessThanOrEqual(GAIT.leanDrive);
  });
});

describe('swing-leg recovery', () => {
  const geo = stanceGeometry(p.limb, p.limb.hipHeight, 11, GAIT.contactMin, 0.5);
  const pelvisY = pelvisHeightFor(p.limb, geo.contactReach, 0, 0.5, 0);

  it('folds the knee heel-to-butt in flight instead of swinging straight', () => {
    let peakKnee = 0;
    for (let phase = 0.4; phase <= 1; phase += 0.01) {
      const t = footTarget(phase, 0.4, geo, 11);
      peakKnee = Math.max(peakKnee, solveLegIK(pelvisY, 0, t.y, t.z, p.limb.thigh, p.limb.shank).knee);
    }
    expect(deg(peakKnee)).toBeGreaterThan(GAIT.kneeFlexionMax * 0.9);
    // and the fold must not be a hyperextension
    expect(deg(peakKnee)).toBeLessThan(140);
  });

  it('brings the heel back behind the hip at the top of the fold', () => {
    const rec = footTarget(0.7, 0.4, geo, 11);
    expect(rec.z).toBeLessThan(0);
    expect(rec.y).toBeGreaterThan(geo.recoveryY * 0.5);
  });

  it('keeps the leg forward-driving after the fold, so the foot strikes ahead', () => {
    // the fold is the recovery, but the leg has to arrive at the strike point:
    // the ankle has to still be moving forward in the last third of flight
    const late = footTarget(0.92, 0.4, geo, 11);
    expect(late.z).toBeGreaterThan(footTarget(0.7, 0.4, geo, 11).z);
    expect(late.z).toBeGreaterThan(0);
  });

  it('shallow, and a limp suppresses the fold', () => {
    const full = footTarget(0.62, 0.4, geo, 11, 0);
    const limp = footTarget(0.62, 0.4, geo, 11, 1);
    expect(limp.y).toBeLessThan(full.y);
  });
});
