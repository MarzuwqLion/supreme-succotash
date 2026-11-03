import * as THREE from 'three';
import { angleDiff, distXZ, type V3 } from '../core/vec';
import { tuning } from '../data/tuning';
import type { Hostile } from '../sim/entities';
import type { AreaLayout, CellType } from '../sim/gen/layout';
import type { SimEvent, SimWorld } from '../sim/world';
import { hostilePose, LocomotionPhase, playerPose } from './animator';
import { FollowCamera, type CameraMode } from './camera';
import { CapsuleRig, POSES, type RigColors } from './rig';

/**
 * Presentation: builds gray-box meshes for an area and draws sim state each
 * frame. It reads the simulation and never writes to it.
 */

export const COLORS = {
  agent: { body: 0x1d2633, accent: 0x2fb5a8, head: 0xc9a27e } as RigColors,
  legionary: { body: 0x9b2226, accent: 0xd9a441, head: 0xc49a74 } as RigColors,
  trooper: { body: 0x5c6b7a, accent: 0xdfe6ee, head: 0xb8b8b8 } as RigColors,
  escort: { body: 0x23272c, accent: 0x6b7480, head: 0x8a8f96 } as RigColors,
  hale: { body: 0xe8e2d0, accent: 0xc9a227, head: 0xb08968 } as RigColors,
  lucca: { body: 0x3a7d44, accent: 0x9bc53d, head: 0xc49a74 } as RigColors,
  lucretia: { body: 0x6a3d9a, accent: 0xe0aaff, head: 0xd2a07a } as RigColors,
};

const OUTLINE_CHALLENGE = 0xffd60a;
const OUTLINE_ALERT = 0xff2d2d;

const CELL_COLORS: Record<CellType, string> = {
  building: '#6b5b4b',
  street: '#4a4d52',
  alley: '#3b3a38',
  courtyard: '#8a7a62',
  piazza: '#9b9384',
};

const AREA_PALETTES: Record<string, number[]> = {
  porto: [0x8d99ae, 0x6c757d, 0xa68a64, 0x7f5539, 0x4a6274],
  spaccanapoli: [0xd4a373, 0xe9c46a, 0xbc6c25, 0xdda15e, 0xc97c5d],
  quartieri: [0xe76f51, 0xf4a261, 0xe9c46a, 0xcdb4db, 0xd4a373],
  castel: [0x8e8d8a, 0x7a7a72, 0x9a9488, 0x6e6a63, 0x85807a],
};

interface Tracer {
  line: THREE.Line;
  life: number;
}

interface Flash {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

interface HostileVisual {
  rig: CapsuleRig;
  loco: LocomotionPhase;
  cone: THREE.Mesh;
  aimLine: THREE.Line;
  lastPos: V3;
  speed: number;
}

export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: FollowCamera;
  private level = new THREE.Group();
  private dynamic = new THREE.Group();
  private playerRig: CapsuleRig | null = null;
  private playerLoco = new LocomotionPhase();
  private hostileVis = new Map<number, HostileVisual>();
  private npcRigs = new Map<string, CapsuleRig>();
  private cacheMeshes: THREE.Mesh[] = [];
  private intelMesh: THREE.Mesh | null = null;
  private exitBeacon: THREE.Mesh | null = null;
  private smokeMeshes: THREE.Mesh[] = [];
  private tracers: Tracer[] = [];
  private flashes: Flash[] = [];
  private sun: THREE.DirectionalLight;
  showCones = true;
  conversationFocus: V3 | null = null;

  constructor(canvas: HTMLCanvasElement) {
    // ?lowfx=1 trades shadows and resolution for speed (software GL, old laptops).
    const lowfx = new URLSearchParams(window.location.search).has('lowfx');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowfx });
    this.renderer.setPixelRatio(lowfx ? 1 : Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = !lowfx;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.cam = new FollowCamera(window.innerWidth / window.innerHeight);
    this.scene.background = new THREE.Color(0x9fb4c7);
    this.scene.fog = new THREE.Fog(0x9fb4c7, 45, 140);
    this.scene.add(new THREE.HemisphereLight(0xdfe9f3, 0x5a4a3a, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
    this.sun.position.set(30, 60, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -50;
    sc.right = 50;
    sc.top = 50;
    sc.bottom = -50;
    sc.near = 1;
    sc.far = 160;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.level, this.dynamic);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.cam.resize(w / h);
  }

  private clearGroup(g: THREE.Group): void {
    g.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
    g.clear();
  }

  clear(): void {
    this.clearGroup(this.level);
    this.clearGroup(this.dynamic);
    this.hostileVis.clear();
    this.npcRigs.clear();
    this.cacheMeshes = [];
    this.intelMesh = null;
    this.exitBeacon = null;
    this.smokeMeshes = [];
    this.tracers = [];
    this.flashes = [];
    this.playerRig = null;
  }

  // ------------------------------------------------------------ build

  private groundTexture(layout: AreaLayout): THREE.CanvasTexture {
    const px = 8;
    const size = layout.gridSize * layout.blockSize * px;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    for (const cell of layout.cells) {
      g.fillStyle = CELL_COLORS[cell.type];
      g.fillRect(cell.i * layout.blockSize * px, cell.j * layout.blockSize * px, layout.blockSize * px, layout.blockSize * px);
    }
    // Faint lane hints on the guaranteed path help readability.
    g.globalAlpha = 0.12;
    g.fillStyle = '#ffffff';
    for (const ci of layout.pathCells) {
      const cell = layout.cells[ci]!;
      const cx = (cell.i + 0.5) * layout.blockSize * px;
      const cz = (cell.j + 0.5) * layout.blockSize * px;
      g.beginPath();
      g.arc(cx, cz, 6, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 0.18;
    g.strokeStyle = '#000000';
    for (let k = 0; k <= layout.gridSize; k++) {
      g.beginPath();
      g.moveTo(k * layout.blockSize * px, 0);
      g.lineTo(k * layout.blockSize * px, size);
      g.moveTo(0, k * layout.blockSize * px);
      g.lineTo(size, k * layout.blockSize * px);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  build(world: SimWorld): void {
    this.clear();
    const layout = world.layout;
    const extent = layout.gridSize * layout.blockSize;
    const center = extent / 2;

    // Ground.
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: layout.type === 'porto' ? 0x2b4f6e : 0x5d5448 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(center, -0.02, center);
    this.level.add(outer);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(extent, extent), new THREE.MeshStandardMaterial({ map: this.groundTexture(layout), roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(center, 0, center);
    ground.receiveShadow = true;
    this.level.add(ground);

    // Static boxes as one instanced mesh with per-instance colours.
    const palette = AREA_PALETTES[layout.type] ?? AREA_PALETTES.spaccanapoli!;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.85 }), layout.boxes.length);
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    layout.boxes.forEach((b, i) => {
      mtx.compose(new THREE.Vector3(b.x, b.y, b.z), new THREE.Quaternion(), new THREE.Vector3(b.hx * 2, b.hy * 2, b.hz * 2));
      inst.setMatrixAt(i, mtx);
      if (b.kind === 'prop') col.setHex(layout.type === 'porto' ? [0xb5651d, 0x2a9d8f, 0x6d597a, 0x9c6644][i % 4]! : 0x7f5539);
      else if (b.kind === 'perimeter') col.setHex(0x3d3a36);
      else if (b.kind === 'wall') col.setHex(layout.type === 'castel' ? 0x77736b : 0xa89f91);
      else col.setHex(palette[(i * 7) % palette.length]!);
      inst.setColorAt(i, col);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    this.level.add(inst);

    // Exit: door frame + beacon.
    if (world.exit) {
      const g = new THREE.Group();
      g.position.set(world.exit.pos.x, 0, world.exit.pos.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 32), new THREE.MeshBasicMaterial({ color: 0x38f28a, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      g.add(ring);
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 40, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x38f28a, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      beacon.position.y = 20;
      g.add(beacon);
      this.exitBeacon = beacon;
      this.dynamic.add(g);
    }

    // Caches.
    for (const c of world.caches) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xc9a227, emissive: 0x000000 }));
      m.position.set(c.pos.x, 0.3, c.pos.z);
      m.castShadow = true;
      this.cacheMeshes.push(m);
      this.dynamic.add(m);
    }
    if (world.intelPickup) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.32), new THREE.MeshStandardMaterial({ color: 0x4cc9f0, emissive: 0x0b3d5c }));
      m.position.set(world.intelPickup.pos.x, 0.9, world.intelPickup.pos.z);
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.85, 0.5), new THREE.MeshStandardMaterial({ color: 0x5b4636 }));
      stand.position.set(world.intelPickup.pos.x, 0.425, world.intelPickup.pos.z);
      this.dynamic.add(stand, m);
      this.intelMesh = m;
    }

    // Characters.
    this.playerRig = new CapsuleRig(COLORS.agent);
    this.dynamic.add(this.playerRig.root);
    for (const h of world.hostiles) this.addHostile(h);
    for (const n of world.npcs) {
      const rig = new CapsuleRig(COLORS[n.who]);
      rig.root.position.set(n.pos.x, 0, n.pos.z);
      rig.root.rotation.y = Math.atan2(world.player.pos.x - n.pos.x, world.player.pos.z - n.pos.z);
      this.npcRigs.set(n.who, rig);
      this.dynamic.add(rig.root);
    }
    this.cam.setLevel(layout.boxes, world.player.pos);
    this.sun.position.set(center + 30, 60, center + 20);
    this.sun.target.position.set(center, 0, center);
  }

  private addHostile(h: Hostile): void {
    const colors = COLORS[h.kind];
    const rig = new CapsuleRig(colors, h.kind === 'hale' ? 1.12 : 1);
    this.dynamic.add(rig.root);
    const ht = tuning.hostiles;
    const coneGeo = new THREE.CircleGeometry(ht.visionRange, 24, -Math.PI / 2 - (ht.visionConeDeg * Math.PI) / 360, (ht.visionConeDeg * Math.PI) / 180);
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
    cone.rotation.x = -Math.PI / 2;
    cone.position.y = 0.04;
    this.dynamic.add(cone);
    const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.7 }));
    aimLine.visible = false;
    this.dynamic.add(aimLine);
    this.hostileVis.set(h.id, { rig, loco: new LocomotionPhase(), cone, aimLine, lastPos: { ...h.pos }, speed: 0 });
  }

  // ------------------------------------------------------------ events / fx

  handleEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'shot') this.addTracer(e.from, e.to, e.byPlayer ? (e.loud ? 0xffd166 : 0xbde0fe) : 0xff6b6b);
      else if (e.type === 'impact') {
        const color = e.kind === 'parry' ? 0x4cc9f0 : e.kind === 'block' ? 0xadb5bd : e.kind === 'dodge' ? 0xffffff : 0xff8c42;
        this.addFlash(e.pos, color, e.kind === 'parry' ? 0.6 : 0.3);
      } else if (e.type === 'smoke') {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(tuning.items.smokeRadius, 20, 14),
          new THREE.MeshStandardMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.85, depthWrite: false }),
        );
        m.position.set(e.pos.x, 1.3, e.pos.z);
        this.smokeMeshes.push(m);
        this.dynamic.add(m);
      }
    }
  }

  private addTracer(a: V3, b: V3, color: number): void {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
    this.dynamic.add(line);
    this.tracers.push({ line, life: 0.09 });
  }

  private addFlash(p: V3, color: number, size: number): void {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    m.position.set(p.x, p.y || 1.2, p.z);
    this.dynamic.add(m);
    this.flashes.push({ mesh: m, life: 0.15, max: 0.15 });
  }

  // ------------------------------------------------------------ frame

  render(world: SimWorld, alpha: number, dt: number, mode: CameraMode): void {
    const p = world.player;
    const lerpPos = (a: V3, b: V3) => ({ x: a.x + (b.x - a.x) * alpha, y: 0, z: a.z + (b.z - a.z) * alpha });
    const lerpYaw = (a: number, b: number) => a + angleDiff(a, b) * alpha;

    // Agent.
    const pp = lerpPos(p.prevPos, p.pos);
    if (this.playerRig) {
      this.playerRig.root.position.set(pp.x, 0, pp.z);
      this.playerRig.root.rotation.y = lerpYaw(p.prevYaw, p.yaw);
      this.playerLoco.advance(p.speed, dt);
      const recentShot = world.frame - p.lastShotFrame < 30;
      this.playerRig.drive(playerPose(p, this.playerLoco, recentShot), Math.min(1, dt * 18));
      this.playerRig.setOutline(p.hurtFlash > 0 ? 0xff5555 : null);
    }

    // Hostiles.
    for (const h of world.hostiles) {
      const v = this.hostileVis.get(h.id);
      if (!v) continue;
      const hp = lerpPos(h.prevPos, h.pos);
      const moved = distXZ(v.lastPos, h.pos);
      v.lastPos = { ...h.pos };
      v.speed = v.speed * 0.8 + (moved * tuning.sim.hz) * 0.2;
      v.rig.root.position.set(hp.x, 0, hp.z);
      v.rig.root.rotation.y = lerpYaw(h.prevYaw, h.yaw);
      v.loco.advance(v.speed, dt);
      const pose = hostilePose(h, v.loco, v.speed);
      if (h.state === 'dead' && world.frame - h.deathFrame < 2) v.rig.drive(pose, 0.3);
      else v.rig.drive(pose, Math.min(1, dt * (h.state === 'dead' ? 6 : 14)));
      // Readability: yellow outline during Challenge, red during Alert.
      v.rig.setOutline(h.state === 'challenge' || h.state === 'conversation' ? OUTLINE_CHALLENGE : h.state === 'alert' ? OUTLINE_ALERT : null);
      const coneVisible = this.showCones && h.state !== 'dead' && h.state !== 'stoodDown' && h.state !== 'conversation' && h.combat === 'none';
      v.cone.visible = coneVisible;
      if (coneVisible) {
        v.cone.position.set(hp.x, 0.04, hp.z);
        v.cone.rotation.z = v.rig.root.rotation.y;
        const mat = v.cone.material as THREE.MeshBasicMaterial;
        mat.color.setHex(h.state === 'alert' ? 0xff3b30 : h.state === 'challenge' ? 0xffd60a : h.detection > 0 ? 0xffb703 : 0xffffff);
        mat.opacity = h.state === 'alert' ? 0.12 : 0.07 + h.detection * 0.15;
      }
      if (h.aimPoint && h.attack?.kind === 'ranged') {
        v.aimLine.visible = true;
        const pos = v.aimLine.geometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, hp.x, 1.4, hp.z);
        pos.setXYZ(1, h.aimPoint.x, h.aimPoint.y, h.aimPoint.z);
        pos.needsUpdate = true;
      } else v.aimLine.visible = false;
    }

    // Cast.
    for (const n of world.npcs) {
      const rig = this.npcRigs.get(n.who);
      if (!rig) continue;
      rig.root.visible = n.state !== 'gone';
      const d = distXZ(n.pos, p.pos);
      if (d < 8) rig.root.rotation.y = lerpYaw(rig.root.rotation.y, Math.atan2(p.pos.x - n.pos.x, p.pos.z - n.pos.z));
      rig.drive(world.player.interact?.kind === 'npc' && world.player.interact.who === n.who ? POSES.talk! : POSES.idle!, Math.min(1, dt * 6));
    }

    // Caches and intel.
    const t = performance.now() / 1000;
    world.caches.forEach((c, i) => {
      const m = this.cacheMeshes[i];
      if (!m) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (c.opened) {
        mat.color.setHex(0x4a3f2a);
        mat.emissive.setHex(0x000000);
        m.scale.y = 0.5;
      } else {
        const near = distXZ(c.pos, p.pos) < tuning.treasure.cacheRevealRange;
        mat.emissive.setHex(c.revealed || near ? 0x6b4f00 : 0x1a1200);
        mat.emissiveIntensity = c.revealed || near ? 0.6 + Math.sin(t * 4) * 0.4 : 1;
      }
    });
    if (this.intelMesh && world.intelPickup) {
      this.intelMesh.visible = !world.intelPickup.taken;
      this.intelMesh.rotation.y = t;
    }
    if (this.exitBeacon && world.exit) {
      const near = distXZ(world.exit.pos, p.pos) < tuning.gen.exitBeaconRange;
      this.exitBeacon.visible = world.exit.revealed || near;
    }

    // Smoke fades out over its life.
    for (let i = this.smokeMeshes.length - 1; i >= 0; i--) {
      const m = this.smokeMeshes[i]!;
      const s = world.smokes.find((x) => Math.abs(x.pos.x - m.position.x) < 0.01 && Math.abs(x.pos.z - m.position.z) < 0.01);
      if (!s) {
        this.dynamic.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        this.smokeMeshes.splice(i, 1);
        continue;
      }
      (m.material as THREE.MeshStandardMaterial).opacity = 0.85 * Math.min(1, s.framesLeft / 60);
      m.scale.setScalar(Math.min(1, (s.total - s.framesLeft) / 20 + 0.2));
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]!;
      tr.life -= dt;
      (tr.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, tr.life / 0.09);
      if (tr.life <= 0) {
        this.dynamic.remove(tr.line);
        tr.line.geometry.dispose();
        (tr.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.life -= dt;
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, f.life / f.max);
      f.mesh.scale.setScalar(1 + (1 - f.life / f.max));
      if (f.life <= 0) {
        this.dynamic.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
      }
    }

    // Camera.
    let yaw = p.viewYaw;
    let pitch = p.viewPitch;
    let focus: V3 = pp;
    if (mode === 'conversation' && this.conversationFocus) {
      const cf = this.conversationFocus;
      yaw = Math.atan2(cf.x - pp.x, cf.z - pp.z) - 0.25;
      pitch = -0.05;
      focus = pp;
    }
    this.cam.update(dt, focus, yaw, pitch, mode);
    this.renderer.render(this.scene, this.cam.camera);
  }

  /** World position -> screen pixels (for HUD markers). */
  project(p: V3, height = 0): { x: number; y: number; onScreen: boolean; behind: boolean } {
    const v = new THREE.Vector3(p.x, (p.y || 0) + height, p.z).project(this.cam.camera);
    const behind = v.z > 1;
    const x = ((v.x + 1) / 2) * window.innerWidth;
    const y = ((1 - v.y) / 2) * window.innerHeight;
    return { x, y, behind, onScreen: !behind && v.x > -1 && v.x < 1 && v.y > -1 && v.y < 1 };
  }

  /** Camera yaw used for the HUD compass. */
  get cameraYaw(): number {
    const d = new THREE.Vector3();
    this.cam.camera.getWorldDirection(d);
    return Math.atan2(d.x, d.z);
  }
}
