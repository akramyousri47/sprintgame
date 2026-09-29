/**
 * Sprint gait solver.
 *
 * Models one athlete's locomotion from blocks to the line as a kinematic
 * system rather than a canned animation:
 *
 *   velocity  v = f x L      (step frequency x step length)
 *   period   T = 1 / f      (one foot strike to the next)
 *   contact           t_contact  ~ 0.09-0.11 s   (decreases with speed)
 *   flight            t_flight   ~ 0.12 s
 *   stance fraction   = t_contact / T
 *
 * The stride phase is integrated from distance travelled, never from a clock,
 * so the feet stay welded to the track no matter how the speed changes — that
 * is what makes foot IK meaningful rather than decorative.
 */

import { GAIT, START, FATIGUE, RHYTHM, clamp, lerp, smoothstep, invLerp } from '../game/config';
import type { AthleteParams } from './athlete';

export type Foot = 'left' | 'right';

export interface GaitInput {
  /** 0..1 stride quality from the rhythm mechanic (1 = perfect) */
  quality: number;
  /** true while the player is actively driving (holding/tapping) */
  driving: boolean;
  /** airborne/limp for a false start or a fall */
  stalled?: boolean;
}

export interface GaitEvent {
  /** the first foot to strike the track this frame, if any */
  contact: Foot | null;
  /** every strike this frame: a long frame can contain more than one */
  strikes: Foot[];
  /** contact duration of the strike that just happened, seconds */
  contactDuration: number;
  /** horizontal speed at the strike, m/s */
  speedAtContact: number;
  /** step length of the strike that just happened, m */
  stepAtContact: number;
}

export interface GaitState {
  /** metres from the start line */
  distance: number;
  /** m/s */
  speed: number;
  /** 0..1 through a full stride; 0 = left foot strikes, 0.5 = right */
  stridePhase: number;
  /** current foot strikes per second */
  stepFreq: number;
  /** current metres per foot strike */
  stepLength: number;
  contactTime: number;
  flightTime: number;
  stanceFraction: number;
  /** 0 = mid-stance support, 1 = toe-off */
  stanceT: number;
  quality: number;
  fatigue: number;
  /** seconds spent driving since the gun, used for the acceleration curve */
  driveTime: number;
  /** speed handed over by the blocks, decaying out of the acceleration phase */
  blockExit: number;
  /** metres of step taken beyond the athlete's own reach, 0 when clean */
  overstride: number;
  /** trunk pitch, degrees */
  lean: number;
  /** 0 = upright, 1 = full drive lean */
  driveAmount: number;
  /** seconds until the expected (next) foot strike */
  timeToStrike: number;
  maxSpeed: number;
}

const emptyEvent = (): GaitEvent => ({
  contact: null,
  strikes: [],
  contactDuration: 0,
  speedAtContact: 0,
  stepAtContact: 0,
});

export class Gait {
  readonly p: AthleteParams;
  readonly s: GaitState;
  /** which foot the player is expected to strike next */
  expected: Foot = 'left';
  /** the foot that struck most recently, for the HUD and the replay samples */
  lastContact: Foot | null = null;
  /** monotonic stride counter, advanced by distance, 1 unit = one full stride */
  private stepCount = 0;
  /** how many individual foot strikes have gone by, used to fire contacts */
  private lastStepIndex = -1;
  /** speed at the most recent foot strike, m/s — HUD and debug readouts */
  lastContactSpeed = 0;
  /** step length of the most recent foot strike, m */
  lastStepLength = 0;
  private event: GaitEvent = emptyEvent();
  /** smoothed stride-length estimate for the HUD */
  private stepAccum = 0;
  private stepAccumN = 0;
  measuredStepLength = 0;

  constructor(p: AthleteParams) {
    this.p = p;
    this.s = {
      distance: 0,
      speed: 0,
      stridePhase: 0,
      stepFreq: GAIT.stepFreqMin,
      stepLength: GAIT.stepLengthMin,
      contactTime: GAIT.contactMax,
      flightTime: GAIT.flightMax,
      stanceFraction: GAIT.stanceStart,
      stanceT: 0,
      quality: 1,
      fatigue: 0,
      driveTime: 0,
      blockExit: 0,
      overstride: 0,
      lean: GAIT.leanDrive,
      driveAmount: 1,
      timeToStrike: 0,
      maxSpeed: p.maxSpeed,
    };
  }

  reset(): void {
    const s = this.s;
    s.distance = 0;
    s.speed = 0;
    s.stridePhase = 0;
    s.stanceT = 0;
    s.quality = 1;
    s.fatigue = 0;
    s.driveTime = 0;
    s.blockExit = 0;
    s.overstride = 0;
    s.lean = GAIT.leanDrive;
    s.driveAmount = 1;
    s.stanceFraction = GAIT.stanceStart;
    s.stepLength = GAIT.stepLengthMin;
    s.stepFreq = GAIT.stepFreqMin;
    this.expected = 'left';
    this.lastContact = null;
    this.lastStepIndex = -1;
    this.stepCount = 0;
    this.measuredStepLength = 0;
    this.event = emptyEvent();
  }

  /**
   * Velocity the athlete is *capable* of at this point in the race.
   * Exponential approach over the acceleration phase, plateau at maximum
   * velocity, fatigue decay over the final 40 m.
   */
  /**
   * The velocity the athlete can hold at this instant.
   *
   * Acceleration out of the blocks is a force against the ground integrated
   * over time, so the curve is driven by `driveTime` rather than distance: a
   * standing athlete accelerates from rest no matter how far they have covered.
   * `tau` is the time constant — a fast starter is up near 11 m/s inside 2 s.
   *
   * The block push sets the initial slope, and endurance takes the top end off
   * over the final phase of the race.
   */
  private envelope(): number {
    const s = this.s;
    const tau = lerp(2.7, 1.55, this.p.accel) * lerp(1.12, 1, this.p.start);
    let v = s.maxSpeed * (1 - Math.exp(-s.driveTime / tau));
    // the push out of the blocks is a floor the athlete can never sink below
    v = Math.max(v, s.blockExit * Math.exp(-s.driveTime / 0.55));
    if (s.distance > START.maxVelPhaseEnd) {
      const over = s.distance - START.maxVelPhaseEnd;
      const loss = FATIGUE.endLoss * (1 / Math.max(0.35, this.p.endurance));
      v *= 1 - Math.min(0.14, (over / 40) * loss);
    }
    return v;
  }

  /**
   * Step length the athlete can produce at their current speed.
   *
   * Kinematics says v = f x L, so length and frequency cannot both be free. The
   * clean approach is to drive *frequency* off the speed — cadence climbs
   * through the acceleration phase and plateaus at the athlete's own maximum —
   * and let the length fall out as v / f. That is why a standing athlete
   * shuffles in short, quick steps and a flying one reaches out.
   */
  /**
   * Step frequency the athlete can produce at their current speed: it climbs
   * with velocity out of the blocks and settles at their own maximum cadence.
   *
   * Losing rhythm is a turnover problem, not a reach problem: the legs stop
   * coming round as fast, so at the same speed the foot has to land further
   * away. Mashing is punished through the cadence drop, and the longer step it
   * forces is a real consequence, not a bolted-on speed penalty.
   */
  private cadenceFor(): number {
    const t = invLerp(0, this.p.maxSpeed, this.s.speed);
    const maxFreq = Math.min(GAIT.stepFreqMax, this.p.stepFreqMax);
    const clean = lerp(GAIT.stepFreqMin, maxFreq, smoothstep(t));
    const sloppy = Math.max(0, RHYTHM.qualityFloor - this.s.quality);
    return clean * (1 - sloppy * RHYTHM.mashCadence);
  }

  /**
   * The athlete's own maximum cadence — the turnover they could hold with
   * clean rhythm. A step longer than `speed / maxCadence` is by definition
   * overstriding.
   */
  get maxCadence(): number {
    return Math.min(GAIT.stepFreqMax, this.p.stepFreqMax);
  }

  /** the step the athlete takes at a given cadence, from v = f x L */
  stepLengthFor(freq: number): number {
    return freq > 0.05 ? Math.max(0.4, this.s.speed / freq) : 0;
  }

  /** the explosive push out of the blocks, handed over by the start rules */
  launchFromBlocks(v0: number): void {
    const s = this.s;
    // the block push is an exit velocity, not a nudge: the athlete leaves the
    // blocks at this speed and the acceleration curve builds on top of it
    s.speed = clamp(v0, 0.5, 5);
    s.blockExit = s.speed;
    s.driveTime = 0;
    s.driveAmount = 1;
    s.lean = GAIT.leanCrouch * 0.6;
    s.quality = 1;
    s.stridePhase = 0;
    s.stanceT = 0;
    this.lastStepIndex = -1;
    this.stepCount = 0;
  }

  step(dt: number, input: GaitInput): GaitEvent {
    const s = this.s;
    this.event = emptyEvent();

    if (input.stalled) {
      s.speed = Math.max(0, s.speed - 4 * dt);
    } else {
      /* --- quality feedback --------------------------------------- */
      const techBonus = lerp(0.78, 1, this.p.technique);
      s.quality = lerp(s.quality, clamp(input.quality, 0, 1) * techBonus, Math.min(1, dt * 12));

      /* --- fatigue: distance + poor form -------------------------- */
      const distFatigue = invLerp(FATIGUE.onset, 100, s.distance) * (1.25 - this.p.endurance);
      const formFatigue = Math.max(0, RHYTHM.qualityFloor - s.quality) * 2.2;
      s.fatigue = clamp(s.fatigue + (distFatigue * 0.22 + formFatigue * 0.5) * dt, 0, 1);

      /* --- target speed: envelope x posture quality ---------------- */
      s.driveTime += dt;
      const cap = this.envelope();
      s.maxSpeed = this.p.maxSpeed * (1 - FATIGUE.endLoss * 0.5 * s.fatigue * (1.5 - this.p.endurance));
      const target = input.driving ? cap * lerp(0.55, 1, s.quality) : cap * 0.82;

      // approach the target; good form accelerates harder. The exponential form
      // keeps the response frame-rate independent.
      const accel = input.driving ? lerp(4.2, 9.5, this.p.accel) * lerp(0.45, 1, s.quality) : 3.4;
      const decel = 6.5;
      const gap = target - s.speed;
      s.speed = clamp(
        s.speed + (gap > 0 ? gap * (1 - Math.exp(-accel * dt)) : -decel * dt),
        0,
        s.maxSpeed + 0.2,
      );
    }

    /* --- advance along the track ---------------------------------- */
    s.distance += s.speed * dt;

    /* --- stride timing: v = f x L --------------------------------- */
    s.stepFreq = this.cadenceFor();
    s.stepLength = this.stepLengthFor(s.stepFreq);
    // overstriding is the reach beyond what a clean turnover would need at the
    // same speed; the leg can physically get further, but not without cost
    s.overstride = Math.max(0, s.stepLength - this.stepLengthFor(this.maxCadence));

    // contact time falls as speed rises (stiffer leg, stiffer surface load)
    const sp = invLerp(0, this.p.maxSpeed, s.speed);
    s.contactTime = lerp(GAIT.contactMax, GAIT.contactMin, smoothstep(sp)) * lerp(1.12, 1, s.quality);
    const period = s.stepFreq > 0.05 ? 1 / s.stepFreq : 1;
    s.stanceFraction = clamp(s.contactTime / Math.max(0.01, period), 0.28, 0.72);
    s.flightTime = Math.max(0, period - s.contactTime);

    /* --- stride phase from distance, detect contacts --------------- */
    if (s.stepLength > 0.05) {
      // the phase is driven by distance, so the feet stay on the track however
      // the speed changes. One full stride is two foot strikes, so two steps of
      // phase per stride and `strikeIndex` counts individual foot strikes.
      const dPhase = (s.speed * dt) / (s.stepLength * 2);
      this.stepCount += dPhase;
      s.stridePhase = this.stepCount % 1;
      const strikes = Math.floor(this.stepCount * 2);
      if (this.lastStepIndex < 0) this.lastStepIndex = strikes;
      // a long frame can skip more than one strike, so catch up
      let guard = 8;
      while (this.lastStepIndex < strikes && guard-- > 0) {
        this.lastStepIndex++;
        const foot: Foot = this.lastStepIndex % 2 === 0 ? 'left' : 'right';
        this.expected = foot === 'left' ? 'right' : 'left';
        this.lastContact = foot;
        this.lastContactSpeed = s.speed;
        this.lastStepLength = s.stepLength;
        this.event.strikes.push(foot);
        this.event.contact ??= foot;
        this.event.contactDuration = s.contactTime;
        this.event.speedAtContact = s.speed;
        this.event.stepAtContact = s.stepLength;
        this.stepAccum += s.stepLength;
        this.stepAccumN++;
        if (this.stepAccumN >= 6) {
          this.measuredStepLength = this.stepAccum / this.stepAccumN;
          this.stepAccum = 0;
          this.stepAccumN = 0;
        }
      }
    }

    /* --- posture ---------------------------------------------------- */
    const dAcc = invLerp(0, START.accelPhaseEnd, s.distance);
    const dMax = invLerp(START.accelPhaseEnd, START.maxVelPhaseEnd, s.distance);
    s.driveAmount = clamp(1 - dAcc * 0.82 - dMax * 0.18, 0, 1);
    const leanTarget = lerp(
      GAIT.leanUpright,
      GAIT.leanDrive,
      Math.pow(1 - s.driveAmount, 1.5),
    );
    s.lean = lerp(s.lean, leanTarget, Math.min(1, dt * 5)) + s.fatigue * 2.5 * (1 - this.p.endurance);

    /* stanceT: 0 at contact -> 1 at toe-off, then flight */
    const inStance = (s.stridePhase % 0.5) / 0.5 < s.stanceFraction;
    s.stanceT = inStance ? clamp((s.stridePhase % 0.5) / 0.5 / s.stanceFraction, 0, 1) : 1;

    /* time until the expected foot must strike (rhythm window) */
    const phaseOfExpected = this.expected === 'left' ? 0 : 0.5;
    let d = phaseOfExpected - s.stridePhase;
    if (d < 0) d += 1;
    s.timeToStrike = d * period;

    return this.event;
  }

  /** top speed reached so far, m/s */
  topSpeed = 0;
  /** reaction time recorded at the gun, seconds */
  reactionTime = 0;

  get strideLength(): number {
    return this.measuredStepLength || this.s.stepLength;
  }
}

/* ------------------------------------------------------------------ */
/* rhythm grading                                                     */
/* ------------------------------------------------------------------ */
export type TapGrade = 'perfect' | 'good' | 'ok' | 'early' | 'mash';

export interface TapResult {
  grade: TapGrade;
  /** 0..1 */
  quality: number;
  /** seconds early (+) or late (-) relative to the ideal strike */
  error: number;
}

const GRADE_QUALITY: Record<TapGrade, number> = {
  perfect: 1,
  good: 0.84,
  ok: 0.6,
  early: 0.2,
  mash: 0.32,
};

/**
 * Grade a tap. `err` is the signed time to the expected foot strike:
 * positive = struck early, negative = struck late.
 */
export function gradeTap(err: number, interval: number): TapResult {
  const a = Math.abs(err);
  let grade: TapGrade;
  if (interval > 0 && interval < RHYTHM.mashInterval) grade = 'mash';
  else if (a <= RHYTHM.perfectWindow) grade = 'perfect';
  else if (a <= RHYTHM.goodWindow) grade = 'good';
  else if (a <= RHYTHM.okWindow) grade = 'ok';
  else grade = 'early';
  if (grade === 'mash') return { grade, quality: GRADE_QUALITY.mash, error: err };
  if (grade === 'perfect') return { grade, quality: 1, error: err };
  // quality falls off linearly to 0.2 by the edge of the ok window
  const t = clamp((a - RHYTHM.perfectWindow) / (RHYTHM.okWindow - RHYTHM.perfectWindow), 0, 1);
  return { grade, quality: lerp(1, GRADE_QUALITY[grade], t), error: err };
}
