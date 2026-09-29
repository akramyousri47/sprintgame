/**
 * Athlete model: morphometry + performance parameters.
 *
 * Segment lengths are anthropometric fractions of standing height (Winter,
 * De Leva) so a 1.62 m sprinter and a 1.94 m sprinter are genuinely different
 * machines — short levers, faster turnover, versus long levers, longer stride.
 */

import { clamp, lerp, makeRng, rad } from '../game/config';
import { GAIT, START, STAT_RANGE } from '../game/config';

export interface AthleteStats {
  /** explosive start: reaction + block push, 0..1 */
  start: number;
  /** 0-30 m, 0..1 */
  acceleration: number;
  /** m/s */
  topSpeed: number;
  /** resistance to the final-40 m decay, 0..1 */
  endurance: number;
  /** rhythm forgiveness / ceiling on stride quality, 0..1 */
  technique: number;
}

export interface Limb {
  /** hip joint to knee */
  thigh: number;
  /** knee to ankle */
  shank: number;
  /** ankle to toe */
  foot: number;
  /** shoulder to elbow */
  upperArm: number;
  /** elbow to wrist */
  foreArm: number;
  hand: number;
  /** pelvis height when standing */
  hipHeight: number;
  /** shoulder width */
  shoulderWidth: number;
  hipWidth: number;
  torso: number;
  neck: number;
  headRadius: number;
}

export interface AthleteParams {
  height: number;
  limb: Limb;
  maxSpeed: number;
  stepLengthMax: number;
  stepFreqMax: number;
  accel: number;
  start: number;
  endurance: number;
  technique: number;
}

/** anthropometric fractions of stature */
export function limbFromHeight(height: number): Limb {
  const l: Limb = {
    thigh: height * 0.245,
    shank: height * 0.246,
    foot: height * 0.152,
    upperArm: height * 0.186,
    foreArm: height * 0.146,
    hand: height * 0.108,
    hipHeight: height * 0.53,
    shoulderWidth: height * 0.259,
    hipWidth: height * 0.191,
    torso: height * 0.29,
    neck: height * 0.055,
    headRadius: height * 0.072,
  };
  return l;
}

export function paramsFromStats(height: number, st: AthleteStats): AthleteParams {
  const limb = limbFromHeight(height);
  // taller athletes have a higher step-length ceiling (longer levers)
  const heightBonus = clamp((height - 1.62) / 0.32, 0, 1);
  return {
    height,
    limb,
    maxSpeed: st.topSpeed,
    stepLengthMax: clamp(GAIT.stepLengthMin + 0.18 * heightBonus + 0.1 * st.technique, GAIT.stepLengthMin, GAIT.stepLengthMax),
    stepFreqMax: lerp(GAIT.stepFreqMin, GAIT.stepFreqMax, st.acceleration * 0.35 + st.technique * 0.65),
    accel: st.acceleration,
    start: st.start,
    endurance: st.endurance,
    technique: st.technique,
  };
}

/** clamp a stat block into the documented ranges */
export function normaliseStats(s: AthleteStats): AthleteStats {
  return {
    start: clamp(s.start, ...STAT_RANGE.start),
    acceleration: clamp(s.acceleration, ...STAT_RANGE.acceleration),
    topSpeed: clamp(s.topSpeed, ...STAT_RANGE.topSpeed),
    endurance: clamp(s.endurance, ...STAT_RANGE.endurance),
    technique: clamp(s.technique, ...STAT_RANGE.technique),
  };
}

/**
 * Human reaction time to a starter's gun: right-skewed, ~0.24 s mean,
 * hard floor at 0.101 s (anything under that is a false start, not a human).
 */
export function sampleReaction(rng: () => number, ability: number): number {
  // Box-Muller, shifted by the athlete's `start` rating
  const u1 = Math.max(1e-6, rng());
  const u2 = rng();
  const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mean = lerp(START.reactionMean + 0.075, START.reactionMean - 0.045, ability);
  const t = mean + g * START.reactionSigma;
  return clamp(t, START.reactionBest, 0.42);
}

/** block push: velocity gained in the first `START.blockTime` seconds */
export function blockPush(ability: number, height: number): number {
  // heavier athletes launch harder, better technique converts it
  const massFactor = clamp((height - 1.62) / 0.32, 0, 1);
  return lerp(2.5, 4.4, ability) * lerp(0.92, 1.06, massFactor);
}

export function seededRng(seed: number): () => number {
  return makeRng(seed);
}

export const degreesToRad = rad;
