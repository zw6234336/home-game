import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRound, hit, pauseRound, resumeRound, advanceRound, miss } from '../src/game/round.ts';

test('two hands share one score and pausing freezes the round', () => {
  const initial = createRound();
  const scored = hit(initial, 'bubble-1');
  assert.equal(hit(scored, 'bubble-1').score, 10);
  const paused = pauseRound(scored);
  assert.deepEqual(advanceRound(paused, 3000), paused);
  assert.deepEqual(hit(paused, 'bubble-2'), paused);
  assert.equal(hit(resumeRound(paused), 'bubble-2').score, 20);
  assert.equal(initial.score, 0);
});

test('time and missed bubbles never create negative score or invalid state', () => {
  let round = hit(createRound(), 'one');
  round = miss(round);
  assert.equal(round.score, 10);
  assert.equal(round.combo, 0);
  for (const value of [-2, NaN, Infinity]) assert.deepEqual(advanceRound(round, value), round);
  const ended = advanceRound(round, 60001);
  assert.equal(ended.phase, 'results');
  assert.equal(ended.remainingMs, 0);
  assert.equal(hit(ended, 'two').score, 10);
});
