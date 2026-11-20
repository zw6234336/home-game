import type { Point, Rect, TrackedPlayer } from '../types.ts';
import { toStage, validLandmark } from './geometry.ts';

export type HeadwearPose = { x: number; y: number; size: number; angle: number };
type Smoothed = HeadwearPose & { seenAt: number };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function midpoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function pairAngle(first: Point, second: Point): number {
  const left = first.x <= second.x ? first : second;
  const right = first.x <= second.x ? second : first;
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  if (dx < 1e-3 && Math.abs(dy) < 1e-3) return 0;
  return clamp(Math.atan2(dy, Math.max(1e-3, dx)), -0.55, 0.55);
}

export function headwearAnchor(player: TrackedPlayer, fit: Rect): HeadwearPose | null {
  if (!player || !Array.isArray(player.landmarks) || player.landmarks.length < 13) return null;
  if (!Number.isFinite(fit.width) || !Number.isFinite(fit.height) || fit.width <= 0 || fit.height <= 0) return null;
  const project = (index: number): Point | null => validLandmark(player.landmarks[index]) ? toStage(player.landmarks[index], fit) : null;
  const nose = project(0);
  const leftEye = project(2);
  const rightEye = project(5);
  const leftEar = project(7);
  const rightEar = project(8);
  const leftShoulder = project(11);
  const rightShoulder = project(12);
  const eyes = leftEye && rightEye ? { center: midpoint(leftEye, rightEye), span: Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y), angle: pairAngle(leftEye, rightEye) } : null;
  const ears = leftEar && rightEar ? { center: midpoint(leftEar, rightEar), span: Math.hypot(leftEar.x - rightEar.x, leftEar.y - rightEar.y), angle: pairAngle(leftEar, rightEar) } : null;
  const shoulders = leftShoulder && rightShoulder ? { center: midpoint(leftShoulder, rightShoulder), span: Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y), angle: pairAngle(leftShoulder, rightShoulder) } : null;
  const shoulderHead = shoulders && shoulders.span > 16 ? shoulders.span * 0.54 : 0;
  const earHead = ears && ears.span > 8 ? ears.span * 1.18 : 0;
  const eyeHead = eyes && eyes.span > 6 ? eyes.span * 2.5 : 0;
  let rawSize = earHead || eyeHead || shoulderHead;
  if (rawSize <= 0) return null;
  if (shoulderHead > 0 && (earHead > 0 || eyeHead > 0)) {
    rawSize = clamp((rawSize + shoulderHead) / 2, shoulderHead * 0.78, shoulderHead * 1.32);
  }
  const size = clamp(rawSize, 42, 240);
  const angle = eyes ? eyes.angle : ears ? ears.angle : shoulders ? clamp(shoulders.angle * 0.5, -0.35, 0.35) : 0;
  const upX = Math.sin(angle);
  const upY = -Math.cos(angle);
  let base: Point | null = null;
  let offset = 0;
  if (eyes) {
    base = eyes.center;
    offset = size * 0.62;
  } else if (ears) {
    base = ears.center;
    offset = size * 0.66;
  } else if (nose) {
    base = nose;
    offset = size * 0.84;
  } else if (shoulders) {
    base = shoulders.center;
    offset = size * 1.38;
  }
  if (!base) return null;
  const x = base.x + upX * offset;
  const y = base.y + upY * offset;
  if (![x, y, size, angle].every(Number.isFinite)) return null;
  return { x, y, size, angle };
}

export function faceAnchor(player: TrackedPlayer, fit: Rect): HeadwearPose | null {
  if (!player || !Array.isArray(player.landmarks) || player.landmarks.length < 13) return null;
  if (!Number.isFinite(fit.width) || !Number.isFinite(fit.height) || fit.width <= 0 || fit.height <= 0) return null;
  const project = (index: number): Point | null => validLandmark(player.landmarks[index]) ? toStage(player.landmarks[index], fit) : null;
  const nose = project(0);
  const leftEye = project(2);
  const rightEye = project(5);
  const leftEar = project(7);
  const rightEar = project(8);
  const leftShoulder = project(11);
  const rightShoulder = project(12);
  const eyes = leftEye && rightEye ? { center: midpoint(leftEye, rightEye), span: Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y), angle: pairAngle(leftEye, rightEye) } : null;
  const ears = leftEar && rightEar ? { center: midpoint(leftEar, rightEar), span: Math.hypot(leftEar.x - rightEar.x, leftEar.y - rightEar.y), angle: pairAngle(leftEar, rightEar) } : null;
  const shoulders = leftShoulder && rightShoulder ? { center: midpoint(leftShoulder, rightShoulder), span: Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y), angle: pairAngle(leftShoulder, rightShoulder) } : null;
  const shoulderHead = shoulders && shoulders.span > 16 ? shoulders.span * 0.54 : 0;
  const earHead = ears && ears.span > 8 ? ears.span * 1.18 : 0;
  const eyeHead = eyes && eyes.span > 6 ? eyes.span * 2.5 : 0;
  let rawSize = earHead || eyeHead || shoulderHead;
  if (rawSize <= 0) return null;
  if (shoulderHead > 0 && (earHead > 0 || eyeHead > 0)) {
    rawSize = clamp((rawSize + shoulderHead) / 2, shoulderHead * 0.78, shoulderHead * 1.32);
  }
  const size = clamp(rawSize, 42, 240);
  const angle = eyes ? eyes.angle : ears ? ears.angle : shoulders ? clamp(shoulders.angle * 0.5, -0.35, 0.35) : 0;
  const upX = Math.sin(angle);
  const upY = -Math.cos(angle);
  let x = 0;
  let y = 0;
  if (nose && eyes) {
    x = (nose.x + eyes.center.x) / 2;
    y = (nose.y + eyes.center.y) / 2 + size * 0.05;
  } else if (nose) {
    x = nose.x;
    y = nose.y;
  } else if (eyes) {
    x = eyes.center.x - upX * size * 0.08;
    y = eyes.center.y - upY * size * 0.08;
  } else if (ears) {
    x = ears.center.x;
    y = ears.center.y + size * 0.04;
  } else if (shoulders) {
    x = shoulders.center.x + upX * size * 0.78;
    y = shoulders.center.y + upY * size * 0.78;
  } else return null;
  if (![x, y, size, angle].every(Number.isFinite)) return null;
  return { x, y, size, angle };
}

export class HeadwearTracker {
  private entries = new Map<number, Smoothed>();

  update(player: TrackedPlayer, fit: Rect, now: number): HeadwearPose | null {
    const raw = headwearAnchor(player, fit);
    if (!raw) {
      this.entries.delete(player.id);
      return null;
    }
    if (!Number.isFinite(now)) {
      this.entries.delete(player.id);
      return raw;
    }
    const previous = this.entries.get(player.id);
    if (!previous || now < previous.seenAt || now - previous.seenAt > 250 || Math.hypot(raw.x - previous.x, raw.y - previous.y) > raw.size * 2.5) {
      const next = { ...raw, seenAt: now };
      this.entries.set(player.id, next);
      return { ...raw };
    }
    const dt = now - previous.seenAt;
    if (dt === 0) return { x: previous.x, y: previous.y, size: previous.size, angle: previous.angle };
    const move = Math.hypot(raw.x - previous.x, raw.y - previous.y);
    const posAlpha = move < 2 ? 0.08 : 1 - Math.exp(-dt / 85);
    const angleAlpha = 1 - Math.exp(-dt / 120);
    const next: Smoothed = {
      x: previous.x + (raw.x - previous.x) * posAlpha,
      y: previous.y + (raw.y - previous.y) * posAlpha,
      size: previous.size + (raw.size - previous.size) * posAlpha,
      angle: previous.angle + (raw.angle - previous.angle) * angleAlpha,
      seenAt: now,
    };
    this.entries.set(player.id, next);
    return { x: next.x, y: next.y, size: next.size, angle: next.angle };
  }

  prune(activeIds: Set<number>): void {
    for (const id of this.entries.keys()) if (!activeIds.has(id)) this.entries.delete(id);
  }

  reset(): void {
    this.entries.clear();
  }
}
