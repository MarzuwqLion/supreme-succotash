import * as THREE from 'three';
import { Rng } from '../core/rng';

/**
 * Painted sky dome: deep Mediterranean blue overhead, pale haze at the
 * horizon, towering cumulus, the sun's glow, and the volcano across the bay.
 * Drawn once into a canvas (equirectangular) and wrapped on a sphere.
 */

export const HORIZON = 0xd8e3ec;

function cloud(g: CanvasRenderingContext2D, rng: Rng, x: number, y: number, scale: number): void {
  const puffs = rng.int(9, 18);
  for (let k = 0; k < puffs; k++) {
    const px = x + rng.range(-1.6, 1.6) * 60 * scale;
    const py = y - Math.abs(rng.range(-1, 1)) * 38 * scale;
    const r = rng.range(22, 46) * scale;
    const grad = g.createRadialGradient(px, py - r * 0.25, r * 0.1, px, py, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.55, 'rgba(250,250,252,0.75)');
    grad.addColorStop(1, 'rgba(235,240,248,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(px, py, r, 0, Math.PI * 2);
    g.fill();
  }
  // Soft grey underside.
  const base = g.createLinearGradient(0, y - 10 * scale, 0, y + 14 * scale);
  base.addColorStop(0, 'rgba(200,208,220,0)');
  base.addColorStop(1, 'rgba(200,208,220,0.35)');
  g.fillStyle = base;
  g.fillRect(x - 110 * scale, y - 10 * scale, 220 * scale, 24 * scale);
}

export function makeSky(seed: number): THREE.Mesh {
  const W = 2048;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const horizonY = H / 2;
  const sky = g.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, '#3f73b8');
  sky.addColorStop(0.55, '#7aa6d6');
  sky.addColorStop(0.88, '#c3d7ea');
  sky.addColorStop(1, '#dbe5ee');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, horizonY);
  g.fillStyle = '#dbe5ee';
  g.fillRect(0, horizonY, W, H - horizonY);
  // The sun's glow (the sun itself is up and to the south-east).
  const sunX = W * 0.32;
  const sunY = horizonY * 0.38;
  const glow = g.createRadialGradient(sunX, sunY, 4, sunX, sunY, 260);
  glow.addColorStop(0, 'rgba(255,252,240,1)');
  glow.addColorStop(0.08, 'rgba(255,246,220,0.9)');
  glow.addColorStop(0.4, 'rgba(255,240,210,0.25)');
  glow.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = glow;
  g.fillRect(sunX - 260, sunY - 260, 520, 520);
  // Towering cumulus near the horizon, smaller ones higher up.
  const rng = new Rng(seed ^ 0x51c1);
  for (let k = 0; k < 16; k++) cloud(g, rng, rng.range(0, W), horizonY - rng.range(20, 90), rng.range(1.2, 2.4));
  for (let k = 0; k < 18; k++) cloud(g, rng, rng.range(0, W), rng.range(horizonY * 0.25, horizonY * 0.75), rng.range(0.45, 1.0));
  // The volcano across the bay: twin-peaked, hazy blue-grey.
  const vx = W * 0.62;
  g.fillStyle = 'rgba(132,148,170,0.55)';
  g.beginPath();
  g.moveTo(vx - 260, horizonY + 2);
  g.quadraticCurveTo(vx - 120, horizonY - 30, vx - 50, horizonY - 66);
  g.lineTo(vx - 20, horizonY - 72);
  g.quadraticCurveTo(vx, horizonY - 60, vx + 22, horizonY - 64);
  g.quadraticCurveTo(vx + 120, horizonY - 26, vx + 300, horizonY + 2);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(150,164,184,0.45)';
  g.beginPath();
  g.moveTo(vx - 360, horizonY + 2);
  g.quadraticCurveTo(vx - 280, horizonY - 24, vx - 170, horizonY - 30);
  g.quadraticCurveTo(vx - 120, horizonY - 12, vx - 60, horizonY + 2);
  g.closePath();
  g.fill();
  const haze = g.createLinearGradient(0, horizonY - 40, 0, horizonY + 4);
  haze.addColorStop(0, 'rgba(219,229,238,0)');
  haze.addColorStop(1, 'rgba(219,229,238,0.9)');
  g.fillStyle = haze;
  g.fillRect(0, horizonY - 40, W, 44);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 48, 24),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  mesh.renderOrder = -10;
  return mesh;
}
