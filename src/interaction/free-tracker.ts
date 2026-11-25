import type { Landmark, Point, PoseObservation, ReachZone, StereoMeasurement, TrackedPlayer } from '../types.ts';
import { OneEuroFilter } from './filter.ts';
import { validLandmark } from './geometry.ts';
import { HoldGesture } from './raise.ts';
import { signatureSimilarity } from '../vision/stereo-depth.ts';

export type ParticipantBindingState = { phase: 'unbound' | 'preparing' | 'bound' | 'waiting'; boundCount: number; observedCount: number; ignoredCount: number; ambiguous: boolean };

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
  referenceAppearance: number[] | null;
  referenceShoulderMeters: number | null;
  lastSeen: number;
  observations: number;
  present: boolean;
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

function identityAppearance(slot: Slot): number[] | null {
  return slot.referenceAppearance ?? slot.appearance;
}

function compatibleAppearance(slot: Slot, candidate: Candidate): boolean {
  const reference = identityAppearance(slot);
  return !reference || !candidate.measurement.appearance || signatureSimilarity(reference, candidate.measurement.appearance) >= 0.4;
}

function predictedDistance(slot: Slot, candidate: Candidate, time: number): number {
  const elapsed = Math.max(0, Math.min((time - slot.lastSeen) / 1000, 0.22));
  return distance({ x: clamp(slot.center.x + slot.velocity.x * elapsed, 0, 1), y: clamp(slot.center.y + slot.velocity.y * elapsed, 0, 1) }, candidate.center);
}

function accountedElsewhere(slot: Slot, candidate: Candidate, candidates: Candidate[], time: number): boolean {
  return time - slot.lastSeen <= 250 && candidates.some(other => other !== candidate && compatibleAppearance(slot, other) && Math.min(predictedDistance(slot, other, time), distance(slot.center, other.center)) < Math.max(0.045, slot.shoulderWidth * 0.4));
}

function participantCandidate(slot: Slot, candidate: Candidate, room: Slot[], candidates: Candidate[], time: number, recovery = false, preparation = false): boolean {
  if (!compatibleAppearance(slot, candidate)) return false;
  if (!slot.confirmed && (!preparation || slot.raisedSince === null)) return true;
  const ownDistance = predictedDistance(slot, candidate, time);
  const competitors = room.filter(other => other.id !== slot.id && compatibleAppearance(other, candidate) && !(preparation && !slot.confirmed && !other.confirmed && other.lastSeen + 40 < slot.lastSeen) && !accountedElsewhere(other, candidate, candidates, time));
  const appearance = candidate.measurement.appearance;
  const reference = identityAppearance(slot);
  const ownScaleError = Math.abs(Math.log(candidate.shoulderWidth / slot.shoulderWidth));
  const indistinct = (other: Slot) => !appearance || !reference || !identityAppearance(other) || signatureSimilarity(identityAppearance(other), appearance) >= signatureSimilarity(reference, appearance) - 0.12;
  if (competitors.some(other => time - other.lastSeen <= 1500 && indistinct(other) && Math.abs(Math.log(candidate.shoulderWidth / other.shoulderWidth)) + 0.18 < ownScaleError)) return false;
  if (competitors.some(other => time - other.lastSeen <= 700 && indistinct(other) && Math.abs(Math.log(candidate.shoulderWidth / other.shoulderWidth)) <= ownScaleError + 0.12 && matchScore(other, candidate, time, null) !== null)) return false;
  if (competitors.some(other => time - other.lastSeen <= 700 && predictedDistance(other, candidate, time) <= Math.max(0.055, other.shoulderWidth * 0.65) && (other.lastSeen > slot.lastSeen + 40 || Math.abs(predictedDistance(other, candidate, time) - ownDistance) < 0.06))) return false;
  if (competitors.length > 0 && slot.referenceShoulderMeters && candidate.measurement.depthConfidence >= 0.7 && candidate.measurement.realShoulderMeters && (candidate.measurement.realShoulderMeters / slot.referenceShoulderMeters < 0.6 || candidate.measurement.realShoulderMeters / slot.referenceShoulderMeters > 1.7)) return false;
  if (!recovery && slot.present && time - slot.lastSeen <= 400) return true;
  if (!recovery && time - slot.lastSeen <= 400 && ownDistance < Math.max(0.06, slot.shoulderWidth * 0.5) && reference && appearance && signatureSimilarity(reference, appearance) >= 0.9) return true;
  if (!reference || !appearance || signatureSimilarity(reference, appearance) < 0.82) return false;
  const similarity = signatureSimilarity(reference, appearance);
  return !competitors.some(other => identityAppearance(other) && signatureSimilarity(identityAppearance(other), appearance) >= similarity - 0.12);
}

function matchScore(slot: Slot, candidate: Candidate, time: number, maxPlayDepth: number | null): number | null {
  if (!compatibleAppearance(slot, candidate)) return null;
  const elapsed = Math.max(0, (time - slot.lastSeen) / 1000);
  const candDepth = candidate.measurement.depthConfidence >= 0.52 ? candidate.measurement.depthMeters : null;
  if (slot.confirmed && maxPlayDepth !== null && candDepth !== null && candDepth > maxPlayDepth + 1.35) {
    return null;
  }
  const predictionSeconds = Math.min(elapsed, 0.22);
  const predicted = {
    x: clamp(slot.center.x + slot.velocity.x * predictionSeconds, 0, 1),
    y: clamp(slot.center.y + slot.velocity.y * predictionSeconds, 0, 1),
  };
  const disp = Math.min(distance(predicted, candidate.center), distance(slot.center, candidate.center) + 0.015);
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
  if (identityAppearance(slot) && candidate.measurement.appearance) {
    const sim = signatureSimilarity(identityAppearance(slot), candidate.measurement.appearance);
    appearancePenalty = (1 - sim) * 0.32;
  }
  return disp + depthPenalty + scalePenalty + appearancePenalty + Math.min(0.35, elapsed * 0.18);
}

function assignBest(slots: Slot[], candidates: Candidate[], time: number, maxPlayDepth: number | null, room: Slot[] = slots, locked = false, preparation = false): Map<number, number> {
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
      if ((locked || preparation) && !participantCandidate(slots[index], candidates[c], room, candidates, time, false, preparation)) continue;
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
  private boundIds = new Set<number>();
  private roomCount = 0;
  private ambiguous = false;
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
    return this.locked && this.boundIds.size === this.count;
  }

  lock(): void {
    const confirmed = this.slots.filter(slot => slot.confirmed).slice(0, this.count);
    if (confirmed.length >= this.count) {
      if (!confirmed.every(slot => slot.lastSeen === this.lastAt)) return;
      this.boundIds = new Set(confirmed.map(slot => slot.id));
      this.locked = true;
    }
  }

  boundPlayerIds(): number[] { return [...this.boundIds]; }

  canStart(): boolean { return this.isCalibrated() && this.lastPlayers.length === this.count && this.lastPlayers.every(player => this.boundIds.has(player.id) && validLandmark(player.landmarks[11]) && validLandmark(player.landmarks[12])); }

  bindingState(): ParticipantBindingState {
    return { phase: this.locked ? this.canStart() ? 'bound' : 'waiting' : this.readyCount() > 0 || this.lastPlayers.some(player => player.raised) ? 'preparing' : 'unbound', boundCount: this.locked ? this.boundIds.size : this.readyCount(), observedCount: this.lastPlayers.length, ignoredCount: Math.max(0, this.roomCount - this.lastPlayers.length), ambiguous: this.ambiguous };
  }

  unlock(): void {
    this.locked = false;
    this.boundIds.clear();
    for (const slot of this.slots) {
      slot.confirmed = false;
      slot.hold.reset();
    }
  }

  reset(): void {
    this.slots = [];
    this.locked = false;
    this.boundIds.clear(); this.roomCount = 0; this.ambiguous = false;
    this.lastAt = null;
    this.lastPlayers = [];
    this.diagnostic = 'idle';
  }

  update(poses: PoseObservation[], measurements: StereoMeasurement[], timestamp: number, allowEnrollment = true): TrackedPlayer[] {
    if (!Number.isFinite(timestamp) || this.lastAt !== null && timestamp < this.lastAt) {
      this.reset(); this.diagnostic = 'clock_invalid'; return [];
    }
    if (timestamp === this.lastAt) return this.lastPlayers.map(copyPlayer);
    this.lastAt = timestamp;
    const emptyMeasurement: StereoMeasurement = { depthMeters: null, depthConfidence: 0, realShoulderMeters: null, disparityPx: null, appearance: null };
    const candidates = (Array.isArray(poses) ? poses : []).map((pose, index) => candidateFor(pose, measurements[index] ?? emptyMeasurement)).filter((item): item is Candidate => item !== null).slice(0, 6).filter((candidate, index, all) => !all.slice(0, index).some(previous => distance(previous.center, candidate.center) < 0.025 && Math.abs(Math.log(previous.shoulderWidth / candidate.shoulderWidth)) < 0.12));
    this.roomCount = candidates.length;
    this.ambiguous = false;
    if (!this.locked) this.slots = this.slots.filter(slot => timestamp - slot.lastSeen <= 1500);
    const room = [...this.slots];
    const orderedSlots = [...room].sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.lastSeen - a.lastSeen || a.id - b.id).slice(0, 6);
    const activeDepths = room.filter(slot => this.boundIds.has(slot.id)).map(slot => slot.depthMeters).filter((value): value is number => value !== null);
    const maxPlayDepth = this.locked && activeDepths.length ? Math.max(...activeDepths) : null;
    const matches = assignBest(orderedSlots, candidates, timestamp, maxPlayDepth, room, this.locked, !this.locked);
    const used = new Set(matches.values());
    const observed = new Map<number, TrackedPlayer>();
    for (const [slotIndex, candidateIndex] of matches) {
      const slot = orderedSlots[slotIndex];
      observed.set(slot.id, this.observe(slot, candidates[candidateIndex], timestamp));
    }
    if (this.locked) {
      for (const slot of room.filter(item => this.boundIds.has(item.id) && !observed.has(item.id))) {
        const available = candidates.map((candidate, index) => ({ candidate, index })).filter(item => !used.has(item.index));
        const accepted = available.filter(item => participantCandidate(slot, item.candidate, room, candidates, timestamp, true)).sort((a, b) => predictedDistance(slot, a.candidate, timestamp) - predictedDistance(slot, b.candidate, timestamp));
        if (accepted.length === 1) {
          const hit = accepted[0]; used.add(hit.index); observed.set(slot.id, this.observe(slot, hit.candidate, timestamp));
        } else {
          this.ambiguous ||= available.length > 0;
        }
      }
    }
    for (let index = 0; index < candidates.length; index += 1) {
      if (used.has(index)) continue;
      const slot = this.createSlot(candidates[index], timestamp);
      this.slots.push(slot); observed.set(slot.id, this.observe(slot, candidates[index], timestamp));
    }
    for (const slot of this.slots) {
      if (observed.has(slot.id)) continue;
      slot.present = false;
      slot.present = false; slot.raisedSince = null;
      slot.armJoints.forEach(resetJoint); slot.wrists.forEach(resetJoint); slot.raisedSides = [false, false]; slot.hold.update(false, timestamp);
      if (!this.locked && timestamp - slot.lastSeen > 1200) slot.confirmed = false;
    }
    this.slots = this.slots.sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.lastSeen - a.lastSeen).slice(0, 12);
    if (this.locked) {
      this.lastPlayers = [...this.boundIds].flatMap(id => observed.has(id) ? [observed.get(id)!] : []).sort((a, b) => a.id - b.id);
      this.diagnostic = this.canStart() ? 'ok' : this.ambiguous ? 'identity_uncertain' : this.lastPlayers.length ? 'partner_missing' : 'no_player';
      return this.lastPlayers.map(copyPlayer);
    }
    const confirmed = [...observed.values()].filter(player => this.slots.some(slot => slot.id === player.id && slot.confirmed));
    const raising = [...observed.values()].filter(player => !confirmed.some(item => item.id === player.id) && player.raised && player.wrists.some(Boolean) && validLandmark(player.landmarks[11]) && validLandmark(player.landmarks[12]));
    const tooMany = raising.length > this.count - this.readyCount();
    const separated = raising.every((first, index) => raising.slice(index + 1).every(second => distance(first.center, second.center) >= Math.max(0.08, (first.shoulderWidth + second.shoulderWidth) * 0.35)));
    this.ambiguous = tooMany || !separated;
    const enrollingIds = new Set(!tooMany && separated ? raising.map(player => player.id) : []);
    for (const slot of this.slots) {
      if (slot.confirmed) continue;
      if (slot.hold.update(allowEnrollment && enrollingIds.has(slot.id), timestamp)) {
        slot.confirmed = true;
        slot.referenceAppearance = slot.appearance ? [...slot.appearance] : null;
        slot.referenceShoulderMeters = slot.realShoulderMeters;
      }
    }
    if (this.readyCount() >= this.count) this.lock();
    const eligible = this.locked ? [...observed.values()].filter(player => this.boundIds.has(player.id)) : [...confirmed, ...raising].slice(0, this.count);
    this.lastPlayers = eligible.sort((a, b) => a.id - b.id);
    this.diagnostic = this.locked ? this.canStart() ? 'ready' : 'partner_missing' : tooMany ? 'too_many_raising' : !separated ? 'not_separated' : raising.length ? 'holding' : candidates.length ? 'hand_not_raised' : 'no_player';
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
      referenceAppearance: null,
      referenceShoulderMeters: null,
      lastSeen: timestamp,
      observations: 0,
      present: true,
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
    if (!slot.confirmed && slot.observations === 2) slot.referenceAppearance = slot.appearance ? [...slot.appearance] : null;
    slot.present = true;
    slot.lastSeen = timestamp;
    slot.present = true;
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
