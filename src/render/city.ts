import * as THREE from 'three';
import { Rng, hashSeed } from '../core/rng';
import { tuning } from '../data/tuning';
import type { AreaLayout, Box, Decor } from '../sim/gen/layout';
import { cityMaterials, PALETTE, pavingTexture, pick, type CityMaterials } from './materials';

/**
 * Builds the static scene for an area: paving, canals and the harbour, the
 * buildings (instanced boxes with procedural facades), all decor, and a
 * skyline that carries the city on past the play space.
 */

class Batch {
  private readonly m: THREE.Matrix4[] = [];
  private readonly c: THREE.Color[] = [];
  constructor(
    private readonly geo: THREE.BufferGeometry,
    private readonly mat: THREE.Material,
    private readonly cast = true,
    private readonly receive = true,
  ) {}
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, color?: number, q?: THREE.Quaternion): void {
    const mtx = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q ?? new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    this.m.push(mtx);
    this.c.push(new THREE.Color(color ?? 0xffffff));
  }
  build(group: THREE.Group): THREE.InstancedMesh | null {
    if (!this.m.length) return null;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.m.length);
    this.m.forEach((mtx, i) => {
      mesh.setMatrixAt(i, mtx);
      mesh.setColorAt(i, this.c[i]!);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = this.cast;
    mesh.receiveShadow = this.receive;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  }
}

const yawQ = (yaw: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

function archGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0);
  s.lineTo(-0.32, 0);
  s.lineTo(-0.32, 0.5);
  s.absarc(0, 0.5, 0.32, Math.PI, 0, true);
  s.lineTo(0.32, 0);
  s.lineTo(0.5, 0);
  s.lineTo(0.5, 1);
  s.lineTo(-0.5, 1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -0.5);
  return g;
}

export interface CityView {
  group: THREE.Group;
  jets: THREE.InstancedMesh | null;
}

export function buildCity(layout: AreaLayout): CityView {
  const mats = cityMaterials();
  const group = new THREE.Group();
  const S = layout.blockSize;
  const T = layout.gridSize * S;
  buildGround(layout, group, mats, T, S);
  buildBoxes(layout, group, mats);
  const jets = buildDecor(layout.decor, group, mats, layout);
  buildSkyline(layout, group, mats, T);
  return { group, jets };
}

// ------------------------------------------------------------------ ground

function buildGround(layout: AreaLayout, group: THREE.Group, mats: CityMaterials, T: number, S: number): void {
  const half = tuning.gen.canalWidth / 2;
  const tex = pavingTexture((g, px) => {
    for (const c of layout.cells) {
      const x0 = c.i * S * px;
      const z0 = c.j * S * px;
      const w = S * px;
      const base =
        c.type === 'street' ? '#e6dfd1' : c.type === 'piazza' ? (c.tag === 'quay' ? '#cbc2b0' : '#ece5d7') : c.type === 'courtyard' ? '#ddd3bd' : c.type === 'alley' ? '#d4cab6' : c.type === 'canal' ? '#ddd3bf' : '#bdb3a2';
      g.fillStyle = base;
      g.fillRect(x0, z0, w, w);
      // Slab joints: large slabs on boulevards and piazzas, cobbles in lanes.
      const slab = c.type === 'alley' ? 1.0 : c.type === 'courtyard' ? 1.5 : 2.4;
      g.strokeStyle = 'rgba(80,70,55,0.18)';
      g.lineWidth = 1;
      for (let k = 0; k <= S / slab; k++) {
        g.beginPath();
        g.moveTo(x0 + k * slab * px, z0);
        g.lineTo(x0 + k * slab * px, z0 + w);
        g.stroke();
      }
      for (let k = 0; k <= S / (slab * 0.6); k++) {
        g.beginPath();
        g.moveTo(x0, z0 + k * slab * 0.6 * px);
        g.lineTo(x0 + w, z0 + k * slab * 0.6 * px);
        g.stroke();
      }
      if (c.type === 'piazza' && c.tag !== 'quay') {
        // Radial inlay around the fountain.
        const cx = x0 + w / 2;
        const cz = z0 + w / 2;
        g.strokeStyle = 'rgba(150,120,80,0.35)';
        g.lineWidth = 3;
        for (const r of [5, 8, 10.5]) {
          g.beginPath();
          g.arc(cx, cz, r * px, 0, Math.PI * 2);
          g.stroke();
        }
        g.lineWidth = 2;
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2;
          g.beginPath();
          g.moveTo(cx + Math.cos(ang) * 5 * px, cz + Math.sin(ang) * 5 * px);
          g.lineTo(cx + Math.cos(ang) * 10.5 * px, cz + Math.sin(ang) * 10.5 * px);
          g.stroke();
        }
      }
      if (c.type === 'street') {
        // Inlaid bands along the boulevard.
        g.fillStyle = 'rgba(170,140,100,0.25)';
        const horiz = c.conn[1] || c.conn[3];
        if (horiz) {
          g.fillRect(x0, z0 + w / 2 - 2.6 * px, w, 0.5 * px);
          g.fillRect(x0, z0 + w / 2 + 2.1 * px, w, 0.5 * px);
        }
        if (c.conn[0] || c.conn[2]) {
          g.fillRect(x0 + w / 2 - 2.6 * px, z0, 0.5 * px, w);
          g.fillRect(x0 + w / 2 + 2.1 * px, z0, 0.5 * px, w);
        }
      }
      if (c.type === 'courtyard') {
        g.fillStyle = 'rgba(95,130,70,0.35)';
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) g.fillRect(x0 + w / 2 + sx * 6.5 * px - 3 * px, z0 + w / 2 + sz * 6.5 * px - 3 * px, 6 * px, 6 * px);
      }
    }
  }, T);
  // Quads per cell, leaving canal channels open so the water can sit lower.
  const pos: number[] = [];
  const uv: number[] = [];
  const quad = (x0: number, z0: number, x1: number, z1: number) => {
    const v = (x: number, z: number) => {
      pos.push(x, 0, z);
      uv.push(x / T, 1 - z / T);
    };
    v(x0, z0);
    v(x0, z1);
    v(x1, z0);
    v(x1, z0);
    v(x0, z1);
    v(x1, z1);
  };
  for (const c of layout.cells) {
    const x0 = c.i * S;
    const z0 = c.j * S;
    const cx = x0 + S / 2;
    const cz = z0 + S / 2;
    if (c.type !== 'canal') {
      quad(x0, z0, x0 + S, z0 + S);
      continue;
    }
    if (c.axis === 'z') {
      quad(x0, z0, cx - half, z0 + S);
      quad(cx + half, z0, x0 + S, z0 + S);
    } else {
      quad(x0, z0, x0 + S, cz - half);
      quad(x0, cz + half, x0 + S, z0 + S);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82 }));
  ground.receiveShadow = true;
  group.add(ground);
  // Beyond the edges: more paving (or the sea, for Porto's harbour side).
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ color: 0xcfc6b6, roughness: 0.9 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(T / 2, -0.03, T / 2);
  group.add(outer);
  if (layout.type === 'porto') {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(2600, 1300), mats.sea);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(T / 2, -1.1, -650 - 0.4);
    group.add(sea);
    const quay = new THREE.Mesh(new THREE.BoxGeometry(2600, 1.6, 0.6), mats.plain);
    quay.material = new THREE.MeshStandardMaterial({ color: 0xcfc4b0, roughness: 0.8 });
    quay.position.set(T / 2, -0.8, -0.4);
    group.add(quay);
  }
}

// ------------------------------------------------------------------ boxes

function boxMaterial(b: Box, layout: AreaLayout, mats: CityMaterials): { key: string; mat: THREE.Material; color: number; cast: boolean } {
  const t = b.tint ?? 0;
  const q = layout.type === 'quartieri';
  switch (b.look) {
    case 'palazzo':
    case 'perimeter':
      return { key: q ? 'quartieri' : 'palazzo', mat: q ? mats.quartieri : mats.palazzo, color: pick(q ? PALETTE.warm : PALETTE.marble, t), cast: true };
    case 'attic':
      return { key: q ? 'quartieri' : 'palazzo', mat: q ? mats.quartieri : mats.palazzo, color: pick(q ? PALETTE.warm : PALETTE.marble, t + 1), cast: true };
    case 'tower':
      return { key: 'tower', mat: mats.tower, color: 0xf3f5f7, cast: true };
    case 'podium':
      return { key: 'podium', mat: mats.podium, color: pick(PALETTE.marble, t), cast: true };
    case 'warehouse':
      return { key: 'warehouse', mat: mats.warehouse, color: pick(PALETTE.stone, t), cast: true };
    case 'fortress':
      return { key: 'fortress', mat: mats.fortress, color: pick(PALETTE.stone, t + 2), cast: true };
    case 'cornice':
      return { key: 'plain', mat: mats.plain, color: 0xf7f3ea, cast: true };
    case 'deck':
      return { key: 'plain', mat: mats.plain, color: 0xe9e2d4, cast: true };
    case 'step':
      return { key: 'plain', mat: mats.plain, color: 0xe2dacb, cast: true };
    case 'parapet':
      return { key: 'polished', mat: mats.polished, color: 0xf4efe6, cast: true };
    case 'basin':
      return { key: 'polished', mat: mats.polished, color: 0xf0ebe1, cast: true };
    case 'column':
      return { key: 'polished', mat: mats.polished, color: 0xf6f2ea, cast: true };
    case 'planter':
      return { key: 'plain', mat: mats.plain, color: 0xcfc1a3, cast: true };
    case 'bench':
      return { key: 'plain', mat: mats.plain, color: 0xd8cdb9, cast: true };
    case 'crate':
      return { key: 'wood', mat: mats.wood, color: pick([0x9c6b3f, 0x7f5539, 0x8b6a45, 0x6d4c33], t), cast: true };
    case 'hedge':
      return { key: 'hedge', mat: mats.hedge, color: 0xffffff, cast: true };
    case 'bollard':
      return { key: 'iron', mat: mats.iron, color: 0xffffff, cast: false };
    case 'marble':
      return { key: 'plain', mat: mats.plain, color: 0xeee7da, cast: true };
    default:
      return { key: 'plain', mat: mats.plain, color: 0xe8e1d4, cast: true };
  }
}

function buildBoxes(layout: AreaLayout, group: THREE.Group, mats: CityMaterials): void {
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 16);
  const batches = new Map<string, Batch>();
  const batch = (key: string, geo: THREE.BufferGeometry, mat: THREE.Material, cast: boolean) => {
    let b = batches.get(key);
    if (!b) batches.set(key, (b = new Batch(geo, mat, cast, true)));
    return b;
  };
  const capitals = batch('capitals', unitBox, mats.polished, true);
  for (const b of layout.boxes) {
    if (b.visible === false || b.look === 'none' || b.look === 'sea') continue;
    const m = boxMaterial(b, layout, mats);
    let q: THREE.Quaternion | undefined;
    if (b.tilt) q = new THREE.Quaternion().setFromAxisAngle(b.tilt.axis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), b.tilt.angle);
    if (b.cylinder) {
      batch(`cyl-${m.key}`, unitCyl, m.mat, m.cast).add(b.x, b.y, b.z, b.hx, b.hy * 2, b.hx, m.color);
      if (b.look === 'column') {
        const r = b.hx;
        capitals.add(b.x, b.y + b.hy - 0.14, b.z, r * 2.5, 0.28, r * 2.5, 0xf7f3ea);
        capitals.add(b.x, b.y - b.hy + 0.12, b.z, r * 2.3, 0.24, r * 2.3, 0xf2ede3);
      }
    } else batch(`box-${m.key}`, unitBox, m.mat, m.cast).add(b.x, b.y, b.z, b.hx * 2, b.hy * 2, b.hz * 2, m.color, q);
  }
  for (const b of batches.values()) b.build(group);
}

// ------------------------------------------------------------------ decor

function buildDecor(decor: Decor[], group: THREE.Group, mats: CityMaterials, layout: AreaLayout): THREE.InstancedMesh | null {
  const rng = new Rng(hashSeed(layout.seed, 'decor'));
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
  const cone = new THREE.ConeGeometry(1, 1, 8);
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const sphere = new THREE.SphereGeometry(1, 10, 8);
  const hemi = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const capsule = new THREE.CapsuleGeometry(0.3, 1, 3, 8);
  const arch = archGeometry();
  const disc = new THREE.CircleGeometry(1, 24);
  disc.rotateX(-Math.PI / 2);
  const obeliskGeo = new THREE.CylinderGeometry(0.62, 1, 1, 4);
  const pyramid = new THREE.ConeGeometry(0.62, 1, 4);

  const B = {
    plain: new Batch(box, mats.plain),
    polishedBox: new Batch(box, mats.polished),
    stoneBox: new Batch(box, mats.plain),
    bush: new Batch(ico, mats.foliage, false),
    blossom: new Batch(sphere, mats.blossom, false, false),
    cypress: new Batch(cone, mats.cypress),
    canopy: new Batch(ico, mats.foliage),
    trunk: new Batch(cyl, mats.wood),
    pole: new Batch(cyl, mats.iron, false),
    glow: new Batch(sphere, mats.lampGlow, false, false),
    figure: new Batch(capsule, mats.polished),
    bronzeFigure: new Batch(capsule, mats.bronze),
    dome: new Batch(hemi, mats.terracotta),
    drum: new Batch(cyl, mats.polished),
    water: new Batch(disc, mats.water, false),
    jets: new Batch(cyl, mats.spray, false, false),
    arch: new Batch(arch, mats.polished),
    banner: new Batch(box, mats.banner, false),
    posts: new Batch(cyl, mats.polished, false),
    hull: new Batch(box, mats.wood),
    crane: new Batch(box, mats.wood),
    obelisk: new Batch(obeliskGeo, mats.polished),
    pyramid: new Batch(pyramid, mats.bronze),
    channelWall: new Batch(box, mats.plain, false),
    channelWater: new Batch(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mats.water, false),
  };

  for (const d of decor) {
    const q = yawQ(d.yaw ?? 0);
    switch (d.kind) {
      case 'rose': {
        const w = d.w;
        const dd = d.d ?? d.w;
        B.bush.add(d.x, d.y + d.h * 0.4, d.z, w / 2, d.h, dd / 2, 0x4c7a38, q);
        const n = Math.max(4, Math.round(w * dd * 5));
        const c = Math.cos(d.yaw ?? 0);
        const s = Math.sin(d.yaw ?? 0);
        for (let k = 0; k < n; k++) {
          const lx = rng.range(-0.45, 0.45) * w;
          const lz = rng.range(-0.45, 0.45) * dd;
          const x = d.x + lx * c + lz * s;
          const z = d.z - lx * s + lz * c;
          const r = rng.range(0.07, 0.12);
          B.blossom.add(x, d.y + d.h * rng.range(0.7, 1.25), z, r, r, r, pick(PALETTE.rose, rng.int(0, 7)));
        }
        break;
      }
      case 'cypress':
        B.trunk.add(d.x, d.y + 0.5, d.z, 0.12, 1, 0.12, 0x5a4030);
        B.cypress.add(d.x, d.y + 0.6 + d.h / 2, d.z, d.w / 2, d.h, d.w / 2, 0xffffff);
        break;
      case 'tree':
        B.trunk.add(d.x, d.y + d.h * 0.3, d.z, 0.16, d.h * 0.6, 0.16, 0x6b4a2f);
        B.canopy.add(d.x, d.y + d.h * 0.68, d.z, d.w / 2, d.h * 0.36, d.w / 2, 0xffffff);
        break;
      case 'lamp':
        B.pole.add(d.x, d.y + d.h / 2, d.z, 0.07, d.h, 0.07);
        B.glow.add(d.x, d.y + d.h + 0.12, d.z, 0.2, 0.26, 0.2);
        break;
      case 'statue': {
        const bronze = d.tint === 1;
        B.polishedBox.add(d.x, d.y + 0.6, d.z, d.w * 1.1, 1.2, d.w * 1.1, 0xf2ede3);
        (bronze ? B.bronzeFigure : B.figure).add(d.x, d.y + 1.2 + d.h * 0.32, d.z, d.w * 1.1, d.h * 0.5, d.w * 1.1, 0xf8f5ee);
        break;
      }
      case 'drum':
        B.drum.add(d.x, d.y + d.h / 2, d.z, d.w, d.h, d.w, 0xf1ece2);
        break;
      case 'dome': {
        const c = d.tint === 1 ? 0xb5562f : rng.chance(0.5) ? 0xf2ede3 : 0x9aa9ad;
        B.dome.add(d.x, d.y + (d.h > 0 ? 0 : 0), d.z, d.w, d.h * 1.0, d.w, c);
        B.drum.add(d.x, d.y + d.h + 0.9, d.z, d.w * 0.16, 1.8, d.w * 0.16, 0xf6f2ea);
        B.dome.add(d.x, d.y + d.h + 1.8, d.z, d.w * 0.18, d.w * 0.18, d.w * 0.18, c);
        break;
      }
      case 'water':
        B.water.add(d.x, d.y, d.z, d.w, 1, d.w);
        break;
      case 'jet':
        B.jets.add(d.x, d.y + d.h / 2 + 2, d.z, 0.12, d.h, 0.12);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          B.jets.add(d.x + Math.cos(a) * d.w * 0.6, d.y + 0.6, d.z + Math.sin(a) * d.w * 0.6, 0.06, 1.2, 0.06);
        }
        break;
      case 'arch':
        B.arch.add(d.x, d.y, d.z, d.w, d.h, d.d ?? 1, 0xf2ede3, q);
        break;
      case 'gate': {
        B.arch.add(d.x, d.y, d.z, d.w, d.h, d.d ?? 3, 0xf5f1e8, q);
        const attic = new THREE.Vector3(0, 0, 0);
        attic.set(d.x, d.y + d.h + 1.2, d.z);
        B.polishedBox.add(attic.x, attic.y, attic.z, (d.yaw ?? 0) !== 0 ? (d.d ?? 3) : d.w * 1.05, 2.4, (d.yaw ?? 0) !== 0 ? d.w * 1.05 : (d.d ?? 3), 0xf0ebe0);
        B.figure.add(d.x, d.y + d.h + 3.2, d.z, 1.3, 1.6, 1.3, 0xf8f5ee);
        break;
      }
      case 'awning':
        B.arch.add(d.x, d.y, d.z, d.w, d.h * 2.2, d.d ?? 3, 0xefe8da, q);
        break;
      case 'flag':
        B.pole.add(d.x, d.y + d.h / 2 - 1, d.z, 0.05, d.h + 2, 0.05);
        B.banner.add(d.x, d.y + d.h / 2, d.z, d.w, d.h, 0.04, 0xffffff, q);
        break;
      case 'balusters': {
        const along = (d.yaw ?? 0) === 0;
        const n = Math.max(2, Math.floor(d.w / 0.42));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const x = along ? d.x + t * d.w : d.x;
          const z = along ? d.z : d.z + t * d.w;
          B.posts.add(x, d.y - d.h * 0.45, z, 0.06, d.h * 0.85, 0.06, 0xf4efe6);
        }
        B.polishedBox.add(d.x, d.y + 0.04, d.z, along ? d.w : 0.32, 0.1, along ? 0.32 : d.w, 0xf6f2ea);
        break;
      }
      case 'boat':
        B.hull.add(d.x, d.y, d.z, d.w, d.h, d.d ?? 5, 0x6b4a2f, q);
        B.plain.add(d.x, d.y + d.h * 0.9, d.z, d.w * 0.6, d.h * 0.8, (d.d ?? 5) * 0.3, 0xf2ede3, q);
        break;
      case 'crane':
        B.crane.add(d.x, d.y + d.h / 2, d.z, d.w, d.h, d.w, 0xc9a24a);
        B.crane.add(d.x + Math.sin(d.yaw ?? 0) * 7, d.y + d.h, d.z + Math.cos(d.yaw ?? 0) * 7, 0.7, 0.7, 16, 0xc9a24a, q);
        break;
      case 'obelisk':
        B.obelisk.add(d.x, d.y + d.h / 2, d.z, d.w, d.h, d.w, 0xefe9dc);
        B.pyramid.add(d.x, d.y + d.h + d.w * 0.4, d.z, d.w, d.w * 0.8, d.w, 0xffffff);
        break;
      case 'merlons': {
        const along = (d.yaw ?? 0) === 0;
        const n = Math.max(1, Math.floor(d.w / 1.7));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          B.stoneBox.add(along ? d.x + t * d.w : d.x, d.y + d.h / 2, along ? d.z : d.z + t * d.w, along ? 0.9 : d.d ?? 0.6, d.h, along ? d.d ?? 0.6 : 0.9, 0xc4b9a6);
        }
        break;
      }
      case 'channel': {
        const alongX = d.w > d.d!;
        const len = alongX ? d.w : d.d!;
        const width = alongX ? d.d! : d.w;
        B.channelWater.add(d.x, -1.05, d.z, alongX ? len : width, 1, alongX ? width : len);
        for (const s of [-1, 1]) {
          const ox = alongX ? 0 : s * (width / 2 + 0.15);
          const oz = alongX ? s * (width / 2 + 0.15) : 0;
          B.channelWall.add(d.x + ox, -0.8, d.z + oz, alongX ? len : 0.3, 1.6, alongX ? 0.3 : len, 0xcfc4ae);
        }
        break;
      }
    }
  }
  let jets: THREE.InstancedMesh | null = null;
  for (const [name, b] of Object.entries(B)) {
    const m = b.build(group);
    if (name === 'jets') jets = m;
  }
  return jets;
}

// ------------------------------------------------------------------ skyline

/** The rest of the city, past the play space: palazzi, domes, white towers. */
function buildSkyline(layout: AreaLayout, group: THREE.Group, mats: CityMaterials, T: number): void {
  const rng = new Rng(hashSeed(layout.seed, 'skyline'));
  const blocks = new Batch(new THREE.BoxGeometry(1, 1, 1), layout.type === 'quartieri' ? mats.quartieri : mats.palazzo, false, false);
  const towers = new Batch(new THREE.BoxGeometry(1, 1, 1), mats.tower, false, false);
  const domes = new Batch(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.terracotta, false, false);
  const drums = new Batch(new THREE.CylinderGeometry(1, 1, 1, 18), mats.polished, false, false);
  const c = T / 2;
  const step = 22;
  for (let x = -300; x <= T + 300; x += step) {
    for (let z = -300; z <= T + 300; z += step) {
      const dx = x - c;
      const dz = z - c;
      const r = Math.hypot(dx, dz);
      if (Math.abs(dx) < c + 18 && Math.abs(dz) < c + 18) continue;
      if (r > 380) continue;
      if (layout.type === 'porto' && z < -10) continue; // the harbour
      if (!rng.chance(0.78)) continue;
      const jx = x + rng.range(-5, 5);
      const jz = z + rng.range(-5, 5);
      const roll = rng.next();
      if (roll < 0.045) {
        const h = rng.range(70, 170);
        const w = rng.range(10, 18);
        towers.add(jx, h / 2, jz, w, h, w, 0xf4f6f8);
      } else {
        const h = rng.range(14, 46) * (r < 200 ? 1 : 0.85);
        const w = rng.range(14, 21);
        const dd = rng.range(14, 21);
        blocks.add(jx, h / 2, jz, w, h, dd, pick(layout.type === 'quartieri' ? PALETTE.warm : PALETTE.marble, rng.int(0, 7)));
        if (roll > 0.93) {
          const rad = rng.range(5, 11);
          drums.add(jx, h + 2.5, jz, rad, 5, rad, 0xf1ece2);
          domes.add(jx, h + 5, jz, rad, rad * 1.1, rad, rng.chance(0.6) ? 0xb5562f : 0xf2ede3);
        }
      }
    }
  }
  for (const b of [blocks, towers, domes, drums]) b.build(group);
}
