export type Round = { phase: 'playing' | 'paused' | 'results'; remainingMs: number; score: number; hits: number; combo: number; bestCombo: number; consumed: string[] };

export function createRound(durationMs = 60000): Round {
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 60000;
  return { phase: 'playing', remainingMs: duration, score: 0, hits: 0, combo: 0, bestCombo: 0, consumed: [] };
}

export function hit(round: Round, id: string, points = 10): Round {
  if (round.phase !== 'playing' || typeof id !== 'string' || !id.trim() || round.consumed.includes(id)) return round;
  const value = Number.isFinite(points) && points > 0 ? Math.round(points) : 10;
  const combo = round.combo + 1;
  return { ...round, score: round.score + value, hits: round.hits + 1, combo, bestCombo: Math.max(combo, round.bestCombo), consumed: [...round.consumed, id] };
}

export function advanceRound(round: Round, deltaMs: number): Round {
  if (round.phase !== 'playing' || !Number.isFinite(deltaMs) || deltaMs < 0) return round;
  const remainingMs = Math.max(0, round.remainingMs - deltaMs);
  return { ...round, remainingMs, phase: remainingMs === 0 ? 'results' : 'playing' };
}

export function pauseRound(round: Round): Round { return round.phase === 'playing' ? { ...round, phase: 'paused' } : round; }
export function resumeRound(round: Round): Round { return round.phase === 'paused' ? { ...round, phase: 'playing' } : round; }
export function endRound(round: Round): Round { return { ...round, phase: 'results' }; }
export function miss(round: Round): Round { return round.phase === 'playing' ? { ...round, combo: 0 } : round; }
export function penalty(round: Round, id: string, points = 20): Round {
  if (round.phase !== 'playing' || typeof id !== 'string' || !id.trim() || round.consumed.includes(id)) return round;
  const value = Number.isFinite(points) && points > 0 ? Math.round(points) : 20;
  return { ...round, score: Math.max(0, round.score - value), combo: 0, consumed: [...round.consumed, id] };
}
