/**
 * Procedural humanoid — a 15-bone rig built from tapered segments, muscle
 * masses and kit shells, with no external model dependency.
 *
 * Hierarchy
 *   root
 *    └ hips
 *       ├ spine → chest → neck → head
 *       │           ├ clavicleL → upperArmL → foreArmL → handL
 *       │           └ clavicleR → upperArmR → foreArmR → handR
 *       ├ thighL → shinL → footL → toeL
 *       └ thighR → shinR → footR → toeR
 */

import * as THREE from 'three';
import type { Limb } from '../biomechanics/athlete';

export type BoneName =
  | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'clavicleL' | 'upperArmL' | 'foreArmL' | 'handL'
  | 'clavicleR' | 'upperArmR' | 'foreArmR' | 'handR'
  | 'thighL' | 'shinL' | 'footL' | 'toeL'
  | 'thighR' | 'shinR' | 'footR' | 'toeR';

export type Detail = 'low' | 'medium' | 'high';

export interface Appearance {
  skin: number;
  hair: number;
  hairStyle: 'buzz' | 'fade' | 'crop' | 'bun' | 'locs';
  kitPrimary: number;
  kitSecondary: number;
  shoeA: number;
  shoeB: number;
  bib: number;
  nation: string;
  /** 0 = no headband, else the band colour */
  headband: number;
}

export interface BodyShape {
  /** multiplies limb length (0.95 = short-limbed sprinter) */
  limbScale: number;
  /** multiplies torso width */
  mass: number;
  /** shoulder width multiplier */
  shoulders: number;
  /** thigh girth multiplier */
  muscle: number;
}

export const DEFAULT_SHAPE: BodyShape = { limbScale: 1, mass: 1, shoulders: 1, muscle: 1 };

export interface Humanoid {
  root: THREE.Group;
  bones: Record<BoneName, THREE.Group>;
  skinMats: THREE.MeshStandardMaterial[];
  kitMats: THREE.MeshStandardMaterial[];
  hairGroup: THREE.Group | null;
  boneCount: number;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function tapered(rt: number, rb: number, len: number, seg = 10): THREE.BufferGeometry {
  const key = `t${rt.toFixed(3)}_${rb.toFixed(3)}_${len.toFixed(3)}_${seg}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const g = new THREE.CylinderGeometry(rt, rb, len, seg, 1, false);
  g.translate(0, -len / 2, 0);
  geoCache.set(key, g);
  return g;
}

function ball(r: number, seg = 12): THREE.BufferGeometry {
  const key = `b${r.toFixed(3)}_${seg}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 3));
  geoCache.set(key, g);
  return g;
}

function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `x${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const g = new THREE.BoxGeometry(w, h, d);
  geoCache.set(key, g);
  return g;
}

function bibTexture(num: number, primary: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 160;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f6f7f9';
  x.fillRect(0, 0, 128, 160);
  x.fillStyle = `#${primary.toString(16).padStart(6, '0')}`;
  x.fillRect(0, 0, 128, 36);
  x.fillStyle = '#fff';
  x.font = '700 20px system-ui, sans-serif';
  x.textAlign = 'center';
  x.fillText('GLOBAL SPRINT', 64, 25);
  x.fillStyle = '#12151c';
  x.font = '800 84px system-ui, sans-serif';
  x.fillText(String(num), 64, 122);
  x.strokeStyle = '#c8ced8';
  x.lineWidth = 3;
  x.strokeRect(1.5, 1.5, 125, 157);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function nationFlagTexture(a: number, b: number, seed: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 40;
  const x = c.getContext('2d')!;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  x.fillStyle = hex(a);
  x.fillRect(0, 0, 64, 40);
  if (seed % 3 === 0) {
    x.fillStyle = hex(b);
    x.fillRect(0, 14, 64, 12);
  } else if (seed % 3 === 1) {
    x.fillStyle = hex(b);
    x.beginPath();
    x.arc(32, 20, 11, 0, Math.PI * 2);
    x.fill();
  } else {
    x.fillStyle = hex(b);
    x.beginPath();
    x.moveTo(0, 0);
    x.lineTo(32, 20);
    x.lineTo(0, 40);
    x.closePath();
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeFlag(nationSeed: number, a: number, b: number): THREE.Texture {
  return nationFlagTexture(a, b, nationSeed);
}

function seg(
  parent: THREE.Object3D,
  mat: THREE.Material,
  rt: number,
  rb: number,
  len: number,
  zs = 0.9,
  segs = 10,
): THREE.Mesh {
  const m = new THREE.Mesh(tapered(rt, rb, len, segs), mat);
  m.scale.z = zs;
  m.castShadow = true;
  parent.add(m);
  return m;
}

function ballMesh(
  parent: THREE.Object3D,
  mat: THREE.Material,
  r: number,
  px: number,
  py: number,
  pz: number,
  sx: number,
  sy: number,
  sz: number,
): THREE.Mesh {
  const m = new THREE.Mesh(ball(r), mat);
  m.position.set(px, py, pz);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function boxMesh(
  parent: THREE.Object3D,
  mat: THREE.Material,
  w: number,
  h: number,
  d: number,
  px: number,
  py: number,
  pz: number,
): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.position.set(px, py, pz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function buildHumanoid(
  limb: Limb,
  look: Appearance,
  shape: BodyShape = DEFAULT_SHAPE,
  detail: Detail = 'high',
): Humanoid {
  const l = limb;
  const bones = {} as Record<BoneName, THREE.Group>;
  const mk = (name: BoneName, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.name = name;
    parent.add(g);
    bones[name] = g;
    return g;
  };

  const skinColor = new THREE.Color(look.skin);
  const skin = new THREE.MeshStandardMaterial({
    color: look.skin,
    roughness: 0.66,
    metalness: 0,
    // cheap subsurface stand-in: a little self-illumination so shadowed skin
    // keeps the warm bounce of light through flesh instead of going grey
    emissive: skinColor.clone().multiplyScalar(0.07),
  });
  const kit = new THREE.MeshStandardMaterial({
    color: look.kitPrimary,
    roughness: 0.52,
    metalness: 0.02,
  });
  const kit2 = new THREE.MeshStandardMaterial({ color: look.kitSecondary, roughness: 0.55, metalness: 0.02 });
  const shoeM = new THREE.MeshStandardMaterial({ color: look.shoeA, roughness: 0.32, metalness: 0.06 });
  const soleM = new THREE.MeshStandardMaterial({ color: look.shoeB, roughness: 0.4, metalness: 0.08 });
  const hairM = new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.94, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171e, roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xeef1f6, roughness: 0.6 });
  const bibM = new THREE.MeshStandardMaterial({ map: bibTexture(look.bib, look.kitPrimary), roughness: 0.85 });
  const bandM =
    look.headband !== 0
      ? new THREE.MeshStandardMaterial({ color: look.headband, roughness: 0.7 })
      : null;

  const M = shape.mass;
  const MU = shape.muscle;
  const th = l.thigh * shape.limbScale;
  const sh = l.shank * shape.limbScale;
  const ua = l.upperArm * shape.limbScale;
  const fa = l.foreArm * shape.limbScale;

  const root = new THREE.Group();
  root.name = 'athlete';
  const hips = mk('hips', root, 0, l.hipHeight, 0);

  /* ---------------- torso ---------------- */
  ballMesh(hips, skin, 0.15 * M, 0, 0, 0, 1.02, 0.86, 0.82 * shape.mass); // pelvis
  const spine = mk('spine', hips, 0, 0.12 * shape.mass, 0);
  ballMesh(spine, skin, 0.135 * M, 0, 0.08, 0.004, 1, 0.95, 0.84);
  const chest = mk('chest', spine, 0, l.torso * 0.62, 0);
  ballMesh(chest, skin, 0.168 * M, 0, 0.02, 0, 1, 1.16, 0.74);
  for (const s of [-1, 1]) {
    ballMesh(chest, skin, 0.074, s * 0.074 * M, 0.072, 0.098 * M, 1, 0.8, 0.62); // pec
    ballMesh(chest, skin, 0.062, s * 0.142 * M, 0.03, -0.035, 0.85, 1.9, 1.3); // lat
    ballMesh(chest, skin, 0.07, s * 0.082 * M, 0.15, -0.02, 1, 0.7, 0.8); // trap
  }
  // racing singlet: a shell that follows the chest, worn over the muscles
  ballMesh(chest, kit, 0.178 * M, 0, 0.012, 0, 1, 1.2, 0.77);
  boxMesh(chest, kit, 0.046, 0.2, 0.05, -0.078 * M, 0.17, 0.012);
  boxMesh(chest, kit, 0.046, 0.2, 0.05, 0.078 * M, 0.17, 0.012);
  ballMesh(hips, kit2, 0.162 * M, 0, -0.004, 0, 1.06, 0.9, 0.86); // briefs
  boxMesh(hips, kit, 0.3 * M, 0.052, 0.24, 0, 0.104, 0); // waistband
  const bibGeo = new THREE.PlaneGeometry(0.14, 0.175);
  const bibF = new THREE.Mesh(bibGeo, bibM);
  bibF.position.set(0, 0.08, 0.152 * M);
  chest.add(bibF);
  if (detail !== 'low') {
    const bibB = new THREE.Mesh(bibGeo, bibM);
    bibB.position.set(0, 0.08, -0.126 * M);
    bibB.rotation.y = Math.PI;
    chest.add(bibB);
  }

  const neck = mk('neck', chest, 0, l.torso * 0.62 + l.neck * 0.6, 0);
  seg(neck, skin, 0.05 * M, 0.062 * M, l.neck * 1.2, 0.95, 8);
  const head = mk('head', neck, 0, l.neck * 1.25, 0);

  /* ---------------- head ---------------- */
  const hr = l.headRadius;
  ballMesh(head, skin, hr, 0, 0.012, 0, 0.98, 1.14, 1.06); // cranium
  ballMesh(head, skin, hr * 0.74, 0, -0.055 * (hr / 0.13), 0.012, 0.92, 0.78, 0.98); // jaw
  const nose = new THREE.Mesh(new THREE.ConeGeometry(hr * 0.21, hr * 0.52, 7), skin);
  nose.rotation.x = Math.PI * 0.55;
  nose.position.set(0, -0.01, hr * 0.96);
  head.add(nose);
  if (detail === 'high') {
    const mouth = boxMesh(head, dark, hr * 0.46, hr * 0.13, hr * 0.2, 0, -hr * 0.62, hr * 0.84);
    mouth.rotation.x = 0.28;
    for (const s of [-1, 1]) {
      ballMesh(head, white, hr * 0.19, s * hr * 0.37, hr * 0.12, hr * 0.82, 1, 0.7, 0.6);
      ballMesh(head, dark, hr * 0.095, s * hr * 0.39, hr * 0.11, hr * 0.9, 1, 1, 0.7);
      const brow = boxMesh(head, hairM, hr * 0.44, hr * 0.11, hr * 0.22, s * hr * 0.38, hr * 0.37, hr * 0.83);
      brow.rotation.z = -s * 0.1;
    }
  }
  for (const s of [-1, 1]) ballMesh(head, skin, hr * 0.21, s * hr * 0.96, -0.004, 0.004, 0.55, 1.5, 1.0); // ears

  const hairGroup = new THREE.Group();
  head.add(hairGroup);
  const capLen = look.hairStyle === 'buzz' ? 1.35 : 1.62;
  const capScale = look.hairStyle === 'buzz' ? 0.96 : 1.02;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(hr * 1.04, 16, 10, 0, Math.PI * 2, 0, capLen), hairM);
  cap.position.y = 0.012;
  cap.scale.set(capScale, look.hairStyle === 'buzz' ? 1.02 : 1.13, capScale);
  cap.castShadow = true;
  hairGroup.add(cap);
  if (look.hairStyle === 'bun') {
    ballMesh(hairGroup, hairM, hr * 0.44, 0, hr * 0.66, -hr * 1.05, 1, 0.95, 1);
    const tail = seg(hairGroup, hairM, hr * 0.26, hr * 0.11, hr * 1.05, 1, 7);
    tail.position.set(0, hr * 0.6, -hr * 1.24);
    tail.rotation.x = 0.85;
  } else if (look.hairStyle === 'locs') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const l2 = seg(hairGroup, hairM, hr * 0.13, hr * 0.06, hr * (0.9 + (i % 3) * 0.35), 1, 6);
      l2.position.set(Math.cos(a) * hr * 0.7, hr * 0.5, Math.sin(a) * hr * 0.72 - hr * 0.1);
      l2.rotation.x = -0.4 + Math.sin(a) * 0.3;
      l2.rotation.z = -Math.cos(a) * 0.5;
    }
  } else if (look.hairStyle === 'crop') {
    const fade = ballMesh(hairGroup, hairM, hr * 0.5, 0, -hr * 0.3, -hr * 0.6, 1.1, 0.7, 0.9);
    fade.position.y = hr * 0.1;
  }
  if (bandM) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(hr * 1.06, hr * 1.06, hr * 0.32, 16, 1, true), bandM);
    band.position.set(0, hr * 0.44, -0.004);
    band.scale.z = 1.06;
    hairGroup.add(band);
    boxMesh(hairGroup, bandM, hr * 0.3, hr * 0.5, hr * 0.2, 0, hr * 0.38, -hr * 1.02);
  }

  /* ---------------- arms ---------------- */
  const sw = l.shoulderWidth * 0.5 * shape.shoulders;
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? 'L' : 'R';
    const clav = mk(`clavicle${side}` as BoneName, chest, s * sw * 0.42, l.torso * 0.5, 0);
    clav.rotation.z = s * 0.08;
    const arm = mk(`upperArm${side}` as BoneName, clav, s * sw * 0.58, 0, 0);
    ballMesh(arm, skin, 0.061 * M, 0, 0.004, 0, 1, 1.05, 1); // deltoid
    seg(arm, skin, 0.05 * M * MU, 0.037 * M * MU, ua, 0.92);
    const fore = mk(`foreArm${side}` as BoneName, arm, 0, -ua, 0);
    ballMesh(fore, skin, 0.041 * M, 0, 0, 0, 1, 0.9, 1); // elbow
    seg(fore, skin, 0.039 * M * MU, 0.027 * M * MU, fa, 0.9);
    const hand = mk(`hand${side}` as BoneName, fore, 0, -fa, 0);
    ballMesh(hand, skin, 0.036 * M, 0, -0.03, 0, 0.85, 1.5, 0.6);
    if (detail === 'high') boxMesh(hand, skin, 0.042, 0.068, 0.029, 0, -0.062, 0.005);
  }

  /* ---------------- legs ---------------- */
  const hw = l.hipWidth * 0.5;
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? 'L' : 'R';
    const thigh = mk(`thigh${side}` as BoneName, hips, s * hw, 0.015, 0);
    seg(thigh, skin, 0.085 * M * MU, 0.054 * M * MU, th, 0.88);
    ballMesh(thigh, skin, 0.055 * M, 0, -th * 0.36, 0.045 * M, 0.8, 2.0, 0.7); // quad
    if (detail !== 'low') seg(thigh, kit2, 0.092 * M, 0.082 * M, 0.2, 0.9, 8); // briefs leg
    const shin = mk(`shin${side}` as BoneName, thigh, 0, -th, 0);
    ballMesh(shin, skin, 0.051 * M, 0, 0.004, 0.01, 1, 0.85, 0.95); // knee
    seg(shin, skin, 0.055 * M * MU, 0.033 * M * MU, sh, 0.9);
    ballMesh(shin, skin, 0.045 * M, 0, -sh * 0.17, -0.042, 0.85, 2.1, 1.0); // calf
    const foot = mk(`foot${side}` as BoneName, shin, 0, -sh, 0);
    ballMesh(foot, shoeM, 0.042 * M, 0, -0.038, 0.046, 0.95, 0.85, 2.3); // upper
    boxMesh(foot, soleM, 0.082, 0.02, 0.25, 0, -0.068, 0.045); // spike plate
    const toe = mk(`toe${side}` as BoneName, foot, 0, 0, 0);
    boxMesh(toe, soleM, 0.058, 0.026, 0.048, 0, -0.055, 0.15);
  }

  let boneCount = 0;
  root.traverse(() => boneCount++);

  return {
    root,
    bones,
    skinMats: [skin],
    kitMats: [kit, kit2],
    hairGroup,
    boneCount,
  };
}
