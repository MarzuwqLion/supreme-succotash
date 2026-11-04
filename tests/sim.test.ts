import { describe, expect, it } from 'vitest';
import { v3 } from '../src/core/vec';
import { tuning } from '../src/data/tuning';
import { makeWorld, openLayout, press, run, frame, hold } from './helpers';

describe('simulation (Rapier, headless)', () => {
  it('boots a world and keeps the agent on the ground', async () => {
    const w = await makeWorld(openLayout([]));
    run(w, 10);
    expect(w.player.pos.y).toBeCloseTo(0, 3);
    expect(w.frame).toBe(10);
  });

  it('moves the agent forward with stick input', async () => {
    const w = await makeWorld(openLayout([]));
    const z0 = w.player.pos.z;
    run(w, 60, () => frame((f) => (f.move = { x: 0, y: 1 })));
    expect(w.player.pos.z - z0).toBeGreaterThan(3);
  });

  it('spots the agent after 0.75 s in the vision cone', async () => {
    // Hostile at z=14 facing -z (toward the agent at z=6).
    const w = await makeWorld(openLayout([{ kind: 'escort', pos: v3(6, 0, 14), yaw: Math.PI }]));
    const h = w.hostiles[0]!;
    let spottedAt = -1;
    for (let i = 0; i < 120 && spottedAt < 0; i++) {
      w.tick(frame());
      if (h.state === 'alert') spottedAt = w.frame;
    }
    const expected = Math.round(tuning.hostiles.spotTimeSec * tuning.sim.hz);
    expect(spottedAt).toBeGreaterThanOrEqual(expected - 2);
    expect(spottedAt).toBeLessThanOrEqual(expected + 2);
  });

  it('does not spot an agent standing behind the hostile', async () => {
    const w = await makeWorld(openLayout([{ kind: 'trooper', pos: v3(6, 0, 10), yaw: 0 }]));
    run(w, 120);
    expect(w.hostiles[0]!.state).toBe('patrol');
    expect(w.hostiles[0]!.detection).toBe(0);
  });

  it('a talkable hostile who spots the agent challenges and starts a conversation', async () => {
    const w = await makeWorld(openLayout([{ kind: 'legionary', pos: v3(6, 0, 14), yaw: Math.PI }]));
    let conv = false;
    for (let i = 0; i < 400 && !conv; i++) {
      w.tick(frame());
      conv = w.drainEvents().some((e) => e.type === 'conversation');
    }
    expect(conv).toBe(true);
    expect(w.hostiles[0]!.state).toBe('conversation');
  });

  it('Takedown silently kills an unaware hostile within 2 m', async () => {
    // Agent directly behind a hostile facing away.
    const w = await makeWorld(openLayout([{ kind: 'trooper', pos: v3(6, 0, 7.5), yaw: 0 }]));
    w.tick(frame());
    expect(w.player.context.action).toBe('takedown');
    w.tick(press('context'));
    run(w, tuning.melee.takedownTotal + 2);
    expect(w.hostiles[0]!.state).toBe('dead');
    expect(w.stats.takedowns).toBe(1);
    expect(w.suspicion.value).toBe(0);
  });

  it('a hostile who witnesses a Takedown goes to Alert without raising suspicion', async () => {
    const w = await makeWorld(
      openLayout([
        { kind: 'trooper', pos: v3(6, 0, 7.5), yaw: 0 },
        // Witness 10 m away looking straight at the agent.
        { kind: 'escort', pos: v3(6, 0, 18), yaw: Math.PI },
      ]),
    );
    w.tick(frame());
    w.tick(press('context'));
    run(w, tuning.melee.takedownTotal + 2);
    expect(w.hostiles[0]!.state).toBe('dead');
    expect(w.hostiles[1]!.state).toBe('alert');
    expect(w.suspicion.value).toBe(0);
  });

  it('loud gunfire adds 20 suspicion once per 3 s and alerts everyone within 30 m', async () => {
    const w = await makeWorld(
      openLayout([
        { kind: 'legionary', pos: v3(6, 0, 30), yaw: 0 },
        { kind: 'legionary', pos: v3(60, 0, 60), yaw: 0 },
      ]),
      {},
    );
    w.player.weapons.push({ id: 'smg', mag: 999, reserve: 0 });
    w.player.slot = 1;
    w.player.viewPitch = 0.6; // shoot at the sky
    w.tick(press('fire'));
    expect(w.suspicion.value).toBe(tuning.suspicion.loudGunfire);
    expect(w.hostiles[0]!.state).toBe('alert');
    expect(w.hostiles[1]!.state).toBe('patrol');
    // Keep firing for one second: still only +20.
    run(w, 60, () => hold('fire'));
    expect(w.suspicion.value).toBe(tuning.suspicion.loudGunfire);
    run(w, 3 * 60, () => hold('fire'));
    expect(w.suspicion.value).toBeGreaterThanOrEqual(2 * tuning.suspicion.loudGunfire);
  });

  it('a silenced shot nobody sees adds no suspicion', async () => {
    const w = await makeWorld(openLayout([{ kind: 'trooper', pos: v3(30, 0, 30), yaw: 0 }]));
    w.player.viewPitch = 0.6;
    w.tick(press('fire'));
    expect(w.player.weapons[0]!.mag).toBe(tuning.weapons.pistol.magazine - 1);
    expect(w.suspicion.value).toBe(0);
  });

  it('a silenced shot seen by a hostile adds 10 suspicion', async () => {
    const w = await makeWorld(openLayout([{ kind: 'trooper', pos: v3(6, 0, 16), yaw: Math.PI }]));
    w.player.viewPitch = 0.6;
    w.tick(press('fire'));
    expect(w.suspicion.value).toBe(tuning.suspicion.silencedSeen);
  });

  it('a pistol headshot does double damage', async () => {
    const w = await makeWorld(openLayout([{ kind: 'trooper', pos: v3(6, 0, 12), yaw: 0 }]));
    const h = w.hostiles[0]!;
    // Aim from the agent's shoulder camera at the hostile's head.
    w.player.aiming = true;
    w.tick(hold('aim'));
    const cam = tuning.camera.aim;
    const top = h.body!.centerY + h.body!.halfHeight + h.body!.radius;
    const origin = { x: w.player.pos.x - cam.side, y: cam.height, z: w.player.pos.z };
    const target = { x: h.pos.x, y: top - 0.12, z: h.pos.z };
    w.player.viewYaw = Math.atan2(target.x - origin.x, target.z - origin.z);
    w.player.viewPitch = Math.atan2(target.y - origin.y, Math.hypot(target.x - origin.x, target.z - origin.z));
    w.tick(frame((f) => { f.held.aim = true; f.pressed.fire = true; f.held.fire = true; }));
    expect(h.maxHealth - h.health).toBe(tuning.weapons.pistol.damage * tuning.weapons.headshotMultiplier);
  });

  it('reloads automatically when the magazine empties', async () => {
    const w = await makeWorld(openLayout([]));
    w.player.weapons[0]!.mag = 1;
    w.player.viewPitch = 0.6;
    w.tick(press('fire'));
    expect(w.player.reload).toBe(tuning.weapons.pistol.reload - 0);
    run(w, tuning.weapons.pistol.reload + 1);
    expect(w.player.weapons[0]!.mag).toBe(tuning.weapons.pistol.magazine);
  });

  it('a parry staggers a melee attacker for 45 frames and enables an Execution', async () => {
    const w = await makeWorld(openLayout([{ kind: 'legionary', pos: v3(6, 0, 7.4), yaw: Math.PI }]));
    const h = w.hostiles[0]!;
    w.alert(h, w.player.pos, { force: true });
    // Wait until the baton swing is about to land, then tap block.
    let parried = false;
    for (let i = 0; i < 300 && !parried; i++) {
      const atk = h.attack;
      const tapNow = atk?.kind === 'melee' && atk.frame === tuning.hostileAttacks.baton.startup - 3;
      w.tick(tapNow ? press('block') : frame());
      parried = h.combat === 'stagger';
    }
    expect(parried).toBe(true);
    expect(h.combatFrames).toBeGreaterThan(tuning.melee.parryStagger - 6);
    expect(w.player.health).toBe(100);
    w.tick(frame());
    expect(w.player.context.action).toBe('execution');
    w.tick(press('context'));
    run(w, tuning.melee.executionTotal + 2);
    expect(h.state).toBe('dead');
    expect(w.stats.executions).toBe(1);
  });

  it('blocking cuts melee damage by 70%', async () => {
    const w = await makeWorld(openLayout([{ kind: 'legionary', pos: v3(6, 0, 7.4), yaw: Math.PI }]));
    const h = w.hostiles[0]!;
    w.alert(h, w.player.pos, { force: true });
    // Hold block (after the parry window has long passed).
    w.tick(press('block'));
    for (let i = 0; i < 300 && w.player.health === 100; i++) w.tick(hold('block'));
    expect(w.player.health).toBeCloseTo(100 - tuning.hostileAttacks.baton.damage * 0.3, 5);
  });

  it('Throw deals 30 damage and knocks down for 90 frames', async () => {
    const w = await makeWorld(openLayout([{ kind: 'trooper', pos: v3(6, 0, 7.4), yaw: Math.PI }]));
    const h = w.hostiles[0]!;
    w.alert(h, w.player.pos, { force: true });
    w.tick(frame());
    expect(w.player.context.action).toBe('throw');
    w.tick(press('context'));
    run(w, tuning.melee.throwLandFrame + 1);
    expect(h.maxHealth - h.health).toBe(tuning.melee.throwDamage);
    expect(h.combat).toBe('knockdown');
  });

  it('the light string chains three hits for 8, 8, 14', async () => {
    const w = await makeWorld(openLayout([{ kind: 'escort', pos: v3(6, 0, 7.6), yaw: Math.PI }]));
    const h = w.hostiles[0]!;
    h.health = h.maxHealth = 1000;
    w.tick(press('light'));
    for (let i = 0; i < 70; i++) w.tick(i % 4 === 0 && i < 22 ? press('light') : frame());
    expect(h.maxHealth - h.health).toBe(8 + 8 + 14);
  });

  it('dodge is invulnerable on frames 3-14 and moves 3.2 m', async () => {
    const w = await makeWorld(openLayout([]));
    const z0 = w.player.pos.z;
    w.tick(press('dodge')); // no stick input: dodge backward
    expect(w.playerInvulnerable).toBe(false);
    run(w, 3);
    expect(w.playerInvulnerable).toBe(true);
    run(w, tuning.melee.dodgeTotal);
    expect(Math.abs(w.player.pos.z - z0)).toBeCloseTo(tuning.melee.dodgeDistance, 1);
  });

  it('reaching zero health emits playerDown (extraction)', async () => {
    const w = await makeWorld(openLayout([]));
    w.player.armor = 0;
    w.hostileGunHitsPlayer(200);
    expect(w.player.dead).toBe(true);
    expect(w.drainEvents().some((e) => e.type === 'playerDown')).toBe(true);
  });

  it('a stealth Takedown on an unaware Hale ends the run', async () => {
    const w = await makeWorld(openLayout([{ kind: 'hale', pos: v3(6, 0, 7.5), yaw: 0 }]), {});
    w.tick(frame());
    expect(w.player.context.action).toBe('takedown');
    w.tick(press('context'));
    run(w, tuning.melee.takedownTotal + 2);
    const evs = w.drainEvents();
    expect(evs.some((e) => e.type === 'haleDown' && e.method === 'takedown')).toBe(true);
  });

  it('Hale cannot be thrown, and can be executed only at 30% health or below', async () => {
    const w = await makeWorld(openLayout([{ kind: 'hale', pos: v3(6, 0, 7.4), yaw: Math.PI }]));
    const hale = w.hostiles[0]!;
    w.alert(hale, w.player.pos, { force: true });
    w.tick(frame());
    expect(w.player.context.action).toBe(null);
    w.staggerHostile(hale, 45);
    w.tick(frame());
    expect(w.player.context.action).toBe(null);
    hale.health = hale.maxHealth * 0.3;
    w.staggerHostile(hale, 45);
    w.tick(frame());
    expect(w.player.context.action).toBe('execution');
  });

  it('max suspicion sends every hostile to Alert', async () => {
    const w = await makeWorld(
      openLayout([
        { kind: 'legionary', pos: v3(60, 0, 60), yaw: 0 },
        { kind: 'trooper', pos: v3(40, 0, 60), yaw: 0 },
      ]),
    );
    w.applySuspicion(w.suspicion.set(100));
    expect(w.hostiles.every((h) => h.state === 'alert')).toBe(true);
  });

  it('alerted hostiles return to Patrol after 20 s without seeing the agent', async () => {
    const w = await makeWorld(openLayout([{ kind: 'trooper', pos: v3(60, 0, 60), yaw: 0 }], {}));
    const h = w.hostiles[0]!;
    w.alert(h, v3(60, 0, 50), { force: true });
    // Hide the agent behind a wall of smoke so it can't be seen.
    w.spawnSmoke(w.player.pos);
    w.smokes[0]!.framesLeft = 99999;
    run(w, Math.round(tuning.hostiles.alertForgetSec * 60) + 5);
    expect(h.state).toBe('patrol');
  });

  it('attack tokens limit simultaneous melee attackers to 2', async () => {
    const w = await makeWorld(
      openLayout([
        { kind: 'legionary', pos: v3(6, 0, 7.6), yaw: Math.PI },
        { kind: 'legionary', pos: v3(7.6, 0, 6), yaw: -Math.PI / 2 },
        { kind: 'legionary', pos: v3(4.4, 0, 6), yaw: Math.PI / 2 },
      ]),
    );
    w.godMode = true;
    for (const h of w.hostiles) w.alert(h, w.player.pos, { force: true });
    let maxMelee = 0;
    for (let i = 0; i < 400; i++) {
      w.tick(frame());
      maxMelee = Math.max(maxMelee, w.hostiles.filter((h) => h.attack?.kind === 'melee').length);
      expect(w.tokens.melee.size).toBeLessThanOrEqual(tuning.hostiles.maxMeleeAttackers);
    }
    expect(maxMelee).toBe(2);
  });

  it('smoke blocks vision', async () => {
    const w = await makeWorld(openLayout([{ kind: 'escort', pos: v3(6, 0, 16), yaw: Math.PI }]));
    w.spawnSmoke(v3(6, 0, 11));
    run(w, 120);
    expect(w.hostiles[0]!.state).toBe('patrol');
  });

  it('point-blank shot: RT during a strike fires once at the melee target after a 4-frame snap', async () => {
    const w = await makeWorld(openLayout([{ kind: 'escort', pos: v3(6, 0, 7.6), yaw: Math.PI }]));
    const h = w.hostiles[0]!;
    h.health = h.maxHealth = 1000;
    w.tick(press('light'));
    w.tick(press('fire'));
    const mag = w.player.weapons[0]!.mag;
    run(w, tuning.melee.pointBlankSnapFrames - 1);
    expect(w.player.weapons[0]!.mag).toBe(mag);
    run(w, 2);
    expect(w.player.weapons[0]!.mag).toBe(mag - 1);
    // A second RT in the same strike does nothing.
    w.tick(press('fire'));
    run(w, 6);
    expect(w.player.weapons[0]!.mag).toBe(mag - 1);
    run(w, 20);
    expect(h.maxHealth - h.health).toBe(tuning.melee.lightDamage[0]! + tuning.weapons.pistol.damage);
  });

  it('items: medkit heals 50, jammer removes 25 once per area, smoke spawns a cloud', async () => {
    const w = await makeWorld(openLayout([]), {});
    const p = w.player;
    p.items.medkit = 1;
    p.items.smoke = 1;
    p.hasJammer = true;
    p.health = 30;
    p.selectedItem = 0;
    w.tick(press('useItem'));
    w.tick(frame((f) => (f.released.useItem = true)));
    expect(p.health).toBe(80);
    w.applySuspicion(w.suspicion.set(60));
    // Medkits are gone, so the selection falls through to smoke, then jammer.
    w.tick(press('useItem'));
    w.tick(frame((f) => (f.released.useItem = true)));
    expect(w.smokes.length).toBe(1);
    w.tick(press('useItem'));
    w.tick(frame((f) => (f.released.useItem = true)));
    expect(w.suspicion.value).toBe(35);
    expect(w.suspicion.jammerAvailable).toBe(false);
  });

  it('swapping weapons and manual reload', async () => {
    const w = await makeWorld(openLayout([]), {});
    w.player.weapons.push({ id: 'revolver', mag: 2, reserve: 12 });
    w.tick(press('swap2'));
    expect(w.player.slot).toBe(1);
    w.tick(press('reload'));
    run(w, tuning.weapons.revolver.reload + 1);
    expect(w.player.weapons[1]).toMatchObject({ mag: 6, reserve: 8 });
  });

  it('climbs a stair onto an elevated deck', async () => {
    // A 5 m deck with a 30 degree stair rising toward +x, built like the generator's.
    const theta = Math.PI / 6;
    const H = 5;
    const runLen = H / Math.tan(theta);
    const L = runLen / Math.cos(theta);
    const footX = 10;
    const layout = openLayout([], {
      boxes: [
        { x: footX + runLen / 2 + 0.2 * Math.sin(theta), y: H / 2 - 0.2 * Math.cos(theta), z: 6, hx: L / 2 + 0.25, hy: 0.2, hz: 1.5, look: 'step', tilt: { axis: 'z', angle: theta } },
        { x: footX + runLen + 3, y: H - 0.2, z: 6, hx: 3, hy: 0.2, hz: 3, look: 'deck' },
      ],
    });
    const w = await makeWorld(layout);
    w.player.viewYaw = Math.PI / 2; // face +x
    let peak = 0;
    for (let i = 0; i < 60 * 4; i++) {
      w.tick(frame((f) => (f.move = { x: 0, y: 1 })));
      peak = Math.max(peak, w.player.pos.y);
    }
    expect(peak).toBeGreaterThan(H - 0.3);
    // Walking off the far end of the deck, gravity brings the agent back down.
    run(w, 60 * 3, () => frame((f) => (f.move = { x: 0, y: 1 })));
    expect(w.player.pos.y).toBeLessThan(0.3);
  });

  it('takes cover behind a low wall and crouches out of sight', async () => {
    const layout = openLayout([{ kind: 'escort', pos: v3(6, 0, 20), yaw: Math.PI }], {
      boxes: [{ x: 6, y: 0.5, z: 7.4, hx: 2, hy: 0.5, hz: 0.25, look: 'parapet' }],
    });
    const w = await makeWorld(layout);
    w.player.viewYaw = 0; // facing +z, toward the wall and the hostile beyond it
    w.tick(frame((f) => (f.move = { x: 0, y: 1 })));
    expect(w.player.coverHint?.low).toBe(true);
    w.tick(frame((f) => { f.move = { x: 0, y: 1 }; f.pressed.dodge = true; f.held.dodge = true; }));
    run(w, 20);
    expect(w.player.cover).not.toBe(null);
    expect(w.player.crouched).toBe(true);
    expect(w.player.action.kind).toBe('none');
    // Crouched behind 1 m of cover, the hostile 13 m away can't see the agent.
    run(w, 90);
    expect(w.hostiles[0]!.state).toBe('patrol');
    // Aiming pops the agent up into view.
    run(w, 90, () => hold('aim'));
    expect(w.player.crouched).toBe(false);
    expect(w.hostiles[0]!.state).toBe('alert');
  });

  it('pulling away from cover leaves it', async () => {
    const layout = openLayout([], { boxes: [{ x: 6, y: 2, z: 7.4, hx: 2, hy: 2, hz: 0.25, look: 'palazzo' }] });
    const w = await makeWorld(layout);
    w.player.viewYaw = 0;
    w.tick(frame((f) => { f.move = { x: 0, y: 1 }; f.pressed.dodge = true; f.held.dodge = true; }));
    run(w, 15);
    expect(w.player.cover?.low).toBe(false);
    run(w, 15, () => frame((f) => (f.move = { x: 0, y: -1 })));
    expect(w.player.cover).toBe(null);
  });

  it('the dodge is a forward roll: the agent turns into the direction of travel', async () => {
    const w = await makeWorld(openLayout([{ kind: 'escort', pos: v3(20, 0, 20), yaw: 0 }]));
    w.player.lockTarget = w.hostiles[0]!.id;
    w.player.viewYaw = 0;
    // Roll to the right (camera-relative).
    w.tick(frame((f) => { f.move = { x: 1, y: 0 }; f.pressed.dodge = true; f.held.dodge = true; }));
    expect(w.player.action.kind).toBe('dodge');
    const dir = (w.player.action as { dir: { x: number; z: number } }).dir;
    expect(Math.abs(w.player.yaw - Math.atan2(dir.x, dir.z))).toBeLessThan(1e-6);
  });

  it('while talking the agent stands still and the world keeps running', async () => {
    const w = await makeWorld(openLayout([{ kind: 'trooper', pos: v3(30, 0, 30), yaw: 0, route: [v3(30, 0, 30), v3(40, 0, 30)] }]));
    w.player.talking = true;
    const p0 = { ...w.player.pos };
    const h0 = { ...w.hostiles[0]!.pos };
    run(w, 240, () => frame((f) => (f.move = { x: 0, y: 1 })));
    expect(Math.hypot(w.player.pos.x - p0.x, w.player.pos.z - p0.z)).toBeLessThan(0.01);
    expect(w.frame).toBe(240);
    expect(Math.hypot(w.hostiles[0]!.pos.x - h0.x, w.hostiles[0]!.pos.z - h0.z)).toBeGreaterThan(1);
  });

  it('the shoulder camera toggles and swaps shoulders instead of locking on', async () => {
    const w = await makeWorld(openLayout([{ kind: 'escort', pos: v3(6, 0, 14), yaw: 0 }]));
    w.tick(press('camera'));
    expect(w.player.viewStyle).toBe('shoulder');
    w.tick(press('lockOn'));
    expect(w.player.lockTarget).toBe(null);
    expect(w.player.shoulder).toBe(-1);
    w.tick(press('camera'));
    expect(w.player.viewStyle).toBe('classic');
  });
});
