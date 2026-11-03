import { describe, expect, it } from 'vitest';
import { FollowCamera } from '../src/render/camera';
import { tuning } from '../src/data/tuning';

describe('camera spring', () => {
  it('settles on the mode values at low and high frame rates without diverging', () => {
    for (const fps of [20, 30, 60, 144]) {
      const cam = new FollowCamera(16 / 9);
      for (let i = 0; i < fps * 3; i++) cam.update(1 / fps, { x: 10, y: 0, z: 10 }, 0, 0, i < fps ? 'explore' : 'aim');
      expect(cam.camera.fov).toBeCloseTo(tuning.camera.aim.fov, 1);
      const p = cam.camera.position;
      expect(Math.hypot(p.x - 10, p.z - 10)).toBeLessThan(5);
    }
  });
});
