/**
 * The field: one procedural rig per racer, driven from the race state, plus
 * the translucent ghost used by Time Trial and the replay.
 *
 * This is the only place that knows both sides of the boundary — it takes
 * `Racer` data out of the engine and puts it into `Sprinter` animators — so
 * the engine itself stays free of Three.js and testable in Node.
 */

import * as THREE from 'three';
import { Sprinter } from '../characters/animator';
import type { Detail } from '../characters/humanoid';
import type { Race, Racer } from '../game/race';
import { TRACK, clamp } from '../game/config';
import { laneX } from '../world/track';

export interface GhostData {
  athleteIndex: number;
  lane: number;
  /** 8 floats per sample, 20 Hz — see Racer.samples */
  samples: number[];
  /** total race time of the ghost run */
  time: number;
}

const SAMPLE_STRIDE = 8;

export class Field {
  readonly group = new THREE.Group();
  readonly sprinters: Sprinter[] = [];
  private readonly race: Race;
  /** index into `sprinters` for each racer */
  private byIndex: Sprinter[] = [];
  private ghost: Sprinter | null = null;
  private ghostSamples: number[] = [];
  private ghostLane = 0;
  private ghostAt = 0;
  private ghostX = 0;
  private ghostZ = 0;
  private ghostSpeed = 0;

  constructor(race: Race, detail: Detail = 'medium') {
    this.race = race;
    this.group.name = 'field';
    for (const r of race.racers) {
      const s = new Sprinter(r.athlete.params.limb, r.athlete.look, r.athlete.shape, this.detailFor(r, detail));
      s.setCastShadow(r.isPlayer);
      this.group.add(s.object3d);
      this.sprinters.push(s);
      this.byIndex[r.index] = s;
    }
  }

  /** the player and their nearest rival get the full-detail rig */
  private detailFor(r: Racer, detail: Detail): Detail {
    if (r.isPlayer) return 'high';
    void detail;
    return 'medium';
  }

  setGhost(ghost: GhostData | null): void {
    if (this.ghost) {
      this.group.remove(this.ghost.object3d);
      this.ghost.dispose();
      this.ghost = null;
      this.ghostSamples = [];
    }
    if (!ghost || ghost.samples.length < SAMPLE_STRIDE) return;
    const athlete = this.race.racers.find((r) => r.athlete.id === ghost.athleteIndex)?.athlete
      ?? this.race.racers[0].athlete;
    const s = new Sprinter(athlete.params.limb, athlete.look, athlete.shape, 'medium');
    // ghost the whole rig: everything translucent, nothing casting shadows
    s.object3d.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = 0.34;
        mat.depthWrite = false;
        mat.emissive = new THREE.Color(0x2a4a6a);
        mat.emissiveIntensity = 0.6;
      }
      m.castShadow = false;
    });
    this.ghost = s;
    this.ghostSamples = ghost.samples;
    this.ghostLane = ghost.lane;
    this.ghostAt = 0;
    this.group.add(s.object3d);
  }

  /** hide a disqualified racer from the field */
  setRacerVisible(index: number, visible: boolean): void {
    const s = this.byIndex[index];
    if (s) s.object3d.visible = visible;
  }

  /** hide or show every live rig, used while a replay is playing */
  setLiveVisible(on: boolean): void {
    for (const s of this.sprinters) s.object3d.visible = on;
  }

  /** the ghost's current animator state, for the camera during a replay */
  get ghostAnim(): ReturnType<Field['ghostState']> {
    return this.ghostState();
  }

  private ghostState(): { x: number; z: number; speed: number; trunkPitch: number } | null {
    return this.ghost ? { x: this.ghostX, z: this.ghostZ, speed: this.ghostSpeed, trunkPitch: 0 } : null;
  }

  update(dt: number, elapsed: number): void {
    const race = this.race;
    const phase = race.phase;

    for (const r of race.racers) {
      const s = this.byIndex[r.index];
      if (!s) continue;
      const a = r.anim;

      // clip weights from race state
      const done = r.finished;
      const celebrate = done && phase === 'results' ? clamp((race.raceTime - r.finishTime) / 0.7, 0, 1) : 0;
      const disappointed = r.dq ? 1 : done ? clamp((race.raceTime - r.finishTime - 1.2) / 1.2, 0, 1) * 0.6 : 0;
      s.setWeights({
        crouch: a.crouch,
        launch: a.launch * (1 - a.crouch),
        dip: a.dip * (1 - a.crouch),
        celebrate: celebrate * (1 - a.crouch),
        disappointed: disappointed * (1 - a.crouch),
        sprint: 1,
      });

      s.update(a, dt);
      s.contacts.length = 0;
    }

    if (this.ghost) this.updateGhost(dt);
    void elapsed;
  }

  /** foot strikes this frame, for the audio layer */
  drainContacts(): { side: -1 | 1; load: number; z: number; lane: number }[] {
    const out: { side: -1 | 1; load: number; z: number; lane: number }[] = [];
    for (const r of this.race.racers) {
      const s = this.byIndex[r.index];
      if (!s) continue;
      for (const c of s.contacts) out.push({ side: c.side, load: c.load, z: c.worldZ, lane: r.lane });
    }
    return out;
  }

  get playerSprinter(): Sprinter | undefined {
    const p = this.race.player;
    return this.byIndex[p.index];
  }

  private updateGhost(dt: number): void {
    const g = this.ghost;
    if (!g) return;
    const s = this.ghostSamples;
    this.ghostAt += dt;
    const n = s.length / SAMPLE_STRIDE;
    // find the bracket for the current replay time
    let i = 0;
    while (i < n - 1 && s[(i + 1) * SAMPLE_STRIDE] <= this.ghostAt) i++;
    const o0 = i * SAMPLE_STRIDE;
    const o1 = Math.min(n - 1, i + 1) * SAMPLE_STRIDE;
    const t0 = s[o0];
    const t1 = s[o1];
    const u = t1 > t0 ? clamp((this.ghostAt - t0) / (t1 - t0), 0, 1) : 0;
    const mix = (k: number): number => s[o0 + k] + (s[o1 + k] - s[o0 + k]) * u;
    const dip = mix(2);
    this.ghostX = laneX(clamp(this.ghostLane, 0, TRACK.lanes - 1));
    this.ghostZ = mix(1);
    this.ghostSpeed = mix(5);
    g.setWeights({ sprint: 1 - dip, dip, crouch: 0, launch: 0, celebrate: 0, disappointed: 0, cooldown: 0 });
    g.update(
      {
        distance: this.ghostZ,
        laneX: this.ghostX,
        speed: mix(5),
        stridePhase: mix(4),
        stanceFrac: Math.max(0.2, mix(6)),
        strikeFrac: 0.5,
        quality: mix(3),
        fatigue: 0,
        lean: 12,
        contactTime: Math.max(0.05, mix(7)),
        drive: 0,
        crouch: 0,
        launch: 0,
        dip,
        t: this.ghostAt,
      },
      dt,
    );
    g.contacts.length = 0;
  }

  /** start the ghost from the beginning */
  rewindGhost(): void {
    this.ghostAt = 0;
  }

  setGhostTime(t: number): void {
    this.ghostAt = t;
  }

  dispose(): void {
    for (const s of this.sprinters) s.dispose();
    this.ghost?.dispose();
    this.sprinters.length = 0;
  }
}
