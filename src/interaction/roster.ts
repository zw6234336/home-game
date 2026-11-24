import type { Landmark, Point, PoseObservation, TrackedPlayer } from '../types.ts';
import { validLandmark } from './geometry.ts';

type Anchors = { shoulders: Point | null; hips: Point | null };
type Candidate = {
  pose: PoseObservation;
  center: Point;
  anchors: Anchors;
  shoulderWidth: number;
  bodyWidth: number | null;
  torsoHeight: number | null;
  raised: boolean;
  confidence: number;
};
type RoomTrack = {
  id: number;
  center: Point;
  anchors: Anchors;
  shoulderWidth: number;
  bodyWidth: number | null;
  torsoHeight: number | null;
  lastSeen: number;
  raised: boolean;
  raisedSince: number | null;
  bystander: boolean;
};

const torsoIndices = [11, 12, 23, 24] as const;
const shoulderIndices = [11, 12] as const;
const wristIndices = [15, 16] as const;

function distance(first: Point, second: Point): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function midpoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function validPoint(landmark: Landmark | undefined): landmark is Landmark {
  return landmark !== undefined && validLandmark(landmark);
}

function candidateFor(pose: PoseObservation): Candidate | null {
  if (!pose || !Array.isArray(pose.landmarks)) return null;
  const landmarks = pose.landmarks;
  const torso = torsoIndices.map(index => landmarks[index]).filter(validPoint);
  if (torso.length < 2) return null;
  const s11 = validPoint(landmarks[11]) ? landmarks[11] : null;
  const s12 = validPoint(landmarks[12]) ? landmarks[12] : null;
  const h23 = validPoint(landmarks[23]) ? landmarks[23] : null;
  const h24 = validPoint(landmarks[24]) ? landmarks[24] : null;
  const shoulders = s11 && s12 ? midpoint(s11, s12) : null;
  const hips = h23 && h24 ? midpoint(h23, h24) : null;
  const center = shoulders && hips ? midpoint(shoulders, hips) : shoulders ?? hips ?? {
    x: torso.reduce((sum, point) => sum + point.x, 0) / torso.length,
    y: torso.reduce((sum, point) => sum + point.y, 0) / torso.length,
  };
  const width = s11 && s12 ? distance(s11, s12) : h23 && h24 ? distance(h23, h24) * 1.2 : 0.18;
  const shoulderWidth = Math.max(0.025, width);
  const raised = wristIndices.some((wIndex, side) => {
    const wrist = landmarks[wIndex];
    const shoulder = landmarks[shoulderIndices[side]];
    return validPoint(wrist) && validPoint(shoulder) && wrist.y < shoulder.y - Math.max(0.015, shoulderWidth * 0.15);
  });
  return {
    pose,
    center,
    anchors: { shoulders, hips },
    shoulderWidth,
    bodyWidth: s11 && s12 && width >= 0.025 ? width : null,
    torsoHeight: shoulders && hips && distance(shoulders, hips) >= 0.025 ? distance(shoulders, hips) : null,
    raised,
    confidence: torso.length + torso.reduce((sum, point) => sum + point.visibility, 0) / torso.length,
  };
}

function commonAnchors(first: Anchors, second: Anchors): [Point, Point] | null {
  if (first.shoulders && second.shoulders) return [first.shoulders, second.shoulders];
  if (first.hips && second.hips) return [first.hips, second.hips];
  return null;
}

function matchCost(track: RoomTrack, candidate: Candidate, time: number): number | null {
  const anchors = commonAnchors(track.anchors, candidate.anchors);
  if (!anchors) return null;
  const scaleBad = (a: number | null, b: number | null, limit: number) => a !== null && b !== null && Math.max(a, b) > Math.min(a, b) * limit;
  if (scaleBad(track.bodyWidth, candidate.bodyWidth, 1.8) || scaleBad(track.torsoHeight, candidate.torsoHeight, 2.1)) return null;
  const elapsed = Math.max(0, (time - track.lastSeen) / 1000);
  const displacement = distance(anchors[0], anchors[1]);
  const limit = Math.min(0.42, Math.max(0.14, Math.max(track.shoulderWidth, candidate.shoulderWidth) * 1.2) + elapsed * 0.8);
  if (displacement > limit) return null;
  const scalePenalty = Math.abs(Math.log(candidate.shoulderWidth / track.shoulderWidth)) * 0.05;
  return displacement + scalePenalty;
}

function assign(tracks: RoomTrack[], candidates: Candidate[], time: number): Map<number, number> {
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
      if (used.has(candidateIndex)) continue;
      const nextCost = matchCost(tracks[index], candidates[candidateIndex], time);
      if (nextCost === null) continue;
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

function playerAnchor(player: TrackedPlayer): Point | null {
  if (Array.isArray(player.landmarks) && validPoint(player.landmarks[11]) && validPoint(player.landmarks[12])) {
    return midpoint(player.landmarks[11], player.landmarks[12]);
  }
  return player.center;
}

export class PlayerRoster {
  private tracks: RoomTrack[] = [];
  private nextId = 1;
  private lastAt: number | null = null;
  private pinnedIds = new Set<number>();
  private lockedIds: Set<number> | null = null;

  select(poses: PoseObservation[], count: 1 | 2, timestamp: number): PoseObservation[] {
    if (!Number.isFinite(timestamp)) {
      this.reset();
      return [];
    }
    if (this.lastAt !== null && timestamp < this.lastAt) {
      this.reset();
      this.lastAt = timestamp;
      return [];
    }
    this.lastAt = timestamp;
    this.tracks = this.tracks.filter(track => timestamp - track.lastSeen <= 900);
    const candidates = (Array.isArray(poses) ? poses : []).map(candidateFor).filter((item): item is Candidate => item !== null).slice(0, 6);
    const orderedTracks = [...this.tracks].sort((first, second) => {
      const firstLocked = this.lockedIds?.has(first.id) || this.pinnedIds.has(first.id) ? 0 : 1;
      const secondLocked = this.lockedIds?.has(second.id) || this.pinnedIds.has(second.id) ? 0 : 1;
      return firstLocked - secondLocked || first.id - second.id;
    });
    const matches = assign(orderedTracks, candidates, timestamp);
    const usedCandidates = new Set<number>(matches.values());
    const observed = new Map<number, Candidate>();

    for (const [trackIndex, candidateIndex] of matches) {
      const track = orderedTracks[trackIndex];
      const candidate = candidates[candidateIndex];
      track.center = candidate.center;
      track.anchors = candidate.anchors;
      track.shoulderWidth = candidate.shoulderWidth;
      track.bodyWidth = candidate.bodyWidth ?? track.bodyWidth;
      track.torsoHeight = candidate.torsoHeight ?? track.torsoHeight;
      track.lastSeen = timestamp;
      track.raised = candidate.raised;
      track.raisedSince = candidate.raised ? (track.raisedSince ?? timestamp) : null;
      observed.set(track.id, candidate);
    }

    const unmatchedNew: { track: RoomTrack; candidate: Candidate }[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      if (usedCandidates.has(index)) continue;
      const candidate = candidates[index];
      const track: RoomTrack = {
        id: this.nextId++,
        center: candidate.center,
        anchors: candidate.anchors,
        shoulderWidth: candidate.shoulderWidth,
        bodyWidth: candidate.bodyWidth,
        torsoHeight: candidate.torsoHeight,
        lastSeen: timestamp,
        raised: candidate.raised,
        raisedSince: candidate.raised ? timestamp : null,
        bystander: false,
      };
      this.tracks.push(track);
      observed.set(track.id, candidate);
      unmatchedNew.push({ track, candidate });
    }
    if (this.tracks.length > 6) {
      this.tracks = this.tracks
        .sort((first, second) => {
          const keepA = this.lockedIds?.has(first.id) || this.pinnedIds.has(first.id) ? 0 : 1;
          const keepB = this.lockedIds?.has(second.id) || this.pinnedIds.has(second.id) ? 0 : 1;
          return keepA - keepB || second.lastSeen - first.lastSeen;
        })
        .slice(0, 6);
    }

    if (this.lockedIds && this.lockedIds.size > 0) {
      const selected: PoseObservation[] = [];
      for (const id of this.lockedIds) {
        const hit = observed.get(id);
        if (hit) selected.push(hit.pose);
      }
      if (selected.length >= count) {
        for (const id of observed.keys()) {
          if (!this.lockedIds.has(id)) {
            const track = this.tracks.find(item => item.id === id);
            if (track) track.bystander = true;
          }
        }
        return selected;
      }
      if (candidates.length <= count) {
        for (const [id, candidate] of observed) {
          if (selected.length >= count) break;
          if (this.lockedIds.has(id)) continue;
          const track = this.tracks.find(item => item.id === id);
          if (track && !track.bystander) selected.push(candidate.pose);
        }
      }
      return selected;
    }

    const active = [...observed.entries()].map(([id, candidate]) => {
      const track = this.tracks.find(item => item.id === id)!;
      const pinned = this.pinnedIds.has(id) ? 1 : 0;
      const raising = candidate.raised ? 1 : 0;
      const holdMs = track.raisedSince !== null ? timestamp - track.raisedSince : 0;
      const prominence = candidate.shoulderWidth - Math.abs(candidate.center.x - 0.5) * 0.25 + candidate.confidence * 0.01;
      return { id, candidate, pinned, raising, holdMs, prominence };
    });
    active.sort((first, second) =>
      second.pinned - first.pinned ||
      second.raising - first.raising ||
      second.holdMs - first.holdMs ||
      second.prominence - first.prominence,
    );
    return active.slice(0, count).map(item => item.candidate.pose);
  }

  private resolveIds(players: TrackedPlayer[]): Set<number> {
    const ids = new Set<number>();
    const used = new Set<number>();
    for (const player of players) {
      const anchor = playerAnchor(player);
      if (!anchor) continue;
      let bestId: number | null = null;
      let bestDist = 0.12;
      for (const track of this.tracks) {
        if (used.has(track.id)) continue;
        const trackAnchor = track.anchors.shoulders ?? track.center;
        const dist = distance(anchor, trackAnchor);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = track.id;
        }
      }
      if (bestId !== null) {
        ids.add(bestId);
        used.add(bestId);
      }
    }
    return ids;
  }

  syncConfirmed(players: TrackedPlayer[]): void {
    const resolved = this.resolveIds(players);
    for (const id of resolved) this.pinnedIds.add(id);
    for (const id of [...this.pinnedIds]) {
      if (!this.tracks.some(track => track.id === id)) this.pinnedIds.delete(id);
    }
  }

  lock(players: TrackedPlayer[]): void {
    const resolved = this.resolveIds(players);
    if (resolved.size === players.length && resolved.size > 0) {
      this.lockedIds = resolved;
      this.pinnedIds = new Set(resolved);
      for (const track of this.tracks) {
        if (!resolved.has(track.id)) track.bystander = true;
      }
    }
  }

  unlock(): void {
    this.lockedIds = null;
    this.pinnedIds.clear();
  }

  reset(): void {
    this.tracks = [];
    this.lastAt = null;
    this.pinnedIds.clear();
    this.lockedIds = null;
  }
}
