import test from 'node:test';
import assert from 'node:assert/strict';
import type { HandObservation, PoseObservation, StereoMeasurement } from '../src/types.ts';
import { FreeMotionTracker } from '../src/interaction/free-tracker.ts';
import { participantHands } from '../src/interaction/participant-hands.ts';
import { Calibration } from '../src/game/calibration.ts';
import { PrimaryController } from '../src/interaction/primary-controller.ts';

const red = [1, 0, 0, 0];
const blue = [0, 1, 0, 0];
const gray = [0, 0, 1, 0];
const green = [0, 0, 0, 1];
const measurement = (appearance: number[]): StereoMeasurement => ({ appearance, depthMeters: null, depthConfidence: 0, realShoulderMeters: null, disparityPx: null });
function pose(x: number, raised = false, width = 0.12): PoseObservation {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [index, dx, y] of [[0, 0, 0.2], [11, -0.5, 0.35], [12, 0.5, 0.35], [13, -0.7, 0.42], [14, 0.7, 0.42], [15, -0.8, raised ? 0.2 : 0.48], [16, 0.8, 0.48], [23, -0.35, 0.6], [24, 0.35, 0.6]]) landmarks[index] = { x: x + dx * width, y, visibility: 1 };
  return { landmarks };
}
function solo() {
  const tracker = new FreeMotionTracker(1);
  for (let t = 0; t <= 2100; t += 100) tracker.update([pose(0.3, true)], [measurement(red)], t);
  assert.equal(tracker.canStart(), true);
  return tracker;
}

test('one gesture participant is bound out of four visible people and post-lock waves cannot join', () => {
  const tracker = new FreeMotionTracker(1);
  let players = [] as ReturnType<FreeMotionTracker['update']>;
  for (let t = 0; t <= 2100; t += 100) players = tracker.update([pose(0.15), pose(0.4), pose(0.65, true), pose(0.85)], [measurement(gray), measurement(blue), measurement(red), measurement(green)], t);
  const id = players[0].id;
  assert.ok(Math.abs(players[0].center.x - 0.65) < 0.001);
  assert.deepEqual(tracker.bindingState(), { phase: 'bound', boundCount: 1, observedCount: 1, ignoredCount: 3, ambiguous: false });
  for (let t = 2200; t <= 5000; t += 100) {
    players = tracker.update([pose(0.15, true), pose(0.4, true), pose(0.65), pose(0.85, true)], [measurement(gray), measurement(blue), measurement(red), measurement(green)], t);
    assert.deepEqual(players.map(p => p.id), [id]);
  }
});

test('duo can prepare sequentially while two bystanders remain ignored', () => {
  const tracker = new FreeMotionTracker(2);
  for (let t = 0; t <= 2100; t += 100) tracker.update([pose(0.25, true), pose(0.7), pose(0.45), pose(0.88)], [measurement(red), measurement(blue), measurement(gray), measurement(green)], t);
  assert.equal(tracker.readyCount(), 1); assert.equal(tracker.canStart(), false);
  for (let t = 2200; t <= 4400; t += 100) tracker.update([pose(0.25), pose(0.7, true), pose(0.45), pose(0.88)], [measurement(red), measurement(blue), measurement(gray), measurement(green)], t);
  assert.equal(tracker.canStart(), true); assert.equal(tracker.boundPlayerIds().length, 2); assert.equal(tracker.bindingState().ignoredCount, 2);
});

test('excess preparation and duplicate detector poses cannot choose arbitrary members or fill duo capacity', () => {
  const tracker = new FreeMotionTracker(2);
  for (let t = 0; t <= 2400; t += 100) tracker.update([pose(0.2, true), pose(0.5, true), pose(0.8, true)], [measurement(red), measurement(blue), measurement(gray)], t);
  assert.equal(tracker.isLocked, false); assert.deepEqual(tracker.boundPlayerIds(), []); assert.equal(tracker.bindingState().ambiguous, true);
  const duplicate = new FreeMotionTracker(2);
  for (let t = 0; t <= 2400; t += 100) duplicate.update([pose(0.4, true), pose(0.4, true)], [measurement(red), measurement(red)], t);
  assert.equal(duplicate.canStart(), false); assert.equal(duplicate.readyCount(), 1);
});

test('a known similarly dressed spectator stays excluded when the participant is briefly occluded', () => {
  const tracker = new FreeMotionTracker(2);
  let players = [] as ReturnType<FreeMotionTracker['update']>;
  for (let t = 0; t <= 2100; t += 100) players = tracker.update([pose(0.3, true), pose(0.7, true), pose(0.5)], [measurement(red), measurement(blue), measurement(red)], t);
  const bound = tracker.boundPlayerIds(); const absentId = players.find(p => p.center.x < 0.5)!.id;
  for (const [time, x] of [[2200, 0.45], [2300, 0.4], [2400, 0.35], [2500, 0.3], [2600, 0.3]]) {
    players = tracker.update([pose(0.7), pose(x, true)], [measurement(blue), measurement(red)], time);
    assert.ok(players.every(p => p.id !== absentId)); assert.deepEqual(tracker.boundPlayerIds(), bound);
  }
  players = tracker.update([pose(0.8), pose(0.7), pose(0.3)], [measurement(red), measurement(blue), measurement(red)], 2700);
  assert.ok(players.some(p => p.id === absentId));
});

test('frozen enrollment references resist gradual appearance drift and copied measurement mutation', () => {
  const original = [...red]; const tracker = new FreeMotionTracker(1);
  for (let t = 0; t <= 2100; t += 100) tracker.update([pose(0.3, true)], [measurement(original)], t);
  const id = tracker.boundPlayerIds()[0]; original[0] = 0; original[1] = 1;
  for (const [time, angle] of [[2200, 0.3], [2300, 0.6], [2400, 0.9], [2500, 1.2]]) tracker.update([pose(0.3)], [measurement([Math.cos(angle), Math.sin(angle), 0, 0])], time);
  assert.equal(tracker.update([pose(0.3)], [measurement(blue)], 2600).some(p => p.id === id), false);
  assert.equal(tracker.update([pose(0.8)], [measurement([...red])], 2800)[0]?.id, id);
  const copy = tracker.boundPlayerIds(); copy[0] = 999;
  assert.deepEqual(tracker.boundPlayerIds(), [id]);
});

test('a bound roster does not mean an absent or shoulder-hidden participant is ready to start', () => {
  const tracker = solo(); const id = tracker.boundPlayerIds()[0];
  tracker.update([pose(0.8, true)], [measurement(gray)], 2200);
  assert.equal(tracker.isCalibrated(), true); assert.equal(tracker.canStart(), false); assert.deepEqual(tracker.boundPlayerIds(), [id]);
  const hidden = pose(0.3); hidden.landmarks[11].visibility = 0; hidden.landmarks[12].visibility = 0;
  tracker.update([hidden], [measurement(red)], 2300); assert.equal(tracker.canStart(), false);
});

test('preparation requires fresh continuous real shoulders and wrists and explicit enrollment permission', () => {
  const tracker = new FreeMotionTracker(1);
  for (let t = 0; t <= 2200; t += 100) tracker.update([pose(0.3, true)], [measurement(red)], t, false);
  assert.equal(tracker.isLocked, false);
  for (let t = 2300; t <= 3300; t += 100) tracker.update([pose(0.3, true)], [measurement(red)], t);
  for (let repeat = 0; repeat < 50; repeat++) tracker.update([pose(0.3, true)], [measurement(red)], 3300);
  const missing = pose(0.3, true); missing.landmarks[15].visibility = 0;
  tracker.update([missing], [measurement(red)], 3400);
  for (let t = 3500; t <= 5300; t += 100) tracker.update([pose(0.3, true)], [measurement(red)], t);
  assert.equal(tracker.isLocked, false);
  for (let t = 5400; t <= 5600; t += 100) tracker.update([pose(0.3, true)], [measurement(red)], t);
  assert.equal(tracker.canStart(), true);
});

test('only uniquely associated participant hands may enhance wrists or draw fine overlays', () => {
  const tracker = solo(); const players = tracker.update([pose(0.3)], [measurement(red)], 2200);
  const wrist = players[0].wrists[0]!;
  const hand = { landmarks: Array.from({ length: 21 }, () => ({ ...wrist, visibility: 1 })), handedness: 'Left' } satisfies HandObservation;
  assert.equal(participantHands([hand], players, true).length, 1);
  assert.equal(participantHands([hand], players, false).length, 0);
  assert.equal(participantHands([hand, structuredClone(hand)], players, true).length, 0);
  const outsider = structuredClone(hand); outsider.landmarks[0].x = 0.9;
  assert.equal(participantHands([outsider], players, true).length, 0);
});

test('strict reach calibration uses the same bound identities while bystanders move and gesture', () => {
  const tracker = solo(); const calibration = new Calibration(1); const id = tracker.boundPlayerIds()[0];
  let ready = false;
  for (let t = 2200; t <= 4500; t += 100) {
    const players = tracker.update([pose(0.3, true), pose(0.8, true)], [measurement(red), measurement(gray)], t);
    ready = ready ? calibration.adapt(players, t) : calibration.update(players, t);
    assert.deepEqual(players.map(p => p.id), [id]);
  }
  assert.equal(ready, true);
});

test('a similarly dressed bystander cannot finish another person preparation hold by moving into their position', () => {
  const tracker = new FreeMotionTracker(1);
  for (let t = 0; t <= 1800; t += 100) tracker.update([pose(0.3, true), pose(0.5)], [measurement(red), measurement(red)], t);
  tracker.update([pose(0.3, true), pose(0.4)], [measurement(red), measurement(red)], 1900);
  tracker.update([pose(0.3, true)], [measurement(red)], 2000);
  assert.equal(tracker.canStart(), false);
  for (let t = 2100; t <= 3900; t += 100) tracker.update([pose(0.3, true)], [measurement(red)], t);
  assert.equal(tracker.canStart(), false);
  for (let t = 4000; t <= 4200; t += 100) tracker.update([pose(0.3, true)], [measurement(red)], t);
  assert.equal(tracker.canStart(), true);
  assert.equal(tracker.boundPlayerIds().length, 1);
  assert.ok(Math.abs(tracker.update([pose(0.3)], [measurement(red)], 4300)[0].center.x - 0.3) < 0.001);
});

test('a same-outfit spectator sudden position jump cannot fill an absent participant or obtain their operator role', () => {
  const tracker = new FreeMotionTracker(2); const primary = new PrimaryController();
  const spectator = (x: number, raised = false) => { const value = pose(x, raised, 0.075); for (const point of value.landmarks) if (point.visibility) point.y += 0.15; return value; };
  for (let t = 0; t <= 2100; t += 100) {
    const players = tracker.update([pose(0.3, true), pose(0.7, true), spectator(0.1), pose(0.9)], [measurement(red), measurement(blue), measurement(red), measurement(gray)], t);
    primary.update(players, 2, tracker.isLocked);
  }
  assert.equal(tracker.canStart(), true); const members = tracker.boundPlayerIds(); const owner = primary.playerId;
  for (let t = 2200; t <= 2800; t += 100) {
    const players = tracker.update([pose(0.7), spectator(0.3, true), pose(0.9)], [measurement(blue), measurement(red), measurement(gray)], t);
    assert.ok(players.every(player => player.id !== owner));
    assert.equal(tracker.canStart(), false);
    assert.deepEqual(primary.update(players, 2, true), []);
    assert.deepEqual(tracker.boundPlayerIds(), members);
  }
});

test('a solo participant turning sideways cannot lose their binding merely because projected physical shoulder width shrinks', () => {
  const tracker = new FreeMotionTracker(1);
  const measured = (realShoulderMeters: number) => ({ ...measurement(red), depthMeters: 2, depthConfidence: 0.95, realShoulderMeters, disparityPx: 6 });
  for (let t = 0; t <= 2100; t += 100) tracker.update([pose(0.3, true, 0.12)], [measured(0.4)], t);
  const id = tracker.boundPlayerIds()[0];
  const turned = tracker.update([pose(0.3, false, 0.06)], [measured(0.2)], 2200);
  assert.deepEqual(turned.map(player => player.id), [id]);
  assert.equal(tracker.canStart(), true);
});
