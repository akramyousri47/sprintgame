/**
 * Procedural animation blend tree.
 *
 * Six clips contribute partial joint targets; a weight vector blends them.
 * The legs are NOT authored here — they are solved by foot IK — so these
 * clips own the upper body, the trunk mechanics and the posture, exactly the
 * layering a senior animator would use: IK underneath, procedural on top.
 *
 *   crouch ......... set position in the blocks
 *   launch ......... explosive drive out of the blocks
 *   sprint ......... maximum-velocity action
 *   celebrate ...... arms up, decelerating
 *   disappointed .. hands on knees
 *   cooldown ....... walking off
 */

import { GAIT, rad, lerp, clamp, smoothstep } from '../game/config';

export interface Euler {
  x?: number;
  y?: number;
  z?: number;
}

export type PoseMap = Record<string, Euler>;

export interface PoseContext {
  /** 0..1 through a full stride, 0 = left foot strikes */
  stridePhase: number;
  /** trunk pitch target, degrees */
  lean: number;
  /** 0..1 */
  quality: number;
  fatigue: number;
  speed: number;
  /** 1 while driving out of the blocks, decays to 0 */
  launch: number;
  /** 1 in the set position */
  crouch: number;
  /** absolute seconds, for idle clips */
  t: number;
}

export type Clip = (c: PoseContext, out: PoseMap) => void;

const set = (out: PoseMap, bone: string, x: number, y = 0, z = 0): void => {
  out[bone] = { x, y, z };
};

/** smooth keyframe track over a normalised phase */
function track(phase: number, keys: readonly (readonly [number, number])[]): number {
  const p = phase - Math.floor(phase);
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      let u = (p - t0) / Math.max(1e-5, t1 - t0);
      u = u * u * (3 - 2 * u);
      return lerp(v0, v1, u);
    }
  }
  return keys[keys.length - 1][1];
}

/* ------------------------------------------------------------------ */
/* clips                                                               */
/* ------------------------------------------------------------------ */

/** trunk: pelvis tilt, spine counter-rotation, head stabilisation */
function trunk(c: PoseContext, out: PoseMap, extraPitch = 0): void {
  const wobble = Math.sin(c.stridePhase * Math.PI * 2);
  // pelvic rotation drives the shoulders the other way — the classic
  // shoulder-hip separation that makes a sprint look like a sprint
  set(out, 'hips', rad(-c.lean * 0.22) + extraPitch, rad(wobble * 5.5), rad(wobble * 2.2));
  set(out, 'spine', rad(c.lean * 0.24), rad(-wobble * 4.5), rad(-wobble * 2.6));
  set(out, 'chest', rad(c.lean * 0.3), rad(-wobble * 5.5), rad(-wobble * 1.8));
  // the sprinter keeps the head level whatever the trunk does
  set(out, 'neck', rad(-c.lean * 0.42), rad(wobble * 2.2), 0);
  set(out, 'head', rad(-c.lean * 0.36), rad(wobble * 1.6), rad(wobble * 1.2));
}

export const clipSprint: Clip = (c, out) => {
  const drive = clamp(c.speed / 11, 0, 1);
  // poor rhythm folds the athlete forward and stiffens the arm action
  const slump = (1 - c.quality) * 8 + c.fatigue * 4;
  trunk({ ...c, lean: c.lean + slump }, out);
  for (const side of ['L', 'R'] as const) {
    // arms are contralateral: the arm driven by the opposite leg's phase
    const ph = (c.stridePhase + (side === 'L' ? 0.5 : 0)) % 1;
    const amp = GAIT.armSwing * lerp(0.82, 1.08, drive) * lerp(0.8, 1, c.quality);
    const sh = track(ph, [
      [0, amp * 0.5],
      [0.25, amp * 0.24],
      [0.5, -amp * 0.44],
      [0.75, -amp * 0.52],
      [1, amp * 0.5],
    ]);
    const elbow = track(ph, [
      [0, GAIT.armElbow],
      [0.22, GAIT.armElbow + 12],
      [0.5, GAIT.armElbow - 6],
      [0.78, GAIT.armElbow - 10],
      [1, GAIT.armElbow],
    ]);
    const s = side === 'L' ? -1 : 1;
    set(out, `clavicle${side}`, rad(-sh * 0.1), 0, rad(s * 2));
    set(out, `upperArm${side}`, rad(-sh), rad(s * -4), rad(s * (5 + drive * 3)));
    set(out, `foreArm${side}`, rad(-elbow), 0, 0);
    set(out, `hand${side}`, rad(-12 - c.fatigue * 10), 0, 0);
  }
};

export const clipCrouch: Clip = (_c, out) => {
  // arms straight down to the track, palms flat — the set position
  set(out, 'hips', rad(14), 0, 0);
  set(out, 'spine', rad(24), 0, 0);
  set(out, 'chest', rad(30), 0, 0);
  set(out, 'neck', rad(-24), 0, 0);
  set(out, 'head', rad(-34), 0, 0);
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? -1 : 1;
    set(out, `clavicle${side}`, 0, 0, rad(s * 3));
    set(out, `upperArm${side}`, rad(-72), rad(s * 6), rad(s * 4));
    set(out, `foreArm${side}`, rad(-8), 0, 0);
    set(out, `hand${side}`, rad(-24), 0, 0);
  }
};

export const clipLaunch: Clip = (c, out) => {
  // the first three strides: arms punch, rear leg extends hard
  const drive = Math.sin(clamp(c.t * 9, 0, Math.PI)) * 0.5 + 0.5;
  trunk({ ...c, lean: c.lean + 6 * drive }, out, 0);
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? -1 : 1;
    const ph = (c.stridePhase + (side === 'L' ? 0.5 : 0)) % 1;
    const punch = Math.sin(ph * Math.PI * 2);
    set(out, `clavicle${side}`, 0, 0, 0);
    set(out, `upperArm${side}`, rad(-(38 * punch + 20) * (0.9 + drive * 0.35)), rad(s * -8), rad(s * 7));
    set(out, `foreArm${side}`, rad(-(84 + punch * 14)), 0, 0);
    set(out, `hand${side}`, rad(-30), 0, 0);
  }
};

export const clipCelebrate: Clip = (c, out) => {
  const w = clamp(c.t, 0, 1);
  trunk({ ...c, lean: 0 }, out);
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? -1 : 1;
    set(out, `clavicle${side}`, 0, 0, rad(s * 10 * w));
    set(out, `upperArm${side}`, rad(lerp(-40, -168, w)), rad(s * 6), rad(s * 14));
    set(out, `foreArm${side}`, rad(lerp(-80, -12, w)), 0, 0);
    set(out, `hand${side}`, 0, 0, 0);
  }
  set(out, 'head', rad(lerp(0, -12, w)), 0, 0);
};

export const clipDisappointed: Clip = (c, out) => {
  const w = clamp(c.t * 1.6, 0, 1);
  trunk({ ...c, lean: lerp(4, 34, w) }, out);
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? -1 : 1;
    set(out, `clavicle${side}`, 0, 0, 0);
    set(out, `upperArm${side}`, rad(lerp(-30, -52, w)), rad(s * 10), rad(s * 6));
    set(out, `foreArm${side}`, rad(lerp(-70, -96, w)), 0, 0);
    set(out, `hand${side}`, 0, 0, 0);
  }
  set(out, 'head', rad(lerp(-6, 18, w)), 0, 0);
};

export const clipCooldown: Clip = (c, out) => {
  const w = c.t;
  const ph = w * 1.9;
  trunk({ ...c, lean: 4 + Math.sin(ph * 2) * 2 }, out);
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? -1 : 1;
    const swing = Math.sin(ph * Math.PI * 2 + (side === 'L' ? Math.PI : 0));
    set(out, `clavicle${side}`, 0, 0, 0);
    set(out, `upperArm${side}`, rad(swing * 16), 0, rad(s * 5));
    set(out, `foreArm${side}`, rad(-24 - Math.abs(swing) * 14), 0, 0);
    set(out, `hand${side}`, 0, 0, 0);
  }
};

export const clipDip: Clip = (c, out) => {
  // torso goes horizontal, arms sweep back, head lifts last
  const w = smoothstep(clamp(c.t * 1.9, 0, 1));
  const flat = lerp(0, 1, w);
  set(out, 'hips', rad(lerp(0, 34, flat)), 0, 0);
  set(out, 'spine', rad(lerp(4, 16, flat)), 0, 0);
  set(out, 'chest', rad(lerp(4, 6, flat)), 0, 0);
  set(out, 'neck', rad(lerp(-6, -30, flat)), 0, 0);
  set(out, 'head', rad(lerp(-6, -22, flat)), 0, 0);
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? -1 : 1;
    set(out, `clavicle${side}`, 0, 0, rad(s * 12 * flat));
    set(out, `upperArm${side}`, rad(lerp(-40, 62, flat)), rad(s * 10), rad(s * (10 + 8 * flat)));
    set(out, `foreArm${side}`, rad(lerp(-80, -18, flat)), 0, 0);
    set(out, `hand${side}`, rad(-6), 0, 0);
  }
};

export const CLIP_ORDER = ['crouch', 'launch', 'sprint', 'dip', 'celebrate', 'disappointed', 'cooldown'] as const;
export type ClipName = (typeof CLIP_ORDER)[number];

export const CLIPS: Record<ClipName, Clip> = {
  crouch: clipCrouch,
  launch: clipLaunch,
  sprint: clipSprint,
  dip: clipDip,
  celebrate: clipCelebrate,
  disappointed: clipDisappointed,
  cooldown: clipCooldown,
};

export interface BlendWeights {
  crouch: number;
  launch: number;
  sprint: number;
  dip: number;
  celebrate: number;
  disappointed: number;
  cooldown: number;
}

export function emptyWeights(): BlendWeights {
  return { crouch: 0, launch: 0, sprint: 0, dip: 0, celebrate: 0, disappointed: 0, cooldown: 0 };
}

export function normaliseWeights(w: BlendWeights): void {
  let sum = 0;
  for (const k of CLIP_ORDER) sum += Math.max(0, w[k]);
  if (sum <= 1e-4) {
    w.sprint = 1;
    return;
  }
  for (const k of CLIP_ORDER) w[k] = Math.max(0, w[k]) / sum;
}

const tmpA: PoseMap = {};
const tmpB: PoseMap = {};

/** blend every clip into `out` according to the weight vector */
export function evaluatePose(ctx: PoseContext, w: BlendWeights, out: PoseMap): void {
  normaliseWeights(w);
  for (const k of Object.keys(out)) delete out[k];
  let first = true;
  for (const name of CLIP_ORDER) {
    const weight = w[name];
    if (weight < 0.0005) continue;
    const target = first ? out : tmpA;
    if (first) first = false;
    for (const k of Object.keys(target)) delete target[k];
    CLIPS[name](ctx, target);
    if (target !== out) blendInto(out, target, weight);
  }
  if (first) CLIPS.sprint(ctx, out);
}

/** out += src * w  (Euler channels, missing channels default to 0) */
export function blendInto(out: PoseMap, src: PoseMap, w: number): void {
  for (const bone of Object.keys(src)) {
    const s = src[bone];
    const d = out[bone] ?? (out[bone] = {});
    d.x = (d.x ?? 0) + (s.x ?? 0) * w;
    d.y = (d.y ?? 0) + (s.y ?? 0) * w;
    d.z = (d.z ?? 0) + (s.z ?? 0) * w;
  }
  void tmpB;
}
