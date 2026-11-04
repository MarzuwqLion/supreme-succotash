import * as THREE from 'three';

/**
 * Capsule rig built in code, animated by blending keyed poses. No external
 * art or animation assets. A pose is a set of joint rotations (radians).
 * Garments (gowns, togas, cloaks) follow the Napoli character sheet:
 * draped ivory, crimson, and black over modern cuts.
 */

export const JOINTS = ['spine', 'neck', 'lShoulder', 'lElbow', 'rShoulder', 'rElbow', 'lHip', 'lKnee', 'rHip', 'rKnee'] as const;
export type Joint = (typeof JOINTS)[number];
export type Rot = [number, number, number];

export interface Pose {
  joints: Partial<Record<Joint, Rot>>;
  /** Hip height in metres (default 0.95). */
  hipY?: number;
  /** Whole-body pitch about the feet (radians), for falls and lunges. */
  bodyPitch?: number;
  /** Whole-body roll (radians). */
  bodyRoll?: number;
  /** Forward somersault about the body's middle (radians), for the dodge roll. */
  tumble?: number;
  /** Show the weapon in the right hand. */
  weapon?: boolean;
}

const d = (deg: number) => (deg * Math.PI) / 180;
const R = (x: number, y = 0, z = 0): Rot => [d(x), d(y), d(z)];

/** Keyed poses. Positive shoulder X swings the arm backward; negative forward. */
export const POSES: Record<string, Pose> = {
  idle: { joints: { lShoulder: R(4, 0, 6), rShoulder: R(4, 0, -6), lElbow: R(-10), rElbow: R(-10), lKnee: R(4), rKnee: R(4) } },
  idleClasp: { joints: { lShoulder: R(-18, 0, -8), rShoulder: R(-18, 0, 8), lElbow: R(-70, 0, -10), rElbow: R(-70, 0, 10), lKnee: R(4), rKnee: R(4), neck: R(4) } },
  walkA: { joints: { spine: R(4), lShoulder: R(-22, 0, 6), rShoulder: R(22, 0, -6), lElbow: R(-20), rElbow: R(-14), lHip: R(-24), rHip: R(18), lKnee: R(8), rKnee: R(30) } },
  walkB: { joints: { spine: R(4), lShoulder: R(22, 0, 6), rShoulder: R(-22, 0, -6), lElbow: R(-14), rElbow: R(-20), lHip: R(18), rHip: R(-24), lKnee: R(30), rKnee: R(8) } },
  runA: { joints: { spine: R(12), lShoulder: R(-45, 0, 8), rShoulder: R(40, 0, -8), lElbow: R(-70), rElbow: R(-60), lHip: R(-40), rHip: R(28), lKnee: R(20), rKnee: R(70) }, hipY: 0.92 },
  runB: { joints: { spine: R(12), lShoulder: R(40, 0, 8), rShoulder: R(-45, 0, -8), lElbow: R(-60), rElbow: R(-70), lHip: R(28), rHip: R(-40), lKnee: R(70), rKnee: R(20) }, hipY: 0.92 },
  sprintA: { joints: { spine: R(22), neck: R(-14), lShoulder: R(-60, 0, 8), rShoulder: R(55, 0, -8), lElbow: R(-85), rElbow: R(-80), lHip: R(-55), rHip: R(35), lKnee: R(25), rKnee: R(90) }, hipY: 0.88 },
  sprintB: { joints: { spine: R(22), neck: R(-14), lShoulder: R(55, 0, 8), rShoulder: R(-60, 0, -8), lElbow: R(-80), rElbow: R(-85), lHip: R(35), rHip: R(-55), lKnee: R(90), rKnee: R(25) }, hipY: 0.88 },
  aim: { joints: { spine: R(2, 0), lShoulder: R(-80, 0, -30), lElbow: R(-30), rShoulder: R(-88, 0, -6), rElbow: R(-4), lKnee: R(10), rKnee: R(10) }, weapon: true },
  aimRifle: { joints: { spine: R(4, -10), lShoulder: R(-75, 0, -35), lElbow: R(-40), rShoulder: R(-70, 0, 10), rElbow: R(-60), lHip: R(-8), rHip: R(8), lKnee: R(10), rKnee: R(10) }, weapon: true },
  block: { joints: { spine: R(10), neck: R(10), lShoulder: R(-120, 0, -20), lElbow: R(-110), rShoulder: R(-120, 0, 20), rElbow: R(-110), lHip: R(-14), rHip: R(10), lKnee: R(24), rKnee: R(18) }, hipY: 0.88 },
  parry: { joints: { spine: R(-6, 20), lShoulder: R(-90, 0, -60), lElbow: R(-20), rShoulder: R(-150, 0, 30), rElbow: R(-30), lHip: R(-10), rHip: R(14), lKnee: R(14), rKnee: R(14) } },
  lightWind: { joints: { spine: R(4, 30), rShoulder: R(-30, 0, 40), rElbow: R(-120), lShoulder: R(-60, 0, -10), lElbow: R(-100), lHip: R(-16), rHip: R(12), lKnee: R(18), rKnee: R(12) }, hipY: 0.9 },
  lightHit: { joints: { spine: R(10, -30), rShoulder: R(-95, 0, -5), rElbow: R(-5), lShoulder: R(-40, 0, -10), lElbow: R(-110), lHip: R(-28), rHip: R(16), lKnee: R(24), rKnee: R(10) }, hipY: 0.88, bodyPitch: d(6) },
  light2Wind: { joints: { spine: R(4, -30), lShoulder: R(-30, 0, -40), lElbow: R(-120), rShoulder: R(-60, 0, 10), rElbow: R(-100), lHip: R(12), rHip: R(-16), lKnee: R(12), rKnee: R(18) }, hipY: 0.9 },
  light2Hit: { joints: { spine: R(10, 30), lShoulder: R(-95, 0, 5), lElbow: R(-5), rShoulder: R(-40, 0, 10), rElbow: R(-110), lHip: R(16), rHip: R(-28), lKnee: R(10), rKnee: R(24) }, hipY: 0.88, bodyPitch: d(6) },
  kickWind: { joints: { spine: R(-8, 10), lShoulder: R(-40, 0, -30), rShoulder: R(-40, 0, 30), lElbow: R(-80), rElbow: R(-80), rHip: R(-70), rKnee: R(100), lKnee: R(12) } },
  kickHit: { joints: { spine: R(-14, 10), lShoulder: R(20, 0, -40), rShoulder: R(20, 0, 40), lElbow: R(-40), rElbow: R(-40), rHip: R(-95), rKnee: R(4), lKnee: R(6) }, bodyPitch: d(-6) },
  heavyWind: { joints: { spine: R(-10, 50), rShoulder: R(-150, 0, 30), rElbow: R(-80), lShoulder: R(-40, 0, -20), lElbow: R(-60), lHip: R(-20), rHip: R(20), lKnee: R(26), rKnee: R(10) }, hipY: 0.9 },
  heavyHit: { joints: { spine: R(30, -30), rShoulder: R(-60, 0, -10), rElbow: R(-10), lShoulder: R(10, 0, -20), lElbow: R(-40), lHip: R(-40), rHip: R(30), lKnee: R(40), rKnee: R(10) }, hipY: 0.82, bodyPitch: d(10) },
  /** Tucked ball for the forward roll; the somersault comes from `tumble`. */
  tuck: { joints: { spine: R(60), neck: R(35), lShoulder: R(-100, 0, -10), rShoulder: R(-100, 0, 10), lElbow: R(-120), rElbow: R(-120), lHip: R(-120), rHip: R(-120), lKnee: R(140), rKnee: R(140) }, hipY: 0.55 },
  crouch: { joints: { spine: R(22), neck: R(-12), lShoulder: R(-40, 0, -12), rShoulder: R(-40, 0, 12), lElbow: R(-70), rElbow: R(-70), lHip: R(-95), rHip: R(-70), lKnee: R(125), rKnee: R(100) }, hipY: 0.5, weapon: true },
  coverLow: { joints: { spine: R(28), neck: R(-20), lShoulder: R(-70, 0, -20), rShoulder: R(-60, 0, 10), lElbow: R(-60), rElbow: R(-90), lHip: R(-100), rHip: R(-75), lKnee: R(130), rKnee: R(105) }, hipY: 0.48, weapon: true },
  coverHigh: { joints: { spine: R(4, -15), neck: R(0, 25), lShoulder: R(-50, 0, -30), rShoulder: R(-30, 0, 20), lElbow: R(-90), rElbow: R(-100), lHip: R(-6), rHip: R(6), lKnee: R(12), rKnee: R(12) }, weapon: true },
  grab: { joints: { spine: R(14), lShoulder: R(-80, 0, -40), rShoulder: R(-80, 0, 40), lElbow: R(-70), rElbow: R(-70), lHip: R(-14), rHip: R(10), lKnee: R(20), rKnee: R(16) }, hipY: 0.9 },
  takedown: { joints: { spine: R(20, 15), neck: R(10), lShoulder: R(-100, 0, -60), rShoulder: R(-70, 0, 50), lElbow: R(-120), rElbow: R(-110), lHip: R(-20), rHip: R(14), lKnee: R(28), rKnee: R(20) }, hipY: 0.86 },
  executeWind: { joints: { spine: R(-12), rShoulder: R(-170, 0, 10), rElbow: R(-30), lShoulder: R(-170, 0, -10), lElbow: R(-30), lHip: R(-20), rHip: R(10), lKnee: R(20), rKnee: R(14) } },
  executeHit: { joints: { spine: R(60), neck: R(20), rShoulder: R(-70, 0, 10), rElbow: R(-10), lShoulder: R(-70, 0, -10), lElbow: R(-10), lHip: R(-60), rHip: R(-30), lKnee: R(80), rKnee: R(60) }, hipY: 0.62 },
  throwRelease: { joints: { spine: R(20, -60), lShoulder: R(-110, 0, -40), rShoulder: R(-60, 0, 70), lElbow: R(-10), rElbow: R(-20), lHip: R(-34), rHip: R(20), lKnee: R(30), rKnee: R(10) }, hipY: 0.88 },
  hitstun: { joints: { spine: R(-22), neck: R(-20), lShoulder: R(20, 0, -30), rShoulder: R(20, 0, 30), lElbow: R(-50), rElbow: R(-50), lHip: R(10), rHip: R(-12), lKnee: R(20), rKnee: R(14) }, bodyPitch: d(-8) },
  stagger: { joints: { spine: R(-30, 20), neck: R(-30), lShoulder: R(-40, 0, -70), rShoulder: R(10, 0, 80), lElbow: R(-30), rElbow: R(-20), lHip: R(20), rHip: R(-30), lKnee: R(30), rKnee: R(10) }, bodyRoll: d(8), bodyPitch: d(-12) },
  knockdown: { joints: { spine: R(-10), neck: R(-20), lShoulder: R(-160, 0, -20), rShoulder: R(-150, 0, 30), lElbow: R(-20), rElbow: R(-30), lHip: R(-20), rHip: R(-50), lKnee: R(30), rKnee: R(70) }, hipY: 0.18, bodyPitch: d(-88) },
  grabbed: { joints: { spine: R(-14), neck: R(-30), lShoulder: R(-30, 0, -40), rShoulder: R(-30, 0, 40), lElbow: R(-90), rElbow: R(-90), lKnee: R(20), rKnee: R(30) }, hipY: 0.9, bodyPitch: d(-10) },
  dead: { joints: { spine: R(-6), neck: R(30, 30), lShoulder: R(-160, 0, -40), rShoulder: R(-100, 0, 70), lElbow: R(-20), rElbow: R(-60), lHip: R(-10), rHip: R(-30), lKnee: R(14), rKnee: R(50) }, hipY: 0.15, bodyPitch: d(-90) },
  talk: { joints: { lShoulder: R(-30, 0, -14), lElbow: R(-80), rShoulder: R(6, 0, -6), rElbow: R(-14), neck: R(-4, 10) } },
  talkB: { joints: { lShoulder: R(4, 0, 8), lElbow: R(-14), rShoulder: R(-40, 0, 20), rElbow: R(-70), neck: R(-2, -12), spine: R(0, -6) } },
  challenge: { joints: { spine: R(-4), lShoulder: R(-110, 0, -10), lElbow: R(-20), rShoulder: R(-20, 0, 10), rElbow: R(-40), neck: R(-6) } },
  cower: { joints: { spine: R(55), neck: R(30), lShoulder: R(-150, 0, -30), rShoulder: R(-150, 0, 30), lElbow: R(-130), rElbow: R(-130), lHip: R(-110), rHip: R(-110), lKnee: R(140), rKnee: R(140) }, hipY: 0.42 },
  batonWind: { joints: { spine: R(-8, 30), rShoulder: R(-160, 0, 30), rElbow: R(-60), lShoulder: R(-40, 0, -20), lElbow: R(-50), lHip: R(-12), rHip: R(12), lKnee: R(14), rKnee: R(10) } },
  batonHit: { joints: { spine: R(24, -24), rShoulder: R(-50, 0, -20), rElbow: R(-10), lShoulder: R(0, 0, -20), lElbow: R(-40), lHip: R(-30), rHip: R(18), lKnee: R(30), rKnee: R(8) }, hipY: 0.88 },
  lookAround: { joints: { neck: R(0, 40), spine: R(0, 10), lShoulder: R(4, 0, 6), rShoulder: R(4, 0, -6) } },
};

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const joints: Partial<Record<Joint, Rot>> = {};
  for (const j of JOINTS) {
    const ra = a.joints[j] ?? [0, 0, 0];
    const rb = b.joints[j] ?? [0, 0, 0];
    joints[j] = [ra[0] + (rb[0] - ra[0]) * t, ra[1] + (rb[1] - ra[1]) * t, ra[2] + (rb[2] - ra[2]) * t];
  }
  const lerp = (x: number | undefined, y: number | undefined, def: number) => (x ?? def) + ((y ?? def) - (x ?? def)) * t;
  return {
    joints,
    hipY: lerp(a.hipY, b.hipY, 0.95),
    bodyPitch: lerp(a.bodyPitch, b.bodyPitch, 0),
    bodyRoll: lerp(a.bodyRoll, b.bodyRoll, 0),
    tumble: lerp(a.tumble, b.tumble, 0),
    weapon: t < 0.5 ? a.weapon : b.weapon,
  };
}

/** Additively layer `over` joints on top of `base` (used for upper-body actions while walking). */
export function overlayUpper(base: Pose, over: Pose): Pose {
  const upper: Joint[] = ['spine', 'neck', 'lShoulder', 'lElbow', 'rShoulder', 'rElbow'];
  const joints = { ...base.joints };
  for (const j of upper) if (over.joints[j]) joints[j] = over.joints[j];
  return { ...base, joints, weapon: over.weapon ?? base.weapon };
}

export interface RigColors {
  body: number;
  accent: number;
  head: number;
}

export interface Garments {
  /** Long robe/gown from the waist to the ankles. */
  gown?: number;
  /** Short tunic skirt. */
  tunic?: number;
  /** Toga or palla draped over one shoulder and across the chest. */
  drape?: number;
  /** Cloak hanging down the back. */
  cloak?: number;
  /** Hair colour (cap on the head). */
  hair?: number;
  /** Long hair falling to the shoulders. */
  longHair?: boolean;
  /** Thin band around the head (gold headband, beret band). */
  band?: number;
  /** Beard colour. */
  beard?: number;
}

export interface RigOptions {
  scale?: number;
  outline?: boolean;
  shadow?: boolean;
  garments?: Garments;
  /** Lower-poly meshes for crowds. */
  simple?: boolean;
}

const ease = (t: number) => t * t * (3 - 2 * t);
export { ease };

const geoCache = new Map<string, THREE.BufferGeometry>();
function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function cachedMat(color: number, rough = 0.75): THREE.MeshStandardMaterial {
  const key = `${color}-${rough}`;
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: rough })));
  return m;
}

export class CapsuleRig {
  readonly root = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly tumble = new THREE.Group();
  private readonly tumbleInner = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly joints = {} as Record<Joint, THREE.Group>;
  private readonly outlineMeshes: THREE.Mesh[] = [];
  private readonly outlineMat: THREE.MeshBasicMaterial | null;
  readonly weapon: THREE.Mesh;
  private current: Pose = POSES.idle!;
  private outlineColor: number | null = -1;
  private readonly cloak: THREE.Mesh | null = null;

  constructor(colors: RigColors, opts: RigOptions = {}) {
    const simple = !!opts.simple;
    const shadow = opts.shadow ?? true;
    this.outlineMat = opts.outline === false ? null : new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.BackSide });
    const bodyMat = cachedMat(colors.body, 0.7);
    const accent = cachedMat(colors.accent, 0.6);
    const skin = cachedMat(colors.head, 0.8);
    const seg = simple ? 6 : 8;

    this.root.add(this.tilt);
    this.tilt.add(this.tumble);
    this.tumble.position.y = 0.6;
    this.tumble.add(this.tumbleInner);
    this.tumbleInner.position.y = -0.6;
    this.tumbleInner.add(this.hips);
    this.hips.position.y = 0.95;

    const limb = (parent: THREE.Object3D, name: Joint, pos: [number, number, number], radius: number, length: number, mat: THREE.Material, up = false) => {
      const j = new THREE.Group();
      j.position.set(...pos);
      parent.add(j);
      this.joints[name] = j;
      const geo = cachedGeo(`cap-${radius}-${length}-${seg}`, () => new THREE.CapsuleGeometry(radius, length, 3, seg));
      const m = new THREE.Mesh(geo, mat);
      m.position.y = up ? length / 2 + radius : -(length / 2 + radius * 0.6);
      m.castShadow = shadow;
      j.add(m);
      this.addOutline(m);
      return j;
    };

    const spine = limb(this.hips, 'spine', [0, 0.02, 0], 0.19, 0.32, bodyMat, true);
    const plate = new THREE.Mesh(cachedGeo('plate', () => new THREE.BoxGeometry(0.34, 0.28, 0.1)), accent);
    plate.position.set(0, 0.36, 0.13);
    spine.add(plate);
    const neck = new THREE.Group();
    neck.position.y = 0.66;
    spine.add(neck);
    this.joints.neck = neck;
    const head = new THREE.Mesh(cachedGeo(`head-${seg}`, () => new THREE.SphereGeometry(0.13, seg + 6, seg + 2)), skin);
    head.position.y = 0.12;
    head.castShadow = shadow;
    neck.add(head);
    this.addOutline(head);

    const g = opts.garments;
    if (g?.hair !== undefined) {
      const hair = new THREE.Mesh(cachedGeo('hair', () => new THREE.SphereGeometry(0.138, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), cachedMat(g.hair, 0.9));
      hair.position.y = 0.13;
      hair.rotation.x = -0.25;
      neck.add(hair);
      if (g.longHair) {
        const fall = new THREE.Mesh(cachedGeo('hairfall', () => new THREE.BoxGeometry(0.24, 0.26, 0.08)), cachedMat(g.hair, 0.9));
        fall.position.set(0, 0.02, -0.1);
        neck.add(fall);
      }
    }
    if (g?.band !== undefined) {
      const band = new THREE.Mesh(cachedGeo('band', () => new THREE.TorusGeometry(0.132, 0.016, 6, 16)), cachedMat(g.band, 0.4));
      band.position.y = 0.17;
      band.rotation.x = Math.PI / 2 - 0.2;
      neck.add(band);
    }
    if (g?.beard !== undefined) {
      const beard = new THREE.Mesh(cachedGeo('beard', () => new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55)), cachedMat(g.beard, 0.95));
      beard.position.set(0, 0.06, 0.04);
      neck.add(beard);
    }
    if (!g) {
      const visor = new THREE.Mesh(cachedGeo('visor', () => new THREE.BoxGeometry(0.18, 0.05, 0.05)), accent);
      visor.position.set(0, 0.14, 0.11);
      neck.add(visor);
    }

    const lSh = limb(spine, 'lShoulder', [0.24, 0.56, 0], 0.065, 0.24, g?.drape !== undefined ? cachedMat(g.drape, 0.85) : bodyMat);
    limb(lSh, 'lElbow', [0, -0.36, 0], 0.055, 0.22, skin);
    const rSh = limb(spine, 'rShoulder', [-0.24, 0.56, 0], 0.065, 0.24, bodyMat);
    const rEl = limb(rSh, 'rElbow', [0, -0.36, 0], 0.055, 0.22, skin);
    this.weapon = new THREE.Mesh(cachedGeo('weapon', () => new THREE.BoxGeometry(0.05, 0.12, 0.3)), cachedMat(0x222222, 0.5));
    this.weapon.position.set(0, -0.34, 0.08);
    rEl.add(this.weapon);
    const lHip = limb(this.hips, 'lHip', [0.11, -0.02, 0], 0.085, 0.36, accent);
    limb(lHip, 'lKnee', [0, -0.46, 0], 0.075, 0.36, bodyMat);
    const rHip = limb(this.hips, 'rHip', [-0.11, -0.02, 0], 0.085, 0.36, accent);
    limb(rHip, 'rKnee', [0, -0.46, 0], 0.075, 0.36, bodyMat);

    // Garments: draped fabric that rides on the hips and spine.
    if (g?.gown !== undefined) {
      const gown = new THREE.Mesh(cachedGeo('gown', () => new THREE.CylinderGeometry(0.2, 0.4, 0.92, 14, 1, true)), new THREE.MeshStandardMaterial({ color: g.gown, roughness: 0.85, side: THREE.DoubleSide }));
      gown.position.y = -0.45;
      gown.castShadow = shadow;
      this.hips.add(gown);
    } else if (g?.tunic !== undefined) {
      const tunic = new THREE.Mesh(cachedGeo('tunic', () => new THREE.CylinderGeometry(0.21, 0.3, 0.4, 12, 1, true)), new THREE.MeshStandardMaterial({ color: g.tunic, roughness: 0.85, side: THREE.DoubleSide }));
      tunic.position.y = -0.16;
      this.hips.add(tunic);
    }
    if (g?.drape !== undefined) {
      // A band of cloth wrapped diagonally around the chest, over the left shoulder.
      const sash = new THREE.Mesh(cachedGeo('sash', () => new THREE.CylinderGeometry(0.215, 0.23, 0.24, 16, 1, true)), new THREE.MeshStandardMaterial({ color: g.drape, roughness: 0.85, side: THREE.DoubleSide }));
      sash.position.set(0.02, 0.36, 0);
      sash.rotation.z = 0.7;
      spine.add(sash);
      const fold = new THREE.Mesh(cachedGeo('fold', () => new THREE.SphereGeometry(0.13, 10, 8)), cachedMat(g.drape, 0.85));
      fold.position.set(0.2, 0.6, -0.02);
      fold.scale.set(1.1, 0.8, 1.2);
      spine.add(fold);
    }
    if (g?.cloak !== undefined) {
      const cloak = new THREE.Mesh(cachedGeo('cloak', () => new THREE.BoxGeometry(0.5, 1.05, 0.04)), new THREE.MeshStandardMaterial({ color: g.cloak, roughness: 0.9, side: THREE.DoubleSide }));
      cloak.position.set(0, 0.1, -0.2);
      cloak.castShadow = shadow;
      spine.add(cloak);
      this.cloak = cloak;
    }

    this.root.scale.setScalar(opts.scale ?? 1);
    this.setOutline(null);
    this.apply(this.current);
  }

  private addOutline(m: THREE.Mesh): void {
    if (!this.outlineMat) return;
    const o = new THREE.Mesh(m.geometry, this.outlineMat);
    o.scale.setScalar(1.18);
    o.position.copy(m.position);
    o.visible = false;
    m.parent?.add(o);
    this.outlineMeshes.push(o);
  }

  /** Yellow during Challenge, red during Alert, or none. */
  setOutline(color: number | null): void {
    if (!this.outlineMat || color === this.outlineColor) return;
    this.outlineColor = color;
    for (const o of this.outlineMeshes) o.visible = color !== null;
    if (color !== null) this.outlineMat.color.setHex(color);
  }

  apply(p: Pose): void {
    for (const j of JOINTS) {
      const r = p.joints[j] ?? [0, 0, 0];
      this.joints[j].rotation.set(r[0], r[1], r[2]);
    }
    this.hips.position.y = p.hipY ?? 0.95;
    this.tilt.rotation.set(p.bodyPitch ?? 0, 0, p.bodyRoll ?? 0);
    this.tumble.rotation.x = p.tumble ?? 0;
    this.weapon.visible = !!p.weapon;
    if (this.cloak) {
      // Cloaks trail a little behind when the spine leans.
      const lean = (p.joints.spine?.[0] ?? 0) * 0.6;
      this.cloak.rotation.x = Math.max(0, lean) + 0.08;
    }
  }

  /** Smoothly move toward a target pose. `k` is the blend amount this frame. */
  drive(target: Pose, k: number): void {
    this.current = blendPose(this.current, target, Math.min(1, k));
    // The somersault must not be smoothed (it would unwind backwards).
    this.current.tumble = target.tumble ?? 0;
    this.apply(this.current);
  }

  snap(target: Pose): void {
    this.current = target;
    this.apply(target);
  }
}
