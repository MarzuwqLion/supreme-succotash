import { content } from '../content/dialogue';
import type { IntelId } from '../content/dialogue/types';
import { tuning } from '../data/tuning';
import type { ConversationController } from '../game/conversationController';
import { canBuy, isLocked, priceOf, SHOP_ITEMS, validateLoadout, type ShopItemId } from '../meta/economy';
import type { Loadout, OwnedGearId, RunRecord, SaveData } from '../meta/save';
import { h, fmtTime } from './dom';

/** Full-screen overlays. Each returns its root element; callbacks drive the game. */

export const CONTROLS: [string, string, string][] = [
  ['Move', 'Left stick', 'WASD'],
  ['Camera', 'Right stick', 'Mouse (click to lock)'],
  ['Light string', 'X', 'E'],
  ['Heavy', 'Y', 'Q'],
  ['Point-blank shot (during a strike)', 'RT', 'Left mouse'],
  ['Parry (tap) / Block (hold)', 'LB', 'Ctrl or C'],
  ['Roll / take cover (next to cover)', 'A', 'Space'],
  ['Takedown / Execution / Throw', 'B', 'F'],
  ['Aim / Fire', 'LT / RT', 'Right / Left mouse'],
  ['Sprint', 'L3', 'Shift'],
  ['Lock-on (classic) / swap shoulder (shoulder cam)', 'R3', 'Middle mouse'],
  ['Toggle over-the-shoulder camera', 'D-pad →', 'V'],
  ['Interact (talk, loot, exit)', 'RB', 'R'],
  ['Swap weapon', 'D-pad ←', '1, 2'],
  ['Answer in conversation', 'D-pad + A', '1-4'],
  ['Walk away from a conversation', 'Move', 'Move'],
  ['Use item (hold to cycle)', 'D-pad ↑', '3'],
  ['Reload', 'D-pad ↓', 'T'],
  ['Pause', 'Start', 'Esc'],
  ['Debug panel', 'Back', '` (backtick)'],
];

export function controlsTable(): HTMLElement {
  return h(
    'table',
    { class: 'controls' },
    h('tr', {}, h('th', {}, 'Action'), h('th', {}, 'Gamepad'), h('th', {}, 'Keyboard / mouse')),
    ...CONTROLS.map(([a, p, k]) => h('tr', {}, h('td', {}, a), h('td', {}, p), h('td', {}, k))),
  );
}

const GEAR_NAMES: Record<OwnedGearId, string> = { revolver: 'Heavy revolver', smg: 'Compact SMG', plateCarrier: 'Plate carrier', jammer: 'Signal jammer' };
const RESULT_TEXT: Record<string, string> = { none: '', success: 'went well', failure: 'went badly', rebuff: 'ended with them not yet won over', bribed: 'ended with a bribe' };

export interface FobCallbacks {
  buy(id: ShopItemId): void;
  setLoadout(l: Loadout): void;
  deploy(seed: number | null): void;
  resetSave(): void;
}

export function fobScreen(save: SaveData, loadout: Loadout, notice: string | null, cb: FobCallbacks): HTMLElement {
  const errors = validateLoadout(save, loadout);
  const gearBtn = (slot: 'weapon' | 'armor' | 'gadget', id: OwnedGearId | null, label: string) => {
    const owned = id === null || save.owned[id];
    const locked = id !== null && isLocked(save, id);
    const selected = loadout[slot] === id;
    return h(
      'button',
      {
        class: `chip ${selected ? 'selected' : ''} ${locked ? 'locked' : ''}`,
        disabled: !owned || locked,
        title: locked ? 'Locked for this run (carried on an extraction)' : !owned ? 'Not owned' : '',
        onclick: () => cb.setLoadout({ ...loadout, [slot]: id }),
      },
      label,
      locked ? ' 🔒' : !owned ? ' (not owned)' : '',
    );
  };
  const runItemRow = (id: 'smoke' | 'medkit', name: string) => {
    const n = loadout.runItems.filter((r) => r === id).length;
    const total = loadout.runItems.length;
    return h(
      'div',
      { class: 'row' },
      h('span', {}, `${name}: ${n} packed (stash ${save.stash[id]})`),
      h('button', { class: 'chip', disabled: n === 0, onclick: () => {
        const idx = loadout.runItems.lastIndexOf(id);
        const runItems = [...loadout.runItems];
        runItems.splice(idx, 1);
        cb.setLoadout({ ...loadout, runItems });
      } }, '−'),
      h('button', { class: 'chip', disabled: total >= tuning.shop.maxRunItems || n >= save.stash[id], onclick: () => cb.setLoadout({ ...loadout, runItems: [...loadout.runItems, id] }) }, '+'),
    );
  };
  const seedInput = h('input', { type: 'text', placeholder: 'random', class: 'seed', inputmode: 'numeric' });
  const lucca = save.cast.lucca;
  const lucretia = save.cast.lucretia;
  const last = save.history[save.history.length - 1];
  return h(
    'div',
    { class: 'screen fob' },
    h('h1', {}, 'Forward Operating Base'),
    h('div', { class: 'sub' }, `Napoli, alternate Earth · Cash ${save.cash} · Runs ${save.runsStarted} · Wins ${save.stats.wins} · Extractions ${save.stats.extractions}`),
    notice ? h('div', { class: 'notice' }, notice) : null,
    h(
      'div',
      { class: 'cols' },
      h(
        'section',
        {},
        h('h2', {}, 'Shop'),
        ...SHOP_ITEMS.map((it) => {
          const chk = canBuy(save, it.id);
          const owned = (it.type === 'owned' && save.owned[it.id as OwnedGearId]) || (it.type === 'permanent' && save.upgrades[it.id as 'conditioning' | 'coverIdentity']);
          return h(
            'div',
            { class: 'shop-row' },
            h('div', {}, h('b', {}, it.name), h('span', { class: 'tag' }, it.type === 'owned' ? 'owned gear' : it.type === 'runOnly' ? 'run-only' : 'permanent'), h('div', { class: 'desc' }, it.desc)),
            h('button', { disabled: !chk.ok, onclick: () => cb.buy(it.id) }, owned ? 'Owned' : `${priceOf(it.id)}`),
          );
        }),
      ),
      h(
        'section',
        {},
        h('h2', {}, 'Loadout'),
        h('div', { class: 'desc' }, 'Starter kit (never locks): silenced pistol, ballistic vest.'),
        h('h3', {}, 'Extra weapon'),
        h('div', { class: 'row' }, gearBtn('weapon', null, 'None'), gearBtn('weapon', 'revolver', 'Revolver'), gearBtn('weapon', 'smg', 'SMG')),
        h('h3', {}, 'Armor'),
        h('div', { class: 'row' }, gearBtn('armor', null, 'Vest (50)'), gearBtn('armor', 'plateCarrier', 'Plate carrier (100)')),
        h('h3', {}, 'Gadget'),
        h('div', { class: 'row' }, gearBtn('gadget', null, 'None'), gearBtn('gadget', 'jammer', 'Signal jammer')),
        h('h3', {}, `Run-only items (max ${tuning.shop.maxRunItems})`),
        runItemRow('medkit', 'Medkit'),
        runItemRow('smoke', 'Smoke grenade'),
        h('h3', {}, 'Permanent'),
        h('div', { class: 'desc' }, `Conditioning: ${save.upgrades.conditioning ? 'active (+20 max health)' : 'no'} · Cover identity: ${save.upgrades.coverIdentity ? 'active' : 'no'}`),
        errors.length ? h('div', { class: 'error' }, errors.join(' · ')) : null,
        h('div', { class: 'row deploy' }, h('label', {}, 'Seed ', seedInput), h('button', { class: 'primary', disabled: errors.length > 0, onclick: () => {
          const v = seedInput.value.trim();
          cb.deploy(v ? Number(v) >>> 0 || hashText(v) : null);
        } }, 'Deploy to Napoli')),
      ),
      h(
        'section',
        {},
        h('h2', {}, 'Dossier'),
        h('p', {}, h('b', {}, 'Lucca'), ` (gunsmith): ${memoryLine(lucca)}`),
        h('p', {}, h('b', {}, 'Lucretia'), ` (informant): ${memoryLine(lucretia)}`),
        h('p', {}, h('b', {}, 'Commander Hale'), `: ${save.hale.grudge > 0 ? `holds a grudge (+${save.hale.grudge} escort${save.hale.grudge > 1 ? 's' : ''})` : 'no grudge'} · beaten ${save.hale.defeats} time${save.hale.defeats === 1 ? '' : 's'}.`),
        h('h3', {}, 'Gear status'),
        h('div', { class: 'desc' }, ...(['revolver', 'smg', 'plateCarrier', 'jammer'] as OwnedGearId[]).map((g) => h('div', {}, `${GEAR_NAMES[g]}: ${!save.owned[g] ? 'not owned' : isLocked(save, g) ? 'LOCKED this run' : 'available'}`))),
        last ? h('h3', {}, 'Last run') : null,
        last ? summaryTable(last) : null,
        h('h3', {}, 'Controls'),
        controlsTable(),
        h('div', { class: 'row' }, h('button', { class: 'danger', onclick: () => {
          if (confirm('Reset all progress? Cash, gear, and what the cast remembers will be wiped.')) cb.resetSave();
        } }, 'Reset save')),
      ),
    ),
  );
}

function memoryLine(m: SaveData['cast']['lucca']): string {
  if (m.meetings === 0) return 'not met yet.';
  return `met ${m.meetings} time${m.meetings === 1 ? '' : 's'}; the last meeting ${RESULT_TEXT[m.lastResult]}.`;
}

function hashText(s: string): number {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (Math.imul(x, 31) + s.charCodeAt(i)) >>> 0;
  return x;
}

export function summaryTable(r: RunRecord): HTMLElement {
  const rows: [string, string][] = [
    ['Outcome', r.outcome === 'win' ? 'Hale taken down' : r.interrupted ? 'Extracted (run interrupted)' : 'Extracted'],
    ['Time', fmtTime(Math.round(r.timeSec * 60), 60)],
    ['Kills', String(r.kills)],
    ['Takedowns', String(r.takedowns)],
    ['Conversations won / lost', `${r.conversationsWon} / ${r.conversationsLost}`],
    ['Peak suspicion', String(Math.round(r.peakSuspicion))],
    ['Cash earned', String(r.cashEarned)],
    ['Reached', `Area ${r.areaReached + 1}`],
    ['Seed', String(r.seed)],
  ];
  return h('table', { class: 'summary' }, ...rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v))));
}

export function endScreen(r: RunRecord, lockedNow: OwnedGearId[], haleQuote: string | null, onContinue: () => void): HTMLElement {
  const win = r.outcome === 'win';
  return h(
    'div',
    { class: `screen end ${win ? 'win' : 'extract'}` },
    h('h1', {}, win ? 'Commander Hale is down' : 'Extracted'),
    h('div', { class: 'sub' }, win ? 'The occupation in Napoli just lost its head. The FOB wants you back for debrief.' : 'Your health hit zero. The FOB pulled you out before you died. You keep every bit of cash you found.'),
    haleQuote ? h('blockquote', {}, `Hale: “${haleQuote}”`) : null,
    h('h2', {}, 'Run summary'),
    summaryTable(r),
    !win && lockedNow.length
      ? h('div', { class: 'notice' }, `Locked for your next run: ${lockedNow.map((g) => GEAR_NAMES[g]).join(', ')}. It comes back after that.`)
      : !win
        ? h('div', { class: 'notice' }, 'You only carried the starter kit, so nothing is locked.')
        : h('div', { class: 'notice' }, 'A win locks nothing.'),
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: onContinue }, 'Return to FOB')),
  );
}

export function conversationScreen(c: ConversationController, cash: number, device: 'pad' | 'kbm', onChoose: (id: string) => void, onDone: () => void): HTMLElement {
  const hint = device === 'pad' ? 'D-pad + A to answer · move or attack to walk away' : '1-4 to answer · move or attack to walk away';
  const log = h('div', { class: 'conv-log' }, ...c.log.map((l) => h('div', { class: `line ${l.who}` }, l.who === 'agent' ? `You: ${l.text}` : l.who === 'them' ? `${c.speakerName}: ${l.text}` : l.text)));
  const replies = h('div', { class: 'replies' });
  if (!c.done) {
    c.visibleReplies(cash).forEach(({ reply, avail }, i) => {
      const tag = reply.tier === 'intel' ? ' [intel]' : reply.tier === 'bribe' ? ` [bribe: ${reply.cost}]` : '';
      replies.append(
        h('button', { class: `reply ${reply.tier === 'intel' ? 'intel' : ''} ${reply.tier === 'bribe' ? 'bribe' : ''}`, disabled: !avail.enabled || c.busy, onclick: () => onChoose(reply.id), title: avail.reason ?? '' }, `${device === 'kbm' ? `${i + 1}. ` : ''}${reply.text}${tag}${avail.reason ? ` (${avail.reason})` : ''}`),
      );
    });
  } else {
    const who = c.ctx.speaker;
    const label =
      c.outcome === 'failure'
        ? who === 'lucca' || who === 'lucretia'
          ? `${c.speakerName} has heard enough. Word gets around (+suspicion).`
          : 'It went badly. They raise the alarm.'
        : c.outcome === 'rebuff'
          ? `${c.speakerName} isn't won over yet, but will remember this.`
          : who === 'lucca'
            ? 'Lucca will trade with you.'
            : who === 'lucretia'
              ? c.outcome === 'bribed'
                ? 'Lucretia takes the money and helps, this once.'
                : 'Lucretia will help.'
              : 'They stand down.';
    replies.append(h('div', { class: `result ${c.outcome}` }, label), h('button', { class: 'primary', onclick: onDone }, device === 'pad' ? 'Continue (A)' : 'Continue (1)'));
  }
  const exch = c.exchange ? `Exchange ${c.exchange.index + 1} of ${c.state.totalExchanges}` : 'Conversation over';
  const root = h('div', { class: 'screen conv live' }, h('div', { class: 'conv-panel' }, h('div', { class: 'conv-head' }, h('b', {}, c.speakerName), h('span', {}, exch)), log, replies, h('div', { class: 'conv-hint' }, hint)));
  queueMicrotask(() => (log.scrollTop = log.scrollHeight));
  return root;
}

export interface ShopEntry {
  id: 'ammo' | 'medkit' | 'smoke';
  name: string;
  price: number;
}

export function luccaShopScreen(entries: ShopEntry[], cash: number, discount: boolean, device: 'pad' | 'kbm', onBuy: (id: ShopEntry['id']) => void, onClose: () => void): HTMLElement {
  return h(
    'div',
    { class: 'screen shop live' },
    h('div', { class: 'conv-panel' },
      h('div', { class: 'conv-head' }, h('b', {}, "Lucca's stock"), h('span', {}, `Cash ${cash}${discount ? ' · friend discount' : ''}`)),
      ...entries.map((e, i) => h('div', { class: 'shop-row' }, h('span', {}, `${device === 'kbm' ? `${i + 1}. ` : ''}${e.name}`), h('button', { disabled: cash < e.price, onclick: () => onBuy(e.id) }, `${e.price}`))),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: onClose }, device === 'pad' ? 'Done (RB)' : 'Done (R)')),
      h('div', { class: 'conv-hint' }, device === 'pad' ? 'D-pad + A to buy · move to walk away' : '1-3 to buy · move to walk away'),
    ),
  );
}

export function intelScreen(id: IntelId, onClose: () => void): HTMLElement {
  const doc = content.intel.find((d) => d.id === id)!;
  return h('div', { class: 'screen modal' }, h('div', { class: 'conv-panel doc' }, h('div', { class: 'conv-head' }, h('b', {}, 'Intel acquired'), h('span', {}, doc.title)), h('p', {}, doc.body), h('button', { class: 'primary', onclick: onClose }, 'Continue')));
}

export function pauseScreen(onResume: () => void): HTMLElement {
  return h('div', { class: 'screen modal' }, h('div', { class: 'conv-panel' }, h('h2', {}, 'Paused'), h('p', { class: 'desc' }, 'You cannot call for extraction yourself. Reloading the page mid-run counts as an extraction.'), controlsTable(), h('button', { class: 'primary', onclick: onResume }, 'Resume')));
}

export function cardScreen(title: string, sub: string): HTMLElement {
  return h('div', { class: 'screen card' }, h('h1', {}, title), h('div', { class: 'sub' }, sub));
}
