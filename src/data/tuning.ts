/**
 * Every tunable number in the game lives here. Values marked "doc" come
 * straight from docs/design.md; everything else is a starting value chosen
 * for this build (see DECISIONS.md). The debug panel edits this object live,
 * so systems must read from it at use time instead of caching values.
 *
 * Timing is in frames at 60 Hz unless the name ends in `Sec`.
 */

export interface MoveFrames {
  startup: number;
  active: number;
  recovery: number;
}

export const tuning = {
  sim: {
    hz: 60, // doc: fixed 60 Hz
    maxStepsPerFrame: 5,
    gravity: -20,
  },

  player: {
    maxHealth: 100, // doc
    walkSpeed: 3.2,
    runSpeed: 5.0,
    sprintSpeed: 7.8,
    aimMoveSpeed: 2.4,
    blockMoveSpeed: 1.6,
    turnRateDegPerSec: 720,
    capsuleRadius: 0.35,
    capsuleHalfHeight: 0.55,
    lookSensitivityMouse: 0.0025,
    lookSensitivityPad: 3.2,
    pitchMinDeg: -55,
    pitchMaxDeg: 40,
    interactRange: 2.6,
  },

  melee: {
    light1: { startup: 6, active: 3, recovery: 10 } as MoveFrames, // doc
    light2: { startup: 7, active: 3, recovery: 11 } as MoveFrames, // doc
    light3: { startup: 9, active: 4, recovery: 16 } as MoveFrames, // doc
    lightDamage: [8, 8, 14], // doc
    lightHitstun: [14, 14, 22],
    heavy: { startup: 14, active: 4, recovery: 20 } as MoveFrames, // doc
    heavyDamage: 24, // doc
    heavyHitstun: 24, // doc
    reach: 1.9,
    arcDeg: 120,
    targetAcquireRange: 3.2,
    lungeMax: 1.4,
    comboBufferFrames: 10,
    pointBlankSnapFrames: 4, // doc
    parryWindow: 8, // doc
    parryStagger: 45, // doc
    parryRepressLockout: 24,
    blockReduction: 0.7, // doc: block cuts melee damage by 70%
    dodgeTotal: 20, // doc
    dodgeInvulnStart: 3, // doc
    dodgeInvulnEnd: 14, // doc
    dodgeDistance: 3.2, // doc
    takedownTotal: 40, // doc
    takedownKillFrame: 28,
    takedownRange: 2.0, // doc
    executionTotal: 70, // doc
    executionInvulnStart: 1, // doc
    executionInvulnEnd: 50, // doc
    executionKillFrame: 48,
    executionRange: 2.6,
    throwTotal: 50, // doc
    throwLandFrame: 38,
    throwDamage: 30, // doc
    throwKnockdown: 90, // doc
    throwRange: 1.8,
    throwDistance: 2.6,
    haleExecuteHealthFraction: 0.3, // doc
  },

  weapons: {
    pistol: { damage: 18, magazine: 12, fireInterval: 12, reload: 84, loud: false, reserve: 48, automatic: false }, // doc (reserve chosen)
    revolver: { damage: 55, magazine: 6, fireInterval: 36, reload: 120, loud: true, reserve: 24, automatic: false }, // doc (reserve chosen)
    smg: { damage: 12, magazine: 30, fireInterval: 6, reload: 96, loud: true, reserve: 120, automatic: true }, // doc (reserve chosen)
    headshotMultiplier: 2, // doc (pistol); applied to all guns
    range: 60,
    swapFrames: 18,
    headZoneHeight: 0.32,
    ammoPickupMagazines: 2,
  },

  armor: {
    vest: 50, // doc
    plateCarrier: 100, // doc
    armorPlateRestore: 25, // doc
  },

  camera: {
    explore: { distance: 4.5, height: 1.8, side: 0.6, fov: 60 }, // doc
    melee: { distance: 6.5, height: 2.6, side: 0.3, fov: 65 }, // doc
    aim: { distance: 1.8, height: 1.6, side: 0.8, fov: 45 }, // doc
    conversation: { distance: 2.2, height: 1.4, side: 0.8, fov: 50 }, // doc
    springFrequency: 5.0,
    springDamping: 1.0,
    meleeModeRange: 7,
    collisionPadding: 0.25,
    lockOnRange: 20,
    lockOnBreakRange: 26,
  },

  hostiles: {
    legionary: { health: 60, talkTarget: 20, speed: 3.0, runSpeed: 4.6 }, // doc (health, target)
    trooper: { health: 100, talkTarget: 40, speed: 3.0, runSpeed: 4.8 }, // doc
    escort: { health: 100, speed: 3.0, runSpeed: 4.8 }, // doc
    hale: { health: 300, speed: 3.2, runSpeed: 5.0 }, // doc
    visionConeDeg: 90, // doc
    visionRange: 14, // doc
    spotTimeSec: 0.75, // doc
    detectionDecayPerSec: 0.6,
    sprintNoticeRange: 5, // doc
    peripheralRange: 2.2,
    challengeTalkRange: 2.4,
    challengeGiveUpSec: 4,
    challengeGiveUpRange: 18,
    alertJoinRange: 10, // doc
    alertForgetSec: 20, // doc
    loudGunfireAlertRange: 30, // doc
    eyeHeight: 1.55,
    capsuleRadius: 0.35,
    capsuleHalfHeight: 0.55,
    maxMeleeAttackers: 2,
    maxRangedAttackers: 3,
    tokenCooldownSec: 0.8,
    meleeEngageRange: 1.8,
    preferredRangedDistance: 9,
    rangedMaxDistance: 22,
    hitstunInterruptsAttack: true,
  },

  hostileAttacks: {
    baton: { startup: 20, active: 4, recovery: 26, damage: 10, reach: 1.9 },
    haleMelee: { startup: 16, active: 4, recovery: 22, damage: 18, reach: 2.0 },
    pistol: { aim: 36, burst: 1, burstGap: 8, damage: 7, cooldown: 70 },
    rifle: { aim: 30, burst: 3, burstGap: 6, damage: 5, cooldown: 80 },
    haleRifle: { aim: 26, burst: 3, burstGap: 5, damage: 7, cooldown: 60 },
    hitChanceNear: 0.75,
    hitChanceFar: 0.3,
    nearDistance: 4,
    farDistance: 22,
    sprintHitPenalty: 0.2,
  },

  suspicion: {
    max: 100, // doc
    loudGunfire: 20, // doc
    loudGunfireCooldownSec: 3, // doc
    silencedSeen: 10, // doc
    silencedUnseen: 0, // doc
    failedConversation: 15, // doc
    jammer: 25, // doc
  },

  trust: {
    min: -100, // doc
    max: 100, // doc
    tierBest: 15, // doc: personality lines gain up to +15
    tierGood: 8,
    tierNeutral: 0,
    tierBad: -10,
    tierInsult: -20,
    intel: 25, // doc
    bribeLegionary: 20,
    bribeTrooper: 25,
    bribeCostLegionary: 150,
    bribeCostTrooper: 300,
    bribeCostLucretia: 300,
    exchanges: 3, // doc
    luccaStart: 30, // doc
    lucretiaStart: -30, // doc
    luccaTarget: 30,
    lucretiaTarget: 30, // doc: helps at trust 30+
    lucretiaMaxGainPerConversation: 20, // doc
    luccaDiscountTrust: 60, // doc
    luccaDiscount: 0.25,
  },

  shop: {
    revolver: 600, // doc
    smg: 800, // doc
    plateCarrier: 700, // doc
    jammer: 500, // doc
    smoke: 100, // doc
    medkit: 150, // doc
    conditioning: 1000, // doc
    coverIdentity: 1200, // doc
    luccaAmmo: 80,
    luccaMedkit: 150,
    luccaSmoke: 100,
    maxRunItems: 2, // doc
  },

  items: {
    medkitHeal: 50, // doc
    smokeDurationSec: 8, // doc
    smokeRadius: 4.5,
    smokeThrowDistance: 7,
    conditioningHealth: 20, // doc
    useHoldCycleFrames: 20,
  },

  treasure: {
    valuablesChance: 0.7, // doc
    valuablesMin: 100, // doc
    valuablesMax: 300, // doc
    cacheRevealRange: 12,
  },

  gen: {
    gridSize: 6, // doc
    blockSize: 12, // doc
    minEntranceExitDistance: 50, // doc
    hostilesMinArea12: 8, // doc
    hostilesMaxArea12: 12, // doc
    hostilesMinArea3: 12, // doc
    hostilesMaxArea3: 15, // doc
    cachesMin: 3, // doc
    cachesMax: 4, // doc
    castAppearChance: 0.5, // doc
    baseEscorts: 2, // doc
    maxGrudgeEscorts: 2, // doc
    buildingHeightMin: 7,
    buildingHeightMax: 15,
    alleyWidth: 4,
    streetWidth: 8,
    wallHeight: 6,
    exitBeaconRange: 30,
  },

  run: {
    winDelaySec: 2.5,
    extractionDelaySec: 1.5,
  },
};

export type Tuning = typeof tuning;
export type WeaponId = 'pistol' | 'revolver' | 'smg';

/** Convert frames to seconds at the fixed sim rate. */
export const framesToSec = (frames: number): number => frames / tuning.sim.hz;
export const secToFrames = (sec: number): number => Math.round(sec * tuning.sim.hz);
