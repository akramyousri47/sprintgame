/**
 * The stadium bowl: stands, crowd, floodlight masts, the big screen, sky and
 * the lighting rig, plus optional rain.
 *
 * The crowd is one instanced mesh of 900-7000 seats' worth of bodies with
 * per-instance colour, so a full stadium costs a single draw call. Lighting is
 * deliberately cheap: one shadow-casting key that the race code drags along
 * with the action, a hemisphere fill, and emissive geometry for everything
 * that is only pretending to be a light source.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../game/config';
import type { QualityPreset } from '../game/config';
import { STRAIGHT_END, TRACK_WIDTH } from './track';

export interface StadiumBuild {
  group: THREE.Group;
  key: THREE.DirectionalLight;
  /** where the key light's shadow frustum should centre, updated by the race */
  focus: THREE.Vector3;
  /** the big screen canvas, handed to the results system */
  screen: Screen;
  /** set as scene.background */
  sky: THREE.Texture;
  /** set as scene.fog */
  fog: THREE.Fog;
  rain: THREE.Points | null;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

export interface Screen {
  mesh: THREE.Mesh;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

/* ------------------------------------------------------------------ */

function crowdTexture(): THREE.Texture {
  const w = 512;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const rng = makeRng(0x51a7c0de);
  g.fillStyle = '#12151b';
  g.fillRect(0, 0, w, h);
  const cols = 190;
  const rows = 26;
  const cw = w / cols;
  const ch = h / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (rng() < 0.07) continue; // empty seats
      const hue = rng();
      const l = 26 + rng() * 46;
      const sat = 12 + rng() * 62;
      g.fillStyle = `hsl(${Math.floor(hue * 360)},${sat}%,${l}%)`;
      const px = x * cw + cw * 0.15;
      const py = y * ch + ch * 0.1;
      g.fillRect(px, py, cw * 0.7, ch * 0.62);
      // head
      g.beginPath();
      g.arc(px + cw * 0.35, py + ch * 0.12, Math.min(cw, ch) * 0.22, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function trussTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d1015';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = '#39414d';
  g.lineWidth = 2;
  for (let i = -s; i < s * 2; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + s, s);
    g.moveTo(i + s, 0);
    g.lineTo(i, s);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function skyTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#05070d');
  grad.addColorStop(0.45, '#0b1220');
  grad.addColorStop(0.72, '#16263c');
  grad.addColorStop(1, '#243a53');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

export function buildStadium(q: QualityPreset): StadiumBuild {
  const group = new THREE.Group();
  group.name = 'stadium';
  const junk: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  const keep = <T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(x: T): T => {
    junk.push(x);
    return x;
  };
  const rng = makeRng(0x2badf00d);
  const disposables: { dispose(): void }[] = [];

  const halfW = TRACK_WIDTH / 2;
  const standLen = STRAIGHT_END * 0.92;
  const standMid = STRAIGHT_END * 0.5;

  /* ---------------- stands ---------------- */
  const rows = 24;
  const rowRise = 0.44;
  const rowDepth = 0.92;
  const crowd = keep(crowdTexture());
  crowd.repeat.set(standLen / 6, 1);
  const seatMat = keep(
    new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.95, metalness: 0 }),
  );
  const concrete = keep(new THREE.MeshStandardMaterial({ color: 0x232a34, roughness: 0.9 }));
  const structGeos: THREE.BufferGeometry[] = [];
  const seatGeos: THREE.BufferGeometry[] = [];

  for (const s of [-1, 1] as const) {
    for (let r = 0; r < rows; r++) {
      const x = s * (halfW + 8.5 + r * rowDepth);
      const y = 1.1 + r * rowRise;
      // seat deck, slightly tilted forward
      const deck = new THREE.BoxGeometry(rowDepth, rowRise, standLen);
      deck.translate(x, y, standMid);
      seatGeos.push(deck);
      // riser under it, in bare concrete
      const riser = new THREE.BoxGeometry(rowDepth * 0.16, rowRise, standLen);
      riser.translate(x - s * rowDepth * 0.42, y - rowRise / 2, standMid);
      structGeos.push(riser);
    }
    // back wall
    const back = new THREE.BoxGeometry(0.5, rows * rowRise + 6, standLen);
    back.translate(s * (halfW + 9.2 + rows * rowDepth), (rows * rowRise) / 2 + 1, standMid);
    structGeos.push(back);
  }

  // end stands behind the start and past the finish
  for (const end of [-1, 1] as const) {
    for (let r = 0; r < rows; r++) {
      const z = end * (halfW + 12 + r * rowDepth);
      const y = 1.1 + r * rowRise;
      const deck = new THREE.BoxGeometry(standLen * 0.5, rowRise, rowDepth);
      deck.translate(0, y, z);
      seatGeos.push(deck);
    }
  }

  const seatMerged = mergeGeometries(seatGeos, false);
  const structMerged = mergeGeometries(structGeos, false);
  for (const g of [...seatGeos, ...structGeos]) g.dispose();
  if (seatMerged) {
    const m = new THREE.Mesh(seatMerged, seatMat);
    m.receiveShadow = false;
    group.add(m);
    keep(seatMerged);
  }
  if (structMerged) {
    group.add(new THREE.Mesh(structMerged, keep(concrete)));
    keep(structMerged);
  }

  /* ---------------- crowd bodies ---------------- */
  const personGeo = keep(new THREE.BoxGeometry(0.34, 0.62, 0.3));
  const personMat = keep(new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }));
  const count = q.crowdCount;
  const people = new THREE.InstancedMesh(personGeo, personMat, count);
  const m4 = new THREE.Matrix4();
  const qt = new THREE.Quaternion();
  const eu = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const r = Math.floor(rng() * rows);
    const x = side * (halfW + 8.5 + r * rowDepth + (rng() - 0.5) * 0.5);
    const y = 1.1 + r * rowRise + 0.45;
    const z = -8 + rng() * (standLen + 16);
    pos.set(x, y, z);
    eu.set(0, side > 0 ? -Math.PI / 2 : Math.PI / 2, (rng() - 0.5) * 0.18);
    qt.setFromEuler(eu);
    const sc = 0.85 + rng() * 0.35;
    scl.set(sc, sc, sc);
    m4.compose(pos, qt, scl);
    people.setMatrixAt(i, m4);
    col.setHSL(rng(), 0.15 + rng() * 0.6, 0.22 + rng() * 0.4);
    people.setColorAt(i, col);
  }
  people.instanceMatrix.needsUpdate = true;
  if (people.instanceColor) people.instanceColor.needsUpdate = true;
  people.frustumCulled = false;
  group.add(people);
  disposables.push(people);

  /* ---------------- roof + trusses ---------------- */
  const truss = keep(trussTexture());
  truss.repeat.set(standLen / 4, 3);
  const roofMat = keep(
    new THREE.MeshStandardMaterial({ map: truss, color: 0x2a3038, roughness: 0.7, side: THREE.DoubleSide }),
  );
  const roofGeo = new THREE.BoxGeometry(rows * rowDepth + 6, 0.35, standLen);
  keep(roofGeo);
  for (const s of [-1, 1] as const) {
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(s * (halfW + 8.5 + (rows * rowDepth) / 2), rows * rowRise + 6.5, standMid);
    group.add(roof);
  }

  /* ---------------- floodlight masts ---------------- */
  const mastMat = keep(new THREE.MeshStandardMaterial({ color: 0x30363f, roughness: 0.6, metalness: 0.4 }));
  const lampMat = keep(
    new THREE.MeshStandardMaterial({
      color: 0xfff6d8,
      emissive: 0xfff3cf,
      emissiveIntensity: 2.4,
      roughness: 0.3,
    }),
  );
  const mastGeo = keep(new THREE.CylinderGeometry(0.32, 0.5, 34, 10));
  const headGeo = keep(new THREE.BoxGeometry(4.2, 2.6, 0.5));
  const lampGeo = keep(new THREE.BoxGeometry(1.25, 1.05, 0.2));
  for (const s of [-1, 1] as const) {
    for (const z of [12, STRAIGHT_END - 14]) {
      const mastX = s * (halfW + rows * rowDepth + 4);
      const mast = new THREE.Mesh(mastGeo, mastMat);
      mast.position.set(mastX, 17, z);
      group.add(mast);

      // the head is a group so the lamps can be laid out in its local space
      // and simply pointed at the track
      const head = new THREE.Group();
      head.position.set(mastX, 34.4, z);
      head.lookAt(0, 6, z);
      const frame = new THREE.Mesh(headGeo, mastMat);
      head.add(frame);
      for (let cx = -1; cx <= 1; cx++) {
        for (let cy = -1; cy <= 1; cy += 2) {
          const lamp = new THREE.Mesh(lampGeo, lampMat);
          lamp.position.set(cx * 1.3, cy * 1.05, 0.3);
          head.add(lamp);
        }
      }
      group.add(head);
    }
  }

  /* ---------------- big screen ---------------- */
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 1024;
  screenCanvas.height = 512;
  const screenCtx = screenCanvas.getContext('2d')!;
  screenCtx.fillStyle = '#0a0d13';
  screenCtx.fillRect(0, 0, 1024, 512);
  const screenTex = keep(new THREE.CanvasTexture(screenCanvas));
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screenMat = keep(
    new THREE.MeshStandardMaterial({
      map: screenTex,
      emissiveMap: screenTex,
      emissive: 0xffffff,
      emissiveIntensity: 1.25,
      roughness: 0.5,
    }),
  );
  const screenGeo = keep(new THREE.BoxGeometry(15, 7.5, 0.6));
  const screenMesh = new THREE.Mesh(screenGeo, screenMat);
  screenMesh.position.set(0, 12, STRAIGHT_END + 16);
  screenMesh.rotation.y = Math.PI;
  group.add(screenMesh);
  const screenFrame = new THREE.Mesh(
    new THREE.BoxGeometry(16.4, 8.9, 0.5),
    keep(new THREE.MeshStandardMaterial({ color: 0x161a20, roughness: 0.8 })),
  );
  screenFrame.position.copy(screenMesh.position);
  screenFrame.position.z += 0.4;
  group.add(screenFrame);

  /* ---------------- sky + fog ---------------- */
  const sky = keep(skyTexture());
  const fog = new THREE.Fog(0x101a28, 60, 320);

  /* ---------------- lighting ---------------- */
  const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x1b2028, 0.55);
  group.add(hemi);

  const key = new THREE.DirectionalLight(0xfff2dc, 2.15);
  key.position.set(-38, 52, 26);
  key.castShadow = q.shadows;
  if (q.shadows) {
    key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const c = key.shadow.camera as THREE.OrthographicCamera;
    c.left = -26;
    c.right = 26;
    c.top = 22;
    c.bottom = -12;
    c.near = 20;
    c.far = 160;
    key.shadow.bias = -0.0009;
    key.shadow.normalBias = 0.022;
  }
  group.add(key);
  group.add(key.target);

  // a soft fill from the opposite side so the far limbs are not black
  const fill = new THREE.DirectionalLight(0xa8c4ff, 0.5);
  fill.position.set(40, 30, -30);
  group.add(fill);

  /* ---------------- rain ---------------- */
  let rain: THREE.Points | null = null;
  if (q.rain) {
    const n = 2600;
    const posArr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      posArr[i * 3] = (rng() - 0.5) * 60;
      posArr[i * 3 + 1] = rng() * 26;
      posArr[i * 3 + 2] = rng() * 140;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const rm = new THREE.PointsMaterial({
      color: 0xaecbe6,
      size: 0.055,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    rain = new THREE.Points(rg, rm);
    rain.frustumCulled = false;
    group.add(rain);
    keep(rg);
    keep(rm);
  }

  const focus = new THREE.Vector3(0, 1, 8);

  return {
    group,
    key,
    focus,
    screen: { mesh: screenMesh, ctx: screenCtx, texture: screenTex },
    sky,
    fog,
    rain,
    update(dt: number, elapsed: number): void {
      if (!rain) return;
      const p = rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const a = p.array as Float32Array;
      for (let i = 0; i < a.length; i += 3) {
        a[i + 1] -= (16 + (i % 7)) * dt;
        a[i] += 1.6 * dt;
        if (a[i + 1] < 0) {
          a[i + 1] = 26;
          a[i] = (rng() - 0.5) * 60;
          a[i + 2] = (rng() - 0.5) * 30 + focus.z;
        }
      }
      p.needsUpdate = true;
      void elapsed;
    },
    dispose(): void {
      for (const d of junk) d.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

/** paint the big screen; the results and HUD layers call this */
export function drawScreen(screen: Screen, draw: (ctx: CanvasRenderingContext2D) => void): void {
  draw(screen.ctx);
  screen.texture.needsUpdate = true;
}
