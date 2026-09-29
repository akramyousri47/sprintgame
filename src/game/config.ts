/**
 * Global Sprint Games — central tuning.
 *
 * Everything a designer might want to touch lives here. Values are taken from
 * published sprint biomechanics (Nielsen et al. ground-contact studies, Baumann
 * stride-length/velocity profiles) and are documented in README.md.
 *
 * NOTE ON TERMINOLOGY: in this codebase a *step* is one foot strike and a
 * *stride* is two steps. The design brief specifies "stride frequency 4.3-5 Hz"
 * together with "stride length 2.2-2.5 m" and v = f x L = 10-12 m/s, which is
 * only self-consistent when both numbers refer to a single foot strike, so
 * `stepFrequencyHz` (4.3-5.0) and `stepLength` (2.2-2.5) are used and the
 * relationship v = f x L is enforced in the gait solver.
 */

/* ------------------------------------------------------------------ */
/* track                                                               */
/* ------------------------------------------------------------------ */
export const TRACK = {
  laneWidth: 1.22,
  lanes: 8,
  /** 100 m of running distance; the physical straight is slightly longer. */
  raceDistance: 100,
  backStraight: 42,
  runoff: 26,
  kerbWidth: 1.1,
  trackThickness: 0.02,
} as const;

/* ------------------------------------------------------------------ */
/* biomechanics                                                        */
/* ------------------------------------------------------------------ */
export const GAIT = {
  /** horizontal distance covered by one foot strike, m */
  stepLengthMin: 2.2,
  stepLengthMax: 2.5,
  /** foot strikes per second */
  stepFreqMin: 4.3,
  stepFreqMax: 5.0,
  /** seconds one foot spends on the ground */
  contactMin: 0.09,
  contactMax: 0.11,
  /** seconds between the two contacts of a single stride */
  flightMax: 0.12,

  /** pelvis vertical oscillation, m (half peak-to-peak) */
  pelvisRise: 0.045,
  /**
   * Trunk pitch from vertical, degrees. A sprinter is *not* upright at speed:
   * published 100 m kinematics put the trunk at roughly 20-25 deg at maximum
   * velocity and at 40-45 deg while driving out of the blocks, where the torso
   * is still folded over the front knee. The posture therefore *rises* as the
   * athlete accelerates, which is the opposite of folding further forward.
   */
  leanUpright: 8,
  leanMaxVelocity: 24,
  leanDrive: 42,
  leanCrouch: 84,

  /** maximum hip flexion during the drive/swing, degrees */
  hipFlexionMax: 105,
  /** maximum knee flexion in flight recovery, degrees (heel to seat) */
  kneeFlexionMax: 118,
  /** rear-leg knee flexion in the set position */
  setFrontKnee: 90,
  setRearKnee: 130,

  /** foot target: this far in front of the hip at contact, m */
  stepReach: 0.32,
  /** the landing foot passes under the centre of mass at max velocity */
  footUnderCom: 0.94,

  /**
   * Arm action, degrees. The swing is deliberately *asymmetric*: the hand
   * travels from fully extended behind the hip to roughly level with the
   * sternum in front, so flexion always exceeds extension. A symmetric swing
   * is the single clearest tell of a puppet.
   */
  /** shoulder flexion at the forward peak */
  armForward: 78,
  /** shoulder extension at the backward peak */
  armBack: 38,
  /** mean elbow flexion through the swing */
  armElbow: 84,
  /** how far the elbow flexes/extends either side of that mean */
  armElbowSwing: 20,
  /** how much the arm adducts, so the hands pass close to the midline */
  armAdduct: 7,
  /** phase warp that makes the arm ease through the front and snap through the back */
  armDriveBias: 0.16,

  /** stance fraction of a step (contact / period) at top speed */
  stanceTopSpeed: 0.45,
  /** ...and off the blocks */
  stanceStart: 0.62,
} as const;

export const START = {
  /** reaction below this = false start */
  falseStartThreshold: 0.1,
  /** random hold between "Set" and the gun */
  holdMin: 0.9,
  holdMax: 1.6,
  /** blocks: time from gun to the athlete leaving the blocks */
  blockTime: 0.42,
  /** reaction time distribution for a human (mean 0.24 s) */
  reactionMean: 0.24,
  reactionSigma: 0.05,
  reactionBest: 0.101,
  /** 0-30 m is the acceleration phase */
  accelPhaseEnd: 30,
  /** 30-60 m is maximum velocity */
  maxVelPhaseEnd: 60,
} as const;

export const FINISH = {
  /** the "dip" window: last N metres */
  dipWindow: 15,
  dipBonusTime: 0.14,
  dipLeanDeg: 24,
  /** slow-motion factor of the photo-finish replay */
  replaySlowMo: 0.25,
  replayWindow: 2.4,
} as const;

export const WIND = {
  legalLimit: 2.0,
  /** seconds gained per m/s of head wind above the limit (0.1 s at +2.0) */
  penaltyPerMs: 0.05,
} as const;

/* ------------------------------------------------------------------ */
/* rhythm mechanic                                                    */
/* ------------------------------------------------------------------ */
export const RHYTHM = {
  /** a tap within this window (s) of the ideal contact instant is perfect */
  perfectWindow: 0.045,
  goodWindow: 0.095,
  okWindow: 0.15,
  /** tapping faster than this (s between taps) is "mashing" */
  mashInterval: 0.13,
  /** stride-quality loss from mashing */
  mashOverstride: 0.55,
  /** cadence multiplier from mashing (overstriding = slower turnover) */
  mashCadence: 0.72,
  /** quality below this starts degrading posture */
  qualityFloor: 0.35,
} as const;

/* ------------------------------------------------------------------ */
/* athlete stat model                                                 */
/* ------------------------------------------------------------------ */
export const STAT_RANGE = {
  start: [0.55, 0.98] as const,
  acceleration: [0.6, 0.99] as const,
  topSpeed: [10.1, 12.1] as const,
  endurance: [0.45, 0.98] as const,
  technique: [0.5, 0.99] as const,
} as const;

export const FATIGUE = {
  /** fatigue accumulates once past the max-velocity phase */
  onset: START.maxVelPhaseEnd,
  /** fraction of top speed lost over the final 40 m at endurance = 0.5 */
  endLoss: 0.055,
  /** per-stride quality penalty at full fatigue */
  qualityPenalty: 0.3,
} as const;

/* ------------------------------------------------------------------ */
/* rendering                                                          */
/* ------------------------------------------------------------------ */
export type QualityName = 'low' | 'medium' | 'high';

export interface QualityPreset {
  shadows: boolean;
  shadowMapSize: number;
  crowdCount: number;
  anisotropy: number;
  pixelRatioCap: number;
  trackDetail: number;
  postShake: boolean;
  rain: boolean;
}

export const QUALITY: Record<QualityName, QualityPreset> = {
  low: {
    shadows: false,
    shadowMapSize: 512,
    crowdCount: 900,
    anisotropy: 1,
    pixelRatioCap: 1,
    trackDetail: 24,
    postShake: false,
    rain: false,
  },
  medium: {
    shadows: true,
    shadowMapSize: 1024,
    crowdCount: 3200,
    anisotropy: 4,
    pixelRatioCap: 1.35,
    trackDetail: 48,
    postShake: true,
    rain: true,
  },
  high: {
    shadows: true,
    shadowMapSize: 2048,
    crowdCount: 7000,
    anisotropy: 8,
    pixelRatioCap: 2,
    trackDetail: 96,
    postShake: true,
    rain: true,
  },
};

/** dynamic resolution: renderer scale adapts to keep the frame budget */
export const DYN_RES = {
  min: 0.62,
  max: 1,
  targetFrameMs: 15.5,
  adjustRate: 0.06,
} as const;

export const CAMERA = {
  fovBase: 52,
  fovMaxAdd: 16,
  /** positional smoothing, higher = tighter follow */
  follow: 7.5,
  aimFollow: 9,
} as const;

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const invLerp = (a: number, b: number, v: number): number =>
  a === b ? 0 : clamp((v - a) / (b - a), 0, 1);
/** frame-rate independent exponential smoothing toward a target */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));
export const rad = (deg: number): number => (deg * Math.PI) / 180;
export const deg = (r: number): number => (r * 180) / Math.PI;

/** deterministic PRNG so races can be replayed / verified */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 0x2f6e2b1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}
