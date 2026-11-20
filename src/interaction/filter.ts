export type OneEuroOptions = { minCutoff?: number; beta?: number; derivativeCutoff?: number };

function alpha(cutoff: number, interval: number): number {
  return 1 / (1 + 1 / (2 * Math.PI * cutoff * interval));
}

function blend(previous: number, current: number, weight: number): number {
  const value = (1 - weight) * previous + weight * current;
  return Number.isFinite(value) ? value : current;
}

export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly derivativeCutoff: number;
  private lastAt: number | null = null;
  private raw = 0;
  private value = 0;
  private derivative = 0;

  constructor({ minCutoff = 2.5, beta = 1.2, derivativeCutoff = 1 }: OneEuroOptions = {}) {
    if (!Number.isFinite(minCutoff) || minCutoff <= 0 || !Number.isFinite(beta) || beta < 0 || !Number.isFinite(derivativeCutoff) || derivativeCutoff <= 0) {
      throw new RangeError('Filter cutoffs must be positive and beta must be nonnegative');
    }
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
  }

  update(value: number, time: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(time)) {
      this.reset();
      throw new RangeError('Filter samples and timestamps must be finite');
    }
    if (this.lastAt !== null && time === this.lastAt) {
      return this.value;
    }
    if (this.lastAt === null || time < this.lastAt || time - this.lastAt > 150) {
      this.raw = value;
      this.value = value;
      this.derivative = 0;
      this.lastAt = time;
      return value;
    }
    const interval = (time - this.lastAt) / 1000;
    const slope = (value - this.raw) / interval;
    const finiteSlope = Number.isFinite(slope) ? slope : Math.sign(value - this.raw) * Number.MAX_VALUE;
    this.derivative = blend(this.derivative, finiteSlope, alpha(this.derivativeCutoff, interval));
    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    this.value = blend(this.value, value, alpha(cutoff, interval));
    this.raw = value;
    this.lastAt = time;
    return this.value;
  }

  reset(): void {
    this.lastAt = null;
    this.raw = 0;
    this.value = 0;
    this.derivative = 0;
  }
}
