import type { Landmark, Point, PoseObservation, TrackedPlayer } from '../types.ts';
import { OneEuroFilter } from './filter.ts';
import { validLandmark } from './geometry.ts';

type BodyAnchors = { shoulders: Point | null; hips: Point | null };
type Candidate = { center: Point; anchors: BodyAnchors; shoulderWidth: number; bodyWidth: number | null; torsoHeight: number | null; confidence: number; landmarks: Landmark[] };
type JointState = { x: OneEuroFilter; y: OneEuroFilter; raw: Point | null; lastAt: number | null };
type Track = { id: number; center: Point; anchors: BodyAnchors; velocity: Point; shoulderWidth: number; bodyWidth: number | null; torsoHeight: number | null; lastSeen: number; observations: number; armJoints: [JointState, JointState, JointState, JointState]; wrists: [JointState, JointState]; raisedSides: [boolean, boolean] };

const torsoIndices = [11, 12, 23, 24];
const armIndices = [13, 14, 15, 16] as const;
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
    anchors: { shoulders, hips },
    shoulderWidth: Math.max(0.025, width),
    bodyWidth: shouldersValid && width >= 0.025 ? width : null,
    torsoHeight: shoulders && hips && distance(shoulders, hips) >= 0.025 ? distance(shoulders, hips) : null,
    confidence: torso.length + torso.reduce((sum, point) => sum + point.visibility, 0) / torso.length,
    landmarks,
  };
}

function createJoint(minCutoff = 1.6, beta = 1.8): JointState {
  return { x: new OneEuroFilter({ minCutoff, beta }), y: new OneEuroFilter({ minCutoff, beta }), raw: null, lastAt: null };
}

function resetJoint(joint: JointState): void {
  joint.x.reset();
  joint.y.reset();
  joint.raw = null;
  joint.lastAt = null;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothWrist(state: JointState, landmark: Landmark, centerShift: Point, shoulderWidth: number, elapsed: number, timestamp: number): Point | null {
  if (!validLandmark(landmark)) {
    resetJoint(state);
    return null;
  }
  if (elapsed > 150 || (state.lastAt !== null && timestamp - state.lastAt > 150)) {
    resetJoint(state);
  }
  if (state.raw && state.lastAt !== null) {
    const motion = Math.hypot(landmark.x - state.raw.x - centerShift.x, landmark.y - state.raw.y - centerShift.y);
    const limit = Math.max(0.25, shoulderWidth * 1.5) + (timestamp - state.lastAt) / 1000;
    if (motion > limit) {
      resetJoint(state);
      return null;
    }
  }
  const point = { x: clampUnit(state.x.update(landmark.x, timestamp)), y: clampUnit(state.y.update(landmark.y, timestamp)) };
  state.raw = { x: landmark.x, y: landmark.y };
  state.lastAt = timestamp;
  return point;
}

function stabilizeArmJoint(state: JointState, landmark: Landmark, centerShift: Point, shoulderWidth: number, elapsed: number, timestamp: number): Point | null {
  if (!validLandmark(landmark)) {
    resetJoint(state);
    return null;
  }
  if (elapsed > 150 || (state.lastAt !== null && timestamp - state.lastAt > 150)) {
    resetJoint(state);
  } else if (state.raw) {
    const motion = Math.hypot(landmark.x - state.raw.x - centerShift.x, landmark.y - state.raw.y - centerShift.y);
    if (motion > Math.max(0.035, shoulderWidth * 0.28)) {
      resetJoint(state);
    }
  }
  const point = { x: clampUnit(state.x.update(landmark.x, timestamp)), y: clampUnit(state.y.update(landmark.y, timestamp)) };
  state.raw = { x: landmark.x, y: landmark.y };
  state.lastAt = timestamp;
  return point;
}

function copyPlayer(player: TrackedPlayer): TrackedPlayer {
  return {
    ...player,
    center: { ...player.center },
    landmarks: player.landmarks.map((landmark) => ({ ...landmark })),
    wrists: [player.wrists[0] ? { ...player.wrists[0] } : null, player.wrists[1] ? { ...player.wrists[1] } : null],
  };
}

function commonAnchors(first: BodyAnchors, second: BodyAnchors): [Point, Point] | null {
  for (const key of ['shoulders', 'hips'] as const) {
    if (first[key] && second[key]) return [first[key], second[key]];
  }
  return null;
}

function matchingCost(track: Track, candidate: Candidate, time: number): number | null {
  const anchors = commonAnchors(track.anchors, candidate.anchors);
  if (!anchors) return null;
  const scaleChanged = (previous: number | null, current: number | null, limit: number): boolean => previous !== null && current !== null && Math.max(previous, current) > Math.min(previous, current) * limit;
  if (scaleChanged(track.bodyWidth, candidate.bodyWidth, 1.8) || scaleChanged(track.torsoHeight, candidate.torsoHeight, 2.1)) {
    return null;
  }
  const elapsed = (time - track.lastSeen) / 1000;
  const [previous, current] = anchors;
  const displacement = distance(previous, current);
  const limit = Math.min(0.45, Math.max(0.14, Math.max(track.shoulderWidth, candidate.shoulderWidth) * 1.2) + elapsed * 0.8);
  if (displacement > limit) {
    return null;
  }
  const predictionSeconds = Math.min(elapsed, 0.15);
  const predicted = { x: previous.x + track.velocity.x * predictionSeconds, y: previous.y + track.velocity.y * predictionSeconds };
  const scalePenalty = Math.abs(Math.log(candidate.shoulderWidth / track.shoulderWidth)) * 0.05;
  const torsoPenalty = candidate.torsoHeight !== null && track.torsoHeight !== null ? Math.abs(candidate.torsoHeight - track.torsoHeight) * 0.15 : 0;
  return distance(predicted, current) + displacement * 0.05 + scalePenalty + torsoPenalty;
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
        anchors: candidate.anchors,
        velocity: { x: 0, y: 0 },
        shoulderWidth: candidate.shoulderWidth,
        bodyWidth: candidate.bodyWidth,
        torsoHeight: candidate.torsoHeight,
        lastSeen: timestamp,
        observations: 0,
        armJoints: [createJoint(1.4, 1.5), createJoint(1.4, 1.5), createJoint(1.4, 1.5), createJoint(1.4, 1.5)],
        wrists: [createJoint(1.6, 1.8), createJoint(1.6, 1.8)],
        raisedSides: [false, false],
      };
      this.nextId += 1;
      activeTracks.push(track);
      players.push(this.observe(track, candidate, timestamp));
    }
    const missingTracks = this.tracks.filter((track) => !activeTracks.includes(track)).sort((first, second) => second.lastSeen - first.lastSeen);
    for (const track of missingTracks) {
      track.armJoints.forEach(resetJoint);
      track.wrists.forEach(resetJoint);
      track.raisedSides = [false, false];
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
    const anchors = commonAnchors(track.anchors, candidate.anchors);
    const centerShift = anchors ? { x: anchors[1].x - anchors[0].x, y: anchors[1].y - anchors[0].y } : { x: 0, y: 0 };
    const wrists = wristIndices.map((index, side) => smoothWrist(track.wrists[side], candidate.landmarks[index], centerShift, candidate.shoulderWidth, elapsed, timestamp)) as [Point | null, Point | null];
    for (let index = 0; index < armIndices.length; index += 1) {
      const landmarkIndex = armIndices[index];
      const point = stabilizeArmJoint(track.armJoints[index], candidate.landmarks[landmarkIndex], centerShift, candidate.shoulderWidth, elapsed, timestamp);
      if (point) candidate.landmarks[landmarkIndex] = { ...candidate.landmarks[landmarkIndex], x: point.x, y: point.y };
    }
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
    track.anchors = candidate.anchors;
    track.shoulderWidth = candidate.shoulderWidth;
    track.bodyWidth = candidate.bodyWidth ?? track.bodyWidth;
    track.torsoHeight = candidate.torsoHeight ?? track.torsoHeight;
    track.lastSeen = timestamp;
    track.observations += 1;
    const enterOffset = Math.max(0.015, candidate.shoulderWidth * 0.15);
    const exitOffset = enterOffset * 0.45;
    const raised = wrists.map((wrist, side) => {
      const shoulder = candidate.landmarks[shoulderIndices[side]];
      if (wrist === null || !validLandmark(shoulder)) return false;
      const wasRaised = elapsed <= 150 && track.raisedSides[side];
      return wrist.y < shoulder.y - (wasRaised ? exitOffset : enterOffset);
    }) as [boolean, boolean];
    track.raisedSides = raised;
    return { id: track.id, center: candidate.center, shoulderWidth: candidate.shoulderWidth, landmarks: candidate.landmarks, wrists, raised: raised[0] || raised[1], bothRaised: raised[0] && raised[1] };
  }
}
