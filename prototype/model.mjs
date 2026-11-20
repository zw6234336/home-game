export function createRound() {
  return { phase: 'playing', remainingMs: 60000, score: 0, hits: 0, combo: 0, bestCombo: 0, consumed: [] };
}

export function hit(round, id) {
  if (round.phase !== 'playing' || typeof id !== 'string' || !id.trim() || round.consumed.includes(id)) return round;
  const combo = round.combo + 1;
  return { ...round, score: round.score + 10, hits: round.hits + 1, combo, bestCombo: Math.max(combo, round.bestCombo), consumed: [...round.consumed, id] };
}

export function advanceRound(round, deltaMs) {
  if (round.phase !== 'playing' || !Number.isFinite(deltaMs) || deltaMs < 0) return round;
  const remainingMs = Math.max(0, round.remainingMs - deltaMs);
  return { ...round, remainingMs, phase: remainingMs === 0 ? 'results' : 'playing' };
}

export function pauseRound(round) {
  return round.phase === 'playing' ? { ...round, phase: 'paused' } : round;
}

export function resumeRound(round) {
  return round.phase === 'paused' ? { ...round, phase: 'playing' } : round;
}

export function endRound(round) {
  return { ...round, phase: 'results' };
}

export function miss(round) {
  return round.phase === 'playing' ? { ...round, combo: 0 } : round;
}
