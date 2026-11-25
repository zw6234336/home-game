import type { HandObservation, TrackedPlayer } from '../types.ts';
import { validLandmark } from './geometry.ts';

export function participantHands(hands: readonly HandObservation[], players: TrackedPlayer[], exclusive: boolean): HandObservation[] {
  if (!exclusive || !players.length) return [];
  const wrists = players.flatMap(player => player.wrists.flatMap(wrist => wrist ? [{ wrist, radius: Math.min(0.08, Math.max(0.025, player.shoulderWidth * 0.45)) }] : []));
  return hands.filter(hand => {
    const root = hand.landmarks[0];
    if (!validLandmark(root)) return false;
    const matches = wrists.filter(item => Math.hypot(item.wrist.x - root.x, item.wrist.y - root.y) <= item.radius);
    return matches.length === 1 && hands.filter(other => validLandmark(other.landmarks[0]) && Math.hypot(other.landmarks[0].x - matches[0].wrist.x, other.landmarks[0].y - matches[0].wrist.y) <= matches[0].radius).length === 1;
  });
}
