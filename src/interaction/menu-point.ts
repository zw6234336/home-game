import type { Point, TrackedPlayer } from '../types.ts';
import { validLandmark } from './geometry.ts';

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function menuPoint(player: TrackedPlayer, hand: Point, aspectRatio = 1): Point | null {
  if (![11, 12].every(index => validLandmark(player.landmarks[index])) || !Number.isFinite(player.shoulderWidth) || player.shoulderWidth <= 0 || !Number.isFinite(aspectRatio) || aspectRatio <= 0 || !Number.isFinite(hand.x) || !Number.isFinite(hand.y) || hand.x < 0 || hand.x > 1 || hand.y < 0 || hand.y > 1) return null;
  const centerX = (player.landmarks[11].x + player.landmarks[12].x) / 2;
  const shoulderY = (player.landmarks[11].y + player.landmarks[12].y) / 2;
  const width = Math.max(0.04, player.shoulderWidth);
  const left = Math.max(0.02, centerX - width * 0.9);
  const right = Math.min(0.98, centerX + width * 0.9);
  const top = Math.max(0.02, shoulderY - width * aspectRatio * 0.85);
  const bottom = shoulderY - Math.max(0.03, width * 0.15);
  if (right - left < 0.02 || bottom - top < 0.02) return null;
  return { x: 1 - clamp((hand.x - left) / (right - left)), y: clamp((hand.y - top) / (bottom - top)) };
}
