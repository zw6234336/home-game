import type { TrackedPlayer } from '../types.ts';
import { evaluatePose, POSE_CHALLENGES } from './pose-match.ts';
import type { PoseId } from './pose-match.ts';
import type { SpaceMode } from './space.ts';

export type PosePlayerState = { id: number; progress: number; ready: boolean; matched: boolean; hint: string };
export type PoseResult = { id: PoseId; status: 'matched' | 'timeout' | 'skipped'; score: 0 | 100 };
export type PoseSnapshot = {
  spaceMode: SpaceMode;
  phase: 'playing' | 'paused' | 'results';
  stage: 'pose' | 'celebrate';
  index: number;
  total: number;
  target: PoseId;
  remainingMs: number;
  elapsedMs: number;
  score: number;
  completed: number;
  results: PoseResult[];
  players: PosePlayerState[];
};

type PlayerState = PosePlayerState & { startedAt: number | null };

export class PoseSession {
  private readonly spaceMode: SpaceMode;
  private readonly gentle: boolean;
  private readonly holdMs: number;
  private readonly questionMs: number;
  private phase: PoseSnapshot['phase'] = 'playing';
  private stage: PoseSnapshot['stage'] = 'pose';
  private index = 0;
  private remainingMs: number;
  private celebrationMs = 0;
  private elapsedMs = 0;
  private score = 0;
  private completed = 0;
  private results: PoseResult[] = [];
  private players: PlayerState[];
  private lastAt: number | null = null;

  constructor(playerIds: number[], gentle: boolean, spaceMode: SpaceMode = 'standard') {
    if (!Array.isArray(playerIds) || playerIds.length < 1 || playerIds.length > 2 || playerIds.some(id => !Number.isInteger(id) || id <= 0) || new Set(playerIds).size !== playerIds.length) throw new RangeError('A session requires one or two unique positive integer player IDs');
    if (typeof gentle !== 'boolean') throw new TypeError('Gentle mode must be a boolean');
    this.gentle = gentle;
    this.spaceMode = spaceMode;
    this.holdMs = gentle ? 1000 : 1400;
    this.questionMs = gentle ? 20000 : 16000;
    this.remainingMs = this.questionMs;
    this.players = playerIds.map(id => ({ id, progress: 0, ready: false, matched: false, hint: '跟着示范，轻松摆好动作', startedAt: null }));
  }

  get snapshot(): PoseSnapshot {
    return {
      spaceMode: this.spaceMode,
      phase: this.phase,
      stage: this.stage,
      index: this.index,
      total: POSE_CHALLENGES.length,
      target: POSE_CHALLENGES[this.index].id,
      remainingMs: this.remainingMs,
      elapsedMs: this.elapsedMs,
      score: this.score,
      completed: this.completed,
      results: this.results.map(result => ({ ...result })),
      players: this.players.map(player => ({ id: player.id, progress: player.progress, ready: player.ready, matched: player.matched, hint: player.hint })),
    };
  }

  update(players: TrackedPlayer[], capturedAt: number, aspectRatio: number): void {
    if (this.phase !== 'playing' || this.stage !== 'pose' || !Number.isFinite(capturedAt) || (this.lastAt !== null && capturedAt <= this.lastAt)) return;
    const interrupted = this.lastAt !== null && capturedAt - this.lastAt > 150;
    this.lastAt = capturedAt;
    const observations = Array.isArray(players) ? players : [];
    for (const player of this.players) {
      const matches = observations.filter(observation => observation?.id === player.id);
      if (matches.length !== 1) {
        this.clearPlayer(player);
        player.hint = '请回到画面里，和同伴一起完成';
        continue;
      }
      const result = evaluatePose(POSE_CHALLENGES[this.index].id, matches[0].landmarks, this.gentle, aspectRatio, this.spaceMode);
      player.matched = result.matched;
      if (player.ready) {
        player.hint = '完成啦，放松一下等同伴';
        continue;
      }
      player.hint = result.hint;
      if (interrupted || !result.matched) {
        player.startedAt = null;
        player.progress = 0;
      }
      if (!result.matched) continue;
      player.startedAt ??= capturedAt;
      player.progress = Math.min(1, Math.max(0, (capturedAt - player.startedAt) / this.holdMs));
      if (player.progress >= 1) {
        player.ready = true;
        player.hint = '完成啦，放松一下等同伴';
      }
    }
    if (this.players.every(player => player.ready)) this.settle('matched');
  }

  advance(deltaMs: number): void {
    if (this.phase !== 'playing' || !Number.isFinite(deltaMs) || deltaMs < 0) return;
    let rest = deltaMs;
    while (rest > 0 && this.phase === 'playing') {
      if (this.stage === 'pose') {
        const consumed = Math.min(rest, this.remainingMs);
        this.remainingMs -= consumed;
        this.elapsedMs += consumed;
        rest -= consumed;
        if (this.remainingMs === 0) this.settle('timeout');
      } else {
        const consumed = Math.min(rest, this.celebrationMs);
        this.celebrationMs -= consumed;
        this.elapsedMs += consumed;
        rest -= consumed;
        if (this.celebrationMs === 0) this.next();
      }
    }
  }

  pause(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.clearUnfinished();
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.clearUnfinished();
  }

  end(): void {
    if (this.phase === 'results') return;
    this.phase = 'results';
    this.remainingMs = 0;
  }

  skip(): void {
    if (this.phase !== 'results' && this.stage === 'pose') this.settle('skipped');
  }

  private settle(status: PoseResult['status']): void {
    if (this.stage !== 'pose' || this.phase === 'results') return;
    const score = status === 'matched' ? 100 : 0;
    this.results.push({ id: POSE_CHALLENGES[this.index].id, status, score });
    this.score += score;
    if (status === 'matched') this.completed += 1;
    this.stage = 'celebrate';
    this.celebrationMs = 1200;
  }

  private next(): void {
    if (this.index + 1 === POSE_CHALLENGES.length) {
      this.phase = 'results';
      this.remainingMs = 0;
      return;
    }
    this.index += 1;
    this.stage = 'pose';
    this.remainingMs = this.questionMs;
    for (const player of this.players) this.clearPlayer(player);
  }

  private clearPlayer(player: PlayerState): void {
    player.progress = 0;
    player.ready = false;
    player.matched = false;
    player.startedAt = null;
    player.hint = '跟着示范，轻松摆好动作';
  }

  private clearUnfinished(): void {
    for (const player of this.players) if (!player.ready) this.clearPlayer(player);
  }
}
