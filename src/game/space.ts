import type { TrackedPlayer } from '../types.ts';
import { validLandmark } from '../interaction/geometry.ts';

export type SpaceMode = 'standard' | 'compact';
export type SpacePreference = 'auto' | 'compact';

export function chooseSpaceMode(players: TrackedPlayer[], preference: SpacePreference, aspectRatio = 1): SpaceMode {
  if (preference !== 'auto' || !Number.isFinite(aspectRatio) || aspectRatio <= 0 || !Array.isArray(players) || players.length < 1 || players.length > 2) return 'compact';
  const bodies = [];
  for (const player of players) {
    if (!player || !Array.isArray(player.landmarks) || ![11, 12, 23, 24].every(index => validLandmark(player.landmarks[index])) || !Number.isFinite(player.shoulderWidth) || player.shoulderWidth <= 0) return 'compact';
    const x = (player.landmarks[11].x + player.landmarks[12].x) / 2;
    const y = (player.landmarks[11].y + player.landmarks[12].y) / 2;
    const hipY = (player.landmarks[23].y + player.landmarks[24].y) / 2;
    const width = player.shoulderWidth;
    const vertical = width * aspectRatio;
    if (!Number.isFinite(vertical) || hipY <= y || y - vertical * 1.4 < 0.04 || hipY + vertical * 0.1 > 0.96) return 'compact';
    bodies.push({ x, width });
  }
  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    const other = bodies[1 - index];
    const boundary = other ? (body.x + other.x) / 2 : null;
    const left = boundary !== null && other.x < body.x ? Math.max(0.04, boundary) : 0.04;
    const right = boundary !== null && other.x >= body.x ? Math.min(0.96, boundary) : 0.96;
    if (body.x - body.width * 1.7 < left || body.x + body.width * 1.7 > right) return 'compact';
  }
  return 'standard';
}
