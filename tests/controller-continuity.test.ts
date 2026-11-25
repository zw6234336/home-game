import test from 'node:test';
import assert from 'node:assert/strict';
import type { TrackedPlayer } from '../src/types.ts';
import { PrimaryController } from '../src/interaction/primary-controller.ts';
import { MotionContinuity } from '../src/interaction/motion-continuity.ts';
import { BodyMenuController } from '../src/interaction/body-menu.ts';
import { gameMotionRequirements, supportsRequiredMotion, supportsGateJudgement } from '../src/game/motion-policy.ts';
import { SpaceGatesField } from '../src/game/space-gates.ts';
import { FreeMotionTracker } from '../src/interaction/free-tracker.ts';

function player(id: number, x = 0.3): TrackedPlayer {
  const landmarks = Array.from({ length: 33 }, () => ({ x, y: 0.5, visibility: 0 }));
  for (const [index, dx, y] of [[0, 0, 0.2], [11, -0.08, 0.35], [12, 0.08, 0.35], [13, -0.12, 0.45], [14, 0.12, 0.45], [15, -0.14, 0.55], [16, 0.14, 0.55], [23, -0.06, 0.65], [24, 0.06, 0.65]]) landmarks[index] = { x: x + dx, y, visibility: 1 };
  return { id, center: { x, y: 0.5 }, shoulderWidth: 0.16, landmarks, wrists: [{ x: x - 0.14, y: 0.55 }, { x: x + 0.14, y: 0.55 }], raised: false, bothRaised: false };
}

function hide(value: TrackedPlayer, indices: number[]): TrackedPlayer {
  for (const index of indices) value.landmarks[index].visibility = 0;
  if (indices.includes(15)) value.wrists[0] = null;
  if (indices.includes(16)) value.wrists[1] = null;
  return value;
}

test('screen-right operator uses mirrored shoulders and locks identity through crossing and reordered results', () => {
  const control = new PrimaryController();
  const right = player(7, 0.25); const left = player(2, 0.75);
  assert.deepEqual(control.update([left, right], 2, true).map(p => p.id), [7]);
  assert.equal(control.isLocked, true);
  assert.deepEqual(control.update([player(2, 0.2), player(7, 0.8)], 2).map(p => p.id), [7]);
  assert.equal(control.playerId, 7);
});

test('missing locked operator cannot be replaced by partner or a newly tracked identity', () => {
  const control = new PrimaryController();
  control.update([player(1, 0.25), player(2, 0.75)], 2, true);
  assert.deepEqual(control.update([player(2, 0.75)], 2), []);
  assert.equal(control.missing, true);
  assert.deepEqual(control.update([player(3, 0.25), player(2, 0.75)], 2), []);
  assert.deepEqual(control.update([player(1, 0.8), player(2, 0.2)], 2).map(p => p.id), [1]);
});

test('operator selection waits for both reliable bodies and resets for a new solo or calibration session', () => {
  const control = new PrimaryController();
  assert.deepEqual(control.update([player(1)], 2), []);
  assert.deepEqual(control.update([player(1), hide(player(2, 0.7), [11])], 2), []);
  assert.deepEqual(control.update([player(1), player(1)], 2), []);
  control.update([player(1, 0.25), player(2, 0.75)], 2, true);
  assert.deepEqual(control.update([player(2, 0.75)], 1, true).map(p => p.id), [2]);
  control.reset();
  assert.equal(control.playerId, null);
  assert.equal(control.isLocked, false);
});

test('short hand loss follows real body motion with bounded inferred joints and failure protection', () => {
  const continuity = new MotionContinuity();
  continuity.update([player(1, 0.3)], 0);
  continuity.update([player(1, 0.31)], 100);
  const result = continuity.update([hide(player(1, 0.33), [13, 15])], 200);
  assert.equal(result.inferred, true);
  assert.equal(result.protected, true);
  assert.ok(Math.abs(result.players[0].wrists[0]!.x - 0.19) < 0.025);
  assert.ok(result.players[0].landmarks[13].visibility >= 0.5);
  assert.equal(result.players[0].id, 1);
});

test('repeated missing frames never renew the hand or body prediction deadline', () => {
  const continuity = new MotionContinuity();
  continuity.update([player(1)], 0);
  for (const t of [50, 100, 150, 200, 250]) assert.ok(continuity.update([hide(player(1), [15])], t).players[0].wrists[0]);
  assert.equal(continuity.update([hide(player(1), [15])], 251).players[0].wrists[0], null);
  const body = new MotionContinuity(); body.update([player(1)], 0);
  for (const t of [100, 200, 300, 400]) assert.equal(body.update([], t).players.length, 1);
  assert.equal(body.update([], 401).players.length, 0);
  assert.equal(body.update([], 1000).players.length, 0);
});

test('rejected wrist observations cannot refresh or bypass the inference horizon', () => {
  const continuity = new MotionContinuity();
  continuity.update([player(1)], 0);
  const next = (t: number) => { const p = player(1); p.wrists[0] = null; return continuity.update([p], t); };
  assert.ok(next(100).players[0].wrists[0]);
  assert.equal(next(251).players[0].wrists[0], null);
  assert.equal(next(300).protected, true);
});

test('body inference has decaying bounded displacement and never creates menu raise actions', () => {
  const continuity = new MotionContinuity();
  continuity.update([player(1, 0.3)], 0);
  continuity.update([player(1, 0.4)], 100);
  const result = continuity.update([], 250);
  assert.ok(result.players[0].center.x > 0.4);
  assert.ok(result.players[0].center.x <= 0.67);
  assert.equal(result.players[0].raised, false);
  assert.equal(result.players[0].bothRaised, false);
});

test('real recovery clears trails once and protects failure decisions for 200ms', () => {
  const continuity = new MotionContinuity();
  continuity.update([player(1)], 0);
  continuity.update([hide(player(1), [15])], 100);
  const restored = continuity.update([player(1)], 150);
  assert.equal(restored.recovered, true);
  assert.equal(restored.inferred, false);
  assert.equal(restored.protected, true);
  assert.equal(continuity.update([player(1)], 250).recovered, false);
  assert.equal(continuity.update([player(1)], 349).protected, true);
  assert.equal(continuity.update([player(1)], 350).protected, false);
});

test('prediction history resets on invalid clock, backwards time and explicit session reset', () => {
  const continuity = new MotionContinuity();
  continuity.update([player(1)], 100);
  assert.equal(continuity.update([], 90).players.length, 0);
  assert.equal(continuity.update([], 110).players.length, 0);
  continuity.update([player(1)], 200);
  continuity.reset();
  assert.equal(continuity.update([], 250).players.length, 0);
  continuity.update([player(1)], 300);
  assert.equal(continuity.update([], NaN).players.length, 0);
});

test('duplicate timestamps and returned objects cannot mutate or extend the real motion history', () => {
  const continuity = new MotionContinuity();
  continuity.update([player(1)], 0);
  const first = continuity.update([], 100);
  first.players[0].landmarks[15].x = 0.99;
  const repeated = continuity.update([player(1, 0.7)], 100);
  assert.notEqual(repeated.players[0].landmarks[15].x, 0.99);
  assert.equal(continuity.update([], 401).players.length, 0);
});

test('switching between full and partial torso observations does not fabricate body movement', () => {
  const continuity = new MotionContinuity();
  continuity.update([player(1)], 0);
  const half = hide(player(1), [23, 24]); half.center.y = 0.35;
  const result = continuity.update([half], 100);
  assert.ok(Math.abs(result.players[0].center.y - 0.5) < 0.001);
  assert.ok(Math.abs(result.players[0].landmarks[23].y - 0.65) < 0.001);
  const returned = continuity.update([player(1)], 200);
  assert.ok(Math.abs(returned.players[0].center.y - 0.5) < 0.001);
});

test('nonessential elbows and hips do not stall shoulder and wrist games', () => {
  const continuity = new MotionContinuity();
  const needs = { joints: [11, 12], hands: 1 as const };
  continuity.update([player(1)], 0, needs);
  for (const t of [100, 300, 500, 700]) {
    const result = continuity.update([hide(player(1), [13, 14, 23, 24])], t, needs);
    assert.equal(result.protected, false);
  }
});

test('one reliable hand resumes after optional hand inference expires, while zero hands remain protected', () => {
  const continuity = new MotionContinuity();
  const needs = { joints: [11, 12], hands: 1 as const };
  continuity.update([player(1)], 0, needs);
  assert.equal(continuity.update([hide(player(1), [15])], 100, needs).protected, true);
  const expired = continuity.update([hide(player(1), [15])], 251, needs);
  assert.equal(expired.players[0].wrists[0], null);
  assert.equal(expired.recovered, true);
  assert.equal(continuity.update([hide(player(1), [15])], 450, needs).protected, true);
  assert.equal(continuity.update([hide(player(1), [15])], 451, needs).protected, false);
  assert.equal(continuity.update([hide(player(1), [15, 16])], 500, needs).protected, true);
});

test('body movement games do not require hand visibility but pose tasks still require elbows', () => {
  const gates = new MotionContinuity();
  const bodyOnly = { joints: [11, 12], hands: 0 as const };
  gates.update([player(1)], 0, bodyOnly);
  assert.equal(gates.update([hide(player(1), [13, 14, 15, 16])], 100, bodyOnly).protected, false);
  assert.equal(gates.update([hide(player(1), [13, 14, 15, 16])], 500, bodyOnly).protected, false);
  const poses = new MotionContinuity(); poses.update([player(1)], 0);
  assert.equal(poses.update([hide(player(1), [13])], 500).protected, true);
});

test('lost body or hands disarm menu confirmation until the operator visibly releases again', () => {
  for (const missing of ['body', 'shoulder', 'wrist']) {
    const controller = new BodyMenuController();
    const confirmed = () => { const p = player(1); p.wrists = [{ x: 0.3, y: 0.43 }, { x: 0.3, y: 0.43 }]; return p; };
    const step = (players: TrackedPlayer[], time: number) => controller.update({ context: 'pause', players, capturedAt: time, now: time, aspect: 1 });
    for (let t = 0; t <= 300; t += 100) step([player(1)], t);
    step([confirmed()], 400); step([confirmed()], 500); step([confirmed()], 600);
    step(missing === 'body' ? [] : [hide(confirmed(), [missing === 'shoulder' ? 11 : 15])], 650);
    for (let t = 700; t <= 1700; t += 100) assert.equal(step([confirmed()], t).activated, null);
    for (let t = 1800; t <= 2100; t += 100) step([player(1)], t);
    let activated: string | null = null;
    for (let t = 2200; t <= 3100; t += 100) activated ??= step([confirmed()], t).activated;
    assert.equal(activated, 'confirm');
  }
});

test('a new real reach gate protects lost wrists immediately without changing the last princess form', () => {
  for (const gentle of [true, false]) {
    const fit = { x: 0, y: 0, width: 1280, height: 720 };
    const field = new SpaceGatesField(1, gentle, () => {}, () => {}, () => 0.999);
    for (let i = 0; i < 4; i++) field.update(100, fit);
    assert.equal(field.stats.currentGate?.kind, 'reach');
    const ready = player(1); ready.raised = true; ready.bothRaised = true;
    for (const index of [15, 16]) ready.landmarks[index].y = 0.2;
    ready.wrists.forEach(point => { if (point) point.y = 0.2; });
    field.observePlayers([ready], fit);
    assert.equal(field.faceEffect(1)?.kind, 'princess');
    const missing = hide(player(1), [15, 16]);
    const needs = gameMotionRequirements('gates', gentle, field.stats.currentGate?.kind ?? null);
    assert.equal(supportsRequiredMotion([missing], needs), false);
    const continuity = new MotionContinuity();
    continuity.update([ready], 0, gameMotionRequirements('gates', gentle));
    const result = continuity.update([missing], 50, needs);
    assert.equal(result.protected, true);
    assert.equal(field.faceEffect(1)?.kind, 'princess');
    assert.equal(supportsRequiredMotion([missing], gameMotionRequirements('gates', gentle, 'left')), true);
  }
});

test('gentle reach can accept one real raised hand but cannot declare failure while its partner hand is unknown', () => {
  const unknown = hide(player(1), [15]);
  assert.equal(supportsGateJudgement([unknown], true, 'reach'), false);
  unknown.raised = true;
  assert.equal(supportsGateJudgement([unknown], true, 'reach'), true);
  assert.equal(supportsGateJudgement([unknown], false, 'reach'), false);
  unknown.raised = false;
  assert.equal(supportsGateJudgement([unknown], true, 'left'), true);
});

test('a real tracked partner or bystander cannot inherit the absent operator through either matching path', () => {
  const red = [1, 0, 0]; const blue = [0, 1, 0]; const gray = [0, 0, 1];
  const measurement = (appearance: number[]) => ({ depthMeters: null, depthConfidence: 0, realShoulderMeters: null, disparityPx: null, appearance });
  const pose = (x: number) => { const p = player(0, x); p.landmarks[15].y = 0.2; return { landmarks: p.landmarks }; };
  for (const fallback of [false, true]) {
    const tracker = new FreeMotionTracker(2); const control = new PrimaryController();
    let players: TrackedPlayer[] = [];
    for (let t = 0; t <= 2100; t += 100) players = tracker.update([pose(0.3), pose(0.7)], [measurement(red), measurement(blue)], t);
    assert.equal(tracker.isCalibrated(), true);
    control.update(players, 2, true);
    const operatorId = control.playerId;
    if (fallback) {
      players = tracker.update([pose(0.9), pose(0.7)], [measurement(gray), measurement(blue)], 2200);
    } else {
      tracker.update([pose(0.7)], [measurement(blue)], 2200);
      tracker.update([], [], 2300);
      players = tracker.update([pose(0.3)], [measurement(blue)], 2900);
    }
    assert.ok(players.every(p => p.id !== operatorId));
    assert.deepEqual(control.update(players, 2, true), []);
    assert.equal(control.missing, true);
    players = tracker.update([pose(0.8), pose(0.2)], [measurement(red), measurement(blue)], 3200);
    assert.equal(control.update(players, 2, true)[0]?.id, operatorId);
  }
});
