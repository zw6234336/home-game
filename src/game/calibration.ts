import type { Point, ReachZone, TrackedPlayer } from '../types.ts';
import { validLandmark } from '../interaction/geometry.ts';
import { HoldGesture } from '../interaction/raise.ts';

type Signature = { center: Point; width: number; height: number | null };
type Sample = { hold: HoldGesture; ready: boolean; minX: number; maxX: number; minY: number; maxY: number; seen: number; signature: Signature };

function signature(player: TrackedPlayer): Signature {
  const landmarks = player.landmarks;
  const height = [11, 12, 23, 24].every(index => validLandmark(landmarks[index])) ? Math.abs((landmarks[23].y + landmarks[24].y - landmarks[11].y - landmarks[12].y) / 2) : null;
  return { center: { ...player.center }, width: player.shoulderWidth, height };
}

function sameReach(sample: Sample, player: TrackedPlayer): boolean {
  const next = signature(player);
  const base = sample.signature;
  const widthRatio = next.width / base.width;
  if (widthRatio < 0.7 || widthRatio > 1.4) return false;
  if (base.height && next.height && (next.height / base.height < 0.65 || next.height / base.height > 1.5)) return false;
  return Math.abs(next.center.x - base.center.x) <= Math.max(0.12, base.width) && Math.abs(next.center.y - base.center.y) <= 0.16;
}

function separated(players: TrackedPlayer[]) {
  return players.length < 2 || Math.abs(players[0].center.x - players[1].center.x) >= Math.max(0.12, (players[0].shoulderWidth + players[1].shoulderWidth) * 0.6);
}

export class Calibration {
  private samples = new Map<number, Sample>();
  private count: 1 | 2;
  constructor(count: 1 | 2) { this.count = count; }
  update(players: TrackedPlayer[], time: number) {
    if (!Number.isFinite(time)) { this.samples.clear(); return false; }
    for (const [id, sample] of this.samples) if (!players.some(player => player.id === id) && time - sample.seen > 500) this.samples.delete(id);
    const room = separated(players);
    for (const player of players) {
      let sample = this.samples.get(player.id);
      if (!sample || !sameReach(sample, player) || time < sample.seen) {
        sample = { hold: new HoldGesture(2000), ready: false, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, seen: time, signature: signature(player) };
        this.samples.set(player.id, sample);
      }
      sample.seen = time;
      if (sample.hold.update(room && player.raised && validLandmark(player.landmarks[11]) && validLandmark(player.landmarks[12]), time)) sample.ready = true;
      for (const wrist of player.wrists) if (wrist) {
        sample.minX = Math.min(sample.minX, wrist.x); sample.maxX = Math.max(sample.maxX, wrist.x);
        sample.minY = Math.min(sample.minY, wrist.y); sample.maxY = Math.max(sample.maxY, wrist.y);
      }
    }
    return this.matches(players);
  }
  matches(players: TrackedPlayer[]) {
    return players.length === this.count && this.verifiedPlayers(players).length === this.count;
  }
  verifiedPlayers(players: TrackedPlayer[]): TrackedPlayer[] {
    if (!separated(players)) return [];
    return players.filter(player => {
      const sample = this.samples.get(player.id);
      return sample?.ready && sameReach(sample, player) && validLandmark(player.landmarks[11]) && validLandmark(player.landmarks[12]);
    });
  }
  readyCount() { return [...this.samples.values()].filter(sample => sample.ready).length; }
  zones(players: TrackedPlayer[], gentle: boolean): ReachZone[] {
    if (!this.matches(players)) throw new Error('需要先完成每位玩家的校准');
    return players.map(player => {
      const sample = this.samples.get(player.id)!;
      if (!Number.isFinite(sample.minX)) throw new Error('需要先记录有效的伸手范围');
      const shoulderY = (player.landmarks[11].y + player.landmarks[12].y) / 2;
      const half = Math.max(0.04, player.shoulderWidth * 0.5);
      let minX = Math.max(0.04, Math.min(sample.minX, player.center.x - half));
      let maxX = Math.min(0.96, Math.max(sample.maxX, player.center.x + half));
      if (players.length === 2) {
        const other = players.find(item => item.id !== player.id)!;
        const boundary = (player.center.x + other.center.x) / 2;
        if (player.center.x < other.center.x) maxX = Math.min(maxX, boundary - 0.02);
        else minX = Math.max(minX, boundary + 0.02);
      }
      const minY = Math.max(0.06, Math.min(sample.minY, shoulderY));
      const maxY = Math.min(0.9, Math.max(sample.maxY, shoulderY + half));
      const lower = gentle ? minY + (maxY - minY) * 0.28 : minY;
      return { playerId: player.id, x: minX, y: lower, width: Math.max(0.04, maxX - minX), height: Math.max(0.04, maxY - lower) };
    });
  }
}
