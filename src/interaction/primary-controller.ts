import type { TrackedPlayer } from '../types.ts';
import { validLandmark } from './geometry.ts';

export class PrimaryController {
  private id: number | null = null;
  private count: 1 | 2 | null = null;
  private locked = false;
  private absent = true;

  get playerId(): number | null { return this.id; }
  get isLocked(): boolean { return this.locked; }
  get missing(): boolean { return this.absent; }

  reset(): void {
    this.id = null; this.count = null; this.locked = false; this.absent = true;
  }

  update(players: TrackedPlayer[], count: 1 | 2, confirmed = false): TrackedPlayer[] {
    if (this.count !== count) { this.reset(); this.count = count; }
    const reliable = players.filter(player => Number.isFinite(player.id) && players.filter(other => other.id === player.id).length === 1 && validLandmark(player.landmarks[11]) && validLandmark(player.landmarks[12]));
    if (!this.locked) {
      this.id = reliable.length === count ? [...reliable].sort((a, b) => (a.landmarks[11].x + a.landmarks[12].x) - (b.landmarks[11].x + b.landmarks[12].x) || a.id - b.id)[0].id : null;
      if (confirmed && this.id !== null) this.locked = true;
    }
    const selected = reliable.filter(player => player.id === this.id);
    this.absent = selected.length !== 1;
    return this.absent ? [] : selected;
  }
}
