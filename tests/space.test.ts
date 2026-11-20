import test from 'node:test';
import assert from 'node:assert/strict';
import type { Landmark, TrackedPlayer } from '../src/types.ts';
import { Calibration } from '../src/game/calibration.ts';
import { chooseSpaceMode } from '../src/game/space.ts';

function person(id: number, x = 0.5, y = 0.4, width = 0.12, hipY = 0.65, hips = true): TrackedPlayer {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x, y, visibility: 0 }));
  landmarks[11] = { x: x - width / 2, y, visibility: 1 };
  landmarks[12] = { x: x + width / 2, y, visibility: 1 };
  landmarks[15] = { x: Math.max(0, x - width * 0.7), y: Math.max(0, y - 0.04), visibility: 1 };
  landmarks[16] = { x: Math.min(1, x + width * 0.6), y: Math.min(1, y + width * 0.9), visibility: 1 };
  landmarks[23] = { x: x - width * 0.4, y: hipY, visibility: hips ? 1 : 0 };
  landmarks[24] = { x: x + width * 0.4, y: hipY, visibility: hips ? 1 : 0 };
  return { id, center: { x, y: hips ? (y + hipY) / 2 : y }, shoulderWidth: width, landmarks, wrists: [{ x: landmarks[15].x, y: landmarks[15].y }, { x: landmarks[16].x, y: landmarks[16].y }], raised: true, bothRaised: false };
}

function calibrate(players: TrackedPlayer[]): Calibration {
  const calibration = new Calibration(players.length as 1 | 2);
  for (let time = 0; time <= 2000; time += 100) calibration.update(players, time);
  assert.equal(calibration.matches(players), true);
  return calibration;
}

test('a shoulder-side one-hand greeting calibrates without hip landmarks', () => {
  const player = person(1, 0.5, 0.4, 0.12, 0.65, false);
  const calibration = calibrate([player]);
  assert.equal(calibration.readyCount(), 1);
  assert.equal(calibration.zones([player], true).length, 1);
});

test('continuous translations and growth move the accepted anchor beyond the original limits', () => {
  for (const [steps, shift, scale] of [[30, 0.005, 1.005], [60, 0.003, 1.006]]) {
    const initial = person(1, 0.3);
    const calibration = calibrate([initial]);
    const original = calibration.zones([initial], false)[0];
    let current = initial;
    for (let step = 1; step <= steps; step += 1) {
      current = person(1, 0.3 + shift * step, 0.4, 0.12 * scale ** step);
      const input = structuredClone(current);
      assert.equal(calibration.adapt([current], 2000 + step * 100), true);
      assert.equal(calibration.matches([current]), true);
      assert.deepEqual(current, input);
    }
    const moved = calibration.zones([current], false)[0];
    assert.ok(moved.x > original.x + 0.1);
    assert.ok(moved.width > original.width);
    const unchanged = calibrate([initial]);
    assert.equal(unchanged.matches([current]), false);
  }
});

test('continuous movement away from the camera scales the remembered reach down', () => {
  const initial = person(1, 0.7);
  const calibration = calibrate([initial]);
  const original = calibration.zones([initial], false)[0];
  let current = initial;
  for (let step = 1; step <= 60; step += 1) {
    current = person(1, 0.7 - step * 0.003, 0.4, 0.12 * 0.994 ** step);
    assert.equal(calibration.adapt([current], 2000 + step * 100), true);
  }
  const moved = calibration.zones([current], false)[0];
  assert.ok(moved.x + moved.width < original.x + original.width - 0.15);
  assert.ok(moved.width < original.width);
});

test('a sudden position or scale jump invalidates readiness until a fresh two-second calibration', () => {
  for (const jump of [person(1, 0.55), person(1, 0.3, 0.4, 0.12 * 1.8)]) {
    const initial = person(1, 0.3);
    const calibration = calibrate([initial]);
    assert.equal(calibration.adapt([jump], 2100), false);
    assert.equal(calibration.readyCount(), 0);
    for (let step = 1; step <= 20; step += 1) {
      const returned = person(1, 0.3 + 0.001 * step);
      assert.equal(calibration.adapt([returned], 2100 + step * 100), false);
      assert.deepEqual(calibration.verifiedPlayers([returned]), []);
    }
    assert.equal(calibration.matches([initial]), false);
    assert.throws(() => calibration.zones([initial], true));
    for (let time = 4200; time <= 6100; time += 100) assert.equal(calibration.update([initial], time), false);
    assert.equal(calibration.update([initial], 6200), true);
  }
});

test('nonfinite or backward adaptation clocks invalidate every prior readiness', () => {
  for (const time of [1999, Number.NaN, Number.POSITIVE_INFINITY]) {
    const player = person(1);
    const calibration = calibrate([player]);
    assert.equal(calibration.adapt([player], time), false);
    assert.equal(calibration.adapt([player], 2100), false);
    assert.equal(calibration.matches([player]), false);
    assert.deepEqual(calibration.verifiedPlayers([player]), []);
  }
});

test('the 500ms observation boundary is valid and a longer gap requires re-calibration', () => {
  const player = person(1);
  const accepted = calibrate([player]);
  assert.equal(accepted.adapt([player], 2500), true);
  const expired = calibrate([player]);
  assert.equal(expired.adapt([player], 2501), false);
  assert.equal(expired.adapt([player], 2601), false);
  assert.equal(expired.matches([player]), false);
});

test('duplicate adaptation timestamps cannot drift the accepted reach', () => {
  const player = person(1, 0.3);
  const calibration = calibrate([player]);
  const original = calibration.zones([player], false);
  const shifted = person(1, 0.305, 0.4, 0.121);
  for (let step = 0; step < 50; step += 1) {
    assert.equal(calibration.adapt([shifted], 2000), true);
    assert.deepEqual(calibration.zones([shifted], false), original);
  }
  assert.equal(calibration.adapt([shifted], 2100), true);
  assert.notDeepEqual(calibration.zones([shifted], false), original);
});

test('hip visibility changes do not move a shoulder-based anchor', () => {
  const full = person(1);
  const half = person(1, 0.5, 0.4, 0.12, 0.65, false);
  assert.notEqual(full.center.y, half.center.y);
  const calibration = calibrate([full]);
  const original = calibration.zones([full], true);
  assert.equal(calibration.adapt([half], 2100), true);
  assert.deepEqual(calibration.zones([half], true), original);
  assert.equal(calibration.adapt([full], 2200), true);
  assert.deepEqual(calibration.zones([full], true), original);
});

test('a half-body view can keep adapting and recover visible hips', () => {
  const calibration = calibrate([person(1, 0.3)]);
  for (let step = 1; step <= 30; step += 1) {
    assert.equal(calibration.adapt([person(1, 0.3 + step * 0.003, 0.4, 0.12 * 1.006 ** step, 0.65, false)], 2000 + step * 100), true);
  }
  assert.equal(calibration.adapt([person(1, 0.39, 0.4, 0.12 * 1.006 ** 30)], 5100), true);
});

test('brief absence and shoulder occlusion preserve the other partner calibration', () => {
  for (const missing of ['absent', 'shoulder']) {
    const first = person(1, 0.25, 0.4, 0.1);
    const second = person(2, 0.75, 0.4, 0.1);
    const calibration = calibrate([first, second]);
    const hidden = structuredClone(first);
    hidden.landmarks[11].visibility = 0;
    const visible = missing === 'absent' ? [second] : [hidden, second];
    for (let time = 2100; time <= 2400; time += 100) {
      assert.equal(calibration.adapt(visible, time), false);
      assert.deepEqual(calibration.verifiedPlayers(visible).map(player => player.id), [2]);
    }
    assert.equal(calibration.adapt([first, second], 2500), true);
    for (let time = 2600; time <= 3100; time += 100) calibration.adapt(visible, time);
    assert.equal(calibration.adapt([first, second], 3200), false);
    assert.deepEqual(calibration.verifiedPlayers([first, second]).map(player => player.id), [2]);
  }
});

test('replacement IDs, duplicate identities and overlap cannot adapt into a valid calibration', () => {
  const first = person(1, 0.25, 0.4, 0.1);
  const second = person(2, 0.75, 0.4, 0.1);
  const replacement = calibrate([first, second]);
  assert.equal(replacement.adapt([person(99, 0.25, 0.4, 0.1), second], 2100), false);
  assert.deepEqual(replacement.verifiedPlayers([first, second]).map(player => player.id), [2]);
  const duplicate = calibrate([first]);
  assert.equal(duplicate.adapt([first, first], 2100), false);
  assert.equal(duplicate.matches([first]), false);
  const crossing = calibrate([first, second]);
  assert.equal(crossing.adapt([person(1, 0.49, 0.4, 0.1), person(2, 0.51, 0.4, 0.1)], 2100), false);
  assert.deepEqual(crossing.verifiedPlayers([first, second]), []);
});

test('compact reach stays inside standard reach, the image and each player half', () => {
  for (const [left, right, width] of [[0.25, 0.75, 0.1], [0.02, 0.14, 0.03], [0.86, 0.98, 0.03]]) {
    const players = [person(1, left, 0.4, width), person(2, right, 0.55, width)];
    const calibration = calibrate(players);
    for (const gentle of [false, true]) {
      const standard = calibration.zones(players, gentle);
      const compact = calibration.zones(players, gentle, true);
      for (let index = 0; index < 2; index += 1) {
        const zone = compact[index];
        const outer = standard[index];
        assert.ok(Object.values(zone).every(Number.isFinite));
        assert.ok(zone.width > 0 && zone.height > 0 && zone.x >= 0 && zone.y >= 0 && zone.x + zone.width <= 1 && zone.y + zone.height <= 1);
        assert.ok(zone.width <= outer.width && zone.height <= outer.height);
        assert.ok(zone.x >= outer.x - 1e-12 && zone.y >= outer.y - 1e-12);
        assert.ok(zone.x + zone.width <= outer.x + outer.width + 1e-12 && zone.y + zone.height <= outer.y + outer.height + 1e-12);
      }
      assert.ok(standard[0].x + standard[0].width < standard[1].x);
      assert.ok(compact[0].x + compact[0].width < compact[1].x);
    }
  }
});

test('auto mode keeps wide, centered full-body views standard regardless of small body size', () => {
  for (const players of [[person(1)], [person(1, 0.5, 0.6, 0.06, 0.74)], [person(1, 0.25, 0.4, 0.1), person(2, 0.75, 0.4, 0.1)]]) {
    assert.equal(chooseSpaceMode(players, 'auto'), 'standard');
    assert.equal(chooseSpaceMode(players, 'compact'), 'compact');
  }
});

test('auto mode recognizes constrained edges, large image occupancy, close partners and half bodies', () => {
  for (const players of [[person(1, 0.12, 0.4, 0.14)], [person(1, 0.5, 0.4, 0.3)], [person(1, 0.35, 0.4, 0.14), person(2, 0.65, 0.4, 0.14)], [person(1, 0.5, 0.4, 0.12, 0.65, false)], []]) {
    assert.equal(chooseSpaceMode(players, 'auto'), 'compact');
  }
  const hidden = person(1);
  hidden.landmarks[11].visibility = 0;
  assert.equal(chooseSpaceMode([hidden], 'auto'), 'compact');
});

test('vertical reach is corrected for the source video aspect ratio', () => {
  const player = person(1, 0.5, 0.25, 0.12, 0.65);
  assert.equal(chooseSpaceMode([player], 'auto', 1), 'standard');
  assert.equal(chooseSpaceMode([player], 'auto', 16 / 9), 'compact');
  for (const aspect of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(chooseSpaceMode([player], 'auto', aspect), 'compact');
});
