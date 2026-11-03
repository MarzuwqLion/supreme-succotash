import * as THREE from 'three';

/**
 * Capsule rig built in code, animated by blending keyed poses. No external
 * art or animation assets. A pose is a set of joint rotations (radians).
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
  /** Show the weapon in the right hand. */
  weapon?: boolean;
}

const d = (deg: number) => (deg * Math.PI) / 180;
const R = (x: number, y = 0, z = 0): Rot => [d(x), d(y), d(z)];

/** Keyed poses. Positive shoulder X swings the arm backward; negative forward. */
export const POSES: Record<string, Pose> = {
  idle: { joints: { lShoulder: R(4, 0, 6), rShoulder: R(4, 0, -6), lElbow: R(-10), rElbow: R(-10), lKnee: R(4), rKnee: R(4) } },
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
  dodge: { joints: { spine: R(50), neck: R(20), lShoulder: R(-90, 0, -20), rShoulder: R(-90, 0, 20), lElbow: R(-110), rElbow: R(-110), lHip: R(-100), rHip: R(-100), lKnee: R(130), rKnee: R(130) }, hipY: 0.5, bodyPitch: d(25) },
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
  challenge: { joints: { spine: R(-4), lShoulder: R(-110, 0, -10), lElbow: R(-20), rShoulder: R(-20, 0, 10), rElbow: R(-40), neck: R(-6) } },
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

const ease = (t: number) => t * t * (3 - 2 * t);
export { ease };

export class CapsuleRig {
  readonly root = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly joints = {} as Record<Joint, THREE.Group>;
  private readonly outlineMeshes: THREE.Mesh[] = [];
  private readonly outlineMat: THREE.MeshBasicMaterial;
  readonly weapon: THREE.Mesh;
  private current: Pose = POSES.idle!;
  private bodyMat: THREE.MeshStandardMaterial;

  constructor(colors: RigColors, scale = 1) {
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.BackSide });
    this.bodyMat = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.7 });
    const accent = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: colors.head, roughness: 0.8 });

    this.root.add(this.tilt);
    this.tilt.add(this.hips);
    this.hips.position.y = 0.95;

    const seg = (parent: THREE.Object3D, name: Joint, pos: [number, number, number], radius: number, length: number, mat: THREE.Material, up = false) => {
      const j = new THREE.Group();
      j.position.set(...pos);
      parent.add(j);
      this.joints[name] = j;
      const geo = new THREE.CapsuleGeometry(radius, length, 4, 8);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = up ? length / 2 + radius : -(length / 2 + radius * 0.6);
      m.castShadow = true;
      j.add(m);
      this.addOutline(m);
      return j;
    };

    const spine = seg(this.hips, 'spine', [0, 0.02, 0], 0.19, 0.32, this.bodyMat, true);
    // Vest / accent plate on the chest.
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.1), accent);
    plate.position.set(0, 0.36, 0.13);
    spine.add(plate);
    const neck = new THREE.Group();
    neck.position.y = 0.66;
    spine.add(neck);
    this.joints.neck = neck;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), skin);
    head.position.y = 0.12;
    head.castShadow = true;
    neck.add(head);
    this.addOutline(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.05), accent);
    visor.position.set(0, 0.14, 0.11);
    neck.add(visor);

    const lSh = seg(spine, 'lShoulder', [0.24, 0.56, 0], 0.065, 0.24, this.bodyMat);
    seg(lSh, 'lElbow', [0, -0.36, 0], 0.055, 0.22, skin);
    const rSh = seg(spine, 'rShoulder', [-0.24, 0.56, 0], 0.065, 0.24, this.bodyMat);
    const rEl = seg(rSh, 'rElbow', [0, -0.36, 0], 0.055, 0.22, skin);
    this.weapon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    this.weapon.position.set(0, -0.34, 0.08);
    rEl.add(this.weapon);
    const lHip = seg(this.hips, 'lHip', [0.11, -0.02, 0], 0.085, 0.36, accent);
    seg(lHip, 'lKnee', [0, -0.46, 0], 0.075, 0.36, this.bodyMat);
    const rHip = seg(this.hips, 'rHip', [-0.11, -0.02, 0], 0.085, 0.36, accent);
    seg(rHip, 'rKnee', [0, -0.46, 0], 0.075, 0.36, this.bodyMat);

    this.root.scale.setScalar(scale);
    this.setOutline(null);
    this.apply(this.current);
  }

  private addOutline(m: THREE.Mesh): void {
    const o = new THREE.Mesh(m.geometry, this.outlineMat);
    o.scale.setScalar(1.18);
    o.position.copy(m.position);
    o.visible = false;
    m.parent?.add(o);
    this.outlineMeshes.push(o);
  }

  /** Yellow during Challenge, red during Alert, or none. */
  setOutline(color: number | null): void {
    for (const o of this.outlineMeshes) o.visible = color !== null;
    if (color !== null) this.outlineMat.color.setHex(color);
  }

  setTint(hex: number): void {
    this.bodyMat.color.setHex(hex);
  }

  apply(p: Pose): void {
    for (const j of JOINTS) {
      const r = p.joints[j] ?? [0, 0, 0];
      this.joints[j].rotation.set(r[0], r[1], r[2]);
    }
    this.hips.position.y = p.hipY ?? 0.95;
    this.tilt.rotation.set(p.bodyPitch ?? 0, 0, p.bodyRoll ?? 0);
    this.weapon.visible = !!p.weapon;
  }

  /** Smoothly move toward a target pose. `k` is the blend amount this frame. */
  drive(target: Pose, k: number): void {
    this.current = blendPose(this.current, target, Math.min(1, k));
    this.apply(this.current);
  }

  snap(target: Pose): void {
    this.current = target;
    this.apply(target);
  }
}
