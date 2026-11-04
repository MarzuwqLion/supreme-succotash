import { Rng } from '../core/rng';
import type { HostileKind } from '../sim/damage';
import type { Garments, RigColors } from './rig';

/**
 * Who looks like what. Colours keep the doc's readability rule (Legionaries,
 * Troopers, Hale, and the named cast are easy to tell apart); garments follow
 * the Napoli character sheet: draped ivory, crimson, oxblood, and black.
 */

export interface Look {
  colors: RigColors;
  garments?: Garments;
  scale?: number;
}

export const SKIN = [0xc99a74, 0xb5835a, 0xe0b48f, 0x8d5b3e, 0xd9a47c, 0xa6714c, 0xe8c2a0];
const IVORY = [0xece3cf, 0xe4d8bf, 0xf1eadb, 0xd9ccb0];
const REDS = [0xb0301c, 0xc2411f, 0x9b2a1f, 0xd2552e, 0x7a1f1a];
const DARKS = [0x1b1b1f, 0x2a2a2e, 0x34302c, 0x23262b];
const EARTH = [0x6b4a2f, 0x5a3b28, 0x7a5a3a, 0x4a3a2c];
const HAIR = [0x1e1510, 0x2b1d14, 0x3b2a1e, 0x14110f, 0x5a4030, 0x9a9a98, 0xc8c6c2];

export const AGENT: Look = { colors: { body: 0x1d2633, accent: 0x2fb5a8, head: 0xc9a27e } };

export function hostileLook(kind: HostileKind): Look {
  switch (kind) {
    case 'legionary':
      // Oxblood tunic, leather cuirass, crimson cloak: the Empire's old uniform, now Federation-issued.
      return { colors: { body: 0x7a1f1a, accent: 0x6b4a2f, head: 0xc49a74 }, garments: { cloak: 0xa3241b, tunic: 0x8e2a20, band: 0xb08d57 } };
    case 'trooper':
      return { colors: { body: 0x5c6b7a, accent: 0xdfe6ee, head: 0xb8b8b8 } };
    case 'escort':
      return { colors: { body: 0x23272c, accent: 0x6b7480, head: 0x8a8f96 } };
    case 'hale':
      return { colors: { body: 0xe8e2d0, accent: 0xc9a227, head: 0xb08968 }, garments: { cloak: 0xf0ece2, hair: 0x8f8c88 }, scale: 1.12 };
  }
}

export const LUCCA: Look = {
  colors: { body: 0x5a3b28, accent: 0x4a5a6e, head: 0xc49a74 },
  garments: { gown: 0x6e4a32, drape: 0x3f4f66, hair: 0xbdbab5, beard: 0xcfccc6 },
};

export const LUCRETIA: Look = {
  colors: { body: 0x1a1a1e, accent: 0xb0301c, head: 0xd2a07a },
  garments: { gown: 0xc2411f, cloak: 0x151518, drape: 0x151518, hair: 0x2b1d14, longHair: true, band: 0xc9a227 },
};

/** A citizen of Napoli, varied from a seed. */
export function civilianLook(seed: number): Look {
  const r = new Rng(seed);
  const skin = r.pick(SKIN);
  const woman = r.chance(0.5);
  const hair = r.pick(HAIR);
  if (woman) {
    const gown = r.chance(0.5) ? r.pick(IVORY) : r.chance(0.6) ? r.pick(REDS) : r.pick(DARKS);
    const drape = r.chance(0.7) ? (gown === IVORY[0] || IVORY.includes(gown) ? r.pick(REDS) : r.pick([...IVORY, ...DARKS])) : undefined;
    return {
      colors: { body: r.pick([...IVORY, ...DARKS]), accent: drape ?? gown, head: skin },
      garments: { gown, drape, hair, longHair: r.chance(0.7), band: r.chance(0.22) ? 0xc9a227 : undefined, cloak: r.chance(0.18) ? r.pick(DARKS) : undefined },
      scale: r.range(0.92, 1.0),
    };
  }
  const body = r.chance(0.55) ? r.pick(IVORY) : r.chance(0.5) ? r.pick(EARTH) : r.pick(DARKS);
  const drape = r.chance(0.65) ? r.pick([...REDS, ...IVORY, 0x4a5a6e]) : undefined;
  const longRobe = r.chance(0.35);
  return {
    colors: { body, accent: r.pick([...EARTH, ...DARKS]), head: skin },
    garments: {
      gown: longRobe ? r.pick([...EARTH, ...IVORY]) : undefined,
      tunic: longRobe ? undefined : r.chance(0.5) ? body : undefined,
      drape,
      hair: r.chance(0.85) ? hair : undefined,
      beard: r.chance(0.4) ? hair : undefined,
      cloak: r.chance(0.12) ? r.pick(REDS) : undefined,
    },
    scale: r.range(0.96, 1.06),
  };
}
