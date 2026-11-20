import test from 'node:test';
import assert from 'node:assert/strict';
import type { Landmark, PoseObservation, TrackedPlayer } from '../src/types.ts';
import { PlayerTracker } from '../src/interaction/tracker.ts';
import { Calibration } from '../src/game/calibration.ts';
import { PoseSession } from '../src/game/pose-session.ts';

type Shape = 'raised' | 'airplane' | 'rest';

function observation(x: number, shape: Shape, options: { width?: number; hideWrists?: boolean } = {}): PoseObservation {
  const width = options.width ?? 0.1;
  const shoulder = 0.4;
  const shapes: Record<Shape, number[][]> = {
    raised: [[-1, 0], [1, 0], [-1, -0.8], [1, -0.8]],
    airplane: [[-1.05, 0], [1.05, 0], [-1.7, 0], [1.7, 0]],
    rest: [[-0.6, 0.55], [0.6, 0.55], [-0.65, 1.05], [0.65, 1.05]],
  };
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x, y: shoulder, visibility: 0 }));
  [[-0.5, 0], [0.5, 0], ...shapes[shape]].forEach(([dx, dy], index) => {
    landmarks[index + 11] = { x: x + dx * width, y: shoulder + dy * width, visibility: 1 };
  });
  landmarks[23] = { x: x - width * 0.4, y: 0.65, visibility: 1 };
  landmarks[24] = { x: x + width * 0.4, y: 0.65, visibility: 1 };
  if (options.hideWrists) {
    landmarks[15].visibility = 0;
    landmarks[16].visibility = 0;
  }
  return { landmarks };
}

function calibratedPair() {
  const tracker = new PlayerTracker(2);
  const calibration = new Calibration(2);
  let players: TrackedPlayer[] = [];
  for (let time = 0; time <= 2000; time += 100) {
    players = tracker.update([observation(0.25, 'raised'), observation(0.75, 'raised')], time);
    calibration.update(players, time);
  }
  assert.equal(calibration.matches(players), true);
  const ids = players.map(player => player.id);
  const session = new PoseSession(ids, true);
  const frame = (poses: PoseObservation[], time: number) => {
    const tracked = tracker.update(poses, time);
    const verified = calibration.verifiedPlayers(tracked);
    session.update(verified, time, 1);
    return { tracked, verified, snapshot: session.snapshot };
  };
  return { tracker, calibration, session, ids, frame };
}

test('a completed partner can lower invisible wrists while the other partner finishes', () => {
  const { frame, session, calibration, ids } = calibratedPair();
  for (let time = 2100; time <= 3100; time += 100) frame([observation(0.25, 'airplane'), observation(0.75, 'rest')], time);
  assert.equal(session.snapshot.players[0].ready, true);
  assert.equal(session.snapshot.players[1].ready, false);
  for (let time = 3200; time <= 4200; time += 100) {
    const result = frame([observation(0.25, 'rest', { hideWrists: true }), observation(0.75, 'airplane')], time);
    assert.deepEqual(result.tracked[0].wrists, [null, null]);
    assert.deepEqual(result.verified.map(player => player.id), ids);
    assert.equal(calibration.matches(result.tracked), true);
    assert.equal(result.snapshot.players[0].ready, true);
  }
  assert.equal(session.snapshot.score, 100);
  assert.equal(session.snapshot.completed, 1);
});

test('one absent partner resets only their own hold while the completed partner stays ready', () => {
  const { frame, session, ids } = calibratedPair();
  for (let time = 2100; time <= 3100; time += 100) frame([observation(0.25, 'airplane'), observation(0.75, 'rest')], time);
  for (let time = 3200; time <= 3500; time += 100) frame([observation(0.25, 'rest'), observation(0.75, 'airplane')], time);
  assert.equal(session.snapshot.players[1].progress, 0.3);
  const missing = frame([observation(0.25, 'rest')], 3600);
  assert.deepEqual(missing.verified.map(player => player.id), [ids[0]]);
  assert.equal(missing.snapshot.players[0].ready, true);
  assert.equal(missing.snapshot.players[1].ready, false);
  assert.equal(missing.snapshot.players[1].progress, 0);
  const returned = frame([observation(0.25, 'rest'), observation(0.75, 'airplane')], 3700);
  assert.deepEqual(returned.tracked.map(player => player.id), ids);
  assert.equal(returned.snapshot.players[0].ready, true);
  assert.equal(returned.snapshot.players[1].progress, 0);
  for (let time = 3800; time <= 4600; time += 100) frame([observation(0.25, 'rest'), observation(0.75, 'airplane')], time);
  assert.equal(session.snapshot.score, 0);
  frame([observation(0.25, 'rest'), observation(0.75, 'airplane')], 4700);
  assert.equal(session.snapshot.score, 100);
});

test('visible body identity alone cannot complete an unfinished pose with hidden wrists', () => {
  const { frame, session } = calibratedPair();
  for (let time = 2100; time <= 4100; time += 100) {
    const result = frame([observation(0.25, 'airplane', { hideWrists: true }), observation(0.75, 'airplane')], time);
    assert.equal(result.verified.length, 2);
  }
  assert.equal(session.snapshot.players[0].ready, false);
  assert.equal(session.snapshot.players[0].progress, 0);
  assert.equal(session.snapshot.players[1].ready, true);
  assert.equal(session.snapshot.score, 0);
});

test('a new tracked identity cannot inherit its absent predecessor calibration or ready state', () => {
  const { frame, session, ids } = calibratedPair();
  for (let time = 2100; time <= 3100; time += 100) frame([observation(0.25, 'airplane'), observation(0.75, 'rest')], time);
  assert.equal(session.snapshot.players[0].ready, true);
  for (let time = 3200; time <= 3700; time += 100) frame([observation(0.75, 'rest')], time);
  const replacement = frame([observation(0.25, 'airplane'), observation(0.75, 'airplane')], 3800);
  assert.ok(replacement.tracked.some(player => player.id !== ids[0] && player.id !== ids[1]));
  assert.deepEqual(replacement.verified.map(player => player.id), [ids[1]]);
  assert.equal(replacement.snapshot.players[0].ready, false);
  for (let time = 3900; time <= 4900; time += 100) frame([observation(0.25, 'airplane'), observation(0.75, 'airplane')], time);
  assert.equal(session.snapshot.players[1].ready, true);
  assert.equal(session.snapshot.score, 0);
});

test('changed body size or position invalidates only its corresponding calibrated player', () => {
  for (const changed of [observation(0.25, 'airplane', { width: 0.065 }), observation(0.38, 'airplane')]) {
    const { frame, session, ids } = calibratedPair();
    for (let time = 2100; time <= 3100; time += 100) frame([observation(0.25, 'airplane'), observation(0.75, 'rest')], time);
    assert.equal(session.snapshot.players[0].ready, true);
    const invalid = frame([changed, observation(0.75, 'airplane')], 3200);
    assert.deepEqual(invalid.tracked.map(player => player.id), ids);
    assert.deepEqual(invalid.verified.map(player => player.id), [ids[1]]);
    assert.equal(invalid.snapshot.players[0].ready, false);
    for (let time = 3300; time <= 4300; time += 100) frame([changed, observation(0.75, 'airplane')], time);
    assert.equal(session.snapshot.players[1].ready, true);
    assert.equal(session.snapshot.score, 0);
  }
});
