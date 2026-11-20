import test from 'node:test';
import assert from 'node:assert/strict';
import type { Landmark, PoseObservation } from '../src/types.ts';
import { fitRect, intersectsSweep, toStage, validLandmark } from '../src/interaction/geometry.ts';
import { DwellController } from '../src/interaction/dwell.ts';
import { OneEuroFilter } from '../src/interaction/filter.ts';
import { HoldGesture } from '../src/interaction/raise.ts';
import { PlayerTracker } from '../src/interaction/tracker.ts';

function pose(x: number, width = 0.16, wristY = 0.52): PoseObservation {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  landmarks[11] = { x: x - width / 2, y: 0.35, visibility: 1 };
  landmarks[12] = { x: x + width / 2, y: 0.35, visibility: 1 };
  landmarks[23] = { x: x - width / 3, y: 0.65, visibility: 1 };
  landmarks[24] = { x: x + width / 3, y: 0.65, visibility: 1 };
  landmarks[15] = { x: x - width, y: wristY, visibility: 1 };
  landmarks[16] = { x: x + width, y: wristY, visibility: 1 };
  return { landmarks };
}

function close(actual: number, expected: number, tolerance = 1e-10): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('landmarks require normalized finite coordinates and visible confidence', () => {
  assert.equal(validLandmark({ x: 0, y: 1, visibility: 0.5 }), true);
  assert.equal(validLandmark({ x: 1, y: 0, visibility: 3, z: Number.NaN }), true);
  for (const landmark of [undefined, { x: -0.01, y: 0.5, visibility: 1 }, { x: 0.5, y: 1.01, visibility: 1 }, { x: Number.NaN, y: 0.5, visibility: 1 }, { x: 0.5, y: Number.POSITIVE_INFINITY, visibility: 1 }, { x: 0.5, y: 0.5, visibility: Number.NaN }, { x: 0.5, y: 0.5, visibility: 0.499 }]) {
    assert.equal(validLandmark(landmark), false);
  }
});

test('contain fitting centers landscape and portrait sources', () => {
  assert.deepEqual(fitRect(1920, 1080, 1280, 720), { x: 0, y: 0, width: 1280, height: 720 });
  assert.deepEqual(fitRect(480, 640, 1920, 1080), { x: 555, y: 0, width: 810, height: 1080 });
  assert.deepEqual(fitRect(1920, 1080, 800, 800), { x: 0, y: 175, width: 800, height: 450 });
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    for (let index = 0; index < 4; index += 1) {
      const dimensions: [number, number, number, number] = [640, 480, 1920, 1080];
      dimensions[index] = invalid;
      assert.throws(() => fitRect(...dimensions), RangeError);
    }
  }
  const extreme = fitRect(1e-300, 1e200, 1e-200, 1e308);
  assert.ok(Object.values(extreme).every(Number.isFinite));
  assert.ok(extreme.width <= 1e-200 && extreme.height <= 1e308);
  close(extreme.height / 1e300, 1, 1e-12);
});

test('projection applies mirroring once without changing the model point', () => {
  const point = { x: 0.2, y: 0.4 };
  const rect = { x: 100, y: 50, width: 1000, height: 500 };
  assert.deepEqual(toStage(point, rect), { x: 900, y: 250 });
  assert.deepEqual(toStage(point, rect, false), { x: 300, y: 250 });
  assert.deepEqual(point, { x: 0.2, y: 0.4 });
  assert.deepEqual(toStage({ x: -1, y: 2 }, rect, false), { x: -900, y: 1050 });
  assert.throws(() => toStage({ x: Number.NaN, y: 0 }, rect), RangeError);
  assert.throws(() => toStage(point, { ...rect, width: -1 }), RangeError);
});

test('sweep hits a circle between frames including tangency and endpoints', () => {
  assert.equal(intersectsSweep({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0, radius: 2 }), true);
  assert.equal(intersectsSweep({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 5, radius: 5 }), true);
  assert.equal(intersectsSweep({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 5.01, radius: 5 }), false);
  assert.equal(intersectsSweep({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 101, y: 0, radius: 1 }), true);
  assert.equal(intersectsSweep(null, { x: 4, y: 3 }, { x: 0, y: 0, radius: 5 }), true);
  assert.equal(intersectsSweep({ x: 4, y: 3 }, { x: 4, y: 3 }, { x: 0, y: 0, radius: 4.9 }), false);
  assert.equal(intersectsSweep({ x: -1e308, y: 0 }, { x: 1e308, y: 0 }, { x: 0, y: 1, radius: 1 }), true);
});

test('sweep rejects invalid data without creating hits', () => {
  const point = { x: 0, y: 0 };
  assert.equal(intersectsSweep({ x: Number.NaN, y: 0 }, point, { ...point, radius: 1 }), false);
  assert.equal(intersectsSweep(null, { x: 0, y: Number.POSITIVE_INFINITY }, { ...point, radius: 1 }), false);
  assert.equal(intersectsSweep(null, point, { ...point, radius: -1 }), false);
  assert.equal(intersectsSweep(null, point, { ...point, radius: Number.POSITIVE_INFINITY }), false);
});

test('sweep agrees with an independent closest-point oracle', () => {
  let state = 20261120;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let index = 0; index < 2000; index += 1) {
    const start = { x: random() * 2000, y: random() * 1200 };
    const end = { x: random() * 2000, y: random() * 1200 };
    const target = { x: random() * 2000, y: random() * 1200, radius: random() * 100 };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const parameter = Math.max(0, Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / (dx * dx + dy * dy)));
    const expected = (target.x - start.x - dx * parameter) ** 2 + (target.y - start.y - dy * parameter) ** 2 <= target.radius ** 2;
    assert.equal(intersectsSweep(start, end, target), expected);
    assert.equal(intersectsSweep(end, start, target), expected);
  }
});

test('dwell activates at one continuous second exactly once', () => {
  const dwell = new DwellController();
  const activations: string[] = [];
  for (let time = 0; time <= 3000; time += 100) {
    const result = dwell.update({ time, target: 'play', eligible: true });
    close(result.progress, Math.min(1, time / 1000));
    if (result.activated !== null) {
      activations.push(result.activated);
      assert.equal(time, 1000);
    }
  }
  assert.deepEqual(activations, ['play']);
});

test('dwell re-arms only after leaving or changing eligibility or target', () => {
  const dwell = new DwellController(100);
  assert.equal(dwell.update({ time: 0, target: 'play', eligible: true }).activated, null);
  assert.equal(dwell.update({ time: 100, target: 'play', eligible: true }).activated, 'play');
  assert.deepEqual(dwell.update({ time: 150, target: null, eligible: true }), { progress: 0, activated: null });
  dwell.update({ time: 200, target: 'play', eligible: true });
  assert.equal(dwell.update({ time: 300, target: 'play', eligible: true }).activated, 'play');
  dwell.update({ time: 350, target: 'settings', eligible: true });
  assert.equal(dwell.update({ time: 450, target: 'settings', eligible: true }).activated, 'settings');
  dwell.update({ time: 460, target: 'settings', eligible: false });
  dwell.update({ time: 470, target: 'settings', eligible: true });
  assert.equal(dwell.update({ time: 570, target: 'settings', eligible: true }).activated, 'settings');
});

test('dwell requires new continuous time after a gap above 200ms', () => {
  const dwell = new DwellController(400);
  dwell.update({ time: 0, target: 'play', eligible: true });
  close(dwell.update({ time: 200, target: 'play', eligible: true }).progress, 0.5);
  assert.deepEqual(dwell.update({ time: 401, target: 'play', eligible: true }), { progress: 0, activated: null });
  assert.equal(dwell.update({ time: 601, target: 'play', eligible: true }).activated, null);
  assert.equal(dwell.update({ time: 801, target: 'play', eligible: true }).activated, 'play');
  assert.equal(dwell.update({ time: 2000, target: 'play', eligible: true }).activated, null);
  for (let time = 2100; time <= 3000; time += 100) {
    assert.equal(dwell.update({ time, target: 'play', eligible: true }).activated, null);
  }
});

test('dwell ignores duplicate times and resets on invalid or backward time', () => {
  const dwell = new DwellController(200);
  dwell.update({ time: 100, target: 'play', eligible: true });
  close(dwell.update({ time: 200, target: 'play', eligible: true }).progress, 0.5);
  for (let index = 0; index < 10; index += 1) {
    close(dwell.update({ time: 200, target: 'play', eligible: true }).progress, 0.5);
  }
  assert.equal(dwell.update({ time: 300, target: 'play', eligible: true }).activated, 'play');
  assert.deepEqual(dwell.update({ time: 200, target: 'play', eligible: true }), { progress: 0, activated: null });
  assert.equal(dwell.update({ time: 300, target: 'play', eligible: true }).progress, 0);
  assert.equal(dwell.update({ time: 400, target: 'play', eligible: true }).activated, null);
  assert.equal(dwell.update({ time: 500, target: 'play', eligible: true }).activated, 'play');
  assert.equal(dwell.update({ time: Number.NaN, target: 'play', eligible: true }).progress, 0);
  assert.equal(dwell.update({ time: 600, target: 'play', eligible: true }).progress, 0);
  dwell.reset();
  assert.equal(dwell.update({ time: 700, target: 'play', eligible: true }).progress, 0);
});

test('hold gesture fires once after 1500ms and requires release', () => {
  const gesture = new HoldGesture();
  const triggers: number[] = [];
  for (let time = 0; time <= 2000; time += 100) {
    if (gesture.update(true, time)) {
      triggers.push(time);
    }
  }
  assert.deepEqual(triggers, [1500]);
  assert.equal(gesture.update(true, 3000), false);
  assert.equal(gesture.update(true, 3100), false);
  assert.equal(gesture.update(false, 3200), false);
  for (let time = 3300; time <= 4800; time += 100) {
    assert.equal(gesture.update(true, time), time === 4800);
  }
});

test('hold interruption invalidates incomplete gestures', () => {
  const gesture = new HoldGesture(400);
  gesture.update(true, 0);
  gesture.update(true, 200);
  assert.equal(gesture.update(true, 401), false);
  gesture.update(true, 601);
  assert.equal(gesture.update(true, 801), true);
  assert.equal(gesture.update(true, Number.NaN), false);
  gesture.update(true, 900);
  gesture.update(true, 1000);
  assert.equal(gesture.update(true, 950), false);
  assert.equal(gesture.update(true, 1050), false);
  assert.equal(gesture.update(true, 1250), false);
  assert.equal(gesture.update(true, 1450), true);
});

test('one euro reduces stationary jitter and increases responsiveness with speed', () => {
  const quiet = new OneEuroFilter({ minCutoff: 1.5, beta: 0.5 });
  quiet.update(0.5, 0);
  let rawError = 0;
  let filteredError = 0;
  for (let index = 1; index <= 100; index += 1) {
    const raw = 0.5 + (index % 2 === 0 ? 0.02 : -0.02);
    const filtered = quiet.update(raw, index * 33);
    rawError += (raw - 0.5) ** 2;
    filteredError += (filtered - 0.5) ** 2;
  }
  assert.ok(filteredError < rawError / 4);
  const adaptive = new OneEuroFilter({ minCutoff: 1, beta: 3 });
  const constant = new OneEuroFilter({ minCutoff: 1, beta: 0 });
  adaptive.update(0.1, 0);
  constant.update(0.1, 0);
  assert.ok(adaptive.update(0.9, 33) > constant.update(0.9, 33));
});

test('one euro resets discontinuities and never accepts invalid samples', () => {
  const filter = new OneEuroFilter();
  assert.equal(filter.update(0.2, 0), 0.2);
  const smoothed = filter.update(0.4, 33);
  assert.ok(smoothed > 0.2 && smoothed < 0.4);
  assert.equal(filter.update(0.9, 33), smoothed);
  assert.equal(filter.update(0.8, 184), 0.8);
  assert.equal(filter.update(0.1, 100), 0.1);
  assert.throws(() => filter.update(Number.NaN, 200), RangeError);
  assert.equal(filter.update(0.7, 201), 0.7);
  filter.reset();
  assert.equal(filter.update(0.3, 300), 0.3);
  assert.throws(() => new OneEuroFilter({ beta: -1 }), RangeError);
  filter.update(-Number.MAX_VALUE, 301);
  assert.ok(Number.isFinite(filter.update(Number.MAX_VALUE, 302)));
});

test('player identities survive reversed pose array order', () => {
  const tracker = new PlayerTracker(2);
  const first = tracker.update([pose(0.7), pose(0.3)], 0);
  const leftId = first.find((player) => player.center.x < 0.5)?.id;
  const rightId = first.find((player) => player.center.x > 0.5)?.id;
  for (let frame = 1; frame <= 100; frame += 1) {
    const left = pose(0.3 + Math.sin(frame / 10) * 0.03);
    const right = pose(0.7 + Math.cos(frame / 10) * 0.03);
    const players = tracker.update(frame % 2 === 0 ? [left, right] : [right, left], frame * 33);
    assert.equal(players.find((player) => player.center.x < 0.5)?.id, leftId);
    assert.equal(players.find((player) => player.center.x > 0.5)?.id, rightId);
    assert.equal(new Set(players.map((player) => player.id)).size, 2);
  }
});

test('global assignment uses motion when players pass one another', () => {
  const tracker = new PlayerTracker(2);
  const initial = tracker.update([pose(0.3, 0.12), pose(0.7, 0.2)], 0);
  const movingRightId = initial[0].id;
  const movingLeftId = initial[1].id;
  for (let frame = 1; frame <= 5; frame += 1) {
    const right = pose(0.3 + frame * 0.08, 0.12);
    const left = pose(0.7 - frame * 0.08, 0.2);
    const players = tracker.update(frame % 2 === 0 ? [right, left] : [left, right], frame * 50);
    close(players.find((player) => player.id === movingRightId)!.center.x, 0.3 + frame * 0.08);
    close(players.find((player) => player.id === movingLeftId)!.center.x, 0.7 - frame * 0.08);
  }
});

test('missing and low confidence wrists clear their filters before reappearance', () => {
  const tracker = new PlayerTracker(1);
  tracker.update([pose(0.5)], 0);
  const moving = pose(0.5);
  moving.landmarks[15].x = 0.5;
  const filtered = tracker.update([moving], 33)[0];
  assert.ok(filtered.wrists[0]!.x < 0.5);
  const missing = pose(0.5);
  missing.landmarks[15].visibility = 0.49;
  assert.equal(tracker.update([missing], 66)[0].wrists[0], null);
  const recovered = pose(0.5);
  recovered.landmarks[15].x = 0.7;
  assert.equal(tracker.update([recovered], 99)[0].wrists[0]!.x, 0.7);
  const invalid = pose(0.5);
  invalid.landmarks[16].x = Number.NaN;
  assert.equal(tracker.update([invalid], 132)[0].wrists[1], null);
});

test('missing people and gaps reset wrists without prematurely replacing identity', () => {
  const tracker = new PlayerTracker(1);
  const id = tracker.update([pose(0.5)], 0)[0].id;
  assert.deepEqual(tracker.update([], 33), []);
  const moved = pose(0.5);
  moved.landmarks[15].x = 0.6;
  const recovered = tracker.update([moved], 66)[0];
  assert.equal(recovered.id, id);
  assert.equal(recovered.wrists[0]!.x, 0.6);
  moved.landmarks[15].x = 0.8;
  assert.equal(tracker.update([moved], 217)[0].wrists[0]!.x, 0.8);
  assert.equal(tracker.update([pose(0.5)], 717)[0].id, id);
  assert.notEqual(tracker.update([pose(0.5)], 1218)[0].id, id);
});

test('large center jumps replace identity and wrist teleports break sweeps', () => {
  const tracker = new PlayerTracker(1);
  const first = tracker.update([pose(0.2)], 0)[0];
  const next = tracker.update([pose(0.8)], 33)[0];
  assert.notEqual(next.id, first.id);
  tracker.reset();
  tracker.update([pose(0.5)], 100);
  const teleported = pose(0.5);
  teleported.landmarks[15].x = 0.9;
  assert.equal(tracker.update([teleported], 133)[0].wrists[0], null);
  assert.equal(tracker.update([teleported], 166)[0].wrists[0]!.x, 0.9);
});

test('tracker rejects invalid torsos and supports partial torso observations', () => {
  const tracker = new PlayerTracker(2);
  const invalid = pose(0.4);
  for (const index of [11, 12, 23, 24]) {
    invalid.landmarks[index].visibility = 0.1;
  }
  assert.deepEqual(tracker.update([invalid], 0), []);
  const hipsOnly = pose(0.4);
  hipsOnly.landmarks[11].visibility = 0;
  hipsOnly.landmarks[12].visibility = 0;
  const player = tracker.update([hipsOnly], 33)[0];
  close(player.center.x, 0.4);
  close(player.center.y, 0.65);
  assert.equal(player.bothRaised, false);
  assert.ok(player.shoulderWidth > 0);
  assert.equal(tracker.update([pose(0.2), pose(0.5), pose(0.8)], 66).length, 2);
});

test('raised gestures require confident wrists above their shoulders', () => {
  const tracker = new PlayerTracker(1);
  const both = tracker.update([pose(0.5, 0.16, 0.2)], 0)[0];
  assert.equal(both.raised, true);
  assert.equal(both.bothRaised, true);
  const single = pose(0.5, 0.16, 0.2);
  single.landmarks[16].visibility = 0;
  const result = tracker.update([single], 33)[0];
  assert.equal(result.raised, true);
  assert.equal(result.bothRaised, false);
});

test('tracker snapshots and input observations cannot mutate tracking state', () => {
  const tracker = new PlayerTracker(1);
  const source = pose(0.4);
  const snapshot = tracker.update([source], 0)[0];
  const wristX = snapshot.wrists[0]!.x;
  source.landmarks[15].x = 0.9;
  snapshot.center.x = 0.9;
  snapshot.wrists[0]!.x = 0.9;
  snapshot.landmarks[11].x = 0.9;
  const duplicate = tracker.update([pose(0.8)], 0)[0];
  close(duplicate.center.x, 0.4);
  assert.equal(duplicate.wrists[0]!.x, wristX);
  close(duplicate.landmarks[11].x, 0.32);
});

test('tracker invalid and backward timestamps invalidate previous identities', () => {
  const tracker = new PlayerTracker(1);
  const firstId = tracker.update([pose(0.4)], 100)[0].id;
  assert.deepEqual(tracker.update([pose(0.4)], Number.NaN), []);
  const secondId = tracker.update([pose(0.4)], 200)[0].id;
  assert.notEqual(secondId, firstId);
  assert.deepEqual(tracker.update([pose(0.4)], 150), []);
  const thirdId = tracker.update([pose(0.4)], 250)[0].id;
  assert.notEqual(thirdId, secondId);
});

test('an adult replaced by a child after a short disappearance receives a new identity', () => {
  const tracker = new PlayerTracker(1);
  const adult = pose(0.5, 0.3, 0.2);
  const adultId = tracker.update([adult], 0)[0].id;
  assert.deepEqual(tracker.update([], 100), []);
  const child = pose(0.5, 0.1, 0.3);
  const replacement = tracker.update([child], 200)[0];
  assert.notEqual(replacement.id, adultId);
  assert.equal(replacement.wrists[0]!.x, child.landmarks[15].x);
  assert.notEqual(tracker.update([adult], 300)[0].id, replacement.id);
});

test('reliable torso scale rejects a replacement even at the same shoulder width', () => {
  const tracker = new PlayerTracker(1);
  const adult = pose(0.5, 0.16, 0.2);
  adult.landmarks[11].y = adult.landmarks[12].y = 0.3;
  adult.landmarks[23].y = adult.landmarks[24].y = 0.7;
  const adultId = tracker.update([adult], 0)[0].id;
  const child = pose(0.5, 0.16, 0.3);
  child.landmarks[11].y = child.landmarks[12].y = 0.42;
  child.landmarks[23].y = child.landmarks[24].y = 0.58;
  const replacement = tracker.update([child], 100)[0];
  assert.notEqual(replacement.id, adultId);
  close(replacement.center.x, 0.5);
  close(replacement.center.y, 0.5);
});

test('partial torsos retain the last reliable scale without creating false replacements', () => {
  const tracker = new PlayerTracker(1);
  const adult = pose(0.5, 0.2);
  const adultId = tracker.update([adult], 0)[0].id;
  const occluded = pose(0.5, 0.2);
  occluded.landmarks[11].visibility = 0;
  occluded.landmarks[12].visibility = 0;
  assert.equal(tracker.update([occluded], 100)[0].id, adultId);
  assert.notEqual(tracker.update([pose(0.5, 0.08)], 200)[0].id, adultId);
});

test('normal scale changes preserve identity', () => {
  const tracker = new PlayerTracker(1);
  const id = tracker.update([pose(0.5, 0.16)], 0)[0].id;
  assert.equal(tracker.update([pose(0.5, 0.22)], 100)[0].id, id);
  assert.equal(tracker.update([pose(0.5, 0.17)], 200)[0].id, id);
});
