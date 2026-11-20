import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Calibration } from '../src/game/calibration.ts';
import type { TrackedPlayer } from '../src/types.ts';

function person(id: number, x: number, y: number): TrackedPlayer {
  const landmarks = Array.from({ length: 33 }, () => ({ x, y, visibility: 1 }));
  landmarks[11] = { x: x - 0.07, y, visibility: 1 };
  landmarks[12] = { x: x + 0.07, y, visibility: 1 };
  return { id, center: { x, y: y + 0.1 }, shoulderWidth: 0.14, landmarks, wrists: [{ x: x - 0.2, y: y - 0.15 }, { x: x + 0.2, y: y - 0.12 }], raised: true, bothRaised: true };
}

test('child reach remains lower and two players never share the center boundary', () => {
  const players = [person(1, 0.35, 0.35), person(2, 0.65, 0.6)];
  const calibration = new Calibration(2);
  for (let time = 0; time <= 2000; time += 100) calibration.update(players, time);
  const zones = calibration.zones(players, true);
  assert.ok(zones[0].x + zones[0].width < zones[1].x);
  assert.ok(zones[1].y > zones[0].y);
  assert.ok(zones.every(zone => zone.x >= 0 && zone.y >= 0 && zone.x + zone.width <= 1 && zone.y + zone.height <= 1));
});

test('a new player cannot inherit a previous calibrated reach', () => {
  const calibration = new Calibration(1);
  const player = person(1, 0.5, 0.4);
  for (let time = 0; time <= 2000; time += 100) calibration.update([player], time);
  const replacement = person(2, 0.5, 0.6);
  assert.equal(calibration.update([replacement], 2100), false);
  assert.throws(() => calibration.zones([replacement], true));
});

test('low confidence shoulders cannot finish calibration', () => {
  const calibration = new Calibration(1);
  const player = person(1, 0.5, 0.4);
  player.landmarks[12].visibility = 0;
  for (let time = 0; time <= 3000; time += 100) assert.equal(calibration.update([player], time), false);
});

test('same id with a smaller body must raise hands again and cannot reuse adult reach', () => {
  const calibration = new Calibration(1);
  const adult = person(1, 0.5, 0.25);
  adult.shoulderWidth = 0.3;
  for (let time = 0; time <= 2000; time += 100) calibration.update([adult], time);
  assert.equal(calibration.matches([adult]), true);
  calibration.update([], 2100);
  const child = person(1, 0.5, 0.4);
  child.shoulderWidth = 0.1;
  assert.equal(calibration.matches([child]), false);
  assert.equal(calibration.update([child], 2200), false);
  assert.throws(() => calibration.zones([child], true));
});

test('crossing or overlapping calibrated positions invalidates the round', () => {
  const calibration = new Calibration(2);
  const players = [person(1, 0.3, 0.3), person(2, 0.7, 0.5)];
  for (let time = 0; time <= 2000; time += 100) calibration.update(players, time);
  assert.equal(calibration.matches(players), true);
  assert.equal(calibration.matches([person(1, 0.7, 0.3), person(2, 0.3, 0.5)]), false);
  assert.equal(calibration.update([person(1, 0.49, 0.3), person(2, 0.51, 0.5)], 2100), false);
});
