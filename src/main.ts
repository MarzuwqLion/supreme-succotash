import { Game } from './game/game';

/** Boot: load physics, then hand control to the game state machine. */
async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = '<div class="screen card"><h1>Infinity Mansion: Napoli</h1><div class="sub">Loading…</div></div>';
  const game = new Game(app);
  await game.start();
  // Exposed for debugging and automated smoke tests.
  (window as unknown as { game: Game }).game = game;
}

boot().catch((err: unknown) => {
  const overlay = document.getElementById('overlay');
  if (overlay) overlay.innerHTML = `<div class="screen card"><h1>Failed to start</h1><div class="sub">${String(err)}</div></div>`;
  throw err;
});
