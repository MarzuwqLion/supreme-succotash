/** Minimal vector math for the simulation (no three.js in sim code). */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const clone = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const distXZ = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function normalize(a: V3): V3 {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : v3();
}

export function normalizeXZ(a: V3): V3 {
  const l = Math.hypot(a.x, a.z);
  return l > 1e-9 ? { x: a.x / l, y: 0, z: a.z / l } : v3();
}

/** Yaw convention: yaw 0 faces +Z; forward = (sin yaw, 0, cos yaw). */
export const forwardFromYaw = (yaw: number): V3 => ({ x: Math.sin(yaw), y: 0, z: Math.cos(yaw) });
/** Right-hand vector when facing `yaw` with +Y up. */
export const rightFromYaw = (yaw: number): V3 => ({ x: -Math.cos(yaw), y: 0, z: Math.sin(yaw) });
export const yawTo = (from: V3, to: V3): number => Math.atan2(to.x - from.x, to.z - from.z);

/** Signed smallest difference b - a in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Rotate `current` toward `target` by at most `maxStep` radians. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/** Does segment a->b pass within `r` of point c? */
export function segmentHitsSphere(a: V3, b: V3, c: V3, r: number): boolean {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const abLen2 = dot(ab, ab);
  const t = abLen2 > 0 ? clamp(dot(ac, ab) / abLen2, 0, 1) : 0;
  const p = add(a, scale(ab, t));
  return dist(p, c) <= r;
}
