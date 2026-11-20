import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerTracker } from '../src/interaction/tracker.ts';
import { Calibration } from '../src/game/calibration.ts';
import type { Landmark, PoseObservation, TrackedPlayer } from '../src/types.ts';

function person(x = 0.5, width = 0.14, hips = true, shoulders = true): PoseObservation {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x, y: 0.5, visibility: 0 }));
  landmarks[11] = { x: x - width / 2, y: 0.23, visibility: shoulders ? 1 : 0 };
  landmarks[12] = { x: x + width / 2, y: 0.23, visibility: shoulders ? 1 : 0 };
  landmarks[15] = { x: x - width * 0.7, y: 0.17, visibility: 1 };
  landmarks[16] = { x: x + width * 0.7, y: 0.4, visibility: 1 };
  landmarks[23] = { x: x - width / 3, y: 0.83, visibility: hips ? 1 : 0 };
  landmarks[24] = { x: x + width / 3, y: 0.83, visibility: hips ? 1 : 0 };
  return { landmarks };
}

function prepare(observations: PoseObservation[]) {
  const tracker = new PlayerTracker(observations.length as 1 | 2);
  const calibration = new Calibration(observations.length as 1 | 2);
  let players: TrackedPlayer[] = [];
  for (let time = 0; time <= 2000; time += 100) {
    players = tracker.update(observations, time);
    calibration.update(players, time);
  }
  assert.equal(calibration.matches(players), true);
  return { tracker, calibration, ids: players.map(player => player.id), zones: calibration.zones(players, true) };
}

test('ready players keep identity and reach through alternating full and half body observations', () => {
  for (const centers of [[0.5], [0.25, 0.75]]) {
    const { tracker, calibration, ids, zones } = prepare(centers.map(x => person(x)));
    for (let frame = 1; frame <= 90; frame++) {
      const observations = centers.map((x, index) => person(x, 0.14, (frame + index) % 2 === 0));
      if (frame % 2) observations.reverse();
      const players = tracker.update(observations, 2000 + frame * 70);
      assert.deepEqual(players.map(player => player.id), ids);
      assert.equal(calibration.adapt(players, 2000 + frame * 70), true);
      assert.deepEqual(calibration.zones(players, true), zones);
    }
  }
});

test('brief missing shoulders preserve identity through a shared hip anchor without scoring', () => {
  const { tracker, calibration, ids } = prepare([person()]);
  for (let time = 2100; time <= 2400; time += 100) {
    const players = tracker.update([person(0.5, 0.14, true, false)], time);
    assert.deepEqual(players.map(player => player.id), ids);
    assert.equal(calibration.adapt(players, time), false);
    assert.deepEqual(calibration.verifiedPlayers(players), []);
  }
  const recovered = tracker.update([person()], 2500);
  assert.deepEqual(recovered.map(player => player.id), ids);
  assert.equal(calibration.adapt(recovered, 2500), true);
});

test('brief scale noise suspends scoring without replacing the calibrated anchor', () => {
  const { tracker, calibration, zones } = prepare([person()]);
  for (let time = 2070; time <= 2210; time += 70) {
    const noisy = tracker.update([person(0.5, 0.14 * 1.12)], time);
    assert.equal(calibration.adapt(noisy, time), false);
    assert.deepEqual(calibration.verifiedPlayers(noisy), []);
    assert.throws(() => calibration.zones(noisy, true));
  }
  const recovered = tracker.update([person()], 2280);
  assert.equal(calibration.adapt(recovered, 2280), true);
  assert.deepEqual(calibration.zones(recovered, true), zones);
});

test('rejected jitter cannot keep calibration alive past the observation deadline', () => {
  const { tracker, calibration } = prepare([person()]);
  for (let time = 2070; time <= 2560; time += 70) {
    assert.equal(calibration.adapt(tracker.update([person(0.5, 0.14 * 1.3)], time), time), false);
  }
  const returned = tracker.update([person()], 2630);
  assert.equal(calibration.adapt(returned, 2630), false);
});

test('a missing person and a different body cannot reuse readiness after a visibility change', () => {
  const { tracker, calibration, ids } = prepare([person(0.5, 0.28)]);
  const half = tracker.update([person(0.5, 0.28, false)], 2100);
  assert.deepEqual(half.map(player => player.id), ids);
  assert.equal(calibration.adapt(half, 2100), true);
  assert.equal(calibration.adapt(tracker.update([], 2200), 2200), false);
  const child = tracker.update([person(0.5, 0.08)], 2300);
  assert.notDeepEqual(child.map(player => player.id), ids);
  assert.equal(calibration.adapt(child, 2300), false);
  assert.deepEqual(calibration.verifiedPlayers(child), []);
});
