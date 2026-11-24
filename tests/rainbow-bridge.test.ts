import test from 'node:test';
import assert from 'node:assert/strict';
import type { Landmark, Rect, TrackedPlayer } from '../src/types.ts';
import { RainbowBridgeField, type BridgeEvent } from '../src/game/rainbow-bridge.ts';

const fit: Rect = { x: 0, y: 0, width: 1280, height: 720 };

function player(
  id: number,
  screenX: number,
  shoulderY = 0.52,
  options: { width?: number; leftWristX?: number; rightWristX?: number; wristY?: number; depthMeters?: number | null } = {},
): TrackedPlayer {
  const x = 1 - screenX;
  const width = options.width ?? 0.14;
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  landmarks[11] = { x: Math.max(0.02, x - width / 2), y: shoulderY, visibility: 1 };
  landmarks[12] = { x: Math.min(0.98, x + width / 2), y: shoulderY, visibility: 1 };
  landmarks[23] = { x: Math.max(0.02, x - width / 3), y: Math.min(0.96, shoulderY + 0.25), visibility: 1 };
  landmarks[24] = { x: Math.min(0.98, x + width / 3), y: Math.min(0.96, shoulderY + 0.25), visibility: 1 };
  const lwX = 1 - (options.leftWristX ?? Math.max(0.04, screenX - 0.16));
  const rwX = 1 - (options.rightWristX ?? Math.min(0.96, screenX + 0.16));
  const wy = options.wristY ?? shoulderY;
  return {
    id,
    center: { x, y: shoulderY + 0.1 },
    shoulderWidth: width,
    landmarks,
    wrists: [{ x: lwX, y: wy }, { x: rwX, y: wy }],
    raised: wy < shoulderY - 0.04,
    bothRaised: wy < shoulderY - 0.04,
    depthMeters: options.depthMeters ?? null,
    depthConfidence: options.depthMeters ? 0.9 : 0,
  };
}

function advance(field: RainbowBridgeField, totalMs: number, stepMs = 80, tick?: (elapsed: number) => void): void {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    tick?.(elapsed);
    field.update(stepMs, fit);
  }
}

test('RainbowBridgeField solo player escorts sprite to castle and collects floating sky star', () => {
  const events: BridgeEvent[] = [];
  const field = new RainbowBridgeField(1, true, event => events.push(event), () => {}, () => 0.5);
  field.setRemainingMs(52000);

  advance(field, 9200, 80, elapsed => {
    const progress = Math.min(1, elapsed / 7200);
    const sx = 0.24 + progress * 0.56;
    const wristY = elapsed > 2300 && elapsed < 3200 ? 0.36 : 0.54;
    field.observePlayers([player(1, sx, 0.52, { leftWristX: sx - 0.2, rightWristX: sx + 0.2, wristY })], fit);
  });

  const escort = events.find(e => e.kind === 'escort');
  const star = events.find(e => e.kind === 'star');
  assert.ok(escort, 'expected sprite escort event');
  assert.equal(escort.points, 40);
  assert.ok(star, 'expected sky star collection event');
  assert.equal(star.points, 20);
  assert.equal(field.stats.escorted >= 1, true);
  assert.equal(field.stats.stars >= 1, true);
});

test('RainbowBridgeField duo cooperative link bridges canyon gap and awards link bonus', () => {
  const events: BridgeEvent[] = [];
  let chimes = 0;
  const field = new RainbowBridgeField(2, true, event => events.push(event), () => { chimes += 1; }, () => 0.5);

  advance(field, 8500, 80, () => {
    const p1 = player(1, 0.28, 0.54, { leftWristX: 0.12, rightWristX: 0.42, wristY: 0.54 });
    const p2 = player(2, 0.72, 0.54, { leftWristX: 0.58, rightWristX: 0.88, wristY: 0.54 });
    field.observePlayers([p1, p2], fit);
  });

  assert.equal(field.stats.linked, true);
  assert.equal(chimes, 1);
  const escort = events.find(e => e.kind === 'escort');
  assert.ok(escort);
  assert.equal(escort.linked, true);
  assert.equal(escort.points, 50);
});

test('RainbowBridgeField supports parachute mid-air recovery and zero-penalty gentle miss', () => {
  const events: BridgeEvent[] = [];
  const field = new RainbowBridgeField(1, true, event => events.push(event), () => {}, () => 0.5);

  advance(field, 1800, 80, () => {
    field.observePlayers([player(1, 0.25, 0.54, { leftWristX: 0.1, rightWristX: 0.35 })], fit);
  });
  advance(field, 1200, 80, () => {
    field.observePlayers([player(1, 0.85, 0.54, { leftWristX: 0.75, rightWristX: 0.95 })], fit);
  });
  advance(field, 7500, 80, elapsed => {
    const sx = 0.34 + Math.min(1, elapsed / 5500) * 0.48;
    field.observePlayers([player(1, sx, 0.7, { leftWristX: sx - 0.18, rightWristX: sx + 0.18, wristY: 0.7 })], fit);
  });
  assert.ok(events.some(e => e.kind === 'escort'), 'expected mid-air caught sprite to finish escort');

  const missEvents: BridgeEvent[] = [];
  const missField = new RainbowBridgeField(1, true, event => missEvents.push(event), () => {}, () => 0.5);
  advance(missField, 5500, 80, () => {
    missField.observePlayers([player(1, 0.88, 0.54, { leftWristX: 0.8, rightWristX: 0.96 })], fit);
  });
  const missed = missEvents.find(e => e.kind === 'missed');
  assert.ok(missed);
  assert.equal(missed.points, 0);
  assert.equal(missField.stats.missed >= 1, true);
});

test('RainbowBridgeField evaluates thunder cloud ducking dodge and zapped feedback', () => {
  const dodgeEvents: BridgeEvent[] = [];
  const dodgeField = new RainbowBridgeField(2, true, event => dodgeEvents.push(event), () => {}, () => 0.5);
  dodgeField.setRemainingMs(38000);
  dodgeField.observePlayers([player(1, 0.3, 0.36), player(2, 0.7, 0.42)], fit);
  advance(dodgeField, 1900, 100, () => {
    dodgeField.observePlayers([player(1, 0.3, 0.36), player(2, 0.7, 0.42)], fit);
  });
  advance(dodgeField, 3000, 100, () => {
    dodgeField.observePlayers([player(1, 0.3, 0.48), player(2, 0.7, 0.53)], fit);
  });
  const dodge = dodgeEvents.find(e => e.kind === 'dodge');
  assert.ok(dodge);
  assert.equal(dodge.points, 30);
  assert.equal(dodgeField.stats.dodged, 1);

  const zapEvents: BridgeEvent[] = [];
  const zapField = new RainbowBridgeField(1, true, event => zapEvents.push(event), () => {}, () => 0.5);
  zapField.setRemainingMs(38000);
  zapField.observePlayers([player(1, 0.5, 0.36)], fit);
  advance(zapField, 4900, 100, () => {
    zapField.observePlayers([player(1, 0.5, 0.36)], fit);
  });
  const zapped = zapEvents.find(e => e.kind === 'zapped');
  assert.ok(zapped);
  assert.equal(zapped.points, 0);
});

test('RainbowBridgeField activates stereo depth tailwind when stepping forward', () => {
  const field = new RainbowBridgeField(1, true, () => {}, () => {}, () => 0.5);
  field.observePlayers([player(1, 0.5, 0.5, { depthMeters: 2.1 })], fit);
  assert.equal(field.stats.tailwind, false);
  field.observePlayers([player(1, 0.5, 0.5, { depthMeters: 1.85 })], fit);
  assert.equal(field.stats.tailwind, true);
});

test('RainbowBridgeField supports mouse demo pointer and renders without createRadialGradient', () => {
  const events: BridgeEvent[] = [];
  const field = new RainbowBridgeField(1, true, event => events.push(event), () => {}, () => 0.5);
  advance(field, 9000, 80, elapsed => {
    const progress = Math.min(1, elapsed / 7200);
    field.pointer({ x: fit.x + fit.width * (0.18 + progress * 0.66), y: fit.y + fit.height * 0.55 }, fit);
  });
  assert.ok(events.some(e => e.kind === 'escort'));

  const calls: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_target, prop) {
      if (prop === 'createRadialGradient') throw new Error('createRadialGradient forbidden');
      return (..._args: unknown[]) => { calls.push(String(prop)); };
    },
    set() { return true; },
  });
  field.setRemainingMs(36000);
  advance(field, 2400, 100, () => {
    field.pointer({ x: fit.x + fit.width * 0.5, y: fit.y + fit.height * 0.5 }, fit);
  });
  field.draw(ctx, fit);
  assert.ok(calls.includes('stroke') && calls.includes('fill'));
});
