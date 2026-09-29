/**
 * The stage: renderer, scene, world, camera rig and the render loop's draw
 * half. Owns the dynamic resolution controller, which trades pixels for frame
 * time so the race stays at 60 fps on a laptop iGPU.
 *
 * Nothing here knows about React or the store; the app layer calls `render`.
 */

import * as THREE from 'three';
import { DYN_RES, QUALITY, damp } from '../game/config';
import type { QualityName } from '../game/config';
import { buildTrack, laneX } from '../world/track';
import type { TrackBuild } from '../world/track';
import { buildStadium } from '../world/stadium';
import type { StadiumBuild } from '../world/stadium';
import { CameraRig } from './camera';
import { Field } from './field';
import type { GhostData } from './field';
import type { Race } from '../game/race';

export interface StageOptions {
  quality: QualityName;
  race: Race;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly field: Field;
  readonly track: TrackBuild;
  readonly stadium: StadiumBuild;
  private readonly race: Race;
  private readonly canvas: HTMLCanvasElement;
  private quality: QualityName;
  private scale = 1;
  private targetScale = 1;
  private frameMs: number = DYN_RES.targetFrameMs;
  private pixelRatioCap: number;
  private resizePending = true;
  private onResize = (): void => {
    this.resizePending = true;
  };
  private fpsClock = 0;
  private frames = 0;
  /** draw calls and triangles from the last frame, for the debug overlay */
  stats = { calls: 0, triangles: 0, fps: 0, scale: 1 };

  constructor(canvas: HTMLCanvasElement, opts: StageOptions) {
    this.canvas = canvas;
    this.race = opts.race;
    this.quality = opts.quality;
    const preset = QUALITY[opts.quality];
    this.pixelRatioCap = preset.pixelRatioCap;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: opts.quality !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setClearColor(0x0a0f18, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    if (preset.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    this.applyPixelRatio();

    this.track = buildTrack(preset);
    this.scene.add(this.track.group);
    this.stadium = buildStadium(preset);
    this.scene.add(this.stadium.group);
    this.scene.background = this.stadium.sky;
    this.scene.fog = this.stadium.fog;

    this.rig = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight) || 1.777);
    this.field = new Field(opts.race, preset.trackDetail > 60 ? 'high' : 'medium');
    this.scene.add(this.field.group);

    window.addEventListener('resize', this.onResize);
  }

  setGhost(ghost: GhostData | null): void {
    this.field.setGhost(ghost);
  }

  private applyPixelRatio(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.pixelRatioCap);
    this.renderer.setPixelRatio(dpr * this.scale);
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w / Math.max(1, h));
    this.applyPixelRatio();
    this.resizePending = false;
  }

  setQuality(q: QualityName): void {
    this.quality = q;
    const preset = QUALITY[q];
    this.pixelRatioCap = preset.pixelRatioCap;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.applyPixelRatio();
  }

  /**
   * Draw one frame. `focusIndex` picks the athlete the camera and the shadow
   * frustum track — normally the player; pass -1 to follow the ghost, which is
   * what the slow-motion finish replay does.
   */
  render(dt: number, focusIndex: number): void {
    if (this.resizePending) this.resize();

    const ghost = focusIndex < 0 ? this.field.ghostAnim : null;
    const racer = this.race.racers[focusIndex] ?? this.race.player;
    const a = racer.anim;

    // rigs first: the camera reads the player's trunk pitch out of the
    // animator, so the poses have to be current before the camera solves
    this.field.update(dt, performance.now() / 1000);
    this.stadium.update(dt, performance.now() / 1000);

    const camX = ghost ? ghost.x : a.laneX;
    const camZ = ghost ? ghost.z : a.distance;
    const camSpeed = ghost ? ghost.speed : a.speed;
    const trunkPitch = this.field.playerSprinter?.trunkPitch ?? 0;
    const remaining = this.race.opts.distance - camZ;
    this.rig.setPhase(this.race.phase, this.race.phase === 'running', racer.finished, Math.max(0, remaining));
    this.rig.update(dt, camX, camZ, camSpeed, trunkPitch);

    // keep the shadow frustum tight around the action
    const look = this.rig.shadowFocus();
    this.stadium.focus.copy(look);
    this.stadium.key.position.set(look.x - 38, 52, look.z + 26);
    this.stadium.key.target.position.copy(look);
    this.stadium.key.target.updateMatrixWorld();

    const t0 = performance.now();
    this.renderer.render(this.scene, this.rig.camera);
    const drawMs = performance.now() - t0;

    /* dynamic resolution: keep the draw inside the frame budget */
    this.frameMs = damp(this.frameMs, drawMs, 6, dt);
    if (this.frameMs > DYN_RES.targetFrameMs) {
      this.targetScale = Math.max(DYN_RES.min, this.targetScale - DYN_RES.adjustRate * dt * 6);
    } else if (this.frameMs < DYN_RES.targetFrameMs * 0.7) {
      this.targetScale = Math.min(1, this.targetScale + DYN_RES.adjustRate * dt * 4);
    }
    if (Math.abs(this.targetScale - this.scale) > 0.008) {
      this.scale = damp(this.scale, this.targetScale, 8, dt);
      this.applyPixelRatio();
    }

    this.frames++;
    this.fpsClock += dt;
    if (this.fpsClock >= 0.5) {
      this.stats.calls = this.renderer.info.render.calls;
      this.stats.triangles = this.renderer.info.render.triangles;
      this.stats.fps = this.frames / this.fpsClock;
      this.stats.scale = this.scale;
      this.frames = 0;
      this.fpsClock = 0;
    }
  }

  kick(amount: number): void {
    this.rig.kick(amount);
  }

  laneCentre(lane: number): number {
    return laneX(lane);
  }

  get activeQuality(): QualityName {
    return this.quality;
  }

  get renderMs(): number {
    return this.frameMs;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.field.dispose();
    this.track.dispose();
    this.stadium.dispose();
    this.renderer.dispose();
  }
}
