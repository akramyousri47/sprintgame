/**
 * Sprinter — binds a procedural rig to the gait solver.
 *
 * Per frame, in order:
 *   1. blend the clip weights into one pose (trunk, arms, head)
 *   2. place the hips, then update the world matrix
 *   3. solve each leg's IK against its foot target, expressed in the hips'
 *      local frame so the forward lean never drags the feet off the track
 *   4. layer secondary motion: hair, sweat sheen
 *
 * The legs are never keyframed. That is the whole trick: the physics owns them,
 * the animation only owns the athlete above the waist.
 */

import * as THREE from 'three';
import type { Limb } from '../biomechanics/athlete';
import { clamp, lerp, rad } from '../game/config';
import { evaluatePose, emptyWeights, normaliseWeights } from '../biomechanics/pose';
import type { BlendWeights, PoseMap } from '../biomechanics/pose';
import { ANKLE_REST, footTarget, pelvisHeightFor, solveLegIK, stanceGeometry } from '../biomechanics/ik';
import type { FootTarget, LegIK } from '../biomechanics/ik';
import { buildHumanoid } from './humanoid';
import type { Appearance, BodyShape, Detail, Humanoid } from './humanoid';

export interface AnimatorState {
  /** metres along the track */
  distance: number;
  laneX: number;
  speed: number;
  /** 0..1, 0 = left foot strikes */
  stridePhase: number;
  stanceFrac: number;
  /** 0..1, how far out the foot strikes: 0 = short step, 1 = full stride */
  strikeFrac: number;
  quality: number;
  fatigue: number;
  /** trunk pitch, degrees */
  lean: number;
  contactTime: number;
  /** 0 = upright, 1 = full drive lean out of the blocks */
  drive: number;
  /** 0..1 blocks crouch weight */
  crouch: number;
  /** 0..1 drive out of the blocks */
  launch: number;
  /** finish dip, 0..1 */
  dip: number;
  /** seconds since the race started, for idle clips */
  t: number;
}

export interface FootContact {
  side: -1 | 1;
  /** 0..1 how hard the foot struck */
  load: number;
  worldZ: number;
}

interface Spring {
  x: number;
  v: number;
}

const CLAV_REST = 0.08;
/** dip is a fall, not a crouch: how far the body drops as it goes horizontal */
const DIP_DROP = 0.34;

export class Sprinter {
  readonly human: Humanoid;
  readonly limb: Limb;
  readonly weights: BlendWeights = emptyWeights();
  /** drain the foot strikes recorded during the last update */
  readonly contacts: FootContact[] = [];

  private pose: PoseMap = {};
  private tmp = new THREE.Vector3();
  private lastPhase = [0.5, 0];
  private sweat = 0;
  private hipVel = 0;
  private lastHipY = 0;
  private hair: Spring = { x: 0, v: 0 };
  private leg: LegIK = { thigh: 0, knee: 0, reach: 1 };
  private target: FootTarget = { y: 0, z: 0, pitch: 0, load: 0 };

  constructor(limb: Limb, look: Appearance, shape?: BodyShape, detail: Detail = 'high') {
    this.limb = limb;
    this.human = buildHumanoid(limb, look, shape, detail);
    this.lastHipY = limb.hipHeight;
  }

  get object3d(): THREE.Group {
    return this.human.root;
  }

  /** approximate top of the head, used by the camera rig */
  get height(): number {
    const l = this.limb;
    return l.hipHeight + l.torso * 1.24 + l.neck * 1.85 + l.headRadius;
  }

  setWeights(w: Partial<BlendWeights>): void {
    for (const k of Object.keys(w) as (keyof BlendWeights)[]) {
      const v = w[k];
      if (typeof v === 'number') this.weights[k] = v;
    }
    normaliseWeights(this.weights);
  }

  /** only the athletes the camera can actually see need to cast shadows */
  setCastShadow(on: boolean): void {
    this.human.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = on;
    });
  }

  update(s: AnimatorState, dt: number): void {
    this.contacts.length = 0;
    const b = this.human.bones;
    const limb = this.limb;
    const crouch = clamp(s.crouch, 0, 1);

    /* --- 1. blended pose ------------------------------------------- */
    evaluatePose(
      {
        stridePhase: s.stridePhase,
        lean: s.lean,
        quality: s.quality,
        fatigue: s.fatigue,
        speed: s.speed,
        launch: s.launch,
        crouch,
        t: s.t,
      },
      this.weights,
      this.pose,
    );

    this.human.root.position.set(s.laneX, 0, s.distance);
    this.applyBone(b.hips, this.pose.hips);
    this.applyBone(b.spine, this.pose.spine);
    this.applyBone(b.chest, this.pose.chest);
    this.applyBone(b.neck, this.pose.neck);
    this.applyBone(b.head, this.pose.head);
    for (const side of ['L', 'R'] as const) {
      const sgn = side === 'L' ? -1 : 1;
      this.applyBone(b[`clavicle${side}`], this.pose[`clavicle${side}`], 0, 0, sgn * CLAV_REST);
      this.applyBone(b[`upperArm${side}`], this.pose[`upperArm${side}`]);
      this.applyBone(b[`foreArm${side}`], this.pose[`foreArm${side}`]);
      this.applyBone(b[`hand${side}`], this.pose[`hand${side}`]);
    }

    /* --- 2. pelvis ------------------------------------------------- */
    // geometry first: the stance reach depends on the leg, and the pelvis
    // height depends on the reach
    const geo = stanceGeometry(limb, limb.hipHeight, s.speed, s.contactTime, clamp(s.strikeFrac, 0, 1));
    const hipY =
      pelvisHeightFor(limb, geo.contactReach, s.drive, s.stridePhase, crouch) - s.dip * DIP_DROP;
    b.hips.position.y = hipY;

    if (dt > 1e-5) {
      this.hipVel = dampTo(this.hipVel, (hipY - this.lastHipY) / dt, 20, dt);
      this.lastHipY = hipY;
    }

    /* --- 3. legs: IK, never keyframes ------------------------------ */
    const hipJointY = 0.015;
    const hw = limb.hipWidth * 0.5;

    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? -1 : 1;
      const tag = i === 0 ? 'L' : 'R';
      const phase = (s.stridePhase + (i === 0 ? 0 : 0.5)) % 1;
      const t = footTarget(phase, s.stanceFrac, geo, s.speed, (1 - s.quality) * 0.35);

      if (crouch > 0.001) {
        // right foot at the line, left foot up on the block behind it
        const setY = sgn < 0 ? ANKLE_REST + 0.155 : ANKLE_REST;
        const setZ = sgn < 0 ? -0.34 : 0.015;
        const setPitch = sgn < 0 ? rad(46) : rad(-2);
        t.y = lerp(t.y, setY, crouch);
        t.z = lerp(t.z, setZ, crouch);
        t.pitch = lerp(t.pitch, setPitch, crouch);
        t.load *= 1 - crouch;
      }
      this.target = t;

      // the hips rotate with the trunk, so the target is pulled into the hips'
      // frame — otherwise the lean would shift every foot placement sideways
      this.tmp.set(sgn * hw, t.y, s.distance + t.z);
      this.human.root.localToWorld(this.tmp);
      b.hips.worldToLocal(this.tmp);

      const leg = solveLegIK(
        this.tmp.y - hipJointY,
        0,
        this.tmp.y,
        this.tmp.z,
        limb.thigh,
        limb.shank,
        1,
      );
      this.leg = leg;
      b[`thigh${tag}`].rotation.x = leg.thigh;
      b[`shin${tag}`].rotation.x = leg.knee;
      b[`foot${tag}`].rotation.x = t.pitch - (leg.thigh + leg.knee);
      // the toe rides the spike plate through push-off
      b[`toe${tag}`].rotation.x = rad(6) + clamp(t.pitch, 0, 1) * 0.5;

      if (phase < s.stanceFrac && this.lastPhase[i] >= s.stanceFrac) {
        this.contacts.push({ side: sgn as -1 | 1, load: t.load, worldZ: s.distance + t.z });
      }
      this.lastPhase[i] = phase;
    }

    /* --- 4. secondary motion ---------------------------------------- */
    this.updateSecondary(s, dt);
  }

  /** trunk pitch actually applied, radians, for the camera and debug overlay */
  get trunkPitch(): number {
    return (this.pose.hips?.x ?? 0) + (this.pose.spine?.x ?? 0) + (this.pose.chest?.x ?? 0);
  }

  get lastLeg(): LegIK {
    return this.leg;
  }

  get lastTarget(): FootTarget {
    return this.target;
  }

  get sweatLevel(): number {
    return this.sweat;
  }

  private updateSecondary(s: AnimatorState, dt: number): void {
    // sweat: a wet athlete has a tighter, brighter highlight
    const effort = clamp(s.distance / 55, 0, 1) * lerp(0.55, 1, s.quality);
    this.sweat = dampTo(this.sweat, clamp(effort + s.fatigue * 0.2, 0, 1), 0.55, dt);
    for (const m of this.human.skinMats) m.roughness = lerp(0.66, 0.3, this.sweat);
    for (const m of this.human.kitMats) m.roughness = lerp(0.52, 0.34, this.sweat);

    // hair lags the head and whips with the trunk rotation
    const hairTarget = clamp(-this.hipVel * 0.09 - this.trunkPitch * 0.35, -0.5, 0.5);
    springTo(this.hair, hairTarget, 62, 11, dt);
    if (this.human.hairGroup) this.human.hairGroup.rotation.x = this.hair.x;
  }

  private applyBone(
    bone: THREE.Object3D,
    e: { x?: number; y?: number; z?: number } | undefined,
    dx = 0,
    dy = 0,
    dz = 0,
  ): void {
    bone.rotation.set((e?.x ?? 0) + dx, (e?.y ?? 0) + dy, (e?.z ?? 0) + dz);
  }

  dispose(): void {
    this.human.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
  }
}

/* --- small maths helpers, kept local so the animator stays self-contained */

/** frame-rate independent exponential smoothing */
function dampTo(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** semi-implicit damped spring, stable at any frame rate */
function springTo(s: Spring, target: number, k: number, c: number, dt: number): void {
  if (dt <= 1e-6) {
    s.x = target;
    s.v = 0;
    return;
  }
  s.v += ((target - s.x) * k - s.v * c) * dt;
  s.x += s.v * dt;
}
