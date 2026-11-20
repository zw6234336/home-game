import type { Landmark, Point } from '../types.ts';
import { validLandmark } from '../interaction/geometry.ts';
import { HoldGesture } from '../interaction/raise.ts';

type HoldPlayer = { id: number; bothRaised: boolean; landmarks?: Landmark[]; wrists?: [Point | null, Point | null] };
type Entry = { hold: HoldGesture; armed: boolean };

function validPoint(point: Point | null | undefined): point is Point {
  return point !== null && point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function trustedRelease(player: HoldPlayer): boolean {
  if (player.bothRaised || !Array.isArray(player.landmarks) || !validLandmark(player.landmarks[11]) || !validLandmark(player.landmarks[12])) return false;
  return Array.isArray(player.wrists) && player.wrists.length >= 2 && validPoint(player.wrists[0]) && validPoint(player.wrists[1]);
}

export class PlayerHold {
  private holds = new Map<number, Entry>();
  private duration: number;
  private requireRelease: boolean;
  private lastTime: number | null = null;
  constructor(duration = 1500, requireRelease = false) {
    this.duration = duration;
    this.requireRelease = requireRelease;
  }
  update(players: HoldPlayer[], time: number) {
    if (!Number.isFinite(time)) {
      this.reset();
      return false;
    }
    if (this.lastTime !== null && time < this.lastTime) {
      this.reset();
      this.lastTime = time;
      return false;
    }
    this.lastTime = time;
    for (const id of this.holds.keys()) if (!players.some(player => player.id === id)) this.holds.delete(id);
    let activated = false;
    for (const player of players) {
      let entry = this.holds.get(player.id);
      if (!entry) {
        entry = { hold: new HoldGesture(this.duration), armed: !this.requireRelease };
        this.holds.set(player.id, entry);
      }
      if (!entry.armed) {
        if (trustedRelease(player)) {
          entry.armed = true;
          entry.hold.update(false, time);
        }
        continue;
      }
      if (entry.hold.update(player.bothRaised, time)) activated = true;
    }
    return activated;
  }
  reset() {
    this.holds.clear();
    this.lastTime = null;
  }
}
