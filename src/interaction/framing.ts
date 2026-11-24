import type { Point, Rect, TrackedPlayer } from '../types.ts';
import { validLandmark } from './geometry.ts';

type Bounds = { left: number; top: number; right: number; bottom: number };
type Body = { center: Point; width: number };
type Observation = { bodies: Map<number, Body>; bounds: Bounds; padded: Bounds };
type Extent = { time: number; bounds: Bounds };

const panorama = (): Rect => ({ x: 0, y: 0, width: 1, height: 1 });
const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
const center = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

function validPoint(point: Point | null | undefined): point is Point {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function union(first: Bounds, second: Bounds): Bounds {
  return { left: Math.min(first.left, second.left), top: Math.min(first.top, second.top), right: Math.max(first.right, second.right), bottom: Math.max(first.bottom, second.bottom) };
}

function contains(rect: Rect, bounds: Bounds): boolean {
  return rect.x <= bounds.left && rect.y <= bounds.top && rect.x + rect.width >= bounds.right && rect.y + rect.height >= bounds.bottom;
}

function square(bounds: Bounds, requestedSize: number, focus?: Point): Rect {
  const size = clamp(Math.max(requestedSize, bounds.right - bounds.left, bounds.bottom - bounds.top), 0.68, 1);
  const target = focus ?? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
  return {
    x: clamp(target.x - size / 2, Math.max(0, bounds.right - size), Math.min(1 - size, bounds.left)),
    y: clamp(target.y - size / 2, Math.max(0, bounds.bottom - size), Math.min(1 - size, bounds.top)),
    width: size,
    height: size,
  };
}

function observe(players: TrackedPlayer[]): Observation | null {
  if (!Array.isArray(players) || players.length === 0 || players.length > 2) return null;
  const bodies = new Map<number, Body>();
  let bounds: Bounds | null = null;
  let largestWidth = 0;
  for (const player of players) {
    if (!player || !Number.isFinite(player.id) || bodies.has(player.id) || !Array.isArray(player.landmarks) || !validPoint(player.center) || !Number.isFinite(player.shoulderWidth) || player.shoulderWidth <= 0) return null;
    const left = player.landmarks[11];
    const right = player.landmarks[12];
    if (!validLandmark(left) || !validLandmark(right)) return null;
    const width = Math.hypot(right.x - left.x, right.y - left.y);
    if (width < 0.015) return null;
    bodies.set(player.id, { center: { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }, width });
    largestWidth = Math.max(largestWidth, width);
    const points = player.landmarks.filter(point => validLandmark(point));
    for (const wrist of player.wrists ?? []) if (validPoint(wrist)) points.push({ ...wrist, visibility: 1 });
    for (const point of points) {
      const next = { left: point.x, top: point.y, right: point.x, bottom: point.y };
      bounds = bounds ? union(bounds, next) : next;
    }
  }
  if (!bounds) return null;
  const horizontal = Math.max(0.075, largestWidth * 0.6);
  const vertical = Math.max(0.09, largestWidth * 0.7);
  return {
    bodies,
    bounds,
    padded: { left: Math.max(0, bounds.left - horizontal), top: Math.max(0, bounds.top - vertical), right: Math.min(1, bounds.right + horizontal), bottom: Math.min(1, bounds.bottom + vertical) },
  };
}

export class FramingController {
  private view = panorama();
  private focus: Rect | null = null;
  private lastAt: number | null = null;
  private bodies = new Map<number, Body>();
  private extents: Extent[] = [];
  private pendingFocus: { since: number; offset: Point } | null = null;

  update(players: TrackedPlayer[], time: number): Rect {
    const observation = observe(players);
    if (!Number.isFinite(time) || time < 0 || !observation) {
      this.reset();
      return { ...this.view };
    }
    const interrupted = this.lastAt === null || time < this.lastAt || time - this.lastAt > 500;
    const changed = this.bodies.size !== observation.bodies.size || [...observation.bodies].some(([id, body]) => {
      const previous = this.bodies.get(id);
      return !previous || Math.hypot(body.center.x - previous.center.x, body.center.y - previous.center.y) > 0.35 || body.width / previous.width > 1.6 || body.width / previous.width < 0.6;
    });
    if (interrupted || changed) {
      this.reset();
      this.lastAt = time;
      this.bodies = observation.bodies;
      this.extents = [{ time, bounds: observation.padded }];
      this.focus = square(observation.padded, 0.68);
      return { ...this.view };
    }
    const elapsed = time - this.lastAt!;
    this.lastAt = time;
    this.bodies = observation.bodies;
    const latest = this.extents.at(-1);
    if (latest?.time === time) latest.bounds = union(latest.bounds, observation.padded);
    else this.extents.push({ time, bounds: observation.padded });
    this.extents = this.extents.filter(sample => time - sample.time <= 2600).slice(-120);
    const envelope = this.extents.reduce((bounds, sample) => union(bounds, sample.bounds), observation.padded);
    const desired = square(envelope, 0.68);
    const urgent = !contains(this.view, observation.bounds);
    if (!this.focus || urgent) {
      this.focus = desired;
      this.pendingFocus = null;
    } else {
      const currentFocus = center(this.focus);
      const desiredFocus = center(desired);
      const offset = { x: desiredFocus.x - currentFocus.x, y: desiredFocus.y - currentFocus.y };
      const moving = Math.hypot(offset.x, offset.y) > 0.022 || Math.abs(desired.width - this.focus.width) > 0.03;
      if (!moving) this.pendingFocus = null;
      else if (!this.pendingFocus || offset.x * this.pendingFocus.offset.x + offset.y * this.pendingFocus.offset.y < 0) this.pendingFocus = { since: time, offset };
      else if (time - this.pendingFocus.since >= 240) {
        this.focus = desired;
        this.pendingFocus = null;
      }
    }
    if (elapsed === 0 && !urgent) return { ...this.view };
    const target = center(this.focus);
    const current = center(this.view);
    const movement = 1 - Math.exp(-elapsed / 400);
    const zoom = 1 - Math.exp(-elapsed / 850);
    const size = this.focus.width >= this.view.width ? this.focus.width : this.view.width + (this.focus.width - this.view.width) * zoom;
    const nextCenter = urgent ? target : { x: current.x + (target.x - current.x) * movement, y: current.y + (target.y - current.y) * movement };
    this.view = square(observation.bounds, urgent ? Math.max(size, this.view.width) : size, nextCenter);
    return { ...this.view };
  }

  reset(): void {
    this.view = panorama();
    this.focus = null;
    this.lastAt = null;
    this.bodies.clear();
    this.extents = [];
    this.pendingFocus = null;
  }
}
