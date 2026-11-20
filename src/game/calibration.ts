import type { Point, ReachZone, TrackedPlayer } from '../types.ts';
import { validLandmark } from '../interaction/geometry.ts';
import { HoldGesture } from '../interaction/raise.ts';

type Signature = { center: Point; width: number; height: number | null };
type Sample = { hold: HoldGesture; ready: boolean; invalidated: boolean; suspendedAt: number | null; minX: number; maxX: number; minY: number; maxY: number; seen: number; signature: Signature };

function signature(player: TrackedPlayer): Signature | null {
  const landmarks = player.landmarks;
  if (!Array.isArray(landmarks) || !validLandmark(landmarks[11]) || !validLandmark(landmarks[12]) || !Number.isFinite(player.shoulderWidth) || player.shoulderWidth <= 0) return null;
  const center = { x: (landmarks[11].x + landmarks[12].x) / 2, y: (landmarks[11].y + landmarks[12].y) / 2 };
  const measuredHeight = [23, 24].every(index => validLandmark(landmarks[index])) ? Math.abs((landmarks[23].y + landmarks[24].y) / 2 - center.y) : 0;
  return { center, width: player.shoulderWidth, height: measuredHeight > 1e-4 ? measuredHeight : null };
}

function sameReach(sample: Sample, player: TrackedPlayer): boolean {
  const next = signature(player);
  if (!next) return false;
  const base = sample.signature;
  const widthRatio = next.width / base.width;
  if (widthRatio < 0.7 || widthRatio > 1.4) return false;
  if (base.height && next.height && (next.height / base.height < 0.65 || next.height / base.height > 1.5)) return false;
  return Math.abs(next.center.x - base.center.x) <= Math.max(0.12, base.width) && Math.abs(next.center.y - base.center.y) <= 0.16;
}

function separated(players: TrackedPlayer[]) {
  const signatures = players.map(signature).filter((value): value is Signature => value !== null);
  return signatures.every((first, index) => signatures.slice(index + 1).every(second => Math.abs(first.center.x - second.center.x) >= Math.max(0.12, (first.width + second.width) * 0.6)));
}

function usableWrist(point: Point | null): point is Point {
  return point !== null && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function invalidate(sample: Sample): void {
  sample.ready = false;
  sample.invalidated = true;
  sample.hold.reset();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function fitInterval(minimum: number, maximum: number, lower: number, upper: number, anchor: number): [number, number] {
  let start = clamp(minimum, lower, upper);
  let end = clamp(maximum, lower, upper);
  const span = Math.min(0.04, upper - lower);
  if (end - start < span) {
    start = clamp(anchor - span / 2, lower, upper - span);
    end = start + span;
  }
  return [start, end];
}

export class Calibration {
  private samples = new Map<number, Sample>();
  private count: 1 | 2;
  private lastTime: number | null = null;
  private diagnostic = 'idle';
  constructor(count: 1 | 2) { this.count = count; }
  lastDiagnostic() { return this.diagnostic; }
  update(players: TrackedPlayer[], time: number) {
    if (!Number.isFinite(time)) { this.diagnostic = 'clock_invalid'; this.samples.forEach(invalidate); return false; }
    this.lastTime = time;
    for (const [id, sample] of this.samples) if (!players.some(player => player.id === id)) {
      sample.hold.update(false, time);
      if (time - sample.seen > 500) invalidate(sample);
    }
    const room = separated(players);
    if (!room) this.diagnostic = 'not_separated';
    else if (players.length === 0) this.diagnostic = 'no_player';
    let anyHold = false;
    let missingShoulder = false;
    let missingWrist = false;
    for (const player of players) {
      let sample = this.samples.get(player.id);
      const next = signature(player);
      if (!next) {
        missingShoulder = true;
        sample?.hold.update(false, time);
        if (sample && time - sample.seen > 500) invalidate(sample);
        continue;
      }
      if (!sample || sample.invalidated || !sameReach(sample, player) || time < sample.seen || time - sample.seen > 500) {
        sample = { hold: new HoldGesture(2000), ready: false, invalidated: false, suspendedAt: null, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, seen: time, signature: next };
        this.samples.set(player.id, sample);
      }
      sample.seen = time;
      sample.suspendedAt = null;
      sample.signature = { ...next, height: next.height ?? sample.signature.height };
      const wrists = player.wrists.filter(usableWrist);
      if (wrists.length === 0) missingWrist = true;
      if (room && player.raised && wrists.length > 0) anyHold = true;
      if (sample.hold.update(room && player.raised && wrists.length > 0, time)) sample.ready = true;
      for (const wrist of wrists) {
        const x = (wrist.x - next.center.x) / next.width;
        const y = (wrist.y - next.center.y) / next.width;
        sample.minX = Math.min(sample.minX, x); sample.maxX = Math.max(sample.maxX, x);
        sample.minY = Math.min(sample.minY, y); sample.maxY = Math.max(sample.maxY, y);
      }
    }
    const matched = this.matches(players);
    if (matched) this.diagnostic = 'ready';
    else if (room && players.length > 0) this.diagnostic = missingShoulder ? 'no_shoulders' : anyHold ? 'holding' : missingWrist ? 'no_wrist' : 'hand_not_raised';
    return matched;
  }
  adapt(players: TrackedPlayer[], time: number): boolean {
    if (!Number.isFinite(time) || this.lastTime !== null && time < this.lastTime) {
      this.diagnostic = 'clock_invalid';
      this.samples.forEach(invalidate);
      return false;
    }
    if (time === this.lastTime) return this.matches(players);
    this.lastTime = time;
    const present = new Set(players.map(player => player.id));
    const replacement = players.some(player => !this.samples.has(player.id));
    let reason = 'ok';
    for (const [id, sample] of this.samples) {
      if (time - sample.seen > 500) {
        if (sample.ready) reason = 'timeout_500ms';
        invalidate(sample);
      } else if (replacement && !present.has(id)) {
        if (sample.ready) reason = 'id_replaced';
        invalidate(sample);
      }
    }
    if (!separated(players)) {
      this.diagnostic = 'not_separated';
      for (const player of players) {
        const sample = this.samples.get(player.id);
        if (sample) invalidate(sample);
      }
      return false;
    }
    for (const player of players) {
      const sample = this.samples.get(player.id);
      if (!sample?.ready || sample.invalidated) continue;
      if (players.filter(item => item.id === player.id).length !== 1) {
        reason = 'duplicate_id';
        invalidate(sample);
        continue;
      }
      const next = signature(player);
      if (!next) {
        reason = 'no_shoulders';
        continue;
      }
      const previous = sample.signature;
      const elapsed = (sample.suspendedAt ?? time) - sample.seen;
      const ratio = next.width / previous.width;
      const scaleLimit = 1.08 + Math.min(0.12, elapsed * 0.00024);
      const motionLimit = Math.max(0.025, previous.width * 0.25) + Math.min(0.04, elapsed * 0.00008);
      const expectedHeight = previous.height === null ? null : previous.height * ratio;
      const heightRatio = expectedHeight && next.height ? next.height / expectedHeight : 1;
      const displacement = Math.hypot(next.center.x - previous.center.x, next.center.y - previous.center.y);
      if (!sameReach(sample, player) || displacement > 0.18) {
        reason = 'hard_jump';
        invalidate(sample);
        continue;
      }
      if (ratio < 1 / scaleLimit || ratio > scaleLimit || heightRatio < 0.65 || heightRatio > 1.5 || displacement > motionLimit) {
        reason = displacement > motionLimit ? 'soft_motion_jitter' : 'soft_scale_jitter';
        sample.suspendedAt ??= time;
        continue;
      }
      sample.suspendedAt = null;
      sample.signature = { ...next, height: next.height ?? expectedHeight };
      sample.seen = time;
    }
    this.diagnostic = reason;
    return this.matches(players);
  }
  matches(players: TrackedPlayer[]) {
    return players.length === this.count && this.verifiedPlayers(players).length === this.count;
  }
  verifiedPlayers(players: TrackedPlayer[]): TrackedPlayer[] {
    if (!separated(players)) return [];
    return players.filter(player => {
      const sample = this.samples.get(player.id);
      return sample?.ready && sample.suspendedAt === null && sameReach(sample, player) && validLandmark(player.landmarks[11]) && validLandmark(player.landmarks[12]);
    });
  }
  readyCount() { return [...this.samples.values()].filter(sample => sample.ready && sample.suspendedAt === null).length; }
  zones(players: TrackedPlayer[], gentle: boolean, compact = false): ReachZone[] {
    if (!this.matches(players)) throw new Error('需要先完成每位玩家的校准');
    return players.map(player => {
      const sample = this.samples.get(player.id)!;
      if (!Number.isFinite(sample.minX)) throw new Error('需要先记录有效的伸手范围');
      const { center, width } = sample.signature;
      const half = Math.max(0.04, width * 0.5);
      let left = 0.04;
      let right = 0.96;
      if (players.length === 2) {
        const other = this.samples.get(players.find(item => item.id !== player.id)!.id)!.signature.center;
        const boundary = (center.x + other.x) / 2;
        if (center.x < other.x) {
          right = Math.min(right, boundary - 0.02);
          if (right <= left) left = 0;
        } else {
          left = Math.max(left, boundary + 0.02);
          if (left >= right) right = 1;
        }
      }
      const [minX, maxX] = fitInterval(Math.min(center.x + sample.minX * width, center.x - half), Math.max(center.x + sample.maxX * width, center.x + half), left, right, center.x);
      const [minY, maxY] = fitInterval(Math.min(center.y + sample.minY * width, center.y), Math.max(center.y + sample.maxY * width, center.y + half), 0.06, 0.9, center.y);
      const lower = gentle ? minY + (maxY - minY) * 0.28 : minY;
      const zone = { playerId: player.id, x: minX, y: lower, width: maxX - minX, height: maxY - lower };
      if (!compact) return zone;
      const compactWidth = Math.min(zone.width, Math.max(0.02, width * 1.2));
      const compactHeight = Math.min(zone.height, Math.max(0.02, width * 0.8));
      return { playerId: player.id, x: clamp(center.x - compactWidth / 2, zone.x, zone.x + zone.width - compactWidth), y: clamp(center.y - compactHeight * 0.45, zone.y, zone.y + zone.height - compactHeight), width: compactWidth, height: compactHeight };
    });
  }
}
