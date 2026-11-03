import GUI from 'lil-gui';
import { tuning } from '../data/tuning';

/**
 * Debug panel: every number in tuning.ts, generated recursively so new
 * values show up automatically, plus run tools and live readouts.
 */

export interface DebugActions {
  readonly info: Record<string, string | number>;
  newRun(seed: number | null): void;
  regenerateArea(): void;
  skipToArea(i: number): void;
  addCash(n: number): void;
  setSuspicion(v: number): void;
  revealAll(): void;
  giveAllIntel(): void;
  killAllHostiles(): void;
  teleportToExit(): void;
  teleportToHale(): void;
  damageSelf(n: number): void;
  setGodMode(on: boolean): void;
  setCones(on: boolean): void;
  resetSave(): void;
}

type AnyObj = Record<string, unknown>;

function addTunables(gui: GUI, obj: AnyObj, depth = 0): void {
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === 'number') {
      const step = Number.isInteger(v) && Math.abs(v) >= 1 ? 1 : 0.01;
      const max = Math.max(1, Math.abs(v) * 4);
      gui.add(obj, key, v < 0 ? -max : 0, max, step);
    } else if (typeof v === 'boolean') gui.add(obj, key);
    else if (Array.isArray(v)) {
      const f = gui.addFolder(key);
      v.forEach((_, i) => {
        if (typeof v[i] === 'number') f.add(v as unknown as Record<string, number>, String(i), 0, Math.max(1, (v[i] as number) * 4), 1).name(`${key}[${i}]`);
      });
      f.close();
    } else if (v && typeof v === 'object') {
      const f = gui.addFolder(key);
      addTunables(f, v as AnyObj, depth + 1);
      if (depth >= 0) f.close();
    }
  }
}

export class DebugPanel {
  readonly gui: GUI;
  private readouts: GUI;
  visible = false;

  constructor(actions: DebugActions) {
    this.gui = new GUI({ title: 'Debug (` / Back)', width: 340 });
    this.gui.domElement.classList.add('debug-gui');

    this.readouts = this.gui.addFolder('Live');
    for (const k of Object.keys(actions.info)) this.readouts.add(actions.info, k).listen().disable();

    const run = this.gui.addFolder('Run');
    const state = { seed: '', area: 3, cash: 1000, suspicion: 100, godMode: false, cones: true };
    run.add(state, 'seed').name('Seed for new run');
    run.add({ go: () => actions.newRun(state.seed.trim() ? Number(state.seed) >>> 0 : null) }, 'go').name('Start new run (seed)');
    run.add({ go: () => actions.regenerateArea() }, 'go').name('Regenerate current area');
    run.add(state, 'area', 1, 3, 1).name('Skip to area');
    run.add({ go: () => actions.skipToArea(state.area - 1) }, 'go').name('Skip now');

    const cheats = this.gui.addFolder('Cheats');
    cheats.add(state, 'cash', 100, 10000, 100).name('Cash amount');
    cheats.add({ go: () => actions.addCash(state.cash) }, 'go').name('Add cash');
    cheats.add(state, 'suspicion', 0, 100, 1).name('Suspicion value');
    cheats.add({ go: () => actions.setSuspicion(state.suspicion) }, 'go').name('Set suspicion');
    cheats.add({ go: () => actions.revealAll() }, 'go').name('Reveal exit + caches');
    cheats.add({ go: () => actions.giveAllIntel() }, 'go').name('Give all intel');
    cheats.add({ go: () => actions.killAllHostiles() }, 'go').name('Kill all hostiles (not Hale)');
    cheats.add({ go: () => actions.teleportToExit() }, 'go').name('Teleport to exit');
    cheats.add({ go: () => actions.teleportToHale() }, 'go').name('Teleport behind Hale');
    cheats.add({ go: () => actions.damageSelf(50) }, 'go').name('Take 50 damage');
    cheats.add(state, 'godMode').name('God mode').onChange((v: boolean) => actions.setGodMode(v));
    cheats.add(state, 'cones').name('Show vision cones').onChange((v: boolean) => actions.setCones(v));
    cheats.add({ go: () => actions.resetSave() }, 'go').name('Reset save');

    const tune = this.gui.addFolder('Tuning (src/data/tuning.ts)');
    addTunables(tune, tuning as unknown as AnyObj);
    tune.close();
    run.close();
    cheats.close();
    this.setVisible(false);
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.gui.domElement.style.display = on ? '' : 'none';
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }
}
