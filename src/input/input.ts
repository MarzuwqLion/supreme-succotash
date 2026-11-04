import { tuning } from '../data/tuning';

/**
 * Gamepad-first input with keyboard and mouse fallback. Devices are polled
 * into one InputFrame per simulation step, so the sim never touches DOM
 * events directly. Edges (pressed/released) are latched between steps so
 * quick taps are never lost.
 */

export const ACTIONS = [
  'light',
  'heavy',
  'fire',
  'aim',
  'block',
  'dodge',
  'context',
  'sprint',
  'lockOn',
  'interact',
  'swapPrev',
  'swapNext',
  'camera',
  'swap1',
  'swap2',
  'useItem',
  'reload',
  'pause',
  'debug',
  'confirm',
  'back',
  'up',
  'down',
  'left',
  'right',
  'choice1',
  'choice2',
  'choice3',
  'choice4',
] as const;
export type Action = (typeof ACTIONS)[number];
type Flags = Record<Action, boolean>;

export interface InputFrame {
  /** x = right, y = forward; magnitude 0..1. */
  move: { x: number; y: number };
  /** Look delta in radians for this step (x = yaw right, y = pitch up). */
  look: { x: number; y: number };
  held: Flags;
  pressed: Flags;
  released: Flags;
  device: 'pad' | 'kbm';
}

const emptyFlags = (): Flags => Object.fromEntries(ACTIONS.map((a) => [a, false])) as Flags;

export function emptyFrame(): InputFrame {
  return { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, held: emptyFlags(), pressed: emptyFlags(), released: emptyFlags(), device: 'kbm' };
}

const KEY_MAP: Record<string, Action[]> = {
  KeyE: ['light'],
  KeyQ: ['heavy'],
  ControlLeft: ['block'],
  ControlRight: ['block'],
  KeyC: ['block'], // alternate: Ctrl+W closes tabs in some browsers
  Space: ['dodge', 'confirm'],
  KeyF: ['context'],
  ShiftLeft: ['sprint'],
  ShiftRight: ['sprint'],
  KeyR: ['interact'],
  Digit1: ['swap1', 'choice1'],
  Digit2: ['swap2', 'choice2'],
  Digit3: ['useItem', 'choice3'],
  Digit4: ['choice4'],
  KeyT: ['reload'],
  Escape: ['pause', 'back'],
  Backquote: ['debug'],
  KeyV: ['camera'],
  Enter: ['confirm'],
  ArrowUp: ['up'],
  ArrowDown: ['down'],
  ArrowLeft: ['left'],
  ArrowRight: ['right'],
};

/** Keys that also navigate menus (but not conversations, where WASD means walking away). */
export const MENU_WASD: Record<string, 'up' | 'down' | 'left' | 'right'> = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };

// Standard gamepad mapping (Xbox layout).
const PAD_MAP: Record<number, Action[]> = {
  0: ['dodge', 'confirm'], // A
  1: ['context', 'back'], // B
  2: ['light'], // X
  3: ['heavy'], // Y
  4: ['block'], // LB
  5: ['interact'], // RB
  6: ['aim'], // LT
  7: ['fire'], // RT
  8: ['debug'], // Back / View
  9: ['pause'], // Start / Menu
  10: ['sprint'], // L3
  11: ['lockOn'], // R3
  12: ['useItem', 'up'], // D-pad up
  13: ['reload', 'down'], // D-pad down
  14: ['swapPrev', 'left'], // D-pad left: swap weapon
  15: ['camera', 'right'], // D-pad right: toggle over-the-shoulder camera
};

const DEADZONE = 0.18;

function deadzone(x: number, y: number): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m < DEADZONE) return { x: 0, y: 0 };
  const s = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m;
  return { x: x * s, y: y * s };
}

export class InputSystem {
  private keys = new Set<string>();
  private mouse = new Set<number>();
  private latchedPress = emptyFlags();
  private latchedRelease = emptyFlags();
  private prevHeld = emptyFlags();
  private mouseDX = 0;
  private mouseDY = 0;
  private padSprintLatched = false;
  private lastDevice: 'pad' | 'kbm' = 'kbm';
  private prevPadButtons: boolean[] = [];
  /** When false, keyboard/mouse game actions are ignored (e.g. typing in debug panel). */
  enabled = true;
  /** WASD also moves menu focus (FOB, pause); off in conversations so WASD walks away. */
  wasdNavigates = true;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      if (KEY_MAP[e.code]) {
        // Keep the page from scrolling / selecting while playing.
        if (e.code !== 'Escape' && !(e.ctrlKey && e.code === 'KeyR')) e.preventDefault();
      }
      if (!this.keys.has(e.code)) {
        this.keys.add(e.code);
        for (const a of KEY_MAP[e.code] ?? []) this.latchedPress[a] = true;
        const nav = MENU_WASD[e.code];
        if (nav && this.wasdNavigates) this.latchedPress[nav] = true;
      }
      this.lastDevice = 'kbm';
    });
    window.addEventListener('keyup', (e) => {
      if (this.keys.delete(e.code)) for (const a of KEY_MAP[e.code] ?? []) this.latchedRelease[a] = true;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.clear();
    });
    target.addEventListener('mousedown', (e) => {
      this.mouse.add(e.button);
      for (const a of this.mouseActions(e.button)) this.latchedPress[a] = true;
      this.lastDevice = 'kbm';
      if (e.button === 1) e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (this.mouse.delete(e.button)) for (const a of this.mouseActions(e.button)) this.latchedRelease[a] = true;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.target) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
        this.lastDevice = 'kbm';
      }
    });
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }

  private mouseActions(button: number): Action[] {
    if (button === 0) return ['fire'];
    if (button === 2) return ['aim'];
    if (button === 1) return ['lockOn'];
    return [];
  }

  requestPointerLock(): void {
    if (document.pointerLockElement !== this.target) this.target.requestPointerLock?.();
  }

  releasePointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  private readPad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Build the frame for one simulation step and clear latched edges. */
  sample(): InputFrame {
    const f = emptyFrame();
    const held = f.held;
    if (this.enabled) {
      for (const code of this.keys) for (const a of KEY_MAP[code] ?? []) held[a] = true;
      for (const b of this.mouse) for (const a of this.mouseActions(b)) held[a] = true;
    }

    // Keyboard movement.
    let mx = 0;
    let my = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW')) my += 1;
      if (this.keys.has('KeyS')) my -= 1;
      if (this.keys.has('KeyD')) mx += 1;
      if (this.keys.has('KeyA')) mx -= 1;
    }
    const km = Math.hypot(mx, my);
    if (km > 0) {
      mx /= km;
      my /= km;
    }
    f.move = { x: mx, y: my };
    const sens = tuning.player.lookSensitivityMouse;
    f.look = { x: this.mouseDX * sens, y: -this.mouseDY * sens };
    this.mouseDX = 0;
    this.mouseDY = 0;

    // Gamepad.
    const pad = this.readPad();
    const padPressed = emptyFlags();
    if (pad) {
      const buttons = pad.buttons.map((b) => b.pressed || b.value > 0.5);
      let padActive = false;
      buttons.forEach((down, i) => {
        const acts = PAD_MAP[i];
        if (!acts) return;
        if (down) {
          padActive = true;
          for (const a of acts) held[a] = true;
        }
        if (down && !this.prevPadButtons[i]) for (const a of acts) padPressed[a] = true;
      });
      this.prevPadButtons = buttons;
      const ls = deadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
      const rs = deadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
      if (ls.x || ls.y) {
        f.move = { x: ls.x, y: -ls.y };
        padActive = true;
      }
      if (rs.x || rs.y) {
        const k = tuning.player.lookSensitivityPad / tuning.sim.hz;
        f.look = { x: f.look.x + rs.x * k, y: f.look.y - rs.y * k };
        padActive = true;
      }
      if (padActive) this.lastDevice = 'pad';
      // L3 sprint latches until the stick is released (keyboard Shift is hold).
      if (padPressed.sprint) this.padSprintLatched = !this.padSprintLatched;
      if (!ls.x && !ls.y) this.padSprintLatched = false;
      if (this.padSprintLatched) held.sprint = true;
    }

    for (const a of ACTIONS) {
      f.pressed[a] = this.latchedPress[a] || padPressed[a] || (held[a] && !this.prevHeld[a] && a !== 'sprint');
      f.released[a] = this.latchedRelease[a] || (!held[a] && this.prevHeld[a]);
      this.latchedPress[a] = false;
      this.latchedRelease[a] = false;
    }
    if (!this.enabled) {
      for (const a of ACTIONS) if (a !== 'debug') f.pressed[a] = false;
    }
    this.prevHeld = { ...held };
    f.device = this.lastDevice;
    return f;
  }
}
