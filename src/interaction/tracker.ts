import type { Landmark, Point, PoseObservation, TrackedPlayer } from '../types.ts';
import { OneEuroFilter } from './filter.ts';
import { validLandmark } from './geometry.ts';

type Candidate = { center: Point; shoulderWidth: number; bodyWidth: number | null; torsoHeight: number | null; confidence: number; landmarks: Landmark[] };
type WristState = { x: OneEuroFilter; y: OneEuroFilter; raw: Point | null; lastAt: number | null };
type Track = { id: number; center: Point; velocity: Point; shoulderWidth: number; bodyWidth: number | null; torsoHeight: number | null; lastSeen: number; observations: number; wrists: [WristState, WristState] };

const torsoIndices = [11, 12, 23, 24];
const wristIndices = [15, 16] as const;
const shoulderIndices = [11, 12] as const;

function distance(first: Point, second: Point): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function midpoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function copyLandmark(value: Landmark | undefined): Landmark {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1 || !Number.isFinite(value.visibility)) {
    return { x: 0, y: 0, visibility: 0 };
  }
  const result: Landmark = { x: value.x, y: value.y, visibility: Math.max(0, Math.min(1, value.visibility)) };
  if (Number.isFinite(value.z)) {
    result.z = value.z;
  }
  return result;
}

function candidateFor(pose: PoseObservation): Candidate | null {
  if (!pose || !Array.isArray(pose.landmarks)) {
    return null;
  }
  const landmarks = Array.from({ length: 33 }, (_, index) => copyLandmark(pose.landmarks[index]));
  const torso = torsoIndices.map((index) => landmarks[index]).filter((landmark) => validLandmark(landmark));
  if (torso.length < 2) {
    return null;
  }
  const shouldersValid = validLandmark(landmarks[11]) && validLandmark(landmarks[12]);
  const hipsValid = validLandmark(landmarks[23]) && validLandmark(landmarks[24]);
  const shoulders = shouldersValid ? midpoint(landmarks[11], landmarks[12]) : null;
  const hips = hipsValid ? midpoint(landmarks[23], landmarks[24]) : null;
  const center = shoulders && hips ? midpoint(shoulders, hips) : shoulders ?? hips ?? {
    x: torso.reduce((sum, point) => sum + point.x, 0) / torso.length,
    y: torso.reduce((sum, point) => sum + point.y, 0) / torso.length,
  };
  const width = shouldersValid ? distance(landmarks[11], landmarks[12]) : hipsValid ? distance(landmarks[23], landmarks[24]) * 1.2 : 0.18;
  return {
    center,
    shoulderWidth: Math.max(0.04, width),
    bodyWidth: shouldersValid && width >= 0.04 ? width : null,
    torsoHeight: shoulders && hips && distance(shoulders, hips) >= 0.04 ? distance(shoulders, hips) : null,
    confidence: torso.length + torso.reduce((sum, point) => sum + point.visibility, 0) / torso.length,
    landmarks,
  };
}

function createWrist(): WristState {
  return { x: new OneEuroFilter(), y: new OneEuroFilter(), raw: null, lastAt: null };
}

function resetWrist(wrist: WristState): void {
  wrist.x.reset();
  wrist.y.reset();
  wrist.raw = null;
  wrist.lastAt = null;
}

function copyPlayer(player: TrackedPlayer): TrackedPlayer {
  return {
    ...player,
    center: { ...player.center },
    landmarks: player.landmarks.map((landmark) => ({ ...landmark })),
    wrists: [player.wrists[0] ? { ...player.wrists[0] } : null, player.wrists[1] ? { ...player.wrists[1] } : null],
  };
}

function matchingCost(track: Track, candidate: Candidate, time: number): number | null {
  const scaleChanged = (previous: number | null, current: number | null): boolean => previous !== null && current !== null && Math.max(previous, current) > Math.min(previous, current) * 1.8;
  if (scaleChanged(track.bodyWidth, candidate.bodyWidth) || scaleChanged(track.torsoHeight, candidate.torsoHeight)) {
    return null;
  }
  const elapsed = (time - track.lastSeen) / 1000;
  const displacement = distance(track.center, candidate.center);
  const limit = Math.min(0.45, Math.max(0.14, Math.max(track.shoulderWidth, candidate.shoulderWidth) * 1.2) + elapsed * 0.8);
  if (displacement > limit) {
    return null;
  }
  const predictionSeconds = Math.min(elapsed, 0.15);
  const predicted = { x: track.center.x + track.velocity.x * predictionSeconds, y: track.center.y + track.velocity.y * predictionSeconds };
  const scalePenalty = Math.abs(Math.log(candidate.shoulderWidth / track.shoulderWidth)) * 0.05;
  const torsoPenalty = candidate.torsoHeight !== null && track.torsoHeight !== null ? Math.abs(candidate.torsoHeight - track.torsoHeight) * 0.15 : 0;
  return distance(predicted, candidate.center) + displacement * 0.05 + scalePenalty + torsoPenalty;
}

function matchAll(tracks: Track[], candidates: Candidate[], time: number): Map<number, number> {
  let bestPairs = new Map<number, number>();
  let bestCost = Number.POSITIVE_INFINITY;
  const search = (index: number, pairs: Map<number, number>, used: Set<number>, cost: number): void => {
    if (index === tracks.length) {
      if (pairs.size > bestPairs.size || (pairs.size === bestPairs.size && cost < bestCost)) {
        bestPairs = new Map(pairs);
        bestCost = cost;
      }
      return;
    }
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      if (used.has(candidateIndex)) {
        continue;
      }
      const nextCost = matchingCost(tracks[index], candidates[candidateIndex], time);
      if (nextCost === null) {
        continue;
      }
      pairs.set(index, candidateIndex);
      used.add(candidateIndex);
      search(index + 1, pairs, used, cost + nextCost);
      pairs.delete(index);
      used.delete(candidateIndex);
    }
    search(index + 1, pairs, used, cost);
  };
  search(0, new Map(), new Set(), 0);
  return bestPairs;
}

export class PlayerTracker {
  private readonly maxPlayers: 1 | 2;
  private tracks: Track[] = [];
  private lastAt: number | null = null;
  private lastPlayers: TrackedPlayer[] = [];
  private nextId = 1;

  constructor(maxPlayers: 1 | 2) {
    if (maxPlayers !== 1 && maxPlayers !== 2) {
      throw new RangeError('Player limit must be one or two');
    }
    this.maxPlayers = maxPlayers;
  }

  update(poses: PoseObservation[], timestamp: number): TrackedPlayer[] {
    if (!Number.isFinite(timestamp)) {
      this.reset();
      return [];
    }
    if (this.lastAt !== null && timestamp < this.lastAt) {
      this.reset();
      this.lastAt = timestamp;
      return [];
    }
    if (timestamp === this.lastAt) {
      return this.lastPlayers.map(copyPlayer);
    }
    this.lastAt = timestamp;
    this.tracks = this.tracks.filter((track) => timestamp - track.lastSeen <= 500);
    const candidates = (Array.isArray(poses) ? poses : []).map(candidateFor).filter((candidate): candidate is Candidate => candidate !== null)
      .sort((first, second) => second.confidence - first.confidence || first.center.x - second.center.x || first.center.y - second.center.y)
      .slice(0, this.maxPlayers)
      .sort((first, second) => first.center.x - second.center.x || first.center.y - second.center.y);
    const matches = matchAll(this.tracks, candidates, timestamp);
    const usedCandidates = new Set(matches.values());
    const activeTracks: Track[] = [];
    const players: TrackedPlayer[] = [];
    for (const [trackIndex, candidateIndex] of matches) {
      const track = this.tracks[trackIndex];
      activeTracks.push(track);
      players.push(this.observe(track, candidates[candidateIndex], timestamp));
    }
    for (let index = 0; index < candidates.length; index += 1) {
      if (usedCandidates.has(index)) {
        continue;
      }
      const candidate = candidates[index];
      const track: Track = {
        id: this.nextId,
        center: candidate.center,
        velocity: { x: 0, y: 0 },
        shoulderWidth: candidate.shoulderWidth,
        bodyWidth: candidate.bodyWidth,
        torsoHeight: candidate.torsoHeight,
        lastSeen: timestamp,
        observations: 0,
        wrists: [createWrist(), createWrist()],
      };
      this.nextId += 1;
      activeTracks.push(track);
      players.push(this.observe(track, candidate, timestamp));
    }
    const missingTracks = this.tracks.filter((track) => !activeTracks.includes(track)).sort((first, second) => second.lastSeen - first.lastSeen);
    for (const track of missingTracks) {
      track.wrists.forEach(resetWrist);
    }
    this.tracks = [...activeTracks, ...missingTracks].slice(0, this.maxPlayers).sort((first, second) => first.id - second.id);
    this.lastPlayers = players.sort((first, second) => first.id - second.id);
    return this.lastPlayers.map(copyPlayer);
  }

  reset(): void {
    this.tracks = [];
    this.lastPlayers = [];
    this.lastAt = null;
  }

  private observe(track: Track, candidate: Candidate, timestamp: number): TrackedPlayer {
    const elapsed = timestamp - track.lastSeen;
    const centerShift = { x: candidate.center.x - track.center.x, y: candidate.center.y - track.center.y };
    const wrists = wristIndices.map((index, side) => {
      const state = track.wrists[side];
      const landmark = candidate.landmarks[index];
      if (!validLandmark(landmark)) {
        resetWrist(state);
        return null;
      }
      if (elapsed > 150 || (state.lastAt !== null && timestamp - state.lastAt > 150)) {
        resetWrist(state);
      }
      if (state.raw && state.lastAt !== null) {
        const motion = Math.hypot(landmark.x - state.raw.x - centerShift.x, landmark.y - state.raw.y - centerShift.y);
        const limit = Math.max(0.25, candidate.shoulderWidth * 1.5) + (timestamp - state.lastAt) / 1000;
        if (motion > limit) {
          resetWrist(state);
          return null;
        }
      }
      const point = { x: state.x.update(landmark.x, timestamp), y: state.y.update(landmark.y, timestamp) };
      state.raw = { x: landmark.x, y: landmark.y };
      state.lastAt = timestamp;
      return point;
    }) as [Point | null, Point | null];
    if (elapsed > 0 && elapsed <= 150) {
      const velocity = { x: Math.max(-3, Math.min(3, centerShift.x * 1000 / elapsed)), y: Math.max(-3, Math.min(3, centerShift.y * 1000 / elapsed)) };
      const speed = Math.hypot(velocity.x, velocity.y);
      const scale = speed > 3 ? 3 / speed : 1;
      const weight = track.observations < 2 ? 1 : 0.65;
      track.velocity = { x: track.velocity.x * (1 - weight) + velocity.x * scale * weight, y: track.velocity.y * (1 - weight) + velocity.y * scale * weight };
    } else {
      track.velocity = { x: 0, y: 0 };
    }
    track.center = candidate.center;
    track.shoulderWidth = candidate.shoulderWidth;
    track.bodyWidth = candidate.bodyWidth ?? track.bodyWidth;
    track.torsoHeight = candidate.torsoHeight ?? track.torsoHeight;
    track.lastSeen = timestamp;
    track.observations += 1;
    const raised = wrists.map((wrist, side) => {
      const shoulder = candidate.landmarks[shoulderIndices[side]];
      return wrist !== null && validLandmark(shoulder) && wrist.y < shoulder.y - Math.max(0.03, candidate.shoulderWidth * 0.15);
    });
    return { id: track.id, center: candidate.center, shoulderWidth: candidate.shoulderWidth, landmarks: candidate.landmarks, wrists, raised: raised[0] || raised[1], bothRaised: raised[0] && raised[1] };
  }
}
