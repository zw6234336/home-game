export class FrameGate {
  private sequence = 0;
  private active: number | null = null;
  private readonly maxAgeMs: number;

  constructor(maxAgeMs = 150) {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) throw new RangeError('帧有效期必须是非负有限数值');
    this.maxAgeMs = maxAgeMs;
  }

  begin(now: number): number | null {
    if (this.active !== null || !Number.isFinite(now)) return null;
    this.active = ++this.sequence;
    return this.active;
  }

  complete(token: number, capturedAt: number, now: number): boolean {
    if (this.active === null || token !== this.active) return false;
    this.active = null;
    const age = now - capturedAt;
    return Number.isFinite(capturedAt) && Number.isFinite(now) && age >= 0 && age <= this.maxAgeMs;
  }

  reset(): void {
    this.active = null;
  }
}
