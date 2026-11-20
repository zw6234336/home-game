import test from 'node:test';
import assert from 'node:assert/strict';
import { menuPoint } from '../src/interaction/menu-point.ts';
import type { TrackedPlayer } from '../src/types.ts';

function player(x: number, y: number, width: number): TrackedPlayer {
  const landmarks = Array.from({ length: 33 }, () => ({ x, y, visibility: 0 }));
  landmarks[11] = { x: x - width / 2, y, visibility: 1 };
  landmarks[12] = { x: x + width / 2, y, visibility: 1 };
  return { id: 1, center: { x, y: y + 0.2 }, shoulderWidth: width, landmarks, wrists: [null, null], raised: false, bothRaised: false };
}

test('small shoulder-side movements reach the full mirrored TV menu for adult and child proportions', () => {
  for (const width of [0.06, 0.12, 0.25]) {
    const person = player(0.5, 0.5, width);
    const top = 0.5 - width * 1.6 * 0.85;
    const bottom = 0.5 - Math.max(0.03, width * 0.15);
    const first = menuPoint(person, { x: 0.5 - width * 0.9, y: top }, 1.6)!;
    const last = menuPoint(person, { x: 0.5 + width * 0.9, y: bottom }, 1.6)!;
    assert.ok(Math.abs(first.x - 1) < 1e-9 && Math.abs(first.y) < 1e-9);
    assert.ok(Math.abs(last.x) < 1e-9 && Math.abs(last.y - 1) < 1e-9);
    person.center.y = 0.5;
    const centered = menuPoint(person, { x: 0.5, y: top }, 1.6)!;
    assert.ok(Math.abs(centered.x - 0.5) < 1e-9 && centered.y === 0);
  }
});

test('edge players can select every horizontal menu position without leaving the camera view', () => {
  for (const center of [0.12, 0.88]) {
    const person = player(center, 0.3, 0.2);
    assert.equal(menuPoint(person, { x: Math.max(0.02, center - 0.18), y: 0.15 }, 1.6)!.x, 1);
    assert.ok(Math.abs(menuPoint(person, { x: Math.min(0.98, center + 0.18), y: 0.15 }, 1.6)!.x) < 1e-9);
  }
});

test('unreliable shoulders or invalid geometry cannot steer menu selection', () => {
  const person = player(0.5, 0.5, 0.12);
  for (const aspect of [0, -1, NaN, Infinity]) assert.equal(menuPoint(person, { x: 0.5, y: 0.4 }, aspect), null);
  for (const point of [{ x: NaN, y: 0.4 }, { x: -0.1, y: 0.4 }, { x: 0.5, y: Infinity }]) assert.equal(menuPoint(person, point), null);
  person.landmarks[12].visibility = 0;
  assert.equal(menuPoint(person, { x: 0.5, y: 0.4 }), null);
});
