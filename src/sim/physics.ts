import RAPIER from '@dimforge/rapier3d-compat';
import type { V3 } from '../core/vec';
import { tuning } from '../data/tuning';
import type { Box } from './gen/layout';

/**
 * Thin Rapier wrapper used only by the simulation. Static level geometry
 * (boxes, cylinders, tilted stair slabs), kinematic character capsules with
 * gravity so they climb stairs onto elevated walkways, and ray queries for
 * sight, gunfire, and cover.
 */

export type Rapier = typeof RAPIER;

let initPromise: Promise<Rapier> | null = null;
export function initPhysics(): Promise<Rapier> {
  if (!initPromise) initPromise = RAPIER.init().then(() => RAPIER);
  return initPromise;
}

const G_WORLD = 0x0001;
const G_CHAR = 0x0002;
const G_GROUND = 0x0004;
/** Characters others can walk through (stood-down hostiles stepping aside); still hit by shots. */
const G_GHOST = 0x0008;
/** Civilians: ambient, never block movement or shots. */
const G_CIV = 0x0010;
const groups = (membership: number, filter: number) => ((membership & 0xffff) << 16) | (filter & 0xffff);

export type CharGroup = 'char' | 'civ';

export interface CharBody {
  entityId: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  radius: number;
  halfHeight: number;
  centerY: number;
  group: CharGroup;
  /** Vertical speed (m/s), for gravity. */
  vy: number;
  grounded: boolean;
}

export interface RayHit {
  distance: number;
  point: V3;
  /** Entity id when a character was hit, otherwise null (world or ground). */
  entityId: number | null;
}

export interface NormalHit {
  distance: number;
  point: V3;
  normal: V3;
}

export class Physics {
  readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly entityByCollider = new Map<number, number>();
  private readonly bodies = new Map<number, CharBody>();

  constructor(
    private readonly R: Rapier,
    boxes: readonly Box[],
    extent = 144,
  ) {
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    const ground = R.ColliderDesc.cuboid(extent * 3, 0.5, extent * 3).setTranslation(extent / 2, -0.5, extent / 2).setCollisionGroups(groups(G_GROUND, 0xffff));
    this.world.createCollider(ground);
    for (const b of boxes) {
      if (b.solid === false) continue;
      const desc = b.cylinder ? R.ColliderDesc.cylinder(b.hy, b.hx) : R.ColliderDesc.cuboid(b.hx, b.hy, b.hz);
      desc.setTranslation(b.x, b.y, b.z).setCollisionGroups(groups(G_WORLD, 0xffff));
      if (b.tilt) {
        const s = Math.sin(b.tilt.angle / 2);
        const c = Math.cos(b.tilt.angle / 2);
        desc.setRotation(b.tilt.axis === 'z' ? { x: 0, y: 0, z: s, w: c } : { x: s, y: 0, z: 0, w: c });
      }
      this.world.createCollider(desc);
    }
    this.controller = this.world.createCharacterController(0.02);
    this.controller.setSlideEnabled(true);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.setMaxSlopeClimbAngle((46 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.enableAutostep(0.35, 0.2, false);
    this.controller.enableSnapToGround(0.45);
    this.world.step(); // build the query structures
  }

  addCharacter(entityId: number, feet: V3, radius: number, halfHeight: number, group: CharGroup = 'char'): CharBody {
    // Rapier's controller settles capsules within a few cm of the floor (+/- 6 cm depending on
    // how they arrived); this keeps reported feet height within that band of the floor.
    const centerY = halfHeight + radius - 0.01;
    const bodyDesc = this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(feet.x, feet.y + centerY, feet.z);
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = this.R.ColliderDesc.capsule(halfHeight, radius).setCollisionGroups(groups(group === 'civ' ? G_CIV : G_CHAR, 0xffff));
    const collider = this.world.createCollider(colDesc, body);
    this.entityByCollider.set(collider.handle, entityId);
    const cb: CharBody = { entityId, body, collider, radius, halfHeight, centerY, group, vy: 0, grounded: true };
    this.bodies.set(entityId, cb);
    return cb;
  }

  /** Let other characters walk through this one (shots still hit it). */
  setPassThrough(cb: CharBody, on: boolean): void {
    if (cb.group === 'civ') return;
    cb.collider.setCollisionGroups(groups(on ? G_GHOST : G_CHAR, 0xffff));
  }

  removeCharacter(cb: CharBody): void {
    this.entityByCollider.delete(cb.collider.handle);
    this.bodies.delete(cb.entityId);
    this.world.removeRigidBody(cb.body);
  }

  /**
   * Slide a character by (dx, dz) against walls and (unless ignored) other
   * characters, with gravity and stair climbing. Returns the new feet
   * position. Takes effect for queries after step().
   */
  move(cb: CharBody, dx: number, dz: number, ignoreCharacters = false): V3 {
    const t = cb.body.translation();
    const dt = 1 / tuning.sim.hz;
    if (dx === 0 && dz === 0 && cb.grounded) return { x: t.x, y: t.y - cb.centerY, z: t.z };
    cb.vy = cb.grounded ? -2 : Math.max(-30, cb.vy + tuning.sim.gravity * dt);
    const others = cb.group === 'civ' || ignoreCharacters ? 0 : G_CHAR;
    this.controller.computeColliderMovement(cb.collider, { x: dx, y: cb.vy * dt, z: dz }, undefined, groups(0xffff, G_WORLD | G_GROUND | others));
    const m = this.controller.computedMovement();
    cb.grounded = this.controller.computedGrounded();
    if (cb.grounded) cb.vy = 0;
    const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    cb.body.setNextKinematicTranslation(next);
    return { x: next.x, y: next.y - cb.centerY, z: next.z };
  }

  /** Place a character directly (grabs and throws). */
  teleport(cb: CharBody, feet: V3): void {
    cb.body.setNextKinematicTranslation({ x: feet.x, y: feet.y + cb.centerY, z: feet.z });
    cb.vy = 0;
  }

  feet(cb: CharBody): V3 {
    const t = cb.body.translation();
    return { x: t.x, y: t.y - cb.centerY, z: t.z };
  }

  step(): void {
    this.world.step();
  }

  /** Cast a ray. `mask` 'world' ignores characters (sight lines); 'all' hits characters too (not civilians). */
  raycast(origin: V3, dir: V3, maxDist: number, mask: 'world' | 'all', exclude?: CharBody): RayHit | null {
    const ray = new this.R.Ray(origin, dir);
    const filter = mask === 'world' ? G_WORLD | G_GROUND : G_WORLD | G_GROUND | G_CHAR | G_GHOST;
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups(0xffff, filter), exclude?.collider, exclude?.body);
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      distance: d,
      point: { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d },
      entityId: this.entityByCollider.get(hit.collider.handle) ?? null,
    };
  }

  /** World-only ray that also reports the surface normal (for cover). */
  raycastNormal(origin: V3, dir: V3, maxDist: number): NormalHit | null {
    const ray = new this.R.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, groups(0xffff, G_WORLD));
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      distance: d,
      point: { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
    };
  }

  /** True when nothing static blocks the segment a -> b. */
  clearLine(a: V3, b: V3): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    const hit = this.raycast(a, { x: dx / d, y: dy / d, z: dz / d }, d, 'world');
    return !hit || hit.distance >= d - 0.05;
  }

  /** How far a character can travel from `from` along `dir` before hitting a wall. */
  freeDistance(from: V3, dir: V3, maxDist: number, radius: number): number {
    const o = { x: from.x, y: from.y + 1.0, z: from.z };
    const hit = this.raycast(o, dir, maxDist + radius, 'world');
    if (!hit) return maxDist;
    return Math.max(0, Math.min(maxDist, hit.distance - radius - 0.05));
  }

  dispose(): void {
    this.world.free();
  }
}
