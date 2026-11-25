import type { TrackedPlayer } from '../types.ts';
import type { MotionRequirements } from '../interaction/motion-continuity.ts';
import { validLandmark } from '../interaction/geometry.ts';

export function gameMotionRequirements(game: string, gentle: boolean, gateKind: string | null = null): MotionRequirements {
  if (game === 'poses') return { joints: [11, 12, 13, 14], hands: 2 };
  if (game === 'bridge') return { joints: [11, 12], hands: 2 };
  if (game === 'gates') return { joints: [11, 12], hands: gateKind === 'reach' ? gentle ? 1 : 2 : 0 };
  return { joints: [11, 12], hands: 1 };
}

export function supportsRequiredMotion(players: TrackedPlayer[], requirements: MotionRequirements): boolean {
  return players.length > 0 && players.every(player => requirements.joints.every(index => validLandmark(player.landmarks[index])) && player.wrists.filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1).length >= requirements.hands);
}

export function supportsGateJudgement(players: TrackedPlayer[], gentle: boolean, gateKind: string | null): boolean {
  if (!supportsRequiredMotion(players, gameMotionRequirements('gates', gentle, gateKind))) return false;
  return gateKind !== 'reach' || !gentle || players.every(player => player.raised || player.wrists.every(Boolean));
}
