/**
 * Analytic two-bone leg IK + ground-locked foot placement.
 *
 * All sprinting happens in the sagittal plane, so the IK is solved in that
 * plane (an exact 3D solver would be more general and no more correct here)
 * and returns ready-to-assign X rotations for the thigh and shank bones.
 *
 * The foot is not animated: it is *placed*. The ball of the foot stays planted
 * and the ankle rolls over it while the body travels on, which produces correct
 * roll-over (dorsiflex at contact, plantarflex at toe-off) and keeps the shoe
 * from skating. The reach and roll are derived from the athlete's own geometry
 * so the stance can never demand more reach than the leg has.
 */

import { clamp, lerp, rad, smoothstep } from '../game/config';
import type { Limb } from './athlete';

export interface LegIK {
  /** rotation.x of the thigh, radians (negative = forward) */
  thigh: number;
  /** rotation.x of the shank, radians (positive = knee flexion) */
  knee: number;
  /** total reach used vs available */
  reach: number;
}

const EPS = 1e-4;

/**
 * @param hipY,hipZ    hip joint in world space (character-local X is ignored)
 * @param footY,footZ  target ankle position
 * @param l1,l2        thigh and shank lengths
 * @param poleForward  +1 knee points forward (sprint), -1 knee points back
 */
export function solveLegIK(
  hipY: number,
  hipZ: number,
  footY: number,
  footZ: number,
  l1: number,
  l2: number,
  poleForward = 1,
): LegIK {
  // 2D in the sagittal plane: x = +z forward, y = up
  const ux = footZ - hipZ;
  const uy = footY - hipY;
  const reachMax = l1 + l2 - EPS;
  const dRaw = Math.hypot(ux, uy);
  const d = clamp(dRaw, Math.abs(l1 - l2) + EPS, reachMax);
  const nx = ux / (dRaw || 1);
  const ny = uy / (dRaw || 1);

  // distance along the hip->foot line at which the knee sits (law of cosines)
  const a = clamp((l1 * l1 - l2 * l2 + d * d) / (2 * d), 0, d);
  // perpendicular offset of the knee from that line
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));

  // the pole picks which side of the line the knee bulges to
  let px = -ny;
  let py = nx;
  if (px * poleForward < 0) {
    px = ny;
    py = -nx;
  }
  const kneeX = a * nx + h * px;
  const kneeY = a * ny + h * py;

  // a bone of length L rotated by r about X points its tip at (-L sin r, -L cos r)
  // in (x, y), so r follows from the direction the segment actually runs
  const thigh = Math.atan2(-kneeX, -kneeY);
  const shankX = footZ - (hipZ + kneeX);
  const shankY = footY - (hipY + kneeY);
  const shankWorld = Math.atan2(-shankX, -shankY);

  return {
    thigh,
    knee: shankWorld - thigh,
    reach: dRaw / reachMax,
  };
}

/** ankle height above the track at contact, m (shoe sole thickness) */
export const ANKLE_REST = 0.075;

/**
 * Where a foot must be for the current stride phase.
 *
 * During stance the *ball of the foot* is planted and the ankle rolls over it,
 * which is why the ankle translates forward while the body travels on. The
 * stance slip is v x t_contact, so at 10.4 m/s with a 0.10 s contact the body
 * passes 1.04 m over the foot — far more than a leg can swing. The roll is
 * what makes it work, and the numbers are derived from the athlete's own
 * geometry rather than hard-coded:
 *
 *   contactLocal = reach (clamped by leg length vs hip height)
 *   toeOffLocal  = contactLocal + roll - v * t_contact
 *
 * Anything the leg cannot reach is absorbed by the IK straightening, which is
 * exactly what a real sprinter's ankle does.
 */
export interface StanceGeometry {
  /** horizontal distance from the hip to the strike point at contact, m */
  contactReach: number;
  /** how far the ankle travels forward over the planted ball, m */
  roll: number;
  /** v * ground contact time, m */
  slip: number;
  /** furthest behind the hip the ankle may be planted and still be reached, m */
  behindLimit: number;
}

export function stanceGeometry(
  limb: Limb,
  hipY: number,
  speed: number,
  contactTime: number,
  strikeFraction: number,
): StanceGeometry {
  const leg = limb.thigh + limb.shank;
  // the hips sit well below standing height once the athlete is running, and
  // that is what decides how far behind the hip a planted ankle can be
  const runHip = hipY * 0.88;
  const spanY = Math.max(0.2, runHip - ANKLE_REST);
  const geoMax = Math.sqrt(Math.max(0.01, leg * leg - spanY * spanY));
  // longer steps are struck further out, but never past what the leg allows
  const desired = 0.24 + strikeFraction * 0.12;
  return {
    contactReach: Math.min(geoMax * 0.92, desired),
    roll: limb.foot * 0.9,
    slip: speed * contactTime,
    // the body covers v*t over the stance while the foot only rolls over, so
    // the raw toe-off point is usually further back than any leg can reach;
    // the limit is what keeps the ankle a real, plantable target
    behindLimit: Math.max(0.12, geoMax * 0.85 - 0.04),
  };
}

export interface FootTarget {
  /** Y of the ankle joint above the track */
  y: number;
  /** Z of the ankle joint relative to the hip */
  z: number;
  /** foot pitch in radians, + = toe down */
  pitch: number;
  /** 0..1 how firmly the foot is loaded (drives sound + knee drive) */
  load: number;
}

export function footTarget(
  stridePhase: number,
  stanceFrac: number,
  geo: StanceGeometry,
  speed: number,
  limp = 0,
): FootTarget {
  const p = clamp(stridePhase, 0, 1);
  // the raw roll-over would throw the ankle further behind the hip than the
  // leg can reach at sprint speed, which is the classic cause of foot skate,
  // so toe-off is capped at the furthest plantable point
  const toeOff = Math.max(geo.contactReach + geo.roll - geo.slip, -geo.behindLimit);

  if (p < stanceFrac) {
    const sT = p / stanceFrac;
    return {
      y: ANKLE_REST + smoothstep(sT) * 0.05,
      z: lerp(geo.contactReach, toeOff, sT),
      pitch: lerp(rad(-7), rad(38), Math.pow(sT, 1.3)),
      load: 1 - Math.abs(sT - 0.45) * 0.55,
    };
  }

  // flight: the foot swings back to the strike point while being carried
  // forward by the hip, i.e. it travels through a lifted arc
  const fT = (p - stanceFrac) / (1 - stanceFrac);
  const e = fT * fT * (3 - 2 * fT);
  const lift = (0.075 + 0.06 * smoothstep((speed - 4) / 8)) * (1 - limp);
  return {
    y: ANKLE_REST + 0.05 * (1 - e) + Math.sin(fT * Math.PI) * lift,
    z: lerp(toeOff, geo.contactReach, e),
    pitch: lerp(rad(38), rad(-7), e),
    load: 0,
  };
}

/** pelvis height that keeps the planted leg just inside its reach */
export function pelvisHeightFor(
  limb: Limb,
  stepReach: number,
  driveAmount: number,
  stridePhase: number,
  crouch = 0,
): number {
  const leg = limb.thigh + limb.shank - 0.012;
  // the height the reach alone allows, and the athlete's own standing height
  const reachLimit = Math.sqrt(Math.max(0.02, leg * leg - stepReach * stepReach));
  const stand = Math.min(reachLimit, limb.hipHeight);
  // the hips drop at mid-stance and stand tall again through the flight that
  // follows the push; the drive keeps them folded forward while the athlete
  // is still accelerating, which is why hip height peaks near top speed
  const bob = (1 - Math.cos(4 * Math.PI * stridePhase)) * 0.5 * 0.03;
  const drive = driveAmount * 0.055;
  const set = crouch * 0.3;
  return clamp(stand - bob - drive - set, 0.2, stand);
}

/** shoulder/hip widths used by the rig builder */
export function stanceWidths(limb: Limb): { left: number; right: number } {
  return { left: limb.hipWidth * 0.5, right: -limb.hipWidth * 0.5 };
}
