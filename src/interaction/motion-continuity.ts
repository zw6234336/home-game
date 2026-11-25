import type { Landmark, Point, TrackedPlayer } from '../types.ts';
import { validLandmark } from './geometry.ts';

type JointHistory = { point: Landmark; anchor: Point; velocity: Point; at: number };
type History = { player: TrackedPlayer; velocity: Point; at: number; joints: Map<number, JointHistory> };
export type MotionRequirements = { joints: readonly number[]; hands: 0 | 1 | 2 };
export type ContinuousMotion = { players: TrackedPlayer[]; inferred: boolean; protected: boolean; recovered: boolean };
const bodyJoints = new Set([0, 7, 8, 11, 12, 23, 24]);
const actionJoints = [11, 12, 13, 14, 15, 16];
const blank = (): ContinuousMotion => ({ players: [], inferred: false, protected: true, recovered: false });
const bounded = (value: number) => Math.max(-1.5, Math.min(1.5, value));
const clone = (player: TrackedPlayer): TrackedPlayer => ({ ...player, center: { ...player.center }, landmarks: player.landmarks.map(point => ({ ...point })), wrists: player.wrists.map(point => point ? { ...point } : null) as TrackedPlayer['wrists'] });

function velocity(previous: Point, current: Point, elapsed: number): Point {
  return elapsed > 0 && elapsed <= 200 ? { x: bounded((current.x - previous.x) * 1000 / elapsed), y: bounded((current.y - previous.y) * 1000 / elapsed) } : { x: 0, y: 0 };
}

function extrapolate(point: Point, speed: Point, elapsed: number): Point | null {
  const horizon = 0.18 * (1 - Math.exp(-elapsed / 180));
  const next = { x: point.x + speed.x * horizon, y: point.y + speed.y * horizon };
  return next.x >= 0 && next.x <= 1 && next.y >= 0 && next.y <= 1 ? next : null;
}

export class MotionContinuity {
  private histories = new Map<number, History>();
  private lastAt: number | null = null;
  private protectUntil = 0;
  private gap = false;
  private last = blank();

  reset(): void {
    this.histories.clear(); this.lastAt = null; this.protectUntil = 0; this.gap = false; this.last = blank();
  }

  update(observed: TrackedPlayer[], timestamp: number, requirements: MotionRequirements = { joints: actionJoints, hands: 2 }): ContinuousMotion {
    if (!Number.isFinite(timestamp) || this.lastAt !== null && timestamp < this.lastAt) { this.reset(); return blank(); }
    if (timestamp === this.lastAt) return { ...this.last, players: this.last.players.map(clone) };
    this.lastAt = timestamp;
    const unique = observed.filter(player => observed.filter(other => other.id === player.id).length === 1);
    const actual = new Map(unique.map(player => [player.id, player]));
    let inferred = false;
    let criticalInference = false;
    const critical = (index: number) => requirements.joints.includes(index) || requirements.hands > 0 && (index === 15 || index === 16);
    let gap = unique.length === 0;
    const players: TrackedPlayer[] = [];
    for (const raw of unique) {
      const player = clone(raw);
      let history = this.histories.get(player.id);
      const elapsed = history ? timestamp - history.at : 0;
      if (history && elapsed > 0 && elapsed <= 200) {
        const previousJoints = history.joints;
        const shifts = [11, 12, 23, 24].flatMap(index => {
          const previous = previousJoints.get(index);
          const current = raw.landmarks[index];
          return previous && timestamp - previous.at <= 200 && validLandmark(current) ? [{ x: current.x - previous.point.x, y: current.y - previous.point.y }] : [];
        });
        if (shifts.length) player.center = { x: history.player.center.x + shifts.reduce((sum, point) => sum + point.x, 0) / shifts.length, y: history.player.center.y + shifts.reduce((sum, point) => sum + point.y, 0) / shifts.length };
      }
      const jumped = history && (Math.hypot(player.center.x - history.player.center.x, player.center.y - history.player.center.y) > 0.25 || player.shoulderWidth / history.player.shoulderWidth > 2 || player.shoulderWidth / history.player.shoulderWidth < 0.5);
      if (!history || jumped) {
        history = { player: clone(raw), velocity: { x: 0, y: 0 }, at: timestamp, joints: new Map() };
        if (jumped) { gap = true; this.protectUntil = timestamp + 200; }
        this.histories.set(player.id, history);
      }
      const bodyVelocity = velocity(history.player.center, player.center, elapsed);
      for (let index = 0; index < player.landmarks.length; index += 1) {
        const source = raw.landmarks[index];
        const wrist = index === 15 || index === 16 ? raw.wrists[index - 15] : undefined;
        const current = wrist === null ? { ...source, visibility: 0 } : source;
        if (wrist === null) player.landmarks[index] = current;
        const previous = history.joints.get(index);
        if (validLandmark(current)) {
          const jointVelocity = previous ? velocity(previous.point, current, timestamp - previous.at) : { x: 0, y: 0 };
          history.joints.set(index, { point: { ...current }, anchor: { ...player.center }, velocity: { x: bounded(jointVelocity.x - bodyVelocity.x), y: bounded(jointVelocity.y - bodyVelocity.y) }, at: timestamp });
        } else if (previous && timestamp - previous.at <= (bodyJoints.has(index) ? 400 : 250)) {
          const point = extrapolate({ x: previous.point.x + player.center.x - previous.anchor.x, y: previous.point.y + player.center.y - previous.anchor.y }, previous.velocity, timestamp - previous.at);
          if (point) { player.landmarks[index] = { ...previous.point, ...point }; inferred = true; criticalInference ||= critical(index); }
        }
      }
      for (let side = 0; side < 2; side += 1) {
        if (!raw.wrists[side] || !validLandmark(raw.landmarks[15 + side])) {
          const joint = player.landmarks[15 + side];
          player.wrists[side] = validLandmark(joint) ? { x: joint.x, y: joint.y } : null;
          if (player.wrists[side]) { inferred = true; criticalInference ||= requirements.hands > 0; }
        }
      }
      if (requirements.joints.some(index => !validLandmark(raw.landmarks[index])) || raw.wrists.filter(Boolean).length < requirements.hands) gap = true;
      history.player = { ...clone(raw), center: { ...player.center } }; history.velocity = bodyVelocity; history.at = timestamp;
      players.push(player);
    }
    for (const [id, history] of this.histories) {
      if (actual.has(id)) continue;
      gap = true;
      const elapsed = timestamp - history.at;
      if (elapsed > 400) { this.histories.delete(id); continue; }
      const center = extrapolate(history.player.center, history.velocity, elapsed);
      if (!center) continue;
      const player = clone(history.player);
      player.center = center;
      player.landmarks = player.landmarks.map((point, index) => {
        const joint = history.joints.get(index);
        if (!joint || timestamp - joint.at > (bodyJoints.has(index) ? 400 : 250)) return { ...point, visibility: 0 };
        const predicted = extrapolate({ x: joint.point.x + center.x - joint.anchor.x, y: joint.point.y + center.y - joint.anchor.y }, joint.velocity, timestamp - joint.at);
        return predicted ? { ...joint.point, ...predicted } : { ...point, visibility: 0 };
      });
      player.wrists = [15, 16].map(index => validLandmark(player.landmarks[index]) ? { x: player.landmarks[index].x, y: player.landmarks[index].y } : null) as TrackedPlayer['wrists'];
      player.raised = false; player.bothRaised = false;
      players.push(player); inferred = true;
    }
    const recovered = this.gap && !gap && !criticalInference;
    if (gap || criticalInference || recovered) this.protectUntil = timestamp + 200;
    this.gap = gap || criticalInference;
    this.last = { players, inferred, protected: gap || criticalInference || timestamp < this.protectUntil, recovered };
    return { ...this.last, players: players.map(clone) };
  }
}
