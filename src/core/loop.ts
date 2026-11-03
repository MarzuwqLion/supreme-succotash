/**
 * Fixed-timestep loop. The simulation always advances in 1/hz steps; the
 * renderer runs once per animation frame with an interpolation alpha.
 */
export interface LoopCallbacks {
  /** Advance the simulation by exactly one fixed step. */
  step(): void;
  /** Draw. `alpha` is how far we are between the last two steps (0..1). */
  render(alpha: number, frameDtSec: number): void;
}

export class FixedLoop {
  private acc = 0;
  private last = 0;
  private running = false;
  private rafId = 0;

  constructor(
    private readonly cb: LoopCallbacks,
    private readonly hz: () => number,
    private readonly maxSteps: () => number,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const dtMs = Math.min(250, now - this.last);
      this.last = now;
      const stepMs = 1000 / this.hz();
      this.acc += dtMs;
      let steps = 0;
      while (this.acc >= stepMs && steps < this.maxSteps()) {
        this.cb.step();
        this.acc -= stepMs;
        steps++;
      }
      if (steps >= this.maxSteps()) this.acc = 0; // drop time instead of spiralling
      this.cb.render(this.acc / stepMs, dtMs / 1000);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
