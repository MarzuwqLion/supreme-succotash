import { content } from '../content/dialogue';
import type { IntelId } from '../content/dialogue/types';
import { distXZ, type V3 } from '../core/vec';
import { tuning } from '../data/tuning';
import type { GameView } from '../render/view';
import { AREA_NAMES } from '../sim/gen/layout';
import { selectedItem } from '../sim/player';
import type { SimWorld } from '../sim/world';
import { h } from './dom';

/** In-run HUD: vitals, suspicion, weapon, items, prompts, markers, messages. */

const INTEL_SHORT: Record<IntelId, string> = {
  patrolCodes: 'Patrol codes',
  halesSchedule: "Hale's schedule",
  transportManifest: 'Transport manifest',
};

const WEAPON_NAMES = { pistol: 'Silenced pistol', revolver: 'Heavy revolver', smg: 'Compact SMG' } as const;
const ITEM_NAMES = { medkit: 'Medkit', smoke: 'Smoke', jammer: 'Jammer' } as const;

interface Msg {
  el: HTMLElement;
  until: number;
}

export class Hud {
  readonly root: HTMLElement;
  private health: HTMLElement;
  private healthText: HTMLElement;
  private armor: HTMLElement;
  private armorText: HTMLElement;
  private susp: HTMLElement;
  private suspText: HTMLElement;
  private area: HTMLElement;
  private cash: HTMLElement;
  private weapon: HTMLElement;
  private ammo: HTMLElement;
  private reloadBar: HTMLElement;
  private items: HTMLElement;
  private intel: HTMLElement;
  private prompt: HTMLElement;
  private context: HTMLElement;
  private crosshair: HTMLElement;
  private markers: HTMLElement;
  private log: HTMLElement;
  private subtitle: HTMLElement;
  private vignette: HTMLElement;
  private compass: HTMLElement;
  private cardEl: HTMLElement;
  private cardUntil = 0;
  private coverEl: HTMLElement;
  private messages: Msg[] = [];
  private subtitleUntil = 0;
  private markerPool: HTMLElement[] = [];

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'hud hidden' });
    parent.append(this.root);
    this.health = h('div', { class: 'bar-fill health' });
    this.healthText = h('span', { class: 'bar-text' });
    this.armor = h('div', { class: 'bar-fill armor' });
    this.armorText = h('span', { class: 'bar-text' });
    this.susp = h('div', { class: 'bar-fill susp' });
    this.suspText = h('span', { class: 'bar-text' });
    this.area = h('div', { class: 'area-label' });
    this.cash = h('div', { class: 'cash' });
    this.weapon = h('div', { class: 'weapon-name' });
    this.ammo = h('div', { class: 'ammo' });
    this.reloadBar = h('div', { class: 'reload-fill' });
    this.items = h('div', { class: 'items' });
    this.intel = h('div', { class: 'intel' });
    this.prompt = h('div', { class: 'prompt' });
    this.context = h('div', { class: 'prompt context' });
    this.crosshair = h('div', { class: 'crosshair' });
    this.markers = h('div', { class: 'markers' });
    this.log = h('div', { class: 'log' });
    this.subtitle = h('div', { class: 'subtitle' });
    this.vignette = h('div', { class: 'vignette' });
    this.compass = h('div', { class: 'compass' });
    this.cardEl = h('div', { class: 'hud-card' });
    this.coverEl = h('div', { class: 'cover-state' });
    this.root.append(
      this.vignette,
      this.markers,
      h(
        'div',
        { class: 'vitals' },
        h('div', { class: 'bar' }, this.health, this.healthText),
        h('div', { class: 'bar' }, this.armor, this.armorText),
        this.cash,
        this.intel,
      ),
      h('div', { class: 'top-center' }, this.area, this.compass, h('div', { class: 'bar wide' }, this.susp, this.suspText)),
      h('div', { class: 'weapon-box' }, this.weapon, this.ammo, h('div', { class: 'reload' }, this.reloadBar), this.items),
      h('div', { class: 'prompts' }, this.prompt, this.context),
      this.crosshair,
      this.log,
      this.subtitle,
      this.cardEl,
      this.coverEl,
    );
  }

  /** A document or note shown beside play (nothing pauses). */
  card(kicker: string, title: string, body: string, seconds = 12): void {
    this.cardEl.innerHTML = '';
    this.cardEl.append(h('div', { class: 'kicker' }, kicker), h('b', {}, title), h('p', {}, body));
    this.cardEl.classList.add('on');
    this.cardUntil = performance.now() + seconds * 1000;
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  message(text: string, tone: 'info' | 'warn' | 'good' | 'bad' = 'info', seconds = 4): void {
    const el = h('div', { class: `msg ${tone}` }, text);
    this.log.prepend(el);
    this.messages.push({ el, until: performance.now() + seconds * 1000 });
    while (this.messages.length > 7) this.messages.shift()!.el.remove();
  }

  say(speaker: string, text: string, seconds = 5): void {
    this.subtitle.innerHTML = '';
    this.subtitle.append(h('b', {}, `${speaker}: `), text);
    this.subtitle.classList.add('on');
    this.subtitleUntil = performance.now() + seconds * 1000;
  }

  private marker(i: number): HTMLElement {
    let m = this.markerPool[i];
    if (!m) {
      m = h('div', { class: 'marker' });
      this.markers.append(m);
      this.markerPool[i] = m;
    }
    return m;
  }

  update(w: SimWorld, view: GameView, device: 'pad' | 'kbm', cash: number, areaIndex: number, panelOpen = false): void {
    const p = w.player;
    const now = performance.now();
    this.health.style.width = `${(100 * p.health) / p.maxHealth}%`;
    this.healthText.textContent = `Health ${Math.ceil(p.health)}/${p.maxHealth}`;
    this.armor.style.width = `${p.maxArmor ? (100 * p.armor) / p.maxArmor : 0}%`;
    this.armorText.textContent = `Armor ${Math.ceil(p.armor)}/${p.maxArmor}`;
    const s = w.suspicion.value;
    this.susp.style.width = `${s}%`;
    this.susp.className = `bar-fill susp ${s >= 100 ? 'max' : s >= 60 ? 'high' : s >= 30 ? 'mid' : ''}`;
    this.suspText.textContent = s >= 100 ? 'SUSPICION MAX: every hostile knows where you are' : `Suspicion ${Math.round(s)}`;
    this.area.textContent = `Area ${areaIndex + 1}/3 · ${AREA_NAMES[w.layout.type]}`;
    this.cash.textContent = `Cash ${cash}`;
    const slot = p.weapons[p.slot]!;
    this.weapon.textContent = `${WEAPON_NAMES[slot.id]}${tuning.weapons[slot.id].loud ? ' (loud)' : ''}${p.weapons.length > 1 ? `  [${p.slot + 1}/${p.weapons.length}]` : ''}`;
    this.ammo.textContent = `${slot.mag} / ${slot.reserve}`;
    const reloadTotal = tuning.weapons[slot.id].reload;
    this.reloadBar.style.width = p.reload > 0 ? `${100 * (1 - p.reload / reloadTotal)}%` : '0%';
    const sel = selectedItem(w);
    const counts = [
      `Medkit ×${p.items.medkit}`,
      `Smoke ×${p.items.smoke}`,
      p.hasJammer ? `Jammer ${w.suspicion.jammerAvailable ? 'ready' : 'used'}` : null,
    ].filter(Boolean);
    const useKey = device === 'pad' ? 'D-pad ↑' : '3';
    this.items.textContent = `${useKey}: ${sel ? ITEM_NAMES[sel] : 'none'}  ·  ${counts.join('  ')}`;
    this.intel.textContent = p.intel.size ? `Intel: ${[...p.intel].map((i) => INTEL_SHORT[i]).join(', ')}` : '';

    const key = (pad: string, kb: string) => `[${device === 'pad' ? pad : kb}]`;
    const ctxNames = { takedown: 'Takedown', execution: 'Execution', throw: 'Throw' } as const;
    if (panelOpen) {
      this.prompt.textContent = '';
      this.context.textContent = '';
    } else {
      const coverPrompt = !p.cover && p.coverHint ? `${key('A', 'Space')} Take cover${p.coverHint.low ? ' (low)' : ''}` : '';
      this.prompt.textContent = p.interact ? `${key('RB', 'R')} ${p.interact.label}` : coverPrompt;
      this.context.textContent = p.context.action && p.action.kind === 'none' ? `${key('B', 'F')} ${ctxNames[p.context.action]}` : '';
    }
    this.context.className = `prompt context ${p.context.action ?? ''}`;
    // Shoulder camera keeps a dot on screen; the ring appears when aiming.
    this.crosshair.classList.toggle('on', p.aiming);
    this.crosshair.classList.toggle('dot', p.viewStyle === 'shoulder' && !p.aiming);
    this.coverEl.textContent = p.cover ? (p.cover.low ? (p.crouched ? 'Low cover: hidden · aim to pop up' : 'Low cover: exposed') : p.cover.edge !== 0 ? 'High cover: at the edge · aim to lean out' : 'High cover') : '';
    this.vignette.style.opacity = String(p.hurtFlash > 0 ? 0.6 : p.health < 30 ? 0.35 : 0);

    // World markers.
    let mi = 0;
    const place = (pos: V3, height: number, text: string, cls: string, clampEdge = false) => {
      const pr = view.project(pos, height);
      if (!pr.onScreen && !clampEdge) return;
      const m = this.marker(mi++);
      let x = pr.x;
      let y = pr.y;
      if (clampEdge && !pr.onScreen) {
        if (pr.behind) {
          x = window.innerWidth - x;
          y = window.innerHeight - 40;
        }
        x = Math.max(30, Math.min(window.innerWidth - 30, x));
        y = Math.max(60, Math.min(window.innerHeight - 40, y));
      }
      m.style.display = 'block';
      m.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      m.className = `marker ${cls}`;
      m.textContent = text;
    };
    for (const hst of w.hostiles) {
      if (hst.state === 'dead') continue;
      const d = distXZ(hst.pos, p.pos);
      if (d > 40) continue;
      if (hst.state === 'alert') place(hst.pos, 2.25, '!', 'alert');
      else if (hst.state === 'challenge') place(hst.pos, 2.25, '?', 'challenge');
      else if (hst.state === 'patrol' && hst.detection > 0.02) place(hst.pos, 2.25, hst.detection > 0.6 ? '??' : '?', `detect d${Math.min(4, Math.floor(hst.detection * 5))}`);
      else if (hst.state === 'stoodDown' && d < 10) place(hst.pos, 2.2, 'stood down', 'calm');
      if (hst.combat === 'stagger' || hst.combat === 'knockdown') place(hst.pos, hst.combat === 'knockdown' ? 0.8 : 2.5, hst.combat === 'stagger' ? 'STAGGERED' : 'DOWN', 'stagger');
      if (hst.id === p.lockTarget) place(hst.pos, 1.2, '◎', 'lock');
    }
    if (w.haleMarked) {
      const hale = w.hale;
      if (hale && hale.state !== 'dead') place(hale.pos, 2.7, `HALE ${Math.round(distXZ(hale.pos, p.pos))}m`, 'hale', true);
    }
    for (const n of w.npcs) {
      if (n.state === 'gone') continue;
      if (distXZ(n.pos, p.pos) < 25) place(n.pos, 2.2, n.who === 'lucca' ? 'Lucca' : 'Lucretia', `npc ${n.who}`);
    }
    for (const c of w.caches) {
      if (c.opened) continue;
      const d = distXZ(c.pos, p.pos);
      if (c.revealed) place(c.pos, 1.0, `cache ${Math.round(d)}m`, 'cache', true);
      else if (d < tuning.treasure.cacheRevealRange) place(c.pos, 1.0, 'cache', 'cache');
    }
    if (w.intelPickup && !w.intelPickup.taken && distXZ(w.intelPickup.pos, p.pos) < 14) place(w.intelPickup.pos, 1.3, 'intel', 'intel-m');
    if (w.exit) {
      const d = distXZ(w.exit.pos, p.pos);
      if (w.exit.revealed) place(w.exit.pos, 2.5, `EXIT ${Math.round(d)}m`, 'exit', true);
      else if (d < tuning.gen.exitBeaconRange) place(w.exit.pos, 2.5, 'EXIT', 'exit');
    }
    for (let i = mi; i < this.markerPool.length; i++) this.markerPool[i]!.style.display = 'none';

    // Compass: camera heading plus revealed objectives.
    const yaw = view.cameraYaw;
    const heading = ((-yaw * 180) / Math.PI + 180 + 360) % 360;
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    this.compass.textContent = `${dirs[Math.round(heading / 45) % 8]} ${Math.round(heading)}°`;

    for (const m of this.messages) if (m.until < now) m.el.classList.add('fade');
    this.messages = this.messages.filter((m) => {
      if (m.until + 600 < now) {
        m.el.remove();
        return false;
      }
      return true;
    });
    if (this.subtitleUntil < now) this.subtitle.classList.remove('on');
    if (this.cardUntil < now) this.cardEl.classList.remove('on');
  }

  haleLine(key: keyof typeof content.hale, pick: number): string {
    const lines = content.hale[key];
    return lines[pick % lines.length] ?? '';
  }
}
