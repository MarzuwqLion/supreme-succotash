import * as THREE from 'three';
import { angleDiff, distXZ, type V3 } from '../core/vec';
import { tuning } from '../data/tuning';
import type { Civilian, Hostile } from '../sim/entities';
import type { SimEvent, SimWorld } from '../sim/world';
import { civilianPose, hostilePose, LocomotionPhase, playerPose } from './animator';
import { FollowCamera, type CameraMode } from './camera';
import { buildCity } from './city';
import { AGENT, civilianLook, hostileLook, LUCCA, LUCRETIA, type Look } from './looks';
import { CapsuleRig, POSES } from './rig';
import { HORIZON, makeSky } from './sky';

/**
 * Presentation: builds the marble city for an area and draws sim state each
 * frame. It reads the simulation and never writes to it.
 */

const OUTLINE_CHALLENGE = 0xffd60a;
const OUTLINE_ALERT = 0xff2d2d;

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

interface CivilianVisual {
  rig: CapsuleRig;
  loco: LocomotionPhase;
}

const rigFor = (look: Look, opts: { outline?: boolean; shadow?: boolean; simple?: boolean } = {}) =>
  new CapsuleRig(look.colors, { scale: look.scale, garments: look.garments, outline: opts.outline, shadow: opts.shadow, simple: opts.simple });

export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: FollowCamera;
  private level = new THREE.Group();
  private dynamic = new THREE.Group();
  private sky: THREE.Mesh | null = null;
  private playerRig: CapsuleRig | null = null;
  private playerLoco = new LocomotionPhase();
  private hostileVis = new Map<number, HostileVisual>();
  private civilianVis = new Map<number, CivilianVisual>();
  private npcRigs = new Map<string, CapsuleRig>();
  private cacheMeshes: THREE.Mesh[] = [];
  private intelMesh: THREE.Mesh | null = null;
  private exitBeacon: THREE.Mesh | null = null;
  private smokeMeshes: THREE.Mesh[] = [];
  private tracers: Tracer[] = [];
  private flashes: Flash[] = [];
  private jets: THREE.InstancedMesh | null = null;
  private sun: THREE.DirectionalLight;
  private readonly lowfx: boolean;
  showCones = true;
  conversationFocus: V3 | null = null;
  /** Civilian currently talking (for a gesture). */
  talkingCivilian: number | null = null;
  private talkingUntil = 0;

  constructor(canvas: HTMLCanvasElement) {
    // ?lowfx=1 trades shadows and resolution for speed (software GL, old laptops).
    this.lowfx = new URLSearchParams(window.location.search).has('lowfx');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lowfx });
    this.renderer.setPixelRatio(this.lowfx ? 1 : Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = !this.lowfx;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.cam = new FollowCamera(window.innerWidth / window.innerHeight);
    this.cam.camera.far = 3000;
    this.cam.camera.updateProjectionMatrix();
    this.scene.background = new THREE.Color(HORIZON);
    this.scene.fog = new THREE.Fog(HORIZON, 110, 720);
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0xc9b79c, 1.05));
    this.sun = new THREE.DirectionalLight(0xffe9c8, 2.4);
    this.sun.castShadow = !this.lowfx;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -55;
    sc.right = 55;
    sc.top = 55;
    sc.bottom = -55;
    sc.near = 5;
    sc.far = 260;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
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
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    g.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.InstancedMesh) {
        geos.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
      }
    });
    for (const geo of geos) geo.dispose();
    for (const m of mats) {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
    g.clear();
  }

  clear(): void {
    this.clearGroup(this.level);
    // Character rigs share cached geometry/materials; just detach them.
    this.dynamic.clear();
    this.hostileVis.clear();
    this.civilianVis.clear();
    this.npcRigs.clear();
    this.cacheMeshes = [];
    this.intelMesh = null;
    this.exitBeacon = null;
    this.smokeMeshes = [];
    this.tracers = [];
    this.flashes = [];
    this.playerRig = null;
    this.jets = null;
  }

  // ------------------------------------------------------------ build

  build(world: SimWorld): void {
    this.clear();
    const layout = world.layout;
    const T = layout.gridSize * layout.blockSize;
    const city = buildCity(layout);
    this.level.add(city.group);
    this.jets = city.jets;
    if (this.sky) this.scene.remove(this.sky);
    this.sky = makeSky(layout.seed);
    this.scene.add(this.sky);

    if (world.exit) {
      const g = new THREE.Group();
      g.position.set(world.exit.pos.x, world.exit.pos.y, world.exit.pos.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 32), new THREE.MeshBasicMaterial({ color: 0x38f28a, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      g.add(ring);
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 60, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x38f28a, transparent: true, opacity: 0.3, depthWrite: false, fog: false }),
      );
      beacon.position.y = 30;
      g.add(beacon);
      this.exitBeacon = beacon;
      this.dynamic.add(g);
    }
    for (const c of world.caches) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xc9a227, emissive: 0x000000, roughness: 0.5, metalness: 0.3 }));
      m.position.set(c.pos.x, c.pos.y + 0.3, c.pos.z);
      m.castShadow = true;
      this.cacheMeshes.push(m);
      this.dynamic.add(m);
    }
    if (world.intelPickup) {
      const ip = world.intelPickup.pos;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.32), new THREE.MeshStandardMaterial({ color: 0x4cc9f0, emissive: 0x0b3d5c }));
      m.position.set(ip.x, ip.y + 0.9, ip.z);
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.85, 0.5), new THREE.MeshStandardMaterial({ color: 0x5b4636 }));
      stand.position.set(ip.x, ip.y + 0.425, ip.z);
      this.dynamic.add(stand, m);
      this.intelMesh = m;
    }

    this.playerRig = rigFor(AGENT);
    this.dynamic.add(this.playerRig.root);
    for (const h of world.hostiles) this.addHostile(h);
    for (const n of world.npcs) {
      const rig = rigFor(n.who === 'lucca' ? LUCCA : LUCRETIA, { outline: false });
      rig.root.position.set(n.pos.x, n.pos.y, n.pos.z);
      rig.root.rotation.y = Math.atan2(world.player.pos.x - n.pos.x, world.player.pos.z - n.pos.z);
      this.npcRigs.set(n.who, rig);
      this.dynamic.add(rig.root);
    }
    for (const c of world.civilians) {
      const rig = rigFor(civilianLook(c.look), { outline: false, shadow: false, simple: true });
      rig.root.position.set(c.pos.x, c.pos.y, c.pos.z);
      rig.root.rotation.y = c.yaw;
      this.civilianVis.set(c.id, { rig, loco: new LocomotionPhase() });
      this.dynamic.add(rig.root);
    }
    this.cam.setLevel(layout.boxes.filter((b) => b.solid !== false && (b.hy > 1.2 || b.look === 'deck')), world.player.pos);
    this.sun.target.position.set(T / 2, 0, T / 2);
  }

  private addHostile(h: Hostile): void {
    const look = hostileLook(h.kind);
    const rig = rigFor(look);
    this.dynamic.add(rig.root);
    const ht = tuning.hostiles;
    const coneGeo = new THREE.CircleGeometry(ht.visionRange, 24, -Math.PI / 2 - (ht.visionConeDeg * Math.PI) / 360, (ht.visionConeDeg * Math.PI) / 180);
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
    cone.rotation.x = -Math.PI / 2;
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
        m.position.set(e.pos.x, e.pos.y + 1.3, e.pos.z);
        this.smokeMeshes.push(m);
        this.dynamic.add(m);
      } else if (e.type === 'civilianLine' && e.kind !== 'flee') {
        this.talkingCivilian = e.civilianId;
        this.talkingUntil = performance.now() + 3500;
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
    const lerpPos = (a: V3, b: V3) => ({ x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha, z: a.z + (b.z - a.z) * alpha });
    const lerpYaw = (a: number, b: number) => a + angleDiff(a, b) * alpha;
    const now = performance.now();

    const pp = lerpPos(p.prevPos, p.pos);
    if (this.playerRig) {
      this.playerRig.root.position.set(pp.x, pp.y, pp.z);
      this.playerRig.root.rotation.y = lerpYaw(p.prevYaw, p.yaw);
      this.playerLoco.advance(p.speed, dt);
      const recentShot = world.frame - p.lastShotFrame < 30;
      this.playerRig.drive(playerPose(p, this.playerLoco, recentShot), Math.min(1, dt * 18));
      this.playerRig.setOutline(p.hurtFlash > 0 ? 0xff5555 : null);
    }

    for (const h of world.hostiles) {
      const v = this.hostileVis.get(h.id);
      if (!v) continue;
      const hp = lerpPos(h.prevPos, h.pos);
      const moved = distXZ(v.lastPos, h.pos);
      v.lastPos = { ...h.pos };
      v.speed = v.speed * 0.8 + moved * tuning.sim.hz * 0.2;
      v.rig.root.position.set(hp.x, hp.y, hp.z);
      v.rig.root.rotation.y = lerpYaw(h.prevYaw, h.yaw);
      v.loco.advance(v.speed, dt);
      const pose = hostilePose(h, v.loco, v.speed);
      v.rig.drive(pose, Math.min(1, dt * (h.state === 'dead' ? 6 : 14)));
      // Readability: yellow outline during Challenge, red during Alert.
      v.rig.setOutline(h.state === 'challenge' || h.state === 'conversation' ? OUTLINE_CHALLENGE : h.state === 'alert' ? OUTLINE_ALERT : null);
      const coneVisible = this.showCones && h.state !== 'dead' && h.state !== 'stoodDown' && h.state !== 'conversation' && h.combat === 'none';
      v.cone.visible = coneVisible;
      if (coneVisible) {
        v.cone.position.set(hp.x, hp.y + 0.05, hp.z);
        v.cone.rotation.z = v.rig.root.rotation.y;
        const mat = v.cone.material as THREE.MeshBasicMaterial;
        mat.color.setHex(h.state === 'alert' ? 0xff3b30 : h.state === 'challenge' ? 0xffd60a : h.detection > 0 ? 0xffb703 : 0xffffff);
        mat.opacity = h.state === 'alert' ? 0.12 : 0.07 + h.detection * 0.15;
      }
      if (h.aimPoint && h.attack?.kind === 'ranged') {
        v.aimLine.visible = true;
        const pos = v.aimLine.geometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, hp.x, hp.y + 1.4, hp.z);
        pos.setXYZ(1, h.aimPoint.x, h.aimPoint.y, h.aimPoint.z);
        pos.needsUpdate = true;
      } else v.aimLine.visible = false;
    }

    // Civilians: drawn only near the camera, the crowd fades into the city.
    const drawRange = tuning.civilians.drawRange;
    if (now > this.talkingUntil) this.talkingCivilian = null;
    for (const c of world.civilians) {
      const v = this.civilianVis.get(c.id);
      if (!v) continue;
      const near = distXZ(c.pos, p.pos) < drawRange;
      v.rig.root.visible = near;
      if (!near) continue;
      this.driveCivilian(c, v, lerpPos, lerpYaw, dt);
    }

    for (const n of world.npcs) {
      const rig = this.npcRigs.get(n.who);
      if (!rig) continue;
      rig.root.visible = n.state !== 'gone';
      const d = distXZ(n.pos, p.pos);
      if (d < 8) rig.root.rotation.y = lerpYaw(rig.root.rotation.y, Math.atan2(p.pos.x - n.pos.x, p.pos.z - n.pos.z));
      const talking = p.talking && this.conversationFocus && Math.abs(this.conversationFocus.x - n.pos.x) < 0.1;
      rig.drive(talking ? (Math.sin(now / 800) > 0 ? POSES.talk! : POSES.talkB!) : POSES.idleClasp!, Math.min(1, dt * 6));
    }

    const t = now / 1000;
    world.caches.forEach((c, i) => {
      const m = this.cacheMeshes[i];
      if (!m) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (c.opened) {
        mat.color.setHex(0x4a3f2a);
        mat.emissive.setHex(0x000000);
        m.scale.y = 0.5;
      } else {
        const nearC = distXZ(c.pos, p.pos) < tuning.treasure.cacheRevealRange;
        mat.emissive.setHex(c.revealed || nearC ? 0x6b4f00 : 0x1a1200);
        mat.emissiveIntensity = c.revealed || nearC ? 0.6 + Math.sin(t * 4) * 0.4 : 1;
      }
    });
    if (this.intelMesh && world.intelPickup) {
      this.intelMesh.visible = !world.intelPickup.taken;
      this.intelMesh.rotation.y = t;
    }
    if (this.exitBeacon && world.exit) {
      const nearE = distXZ(world.exit.pos, p.pos) < tuning.gen.exitBeaconRange;
      this.exitBeacon.visible = world.exit.revealed || nearE;
    }
    if (this.jets) this.jets.scale.y = 1 + Math.sin(t * 6) * 0.04;

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

    // Sun shadows follow the agent so the whole area doesn't need one huge shadow map.
    this.sun.position.set(pp.x + 60, pp.y + 110, pp.z + 45);
    this.sun.target.position.set(pp.x, pp.y, pp.z);
    if (this.sky) this.sky.position.set(pp.x, 0, pp.z);

    let yaw = p.viewYaw;
    let pitch = p.viewPitch;
    if (mode === 'conversation' && this.conversationFocus) {
      const cf = this.conversationFocus;
      // Over the agent's shoulder, angled so the speaker isn't hidden behind the agent's head.
      yaw = Math.atan2(cf.x - pp.x, cf.z - pp.z) - 0.42;
      pitch = -0.05;
    }
    this.cam.update(dt, pp, yaw, pitch, mode, p.viewStyle === 'shoulder' ? p.shoulder : 1);
    this.renderer.render(this.scene, this.cam.camera);
  }

  private driveCivilian(c: Civilian, v: CivilianVisual, lerpPos: (a: V3, b: V3) => V3, lerpYaw: (a: number, b: number) => number, dt: number): void {
    const cp = lerpPos(c.prevPos, c.pos);
    v.rig.root.position.set(cp.x, cp.y, cp.z);
    v.rig.root.rotation.y = lerpYaw(c.prevYaw, c.yaw);
    v.loco.advance(c.speed, dt);
    v.rig.drive(civilianPose(c, v.loco, c.speed, this.talkingCivilian === c.id), Math.min(1, dt * 10));
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
