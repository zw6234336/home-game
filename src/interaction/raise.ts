import { DwellController } from './dwell.ts';

export class HoldGesture {
  private readonly dwell: DwellController;

  constructor(durationMs = 1500) {
    this.dwell = new DwellController(durationMs);
  }

  update(active: boolean, time: number): boolean {
    return this.dwell.update({ time, target: active ? 'hold' : null, eligible: active }).activated !== null;
  }

  reset(): void {
    this.dwell.reset();
  }
}
