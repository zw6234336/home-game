import type { Point, TrackedPlayer } from '../types.ts';
import { validLandmark } from './geometry.ts';

export type BodyMenuAction = 'previous' | 'next' | 'confirm' | 'back';
export type BodyMenuInput = { context: string; players: TrackedPlayer[]; capturedAt: number; now: number; aspect: number };
export type BodyMenuResult = { gesture: BodyMenuAction | null; progress: number; activated: BodyMenuAction | null; armed: boolean; consumed: boolean };
const durations: Record<BodyMenuAction, number> = { previous: 550, next: 550, confirm: 850, back: 1200 };

function bodyPoints(player: TrackedPlayer, aspect: number): [Point, Point, Point, Point] | null {
  if (![11, 12].every(index => validLandmark(player.landmarks[index])) || !Number.isFinite(player.shoulderWidth) || player.shoulderWidth < .025 || !Number.isFinite(aspect) || aspect <= 0) return null;
  const left = player.landmarks[11];
  const right = player.landmarks[12];
  const centerX = (left.x + right.x) / 2;
  const shoulderY = (left.y + right.y) / 2;
  const normalize = (point: Point | null): Point | null => point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 ? { x: (point.x - centerX) / player.shoulderWidth, y: (point.y - shoulderY) / (player.shoulderWidth * aspect) } : null;
  const a = normalize(player.wrists[0]);
  const b = normalize(player.wrists[1]);
  const l = normalize(left);
  const r = normalize(right);
  return a && b && l && r ? [a, b, l, r] : null;
}

export function bodyMenuPose(player: TrackedPlayer, aspect: number): BodyMenuAction | null {
  const points = bodyPoints(player, aspect);
  if (!points) return null;
  const [a, b, left, right] = points;
  const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  if (Math.abs(a.x - b.x) > .45 && distance(a, right) < .5 && distance(b, left) < .5) return 'back';
  const centerY = (a.y + b.y) / 2;
  if (distance(a, b) < .35 && Math.abs((a.x + b.x) / 2) < .45 && centerY >= .18 && centerY <= 1.15) return 'confirm';
  const lateral = (hand: Point, other: Point) => Math.abs(hand.x) >= 1.15 && hand.y > -.35 && hand.y < .45 && other.y > .65;
  const hand = lateral(a, b) ? a : lateral(b, a) ? b : null;
  return hand ? hand.x > 0 ? 'previous' : 'next' : null;
}

export class BodyMenuController {
  private context = '';
  private lastAt: number | null = null;
  private owner: number | null = null;
  private gesture: BodyMenuAction | null = null;
  private heldMs = 0;
  private neutralMs = 0;
  private armed = false;

  reset(): void {
    this.context = ''; this.lastAt = null; this.owner = null; this.gesture = null; this.heldMs = 0; this.neutralMs = 0; this.armed = false;
  }

  update(input: BodyMenuInput): BodyMenuResult {
    const { context, players, capturedAt, now, aspect } = input;
    if (context !== this.context) { this.reset(); this.context = context; }
    const result = (activated: BodyMenuAction | null = null): BodyMenuResult => ({ gesture: this.gesture, progress: this.gesture ? Math.min(1, this.heldMs / durations[this.gesture]) : 0, activated, armed: this.armed, consumed: !this.armed || this.gesture !== null });
    if (!Number.isFinite(now) || !Number.isFinite(capturedAt) || now < capturedAt || now - capturedAt > 150 || !Number.isFinite(aspect) || aspect <= 0) { this.reset(); this.context = context; return result(); }
    if (this.lastAt !== null && capturedAt <= this.lastAt) {
      if (capturedAt < this.lastAt) { this.reset(); this.context = context; }
      return result();
    }
    let delta = this.lastAt === null ? 0 : capturedAt - this.lastAt;
    if (delta > 150) { this.reset(); this.context = context; delta = 0; }
    this.lastAt = capturedAt;
    if (!players.some(player => bodyPoints(player, aspect))) { this.reset(); this.context = context; this.lastAt = capturedAt; return result(); }
    const candidates = players.map(player => ({ id: player.id, gesture: bodyMenuPose(player, aspect) })).filter(item => item.gesture !== null);
    if (!this.armed) {
      const neutral = candidates.length === 0 && players.some(player => {
        const points = bodyPoints(player, aspect);
        return points && points[0].y > .65 && points[1].y > .65;
      });
      this.neutralMs = neutral ? this.neutralMs + delta : 0;
      this.gesture = null; this.heldMs = 0; this.owner = null;
      if (this.neutralMs >= 250) this.armed = true;
      return result();
    }
    const candidate = candidates.find(item => item.id === this.owner) ?? candidates.sort((a, b) => a.id - b.id)[0];
    if (!candidate) { this.gesture = null; this.heldMs = 0; this.owner = null; return result(); }
    if (candidate.id !== this.owner || candidate.gesture !== this.gesture) {
      this.owner = candidate.id; this.gesture = candidate.gesture; this.heldMs = 0;
    } else this.heldMs += delta;
    if (this.gesture && this.heldMs >= durations[this.gesture]) {
      const activated = this.gesture;
      this.armed = false; this.neutralMs = 0;
      return result(activated);
    }
    return result();
  }
}
