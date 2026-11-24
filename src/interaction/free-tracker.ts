import type { Landmark, Point, PoseObservation, ReachZone, StereoMeasurement, TrackedPlayer } from '../types.ts';
import { OneEuroFilter } from './filter.ts';
import { validLandmark } from './geometry.ts';
import { HoldGesture } from './raise.ts';
import { signatureSimilarity } from '../vision/stereo-depth.ts';

type JointState = { x: OneEuroFilter; y: OneEuroFilter; raw: Point | null; lastAt: number | null };

type Candidate = {
  center: Point;
  shoulderCenter: Point | null;
  shoulderWidth: number;
  landmarks: Landmark[];
  confidence: number;
  raised: boolean;
  measurement: StereoMeasurement;
};

type Slot = {
  id: number;
  center: Point;
  velocity: Point;
  shoulderWidth: number;
  depthMeters: number | null;
  depthConfidence: number;
  realShoulderMeters: number | null;
  appearance: number[] | null;
  lastSeen: number;
  observations: number;
  armJoints: [JointState, JointState, JointState, JointState];
  wrists: [JointState, JointState];
  raisedSides: [boolean, boolean];
  hold: HoldGesture;
  confirmed: boolean;
  raisedSince: number | null;
};

const torsoIndices = [11, 12, 23, 24] as const;
const headIndices = [0, 7, 8] as const;
const armIndices = [13, 14, 15, 16] as const;
const wristIndices = [15, 16] as const;
const shoulderIndices = [11, 12] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function createJoint(minCutoff: number, beta: number): JointState {
  return { x: new OneEuroFilter({ minCutoff, beta }), y: new OneEuroFilter({ minCutoff, beta }), raw: null, lastAt: null };
}

function resetJoint(joint: JointState): void {
  joint.x.reset();
  joint.y.reset();
  joint.raw = null;
  joint.lastAt = null;
}

function copyLandmark(value: Landmark | undefined): Landmark {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1 || !Number.isFinite(value.visibility)) {
    return { x: 0, y: 0, visibility: 0 };
  }
  const result: Landmark = { x: value.x, y: value.y, visibility: clamp(value.visibility, 0, 1) };
  if (Number.isFinite(value.z)) result.z = value.z;
  return result;
}

function blendAppearance(prev: number[] | null, next: number[] | null): number[] | null {
  if (!next) return prev;
  if (!prev || prev.length !== next.length) return [...next];
  const blended = prev.map((value, idx) => value * 0.85 + next[idx] * 0.15);
  let norm = 0;
  for (let i = 0; i < blended.length; i += 1) norm += blended[i] * blended[i];
  if (norm <= 1e-8) return prev;
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < blended.length; i += 1) blended[i] *= inv;
  return blended;
}

function candidateFor(pose: PoseObservation, measurement: StereoMeasurement): Candidate | null {
  if (!pose || !Array.isArray(pose.landmarks)) return null;
  const landmarks = Array.from({ length: 33 }, (_, index) => copyLandmark(pose.landmarks[index]));
  const torso = torsoIndices.map(index => landmarks[index]).filter(validLandmark);
  const head = headIndices.map(index => landmarks[index]).filter(validLandmark);
  if (torso.length < 2 && (torso.length < 1 || head.length < 2)) return null;
  const s11 = validLandmark(landmarks[11]) ? landmarks[11] : null;
  const s12 = validLandmark(landmarks[12]) ? landmarks[12] : null;
  const h23 = validLandmark(landmarks[23]) ? landmarks[23] : null;
  const h24 = validLandmark(landmarks[24]) ? landmarks[24] : null;
  const shoulders = s11 && s12 ? midpoint(s11, s12) : null;
  const hips = h23 && h24 ? midpoint(h23, h24) : null;
  const anchors = torso.length >= 2 ? torso : [...torso, ...head];
  const center = shoulders && hips ? midpoint(shoulders, hips) : shoulders ?? hips ?? {
    x: anchors.reduce((sum, p) => sum + p.x, 0) / anchors.length,
    y: anchors.reduce((sum, p) => sum + p.y, 0) / anchors.length,
  };
  const headSpan = validLandmark(landmarks[7]) && validLandmark(landmarks[8]) ? distance(landmarks[7], landmarks[8]) * 2.1 : 0;
  const rawWidth = s11 && s12 ? distance(s11, s12) : h23 && h24 ? distance(h23, h24) * 1.2 : headSpan > 0.03 ? headSpan : 0.14;
  const shoulderWidth = clamp(rawWidth, 0.025, 0.65);
  const raised = wristIndices.some((wIdx, side) => {
    const wrist = landmarks[wIdx];
    const shoulder = landmarks[shoulderIndices[side]];
    return validLandmark(wrist) && validLandmark(shoulder) && wrist.y < shoulder.y - Math.max(0.015, shoulderWidth * 0.15);
  });
  const confidence = anchors.length + anchors.reduce((sum, p) => sum + p.visibility, 0) / anchors.length;
  return { center, shoulderCenter: shoulders, shoulderWidth, landmarks, confidence, raised, measurement };
}

function smoothWrist(state: JointState, landmark: Landmark, centerShift: Point, shoulderWidth: number, elapsed: number, timestamp: number): Point | null {
  if (!validLandmark(landmark)) {
    resetJoint(state);
    return null;
  }
  if (elapsed > 200 || (state.lastAt !== null && timestamp - state.lastAt > 200)) {
    resetJoint(state);
  }
  if (state.raw && state.lastAt !== null) {
    const motion = Math.hypot(landmark.x - state.raw.x - centerShift.x, landmark.y - state.raw.y - centerShift.y);
    const limit = Math.max(0.32, shoulderWidth * 1.8) + (timestamp - state.lastAt) / 800;
    if (motion > limit) {
      resetJoint(state);
      return null;
    }
  }
  const point = { x: clamp(state.x.update(landmark.x, timestamp), 0, 1), y: clamp(state.y.update(landmark.y, timestamp), 0, 1) };
  state.raw = { x: landmark.x, y: landmark.y };
  state.lastAt = timestamp;
  return point;
}

function stabilizeArmJoint(state: JointState, landmark: Landmark, centerShift: Point, shoulderWidth: number, elapsed: number, timestamp: number): Point | null {
  if (!validLandmark(landmark)) {
    resetJoint(state);
    return null;
  }
  if (elapsed > 200 || (state.lastAt !== null && timestamp - state.lastAt > 200)) {
    resetJoint(state);
  } else if (state.raw) {
    const motion = Math.hypot(landmark.x - state.raw.x - centerShift.x, landmark.y - state.raw.y - centerShift.y);
    if (motion > Math.max(0.035, shoulderWidth * 0.28)) resetJoint(state);
  }
  const point = { x: clamp(state.x.update(landmark.x, timestamp), 0, 1), y: clamp(state.y.update(landmark.y, timestamp), 0, 1) };
  state.raw = { x: landmark.x, y: landmark.y };
  state.lastAt = timestamp;
  return point;
}

function matchScore(slot: Slot, candidate: Candidate, time: number, maxPlayDepth: number | null): number | null {
  const elapsed = Math.max(0, (time - slot.lastSeen) / 1000);
  const candDepth = candidate.measurement.depthConfidence >= 0.52 ? candidate.measurement.depthMeters : null;
  if (maxPlayDepth !== null && candDepth !== null && candDepth > maxPlayDepth + 1.35) {
    return null;
  }
  const predictionSeconds = Math.min(elapsed, 0.22);
  const predicted = {
    x: clamp(slot.center.x + slot.velocity.x * predictionSeconds, 0, 1),
    y: clamp(slot.center.y + slot.velocity.y * predictionSeconds, 0, 1),
  };
  const disp = distance(predicted, candidate.center);
  const maxDisp = Math.min(1.15, Math.max(0.32, Math.max(slot.shoulderWidth, candidate.shoulderWidth) * 2.4) + elapsed * 1.15);
  if (disp > maxDisp) return null;
  let depthPenalty = 0;
  if (slot.depthMeters !== null && candDepth !== null) {
    const depthDiff = Math.abs(candDepth - slot.depthMeters);
    if (depthDiff > 1.3 + elapsed * 1.4) return null;
    depthPenalty = depthDiff * 0.16;
  }
  let scalePenalty = 0;
  const candReal = candidate.measurement.depthConfidence >= 0.55 ? candidate.measurement.realShoulderMeters : null;
  if (slot.realShoulderMeters !== null && candReal !== null) {
    scalePenalty = Math.abs(Math.log(candReal / slot.realShoulderMeters)) * 0.22;
  } else {
    scalePenalty = Math.abs(Math.log(candidate.shoulderWidth / slot.shoulderWidth)) * 0.06;
  }
  let appearancePenalty = 0;
  if (slot.appearance && candidate.measurement.appearance) {
    const sim = signatureSimilarity(slot.appearance, candidate.measurement.appearance);
    appearancePenalty = (1 - sim) * 0.32;
  }
  return disp + depthPenalty + scalePenalty + appearancePenalty;
}

function assignBest(slots: Slot[], candidates: Candidate[], time: number, maxPlayDepth: number | null): Map<number, number> {
  let bestPairs = new Map<number, number>();
  let bestCost = Number.POSITIVE_INFINITY;
  const search = (index: number, pairs: Map<number, number>, used: Set<number>, cost: number): void => {
    if (index === slots.length) {
      if (pairs.size > bestPairs.size || (pairs.size === bestPairs.size && cost < bestCost)) {
        bestPairs = new Map(pairs);
        bestCost = cost;
      }
      return;
    }
    for (let c = 0; c < candidates.length; c += 1) {
      if (used.has(c)) continue;
      const next = matchScore(slots[index], candidates[c], time, maxPlayDepth);
      if (next === null) continue;
      pairs.set(index, c);
      used.add(c);
      search(index + 1, pairs, used, cost + next);
      pairs.delete(index);
      used.delete(c);
    }
    search(index + 1, pairs, used, cost);
  };
  search(0, new Map(), new Set(), 0);
  return bestPairs;
}

function copyPlayer(player: TrackedPlayer): TrackedPlayer {
  return {
    ...player,
    center: { ...player.center },
    landmarks: player.landmarks.map(item => ({ ...item })),
    wrists: [player.wrists[0] ? { ...player.wrists[0] } : null, player.wrists[1] ? { ...player.wrists[1] } : null],
  };
}

export class FreeMotionTracker {
  private readonly count: 1 | 2;
  private slots: Slot[] = [];
  private locked = false;
  private nextId = 1;
  private lastAt: number | null = null;
  private lastPlayers: TrackedPlayer[] = [];
  private diagnostic = 'idle';

  constructor(count: 1 | 2) {
    if (count !== 1 && count !== 2) throw new RangeError('Player limit must be one or two');
    this.count = count;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  lastDiagnostic(): string {
    return this.diagnostic;
  }

  readyCount(): number {
    return this.slots.filter(slot => slot.confirmed).length;
  }

  isCalibrated(): boolean {
    return this.slots.filter(slot => slot.confirmed).length >= this.count;
  }

  lock(): void {
    const confirmed = this.slots.filter(slot => slot.confirmed).slice(0, this.count);
    if (confirmed.length >= this.count) {
      this.slots = confirmed;
      this.locked = true;
    }
  }

  unlock(): void {
    this.locked = false;
    for (const slot of this.slots) {
      slot.confirmed = false;
      slot.hold.reset();
    }
  }

  reset(): void {
    this.slots = [];
    this.locked = false;
    this.lastAt = null;
    this.lastPlayers = [];
    this.diagnostic = 'idle';
  }

  update(poses: PoseObservation[], measurements: StereoMeasurement[], timestamp: number): TrackedPlayer[] {
    if (!Number.isFinite(timestamp)) {
      this.reset();
      this.diagnostic = 'clock_invalid';
      return [];
    }
    if (this.lastAt !== null && timestamp < this.lastAt) {
      this.reset();
      this.lastAt = timestamp;
      this.diagnostic = 'clock_invalid';
      return [];
    }
    if (timestamp === this.lastAt) {
      return this.lastPlayers.map(copyPlayer);
    }
    this.lastAt = timestamp;
    const emptyMeasurement: StereoMeasurement = { depthMeters: null, depthConfidence: 0, realShoulderMeters: null, disparityPx: null, appearance: null };
    const candidates = (Array.isArray(poses) ? poses : [])
      .map((pose, index) => candidateFor(pose, measurements[index] ?? emptyMeasurement))
      .filter((item): item is Candidate => item !== null)
      .slice(0, 6);

    if (!this.locked) {
      this.slots = this.slots.filter(slot => timestamp - slot.lastSeen <= 1500);
    }

    const activeDepths = this.slots.map(slot => slot.depthMeters).filter((d): d is number => d !== null);
    const maxPlayDepth = this.locked && activeDepths.length > 0 ? Math.max(...activeDepths) : null;

    const orderedSlots = [...this.slots].sort((a, b) => (b.confirmed ? 1 : 0) - (a.confirmed ? 1 : 0) || a.id - b.id);
    const matches = assignBest(orderedSlots, candidates, timestamp, maxPlayDepth);
    const usedCandidates = new Set<number>(matches.values());
    const observedPlayers: TrackedPlayer[] = [];
    const matchedSlotIds = new Set<number>();

    for (const [slotIdx, candIdx] of matches) {
      const slot = orderedSlots[slotIdx];
      matchedSlotIds.add(slot.id);
      observedPlayers.push(this.observe(slot, candidates[candIdx], timestamp));
    }

    if (this.locked) {
      const missingSlots = orderedSlots.filter(slot => !matchedSlotIds.has(slot.id));
      const freeCandidates = candidates
        .map((candidate, index) => ({ candidate, index }))
        .filter(item => !usedCandidates.has(item.index));

      for (const slot of missingSlots) {
        if (freeCandidates.length === 0) {
          slot.armJoints.forEach(resetJoint);
          slot.wrists.forEach(resetJoint);
          slot.raisedSides = [false, false];
          continue;
        }
        let bestIdx = -1;
        let bestScore = Number.POSITIVE_INFINITY;
        for (let i = 0; i < freeCandidates.length; i += 1) {
          const cand = freeCandidates[i].candidate;
          const candDepth = cand.measurement.depthConfidence >= 0.52 ? cand.measurement.depthMeters : null;
          if (maxPlayDepth !== null && candDepth !== null && candDepth > maxPlayDepth + 1.6) continue;
          const simPenalty = slot.appearance && cand.measurement.appearance ? (1 - signatureSimilarity(slot.appearance, cand.measurement.appearance)) * 0.5 : 0.25;
          const sizePenalty = slot.realShoulderMeters && cand.measurement.realShoulderMeters
            ? Math.abs(Math.log(cand.measurement.realShoulderMeters / slot.realShoulderMeters)) * 0.35
            : Math.abs(Math.log(cand.shoulderWidth / slot.shoulderWidth)) * 0.15;
          const distPenalty = distance(slot.center, cand.center) * 0.35;
          const score = simPenalty + sizePenalty + distPenalty;
          if (score < bestScore) {
            bestScore = score;
            bestIdx = i;
          }
        }
        if (bestIdx >= 0) {
          const picked = freeCandidates.splice(bestIdx, 1)[0];
          matchedSlotIds.add(slot.id);
          observedPlayers.push(this.observe(slot, picked.candidate, timestamp));
        } else {
          slot.armJoints.forEach(resetJoint);
          slot.wrists.forEach(resetJoint);
          slot.raisedSides = [false, false];
        }
      }
      this.diagnostic = observedPlayers.length >= this.count ? 'ok' : observedPlayers.length > 0 ? 'partner_missing' : 'no_player';
      this.lastPlayers = observedPlayers.sort((a, b) => a.id - b.id);
      return this.lastPlayers.map(copyPlayer);
    }

    for (let index = 0; index < candidates.length; index += 1) {
      if (usedCandidates.has(index)) continue;
      const cand = candidates[index];
      const slot = this.createSlot(cand, timestamp);
      this.slots.push(slot);
      matchedSlotIds.add(slot.id);
      observedPlayers.push(this.observe(slot, cand, timestamp));
    }

    for (const slot of this.slots) {
      if (!matchedSlotIds.has(slot.id)) {
        slot.hold.update(false, timestamp);
        slot.armJoints.forEach(resetJoint);
        slot.wrists.forEach(resetJoint);
        slot.raisedSides = [false, false];
        if (timestamp - slot.lastSeen > 1200) slot.confirmed = false;
      }
    }

    const ranked = observedPlayers.map(player => {
      const slot = this.slots.find(item => item.id === player.id)!;
      const depthBoost = slot.depthMeters !== null ? Math.max(0, 3.2 - slot.depthMeters) * 0.12 : 0;
      const holdMs = slot.raisedSince !== null ? timestamp - slot.raisedSince : 0;
      const score = (slot.confirmed ? 100 : 0) + (player.raised ? 20 : 0) + Math.min(10, holdMs / 200) + player.shoulderWidth * 4 + depthBoost - Math.abs(player.center.x - 0.5) * 0.4;
      return { player, slot, score };
    }).sort((a, b) => b.score - a.score);

    const chosen = ranked.slice(0, this.count);
    let anyHold = false;
    let missingWrist = false;
    for (const item of chosen) {
      const hasWrist = item.player.wrists.some(Boolean);
      if (!hasWrist) missingWrist = true;
      if (item.player.raised && hasWrist) anyHold = true;
      if (item.slot.hold.update(item.player.raised && hasWrist, timestamp)) {
        item.slot.confirmed = true;
      }
    }
    if (this.slots.length > 6) {
      this.slots = this.slots
        .sort((a, b) => (b.confirmed ? 1 : 0) - (a.confirmed ? 1 : 0) || b.lastSeen - a.lastSeen)
        .slice(0, 6);
    }
    if (this.isCalibrated()) {
      this.diagnostic = 'ready';
      this.lock();
    } else if (chosen.length === 0) {
      this.diagnostic = 'no_player';
    } else {
      this.diagnostic = anyHold ? 'holding' : missingWrist ? 'no_wrist' : 'hand_not_raised';
    }
    this.lastPlayers = chosen.map(item => item.player).sort((a, b) => a.id - b.id);
    return this.lastPlayers.map(copyPlayer);
  }

  zones(players: TrackedPlayer[], gentle: boolean, compact = false): ReachZone[] {
    const active = players.slice(0, this.count);
    return active.map(player => {
      const s11 = validLandmark(player.landmarks[11]) ? player.landmarks[11] : null;
      const s12 = validLandmark(player.landmarks[12]) ? player.landmarks[12] : null;
      const anchor = s11 && s12 ? midpoint(s11, s12) : player.center;
      const width = clamp(player.shoulderWidth, 0.04, 0.45);
      const halfSpan = compact ? Math.max(0.1, width * 0.9) : Math.max(0.16, width * 1.65);
      const topSpan = compact ? Math.max(0.08, width * 0.55) : Math.max(0.14, width * 1.15);
      const bottomSpan = compact ? Math.max(0.08, width * 0.55) : Math.max(0.14, width * 0.9);
      let left = 0.04;
      let right = 0.96;
      if (active.length === 2) {
        const other = active.find(item => item.id !== player.id)!;
        const boundary = (anchor.x + other.center.x) / 2;
        if (anchor.x <= other.center.x) {
          right = Math.max(left + 0.08, Math.min(right, boundary - 0.015));
        } else {
          left = Math.min(right - 0.08, Math.max(left, boundary + 0.015));
        }
      }
      const minX = clamp(anchor.x - halfSpan, left, right - 0.06);
      const maxX = clamp(anchor.x + halfSpan, minX + 0.06, right);
      const minY = clamp(anchor.y - topSpan, 0.06, 0.84);
      const maxY = clamp(anchor.y + bottomSpan, minY + 0.08, 0.92);
      const lower = gentle ? minY + (maxY - minY) * 0.22 : minY;
      return { playerId: player.id, x: minX, y: lower, width: maxX - minX, height: Math.max(0.08, maxY - lower) };
    });
  }

  private createSlot(cand: Candidate, timestamp: number): Slot {
    return {
      id: this.nextId++,
      center: cand.center,
      velocity: { x: 0, y: 0 },
      shoulderWidth: cand.shoulderWidth,
      depthMeters: cand.measurement.depthConfidence >= 0.52 ? cand.measurement.depthMeters : null,
      depthConfidence: cand.measurement.depthConfidence,
      realShoulderMeters: cand.measurement.depthConfidence >= 0.55 ? cand.measurement.realShoulderMeters : null,
      appearance: cand.measurement.appearance ? [...cand.measurement.appearance] : null,
      lastSeen: timestamp,
      observations: 0,
      armJoints: [createJoint(1.4, 1.5), createJoint(1.4, 1.5), createJoint(1.4, 1.5), createJoint(1.4, 1.5)],
      wrists: [createJoint(1.6, 1.8), createJoint(1.6, 1.8)],
      raisedSides: [false, false],
      hold: new HoldGesture(2000),
      confirmed: false,
      raisedSince: cand.raised ? timestamp : null,
    };
  }

  private observe(slot: Slot, cand: Candidate, timestamp: number): TrackedPlayer {
    const elapsed = timestamp - slot.lastSeen;
    const centerShift = { x: cand.center.x - slot.center.x, y: cand.center.y - slot.center.y };
    const wrists = wristIndices.map((index, side) => smoothWrist(slot.wrists[side], cand.landmarks[index], centerShift, cand.shoulderWidth, elapsed, timestamp)) as [Point | null, Point | null];
    for (let i = 0; i < armIndices.length; i += 1) {
      const idx = armIndices[i];
      const point = stabilizeArmJoint(slot.armJoints[i], cand.landmarks[idx], centerShift, cand.shoulderWidth, elapsed, timestamp);
      if (point) cand.landmarks[idx] = { ...cand.landmarks[idx], x: point.x, y: point.y };
    }
    if (elapsed > 0 && elapsed <= 250) {
      const vx = clamp(centerShift.x * 1000 / elapsed, -3.5, 3.5);
      const vy = clamp(centerShift.y * 1000 / elapsed, -3.5, 3.5);
      const w = slot.observations < 2 ? 1 : 0.6;
      slot.velocity = { x: slot.velocity.x * (1 - w) + vx * w, y: slot.velocity.y * (1 - w) + vy * w };
    } else {
      slot.velocity = { x: 0, y: 0 };
    }
    slot.center = cand.center;
    slot.shoulderWidth = cand.shoulderWidth;
    if (cand.measurement.depthMeters !== null && cand.measurement.depthConfidence >= 0.52) {
      slot.depthMeters = slot.depthMeters === null ? cand.measurement.depthMeters : slot.depthMeters * 0.72 + cand.measurement.depthMeters * 0.28;
      slot.depthConfidence = cand.measurement.depthConfidence;
    } else if (elapsed > 400) {
      slot.depthConfidence *= 0.85;
    }
    if (cand.measurement.realShoulderMeters !== null && cand.measurement.depthConfidence >= 0.55) {
      slot.realShoulderMeters = slot.realShoulderMeters === null ? cand.measurement.realShoulderMeters : slot.realShoulderMeters * 0.8 + cand.measurement.realShoulderMeters * 0.2;
    }
    slot.appearance = blendAppearance(slot.appearance, cand.measurement.appearance);
    slot.lastSeen = timestamp;
    slot.observations += 1;
    const enterOffset = Math.max(0.015, cand.shoulderWidth * 0.15);
    const exitOffset = enterOffset * 0.45;
    const raised = wrists.map((wrist, side) => {
      const shoulder = cand.landmarks[shoulderIndices[side]];
      if (wrist === null || !validLandmark(shoulder)) return false;
      const wasRaised = elapsed <= 200 && slot.raisedSides[side];
      return wrist.y < shoulder.y - (wasRaised ? exitOffset : enterOffset);
    }) as [boolean, boolean];
    slot.raisedSides = raised;
    const anyRaised = raised[0] || raised[1];
    slot.raisedSince = anyRaised ? (slot.raisedSince ?? timestamp) : null;
    return {
      id: slot.id,
      center: cand.center,
      shoulderWidth: cand.shoulderWidth,
      landmarks: cand.landmarks,
      wrists,
      raised: anyRaised,
      bothRaised: raised[0] && raised[1],
      depthMeters: slot.depthMeters,
      depthConfidence: slot.depthConfidence,
      realShoulderMeters: slot.realShoulderMeters,
    };
  }
}
