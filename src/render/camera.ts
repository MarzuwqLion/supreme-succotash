import * as THREE from 'three';
import type { V3 } from '../core/vec';
import { tuning } from '../data/tuning';
import type { Box } from '../sim/gen/layout';

/**
 * One third-person camera that moves between modes with a spring-damper.
 * Presentation only: it follows sim state (agent position, view yaw/pitch)
 * and never feeds back into the simulation.
 */

export type CameraMode = 'explore' | 'melee' | 'aim' | 'conversation';

class Spring {
  v = 0;
  constructor(public x: number) {}
  step(target: number, dt: number): number {
    const f = tuning.camera.springFrequency * Math.PI * 2;
    const z = tuning.camera.springDamping;
    // Semi-implicit critically-damped spring.
    const a = f * f * (target - this.x) - 2 * z * f * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

/** Ray vs axis-aligned box (slab test). Returns entry distance or null. */
function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: Box, maxT: number): number | null {
  let tmin = 0;
  let tmax = maxT;
  const axes: [number, number, number, number][] = [
    [o.x, d.x, b.x - b.hx, b.x + b.hx],
    [o.y, d.y, b.y - b.hy, b.y + b.hy],
    [o.z, d.z, b.z - b.hz, b.z + b.hz],
  ];
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-8) {
      if (oo < lo || oo > hi) return null;
    } else {
      let t1 = (lo - oo) / dd;
      let t2 = (hi - oo) / dd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'explore';
  private dist = new Spring(tuning.camera.explore.distance);
  private height = new Spring(tuning.camera.explore.height);
  private side = new Spring(tuning.camera.explore.side);
  private fov = new Spring(tuning.camera.explore.fov);
  private px = new Spring(0);
  private py = new Spring(0);
  private pz = new Spring(0);
  private boxes: readonly Box[] = [];
  private pullIn = 99;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.05, 400);
  }

  setLevel(boxes: readonly Box[], at: V3): void {
    this.boxes = boxes;
    this.px.x = at.x;
    this.py.x = at.y;
    this.pz.x = at.z;
  }

  update(dt: number, focus: V3, yaw: number, pitch: number, mode: CameraMode): void {
    this.mode = mode;
    const m = tuning.camera[mode];
    const step = Math.min(dt, 1 / 30);
    const dist = this.dist.step(m.distance, step);
    const height = this.height.step(m.height, step);
    const side = this.side.step(m.side, step);
    const fov = this.fov.step(m.fov, step);
    const fx = this.px.step(focus.x, step);
    const fy = this.py.step(focus.y, step);
    const fz = this.pz.step(focus.z, step);

    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    const pivot = new THREE.Vector3(fx + rx * side, fy + height, fz + rz * side);
    const cp = Math.cos(pitch);
    const dir = new THREE.Vector3(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    // Keep the camera out of walls: pull in along the boom.
    const back = dir.clone().negate();
    let free = dist;
    for (const b of this.boxes) {
      const t = rayBox(pivot, back, b, dist + tuning.camera.collisionPadding);
      if (t !== null) free = Math.min(free, t - tuning.camera.collisionPadding);
    }
    free = Math.max(0.4, free);
    // Snap in fast, ease out slowly.
    this.pullIn = free < this.pullIn ? free : Math.min(free, this.pullIn + step * 4);
    const pos = pivot.clone().addScaledVector(back, this.pullIn);
    if (pos.y < 0.3) pos.y = 0.3;
    this.camera.position.copy(pos);
    this.camera.lookAt(pivot.clone().addScaledVector(dir, 10));
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
