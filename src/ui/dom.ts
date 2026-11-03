import type { InputFrame } from '../input/input';

/** Tiny DOM helpers plus gamepad/keyboard focus navigation for menus. */

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void) | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/**
 * Moves focus between enabled buttons inside `root` with D-pad / stick /
 * arrows, and clicks with A / Enter / Space. Mouse clicks work as usual.
 */
export class MenuNav {
  private index = 0;
  private repeat = 0;

  constructor(private root: HTMLElement) {}

  setRoot(root: HTMLElement): void {
    this.root = root;
    this.index = 0;
    this.focusCurrent();
  }

  private buttons(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>('button:not([disabled]), [data-nav]:not([disabled])')].filter((b) => b.offsetParent !== null);
  }

  focusCurrent(): void {
    const bs = this.buttons();
    if (!bs.length) return;
    this.index = Math.max(0, Math.min(bs.length - 1, this.index));
    bs.forEach((b, i) => b.classList.toggle('focused', i === this.index));
    bs[this.index]!.scrollIntoView({ block: 'nearest' });
  }

  /** Returns true if the frame was consumed. */
  handle(f: InputFrame): boolean {
    const bs = this.buttons();
    if (!bs.length) return false;
    const stickY = f.move.y;
    let delta = 0;
    if (f.pressed.down || f.pressed.right) delta = 1;
    if (f.pressed.up || f.pressed.left) delta = -1;
    if (f.device === 'pad' && Math.abs(stickY) > 0.6) {
      if (this.repeat <= 0) {
        delta = stickY > 0 ? -1 : 1;
        this.repeat = 14;
      } else this.repeat--;
    } else this.repeat = 0;
    // On keyboard, W/S/A/D map to up/down/left/right, so this works without a pad too.
    if (delta) {
      this.index = (this.index + delta + bs.length) % bs.length;
      this.focusCurrent();
      return true;
    }
    if (f.pressed.confirm) {
      const b = bs[Math.min(this.index, bs.length - 1)];
      if (b && document.activeElement?.tagName !== 'INPUT') {
        b.click();
        return true;
      }
    }
    return false;
  }
}

export function fmtTime(frames: number, hz: number): string {
  const s = Math.floor(frames / hz);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
