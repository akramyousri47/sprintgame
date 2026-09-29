/**
 * Camera rig.
 *
 * Six shots, chosen by race phase, all driven from one smoothed focus point so
 * cuts feel like a broadcast rather than a lerp:
 *
 *   blocks    low and wide, looking up the track at the set position
 *   reaction  tight on the blocks, gun-side
 *   chase     behind and above, pulling wider as the field strings out
 *   side      trackside pan, used for the acceleration phase and the dive
 *   finish    low in front, the athlete runs into the lens
 *   celebrate slow orbit around whoever won
 *
 * Field of view widens with speed (the brief's speed-FOV effect) and the
 * chase shot lags the athlete, so acceleration is visible in the frame itself.
 */

import * as THREE from 'three';
import { CAMERA, clamp, damp, smoothstep } from '../game/config';
import type { RacePhase } from '../game/race';

export type ShotName = 'blocks' | 'reaction' | 'chase' | 'side' | 'finish' | 'celebrate';

interface Shot {
  /** offset from the focus point, in metres */
  offset: THREE.Vector3;
  /** where the camera looks, relative to the focus point */
  aim: THREE.Vector3;
  /** 0..1 how fast the shot settles */
  follow: number;
  aimFollow: number;
  /** extra FOV, degrees */
  fov: number;
}

const SHOTS: Record<ShotName, Shot> = {
  blocks: { offset: new THREE.Vector3(5.4, 1.5, -6.2), aim: new THREE.Vector3(0, 0.95, 1.2), follow: 2.2, aimFollow: 2.6, fov: 4 },
  reaction: { offset: new THREE.Vector3(-2.6, 0.75, 1.9), aim: new THREE.Vector3(0, 0.8, 0.3), follow: 3.2, aimFollow: 4, fov: 8 },
  chase: { offset: new THREE.Vector3(0.9, 2.5, -7.4), aim: new THREE.Vector3(0, 1.15, 3.5), follow: 5.5, aimFollow: 7, fov: 0 },
  side: { offset: new THREE.Vector3(-7.6, 1.9, -1.4), aim: new THREE.Vector3(0, 1.15, 0.6), follow: 3.4, aimFollow: 5, fov: 3 },
  finish: { offset: new THREE.Vector3(2.2, 0.95, 7.4), aim: new THREE.Vector3(0, 1.1, 0), follow: 3.6, aimFollow: 5.5, fov: 6 },
  celebrate: { offset: new THREE.Vector3(3.4, 1.7, -3.2), aim: new THREE.Vector3(0, 1.2, 0), follow: 1.8, aimFollow: 3, fov: 2 },
};

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  shot: ShotName = 'blocks';
  private target: ShotName = 'blocks';
  private focus = new THREE.Vector3(0, 1, 0);
  private pos = new THREE.Vector3(6, 2, -6);
  private look = new THREE.Vector3(0, 1, 0);
  private fov: number = CAMERA.fovBase;
  private shake = 0;
  private shakeSeed = 0;
  private orbit = 0;
  private posTmp = new THREE.Vector3();
  private lookTmp = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fovBase, aspect, 0.1, 900);
    this.camera.position.copy(this.pos);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** camera shake in metres, e.g. from the starting pistol */
  kick(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  /** pick the shot for a phase; call once per frame, it eases into place */
  setPhase(phase: RacePhase, running: boolean, finished: boolean, distToLine: number): void {
    if (phase === 'intro') this.target = 'blocks';
    else if (phase === 'set' || phase === 'hold') this.target = 'reaction';
    else if (phase === 'results' || finished) this.target = 'celebrate';
    else if (running) {
      // deterministic cut pattern: a trackside shot through the drive phase,
      // then a low finish-line shot, chase everywhere else
      if (distToLine < 14) this.target = 'finish';
      else if (distToLine > 66 && distToLine < 84) this.target = 'side';
      else this.target = 'chase';
    } else this.target = 'blocks';
    if (this.target !== this.shot) {
      this.shot = this.target;
      // a cut should be instant in framing but still smooth in motion
      this.shake = Math.max(this.shake, 0.02);
    }
  }

  /** follow an athlete; `lead` pushes the look-ahead down the track */
  update(dt: number, x: number, z: number, speed: number, leanPitch: number): void {
    const s = SHOTS[this.shot];
    this.focus.set(x, 1.05, z);

    // orbit the winner slowly during the celebration
    if (this.shot === 'celebrate') {
      this.orbit += dt * 0.32;
      const r = 3.8;
      this.posTmp.set(Math.sin(this.orbit) * r, 1.9, Math.cos(this.orbit) * r);
    } else {
      this.posTmp.copy(s.offset);
    }

    this.pos.x = damp(this.pos.x, this.focus.x + this.posTmp.x, CAMERA.follow * (s.follow / 7.5) + 0.5, dt);
    this.pos.y = damp(this.pos.y, this.focus.y + this.posTmp.y, CAMERA.follow * (s.follow / 7.5) + 0.5, dt);
    this.pos.z = damp(this.pos.z, this.focus.z + this.posTmp.z, CAMERA.follow * (s.follow / 7.5) + 0.5, dt);

    this.lookTmp.copy(s.aim);
    this.lookTmp.z += this.shot === 'chase' ? speed * 0.12 : 0;
    this.lookTmp.y += Math.sin(performance.now() / 900) * 0.01;
    this.look.x = damp(this.look.x, this.focus.x + this.lookTmp.x, CAMERA.aimFollow * (s.aimFollow / 9), dt);
    this.look.y = damp(this.look.y, this.focus.y + this.lookTmp.y, CAMERA.aimFollow * (s.aimFollow / 9), dt);
    this.look.z = damp(this.look.z, this.focus.z + this.lookTmp.z, CAMERA.aimFollow * (s.aimFollow / 9), dt);

    // speed FOV: +16 degrees from standing to flat out
    const speedFov = clamp((speed - 4) / 8, 0, 1) * CAMERA.fovMaxAdd;
    const target = CAMERA.fovBase + speedFov + s.fov;
    this.fov = damp(this.fov, target, 3, dt);

    // shake decays fast; it is a punctuation mark, not a state
    this.shake = Math.max(0, this.shake - dt * 0.9);
    this.shakeSeed += dt * 60;
    const sh = this.shake * this.shake;
    const jx = Math.sin(this.shakeSeed * 1.7) * sh * 0.16;
    const jy = Math.sin(this.shakeSeed * 2.3 + 1.1) * sh * 0.12;

    this.camera.position.set(this.pos.x + jx, Math.max(0.35, this.pos.y + jy), this.pos.z);
    // roll the camera slightly with the athlete's trunk lean — subtle, but it
    // is what makes a chase shot feel like it is being held, not glued
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    this.camera.rotateZ(clamp(leanPitch * 0.35, -0.16, 0.16) * smoothstep(speed / 6));
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  /** the shadow frustum follows the same focus, so shadows stay crisp */
  shadowFocus(): THREE.Vector3 {
    return this.look;
  }
}
