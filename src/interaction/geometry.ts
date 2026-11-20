import type { Landmark, Point, Rect } from '../types.ts';

function finitePoint(point: Point | null | undefined): point is Point {
  return point !== null && point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function validLandmark(value: Landmark | undefined): boolean {
  return finitePoint(value) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1 && Number.isFinite(value.visibility) && value.visibility >= 0.5;
}

function multiplyRatio(value: number, numerator: number, denominator: number): number {
  const ratio = numerator / denominator;
  const result = value * ratio;
  return ratio > 0 && Number.isFinite(result) ? result : Math.exp(Math.log(value) + Math.log(numerator) - Math.log(denominator));
}

export function fitRect(sw: number, sh: number, vw: number, vh: number): Rect {
  if (![sw, sh, vw, vh].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Video and viewport dimensions must be finite and positive');
  }
  const widthLimited = Math.log(sw) - Math.log(sh) >= Math.log(vw) - Math.log(vh);
  const width = widthLimited ? vw : Math.min(vw, multiplyRatio(vh, sw, sh));
  const height = widthLimited ? Math.min(vh, multiplyRatio(vw, sh, sw)) : vh;
  return { x: (vw - width) / 2, y: (vh - height) / 2, width, height };
}

export function toStage(point: Point, rect: Rect, mirror = true): Point {
  if (!finitePoint(point) || !finitePoint(rect) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < 0 || rect.height < 0) {
    throw new RangeError('Projection requires finite coordinates and nonnegative dimensions');
  }
  const result = { x: rect.x + (mirror ? 1 - point.x : point.x) * rect.width, y: rect.y + point.y * rect.height };
  if (!finitePoint(result)) {
    throw new RangeError('Projected coordinates must remain finite');
  }
  return result;
}

export function intersectsSweep(previous: Point | null, current: Point, target: Point & { radius: number }): boolean {
  if (!finitePoint(current) || !finitePoint(target) || (previous !== null && !finitePoint(previous)) || !Number.isFinite(target.radius) || target.radius < 0) {
    return false;
  }
  const start = previous ?? current;
  const magnitude = Math.max(Math.abs(start.x), Math.abs(start.y), Math.abs(current.x), Math.abs(current.y), Math.abs(target.x), Math.abs(target.y), target.radius);
  const scale = magnitude > 1e150 ? magnitude : 1;
  const sx = start.x / scale;
  const sy = start.y / scale;
  const dx = current.x / scale - sx;
  const dy = current.y / scale - sy;
  const tx = target.x / scale - sx;
  const ty = target.y / scale - sy;
  const length = Math.hypot(dx, dy);
  const projection = length === 0 ? 0 : Math.max(0, Math.min(length, tx * (dx / length) + ty * (dy / length)));
  const closestX = length === 0 ? 0 : projection * (dx / length);
  const closestY = length === 0 ? 0 : projection * (dy / length);
  return Math.hypot(tx - closestX, ty - closestY) <= target.radius / scale;
}
