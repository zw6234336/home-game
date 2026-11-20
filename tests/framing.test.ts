import assert from 'node:assert/strict';
import test from 'node:test';
import type { Landmark, Rect, TrackedPlayer } from '../src/types.ts';
import { FramingController } from '../src/interaction/framing.ts';
import { fitRect, framingFit, toStage, validLandmark } from '../src/interaction/geometry.ts';

const full = { x: 0, y: 0, width: 1, height: 1 };

function player(id = 1, x = 0.5, y = 0.4, width = 0.12): TrackedPlayer {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [index, dx, dy] of [[11, -0.5, 0], [12, 0.5, 0], [13, -0.6, 0.5], [14, 0.6, 0.5], [15, -0.7, 1], [16, 0.7, 1], [23, -0.35, 1.4], [24, 0.35, 1.4]]) {
    landmarks[index] = { x: x + dx * width, y: y + dy * width, visibility: 1 };
  }
  return { id, center: { x, y: y + width * 0.7 }, shoulderWidth: width, landmarks, wrists: [{ ...landmarks[15] }, { ...landmarks[16] }], raised: false, bothRaised: false };
}

function bounded(rect: Rect) {
  assert.ok(Object.values(rect).every(Number.isFinite));
  assert.equal(rect.width, rect.height);
  assert.ok(rect.width >= 0.68 && rect.width <= 1);
  assert.ok(rect.x >= 0 && rect.y >= 0);
  assert.ok(rect.x + rect.width <= 1 + 1e-12 && rect.y + rect.height <= 1 + 1e-12);
}

function containsPlayers(rect: Rect, players: TrackedPlayer[]) {
  for (const item of players) {
    const points = [...item.landmarks.filter(validLandmark), ...item.wrists.filter(point => point !== null)];
    for (const point of points) {
      assert.ok(point.x >= rect.x - 1e-12 && point.x <= rect.x + rect.width + 1e-12, JSON.stringify({ point, rect }));
      assert.ok(point.y >= rect.y - 1e-12 && point.y <= rect.y + rect.height + 1e-12, JSON.stringify({ point, rect }));
    }
  }
}

function near(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('framing begins at panorama and slowly magnifies stable players without mutating input', () => {
  const controller = new FramingController();
  const input = [player()];
  const original = structuredClone(input);
  assert.deepEqual(controller.update(input, 0), full);
  let previous = 1;
  let frame = full;
  for (let index = 1; index <= 20; index++) {
    frame = controller.update(input, index * 33);
    bounded(frame);
    containsPlayers(frame, input);
    assert.ok(frame.width <= previous);
    assert.ok(previous - frame.width < 0.03);
    previous = frame.width;
  }
  assert.ok(frame.width < 0.95);
  assert.deepEqual(input, original);
  frame.width = 0;
  bounded(controller.update(input, 660));
});

test('framing includes an adult and a smaller lower child without weighting either away', () => {
  const controller = new FramingController();
  const players = [player(1, 0.32, 0.28, 0.17), player(2, 0.73, 0.63, 0.08)];
  for (let index = 0; index < 100; index++) {
    const frame = controller.update(index % 2 ? players.toReversed() : players, index * 33);
    bounded(frame);
    containsPlayers(frame, players);
  }
});

test('fresh reliable wrists are visible immediately, including a duplicate timestamp', () => {
  const controller = new FramingController();
  const initial = player();
  for (let index = 0; index < 150; index++) controller.update([initial], index * 33);
  const next = structuredClone(initial);
  next.landmarks[15] = { x: 0.02, y: 0.05, visibility: 1 };
  next.landmarks[16] = { x: 0.98, y: 0.94, visibility: 1 };
  next.wrists = [{ x: 0.01, y: 0.04 }, { x: 0.99, y: 0.95 }];
  const expanded = controller.update([next], 149 * 33);
  bounded(expanded);
  containsPlayers(expanded, [next]);
  const duplicate = controller.update([next], 149 * 33);
  assert.deepEqual(duplicate, expanded);
  assert.ok(controller.update([initial], 150 * 33).width >= expanded.width - 0.01);
});

test('framing restores panorama for lost partners, uncertain shoulders and discontinuities', () => {
  const cases: Array<(players: TrackedPlayer[]) => { players: TrackedPlayer[]; time: number }> = [
    players => ({ players: players.slice(0, 1), time: 1000 }),
    () => ({ players: [], time: 1000 }),
    players => { players[0].landmarks[11].visibility = 0.49; return { players, time: 1000 }; },
    players => ({ players, time: NaN }),
    players => ({ players, time: Infinity }),
    players => ({ players, time: 0 }),
    players => ({ players, time: 2000 }),
    players => ({ players: [player(1, 0.8, 0.4, 0.1), players[1]], time: 1000 }),
    players => { players[0].id = 3; return { players, time: 1000 }; },
  ];
  for (const change of cases) {
    const controller = new FramingController();
    const input = [player(1, 0.3, 0.4, 0.1), player(2, 0.65, 0.5, 0.1)];
    for (let index = 0; index < 30; index++) controller.update(input, index * 33);
    const next = change(structuredClone(input));
    assert.deepEqual(controller.update(next.players, next.time), full);
  }
  const controller = new FramingController();
  for (let index = 0; index < 30; index++) controller.update([player()], index * 33);
  controller.reset();
  assert.deepEqual(controller.update([player()], 1000), full);
});

test('stable jitter does not cause zoom breathing and persistent movement is followed', () => {
  const controller = new FramingController();
  for (let index = 0; index < 180; index++) controller.update([player()], index * 33);
  const frames: Rect[] = [];
  for (let index = 180; index < 220; index++) {
    const sign = index % 2 ? -1 : 1;
    const input = [player(1, 0.5 + sign * 0.002, 0.4 - sign * 0.002, 0.12 * (1 + sign * 0.005))];
    const frame = controller.update(input, index * 33);
    containsPlayers(frame, input);
    frames.push(frame);
  }
  for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.max(...frames.map(frame => frame[key])) - Math.min(...frames.map(frame => frame[key])) < 0.002);
  const start = frames.at(-1)!;
  let final = start;
  for (let index = 220; index < 340; index++) final = controller.update([player(1, 0.62, 0.4)], index * 33);
  assert.ok(final.x > start.x + 0.06);
  bounded(final);
});

test('random reliable extensions always remain inside a bounded common frame', () => {
  const controller = new FramingController();
  let seed = 42;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let index = 0; index < 1000; index++) {
    const players = [player(1, 0.3, 0.35, 0.12), player(2, 0.7, 0.6, 0.08)];
    for (const input of players) {
      input.landmarks[15] = { x: random(), y: random(), visibility: 1 };
      input.landmarks[16] = { x: random(), y: random(), visibility: 1 };
      input.wrists = [{ ...input.landmarks[15] }, { ...input.landmarks[16] }];
    }
    const frame = controller.update(players, index * 33);
    bounded(frame);
    containsPlayers(frame, players);
  }
});

test('framing fit mirrors the selected view onto its contained destination', () => {
  assert.deepEqual(framingFit(1280, 720, 800, 600, full), fitRect(1280, 720, 800, 600));
  for (const view of [{ x: 0.1, y: 0.2, width: 0.7, height: 0.7 }, { x: 0.2, y: 0.1, width: 0.4, height: 0.8 }]) {
    const fit = framingFit(1280, 720, 1920, 1080, view);
    const visible = fitRect(1280 * view.width, 720 * view.height, 1920, 1080);
    const originalLeft = toStage({ x: view.x, y: view.y }, fit);
    const originalRight = toStage({ x: view.x + view.width, y: view.y + view.height }, fit);
    near(originalLeft.x, visible.x + visible.width);
    near(originalLeft.y, visible.y);
    near(originalRight.x, visible.x);
    near(originalRight.y, visible.y + visible.height);
  }
});

test('framing fit rejects invalid geometry instead of emitting NaN coordinates', () => {
  for (const value of [0, -1, NaN, Infinity]) {
    for (let index = 0; index < 4; index++) {
      const dimensions: [number, number, number, number] = [1280, 720, 1920, 1080];
      dimensions[index] = value;
      assert.throws(() => framingFit(...dimensions, full), RangeError);
    }
  }
  for (const view of [{ ...full, x: -0.01 }, { ...full, y: 0.1 }, { ...full, width: 0 }, { ...full, height: Infinity }, { ...full, x: NaN }]) assert.throws(() => framingFit(1280, 720, 1920, 1080, view), RangeError);
});
