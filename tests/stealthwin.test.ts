import { describe, expect, it } from 'vitest';
import { forwardFromYaw, normalizeXZ, sub, v3, yawTo } from '../src/core/vec';
import { emptyFrame } from '../src/input/input';
import { generateArea } from '../src/sim/gen/generator';
import { initPhysics } from '../src/sim/physics';
import { SimWorld } from '../src/sim/world';
import { runBot } from './bots/bots';
import { carry } from './helpers';

/**
 * The doc's stealth win: an unaware Hale can be taken down. In a generated
 * Castel (only Hale's group kept), wait for one of his inspection pauses,
 * come up behind the group, and take down the escorts and then Hale.
 */
async function stealthWin(seed: number): Promise<{ won: boolean; method: string; suspicion: number; alerted: boolean }> {
  const R = await initPhysics();
  const layout = generateArea({ type: 'castel', index: 2, seed });
  const w = new SimWorld(R, { layout, areaIndex: 2, runSeed: seed, carry: carry(), coverIdentity: false, areaIntel: null, haleTaunt: null });
  for (const h of w.hostiles) if (h.kind !== 'hale' && h.kind !== 'escort') w.killHostile(h, 'gun');
  w.civilians.length = 0;
  w.drainEvents();
  const hale = w.hale!;
  // Wait out of sight until Hale stops to inspect.
  w.physics.teleport(w.player.body, layout.entrance);
  for (let i = 0; i < 60 * 40 && !(hale.waitFrames > 200); i++) w.tick(emptyFrame());
  const back = forwardFromYaw(hale.yaw);
  w.physics.teleport(w.player.body, v3(hale.pos.x - back.x * 7, hale.pos.y, hale.pos.z - back.z * 7));
  w.tick(emptyFrame());
  let method = '';
  let alerted = false;
  for (let i = 0; i < 60 * 20 && !method; i++) {
    const p = w.player;
    const group = w.hostiles.filter((h) => (h.kind === 'escort' || h.kind === 'hale') && h.state !== 'dead');
    const target = group.filter((h) => h.kind === 'escort')[0] ?? group[0];
    const f = emptyFrame();
    if (target && p.action.kind === 'none') {
      if (p.context.action === 'takedown') f.pressed.context = true;
      else {
        // Approach a spot just behind the target.
        const tb = forwardFromYaw(target.yaw);
        const spot = v3(target.pos.x - tb.x * 1.1, target.pos.y, target.pos.z - tb.z * 1.1);
        const dir = normalizeXZ(sub(spot, p.pos));
        p.viewYaw = Math.atan2(dir.x, dir.z);
        f.move = { x: 0, y: 0.6 };
      }
    }
    w.tick(f);
    for (const e of w.drainEvents()) {
      if (e.type === 'alert') alerted = true;
      if (e.type === 'haleDown') method = e.method;
    }
    if (target) p.viewYaw = yawTo(p.pos, target.pos);
  }
  const res = { won: !!method, method, suspicion: w.suspicion.peak, alerted };
  w.dispose();
  return res;
}

describe('stealth win', () => {
  it('Hale and his escorts can be taken down from behind during an inspection pause', async () => {
    const seeds = [11, 23, 37, 41, 53, 67];
    let wins = 0;
    for (const seed of seeds) {
      const r = await stealthWin(seed);
      if (r.won && r.method === 'takedown' && r.suspicion === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(seeds.length - 1);
  }, 120000);
});

describe('replay', () => {
  it('the same seed and inputs replay identically', async () => {
    const a = await runBot('gunfu', 4242, 0, undefined, 60 * 40);
    const b = await runBot('gunfu', 4242, 0, undefined, 60 * 40);
    expect(b).toEqual(a);
  }, 60000);
});
