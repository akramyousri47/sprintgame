/**
 * The track: tartan surface, eight lanes, start blocks, markings, kerbs and
 * the run-off apron.
 *
 * Line work is merged into single geometries so the whole track costs about a
 * dozen draw calls even at high detail.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TRACK } from '../game/config';
import type { QualityPreset } from '../game/config';

const HALF_LANES = (TRACK.lanes - 1) / 2;

/** world X of a lane centre; lane 0 is on the left looking down the track */
export function laneX(lane: number): number {
  return (lane - HALF_LANES) * TRACK.laneWidth;
}

export const TRACK_WIDTH = TRACK.lanes * TRACK.laneWidth;
/** where the physical straight ends and the run-off begins */
export const STRAIGHT_END = TRACK.backStraight + TRACK.raceDistance + TRACK.runoff;

/* ------------------------------------------------------------------ */
/* procedural textures                                                 */
/* ------------------------------------------------------------------ */

function tartanTexture(detail: number): THREE.Texture {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#a33a26';
  g.fillRect(0, 0, s, s);
  // the speckled look of a modern synthetic track: fine grit plus a faint grid
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 34;
    img.data[i] = clamp255(163 + n);
    img.data[i + 1] = clamp255(58 + n * 0.7);
    img.data[i + 2] = clamp255(38 + n * 0.6);
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1;
  const cells = 32;
  for (let i = 0; i <= cells; i++) {
    const p = (i / cells) * s;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, s);
    g.moveTo(0, p);
    g.lineTo(s, p);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(TRACK.lanes * 1.6, (STRAIGHT_END / 6) * (detail / 48));
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function checkerTexture(squares: number): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const n = 8;
  const q = s / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      g.fillStyle = (x + y) % 2 === 0 ? '#f4f6f8' : '#1d2129';
      g.fillRect(x * q, y * q, q, q);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(squares, squares * 0.35);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function numberTexture(n: number): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, s, s);
  g.fillStyle = '#f4f6f8';
  g.font = 'bold 92px Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), s / 2, s / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function grassTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1d4a2b';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 === 0 ? '#245734' : '#1a4026';
    g.fillRect(0, (i * s) / 8, s, s / 8);
  }
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${30 + Math.random() * 40},${90 + Math.random() * 50},${50 + Math.random() * 30},0.5)`;
    g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 90);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/* ------------------------------------------------------------------ */
/* starting blocks                                                     */
/* ------------------------------------------------------------------ */

function buildBlocks(): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.55, metalness: 0.55 });
  const pad = new THREE.MeshStandardMaterial({ color: 0x161a20, roughness: 0.9 });

  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.72), metal);
  rail.position.set(0, 0.03, 0.02);
  rail.castShadow = true;
  g.add(rail);

  // two adjustable footplates, the rear one tilted up on the block
  const mkPlate = (z: number, tilt: number, y: number, w: number) => {
    const p = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(w, 0.022, 0.26), pad);
    plate.castShadow = true;
    p.add(plate);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.03), metal);
    lip.position.set(0, 0.02, 0.13);
    p.add(lip);
    p.position.set(0, y, z);
    p.rotation.x = tilt;
    return p;
  };
  g.add(mkPlate(0.27, -0.06, 0.055, 0.34));
  g.add(mkPlate(-0.08, 0.62, 0.09, 0.34));
  return g;
}

/* ------------------------------------------------------------------ */
/* the track                                                           */
/* ------------------------------------------------------------------ */

export interface TrackBuild {
  group: THREE.Group;
  /** per-lane block group so the start sequence can animate them */
  blocks: THREE.Group[];
  dispose(): void;
}

export function buildTrack(q: QualityPreset): TrackBuild {
  const group = new THREE.Group();
  group.name = 'track';
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  const track = (o: THREE.BufferGeometry | THREE.Material | THREE.Texture): void => {
    disposables.push(o);
  };

  const halfW = TRACK_WIDTH / 2;
  const L = STRAIGHT_END;

  /* tartan surface */
  const tartan = tartanTexture(q.trackDetail);
  const surfMat = new THREE.MeshStandardMaterial({ map: tartan, roughness: 0.94, metalness: 0 });
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH, L), surfMat);
  surf.rotation.x = -Math.PI / 2;
  surf.position.z = L / 2;
  surf.receiveShadow = q.shadows;
  group.add(surf);
  track(surf.geometry);
  track(surfMat);
  track(tartan);

  /* run-off apron either side */
  const apronMat = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.96 });
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(TRACK.runoff * 0.5 + 2.4, L), apronMat);
    a.rotation.x = -Math.PI / 2;
    a.position.set(s * (halfW + 1.2 + (TRACK.runoff * 0.5 + 2.4) / 2 - 1.2), 0.001, L / 2);
    a.receiveShadow = q.shadows;
    group.add(a);
    track(a.geometry);
  }
  track(apronMat);

  /* infield */
  const grass = grassTexture();
  const grassMat = new THREE.MeshStandardMaterial({ map: grass, roughness: 1 });
  const infield = new THREE.Mesh(new THREE.PlaneGeometry(70, L + 60), grassMat);
  infield.rotation.x = -Math.PI / 2;
  infield.position.set(0, -0.004, L / 2);
  infield.receiveShadow = q.shadows;
  group.add(infield);
  track(infield.geometry);
  track(grassMat);
  track(grass);

  /* kerbs */
  const kerbMat = new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.7 });
  for (const s of [-1, 1]) {
    const k = new THREE.Mesh(new THREE.BoxGeometry(TRACK.kerbWidth, 0.12, L), kerbMat);
    k.position.set(s * (halfW + TRACK.kerbWidth / 2), 0.06, L / 2);
    k.castShadow = q.shadows;
    k.receiveShadow = q.shadows;
    group.add(k);
    track(k.geometry);
  }
  track(kerbMat);

  /* line work: lane lines, start, finish, distance ticks — merged */
  const paint = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.8 });
  const parts: THREE.BufferGeometry[] = [];
  const line = (w: number, len: number, x: number, z: number, y = 0.004): void => {
    const p = new THREE.PlaneGeometry(w, len);
    p.rotateX(-Math.PI / 2);
    p.translate(x, y, z);
    parts.push(p);
  };
  for (let i = 0; i <= TRACK.lanes; i++) line(0.05, L, -halfW + i * TRACK.laneWidth, L / 2);
  line(TRACK_WIDTH, 0.12, 0, 0); // start line
  // distance marks every 10 m, longer at 50 m
  for (let m = 10; m < TRACK.raceDistance; m += 10) {
    const w = m % 50 === 0 ? 0.5 : 0.3;
    line(w, 0.06, -halfW + 0.35 + w / 2, m);
    line(w, 0.06, halfW - 0.35 - w / 2, m);
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (merged) {
    const paintMesh = new THREE.Mesh(merged, paint);
    paintMesh.receiveShadow = q.shadows;
    group.add(paintMesh);
    track(merged);
  }
  track(paint);

  /* finish line: chequered, slightly proud of the tartan */
  const checker = checkerTexture(1);
  const finMat = new THREE.MeshStandardMaterial({ map: checker, roughness: 0.75 });
  const fin = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH, 0.4), finMat);
  fin.rotation.x = -Math.PI / 2;
  fin.position.set(0, 0.006, TRACK.raceDistance);
  group.add(fin);
  track(fin.geometry);
  track(finMat);
  track(checker);

  /* lane numbers painted just behind the start line */
  const numGeo = new THREE.PlaneGeometry(0.6, 0.6);
  track(numGeo);
  for (let i = 0; i < TRACK.lanes; i++) {
    const m = new THREE.MeshStandardMaterial({
      map: numberTexture(i + 1),
      transparent: true,
      roughness: 0.85,
      depthWrite: false,
    });
    const n = new THREE.Mesh(numGeo, m);
    n.rotation.x = -Math.PI / 2;
    n.rotation.z = Math.PI;
    n.position.set(laneX(i), 0.005, -1.6);
    group.add(n);
    track(m);
  }

  /* starting blocks, one set per lane, 1.1 m behind the line */
  const blocks: THREE.Group[] = [];
  for (let i = 0; i < TRACK.lanes; i++) {
    const b = buildBlocks();
    b.position.set(laneX(i), 0, -1.1);
    group.add(b);
    blocks.push(b);
  }

  return {
    group,
    blocks,
    dispose(): void {
      for (const d of disposables) d.dispose();
      blocks.forEach((b) => b.traverse((o) => (o as THREE.Mesh).geometry?.dispose()));
    },
  };
}
