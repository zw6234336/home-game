import { HoldGesture } from '../interaction/raise.ts';

export class PlayerHold {
  private holds = new Map<number, HoldGesture>();
  private duration: number;
  constructor(duration = 1500) { this.duration = duration; }
  update(players: { id: number; bothRaised: boolean }[], time: number) {
    for (const id of this.holds.keys()) if (!players.some(player => player.id === id)) this.holds.delete(id);
    let activated = false;
    for (const player of players) {
      let hold = this.holds.get(player.id);
      if (!hold) { hold = new HoldGesture(this.duration); this.holds.set(player.id, hold); }
      if (hold.update(player.bothRaised, time)) activated = true;
    }
    return activated;
  }
  reset() { this.holds.clear(); }
}
