export type DwellInput = { time: number; target: string | null; eligible: boolean };
export type DwellResult = { progress: number; activated: string | null };

export class DwellController {
  private readonly durationMs: number;
  private target: string | null = null;
  private startedAt: number | null = null;
  private lastAt: number | null = null;
  private activated = false;

  constructor(durationMs = 1000) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError('Dwell duration must be finite and nonnegative');
    }
    this.durationMs = durationMs;
  }

  update({ time, target, eligible }: DwellInput): DwellResult {
    if (!Number.isFinite(time)) {
      this.reset();
      return { progress: 0, activated: null };
    }
    if (this.lastAt !== null && time < this.lastAt) {
      this.reset();
      this.lastAt = time;
      return { progress: 0, activated: null };
    }
    const interrupted = this.lastAt !== null && time - this.lastAt > 200;
    this.lastAt = time;
    if (!eligible || typeof target !== 'string') {
      this.clearTarget();
      return { progress: 0, activated: null };
    }
    if (target !== this.target) {
      this.target = target;
      this.startedAt = time;
      this.activated = false;
    }
    if (interrupted) {
      this.startedAt = time;
      return { progress: 0, activated: null };
    }
    if (this.activated) {
      return { progress: 1, activated: null };
    }
    const elapsed = time - (this.startedAt ?? time);
    const progress = this.durationMs === 0 ? 1 : Math.max(0, Math.min(1, elapsed / this.durationMs));
    if (progress === 1) {
      this.activated = true;
      return { progress, activated: target };
    }
    return { progress, activated: null };
  }

  reset(): void {
    this.clearTarget();
    this.lastAt = null;
  }

  private clearTarget(): void {
    this.target = null;
    this.startedAt = null;
    this.activated = false;
  }
}
