import RAPIER from '@dimforge/rapier3d-compat';
import type { V3 } from '../core/vec';
import type { Box } from './gen/layout';

/**
 * Thin Rapier wrapper used only by the simulation. Static level geometry,
 * kinematic character capsules, and ray queries for sight and gunfire.
 * The world is flat, so characters stay on y = 0 (feet).
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
const groups = (membership: number, filter: number) => ((membership & 0xffff) << 16) | (filter & 0xffff);

export interface CharBody {
  entityId: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  radius: number;
  halfHeight: number;
  centerY: number;
}

export interface RayHit {
  distance: number;
  point: V3;
  /** Entity id when a character was hit, otherwise null (world or ground). */
  entityId: number | null;
}

export class Physics {
  readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly entityByCollider = new Map<number, number>();
  private readonly bodies = new Map<number, CharBody>();

  constructor(
    private readonly R: Rapier,
    boxes: readonly Box[],
  ) {
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    const ground = R.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(36, -0.5, 36).setCollisionGroups(groups(G_GROUND, 0xffff));
    this.world.createCollider(ground);
    for (const b of boxes) {
      const desc = R.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z).setCollisionGroups(groups(G_WORLD, 0xffff));
      this.world.createCollider(desc);
    }
    this.controller = this.world.createCharacterController(0.02);
    this.controller.setSlideEnabled(true);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.world.step(); // build the query structures
  }

  addCharacter(entityId: number, feet: V3, radius: number, halfHeight: number): CharBody {
    const centerY = halfHeight + radius + 0.05;
    const bodyDesc = this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(feet.x, centerY, feet.z);
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = this.R.ColliderDesc.capsule(halfHeight, radius).setCollisionGroups(groups(G_CHAR, 0xffff));
    const collider = this.world.createCollider(colDesc, body);
    this.entityByCollider.set(collider.handle, entityId);
    const cb: CharBody = { entityId, body, collider, radius, halfHeight, centerY };
    this.bodies.set(entityId, cb);
    return cb;
  }

  removeCharacter(cb: CharBody): void {
    this.entityByCollider.delete(cb.collider.handle);
    this.bodies.delete(cb.entityId);
    this.world.removeRigidBody(cb.body);
  }

  /**
   * Slide a character by (dx, dz) against walls and other characters.
   * Returns the new feet position. Takes effect for queries after step().
   */
  move(cb: CharBody, dx: number, dz: number, ignoreCharacters = false): V3 {
    const t = cb.body.translation();
    if (dx === 0 && dz === 0) return { x: t.x, y: 0, z: t.z };
    const filter = ignoreCharacters ? G_WORLD : G_WORLD | G_CHAR;
    this.controller.computeColliderMovement(cb.collider, { x: dx, y: 0, z: dz }, undefined, groups(0xffff, filter));
    const m = this.controller.computedMovement();
    const next = { x: t.x + m.x, y: cb.centerY, z: t.z + m.z };
    cb.body.setNextKinematicTranslation(next);
    return { x: next.x, y: 0, z: next.z };
  }

  /** Place a character directly (used for grabs and throws). Clamps against walls. */
  teleport(cb: CharBody, feet: V3): void {
    cb.body.setNextKinematicTranslation({ x: feet.x, y: cb.centerY, z: feet.z });
  }

  feet(cb: CharBody): V3 {
    const t = cb.body.translation();
    return { x: t.x, y: 0, z: t.z };
  }

  step(): void {
    this.world.step();
  }

  /** Cast a ray. `mask` 'world' ignores characters (sight lines); 'all' hits characters too. */
  raycast(origin: V3, dir: V3, maxDist: number, mask: 'world' | 'all', exclude?: CharBody): RayHit | null {
    const ray = new this.R.Ray(origin, dir);
    const filter = mask === 'world' ? G_WORLD | G_GROUND : G_WORLD | G_GROUND | G_CHAR;
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups(0xffff, filter), exclude?.collider, exclude?.body);
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      distance: d,
      point: { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d },
      entityId: this.entityByCollider.get(hit.collider.handle) ?? null,
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
    const o = { x: from.x, y: 1.0, z: from.z };
    const hit = this.raycast(o, dir, maxDist + radius, 'world');
    if (!hit) return maxDist;
    return Math.max(0, Math.min(maxDist, hit.distance - radius - 0.05));
  }

  dispose(): void {
    this.world.free();
  }
}
