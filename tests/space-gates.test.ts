import test from 'node:test';
import assert from 'node:assert/strict';
import type { Landmark, Rect, TrackedPlayer } from '../src/types.ts';
import { SpaceGatesField, type GateEvent } from '../src/game/space-gates.ts';
import { drawCostumeFace, drawDemoFace } from '../src/ui/storybook-art.ts';

const fit: Rect = { x: 0, y: 0, width: 1280, height: 720 };

function player(
  id: number,
  screenX: number,
  shoulderY = 0.36,
  options: { width?: number; raised?: boolean; bothRaised?: boolean; depthMeters?: number | null; wristX?: number; wristY?: number } = {},
): TrackedPlayer {
  const x = 1 - screenX;
  const width = options.width ?? 0.14;
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  landmarks[11] = { x: Math.max(0.02, x - width / 2), y: shoulderY, visibility: 1 };
  landmarks[12] = { x: Math.min(0.98, x + width / 2), y: shoulderY, visibility: 1 };
  landmarks[23] = { x: Math.max(0.02, x - width / 3), y: Math.min(0.96, shoulderY + 0.28), visibility: 1 };
  landmarks[24] = { x: Math.min(0.98, x + width / 3), y: Math.min(0.96, shoulderY + 0.28), visibility: 1 };
  const wx = options.wristX !== undefined ? 1 - options.wristX : x;
  const wy = options.wristY ?? shoulderY + 0.08;
  return {
    id,
    center: { x, y: shoulderY + 0.12 },
    shoulderWidth: width,
    landmarks,
    wrists: [{ x: wx, y: wy }, { x: wx, y: wy }],
    raised: options.raised ?? false,
    bothRaised: options.bothRaised ?? false,
    depthMeters: options.depthMeters ?? null,
    depthConfidence: options.depthMeters ? 0.9 : 0,
  };
}

function advance(field: SpaceGatesField, totalMs: number, stepMs = 80, tick?: () => void): void {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    tick?.();
    field.update(stepMs, fit);
  }
}

test('SpaceGatesField evaluates lateral left/right, ducking, and raised hands accurately', () => {
  const events: GateEvent[] = [];
  let pick = 0;
  const seq = [0, 0.2, 0.5, 0.9];
  const field = new SpaceGatesField(1, true, event => events.push(event), () => {}, () => seq[pick++ % seq.length]);

  field.observePlayers([player(1, 0.5, 0.35, { depthMeters: 2.0 })], fit);
  advance(field, 420);
  const firstKind = field.stats.currentGate?.kind;
  assert.ok(firstKind);

  advance(field, 5200, 100, () => {
    const kind = field.stats.currentGate?.kind;
    if (kind === 'left') field.observePlayers([player(1, 0.28, 0.35, { depthMeters: 2.0 })], fit);
    else if (kind === 'right') field.observePlayers([player(1, 0.72, 0.35, { depthMeters: 2.0 })], fit);
    else if (kind === 'duck') field.observePlayers([player(1, 0.5, 0.52, { depthMeters: 2.0 })], fit);
    else if (kind === 'reach') field.observePlayers([player(1, 0.5, 0.35, { raised: true, bothRaised: true, depthMeters: 2.0 })], fit);
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'perfect');
  assert.equal(events[0].points, 50);
  assert.equal(field.stats.passed, 1);
});

test('SpaceGatesField uses stereo depth for step-near and step-far gates and falls back to shoulder scale without stereo', () => {
  const events: GateEvent[] = [];
  const field = new SpaceGatesField(1, true, event => events.push(event), () => {}, () => 0.85);
  field.setRemainingMs(32000);
  field.observePlayers([player(1, 0.5, 0.36, { depthMeters: 2.0, width: 0.14 })], fit);
  advance(field, 420);
  const kind = field.stats.currentGate?.kind;
  assert.ok(kind === 'step-near' || kind === 'step-far', `expected depth gate, got ${kind}`);

  advance(field, 4500, 100, () => {
    const depth = kind === 'step-near' ? 1.65 : 2.38;
    field.observePlayers([player(1, 0.5, 0.36, { depthMeters: depth, width: 0.14 })], fit);
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'perfect');

  const monoEvents: GateEvent[] = [];
  const monoField = new SpaceGatesField(1, true, event => monoEvents.push(event), () => {}, () => 0.85);
  monoField.setRemainingMs(32000);
  monoField.observePlayers([player(1, 0.5, 0.36, { depthMeters: null, width: 0.14 })], fit);
  advance(monoField, 420);
  const monoKind = monoField.stats.currentGate?.kind;
  advance(monoField, 4500, 100, () => {
    const width = monoKind === 'step-near' ? 0.18 : 0.11;
    monoField.observePlayers([player(1, 0.5, 0.36, { depthMeters: null, width })], fit);
  });
  assert.equal(monoEvents.length, 1);
  assert.equal(monoEvents[0].outcome, 'perfect');
});

test('SpaceGatesField teammate shield star rescues an unsafe partner and awards +40 without losing combo', () => {
  const events: GateEvent[] = [];
  let shieldCollected = 0;
  const field = new SpaceGatesField(2, true, event => events.push(event), () => { shieldCollected += 1; }, () => 0);
  field.observePlayers([player(1, 0.25, 0.35), player(2, 0.78, 0.45)], fit);
  advance(field, 420);
  assert.equal(field.stats.currentGate?.kind, 'left');

  advance(field, 1200, 100, () => {
    field.observePlayers([player(1, 0.28, 0.35, { wristX: 0.28, wristY: 0.34 }), player(2, 0.8, 0.45)], fit);
  });
  assert.equal(shieldCollected, 1);
  assert.equal(field.stats.shieldActive, true);

  advance(field, 4200, 100, () => {
    field.observePlayers([player(1, 0.28, 0.35), player(2, 0.8, 0.45)], fit);
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'shielded');
  assert.equal(events[0].points, 40);
  assert.equal(field.stats.rescues, 1);
  assert.equal(field.stats.shieldActive, false);
});

test('SpaceGatesField supports mouse demo mode and gentle zero-penalty miss', () => {
  const events: GateEvent[] = [];
  const field = new SpaceGatesField(1, true, event => events.push(event), () => {}, () => 0);
  advance(field, 420);
  assert.equal(field.stats.currentGate?.kind, 'left');
  field.pointer({ x: 960, y: 360 }, fit, false);
  advance(field, 5200, 100);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'missed');
  assert.equal(events[0].points, 0);
  assert.equal(field.stats.missed, 1);
});

test('SpaceGatesField renders on 2D canvas without createRadialGradient', () => {
  const calls: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_target, prop) {
      if (prop === 'createRadialGradient') throw new Error('createRadialGradient forbidden');
      return (..._args: unknown[]) => { calls.push(String(prop)); };
    },
    set() { return true; },
  });
  const field = new SpaceGatesField(2, true, () => {}, () => {}, () => 0.1);
  field.observePlayers([player(1, 0.3, 0.35, { depthMeters: 1.9 }), player(2, 0.7, 0.45, { depthMeters: 2.1 })], fit);
  advance(field, 1400, 100);
  field.draw(ctx, fit);
  assert.ok(calls.includes('stroke') && calls.includes('fill'));
});

test('SpaceGatesField transforms safe players to princess and danger players to pink-bunny per ID', () => {
  const field = new SpaceGatesField(2, true, () => {}, () => {}, () => 0);
  advance(field, 420);
  assert.equal(field.stats.currentGate?.kind, 'left');

  field.observePlayers([player(1, 0.25, 0.35), player(2, 0.8, 0.35)], fit);
  assert.equal(field.faceEffect(1)?.kind, 'princess');
  assert.equal(field.faceEffect(2)?.kind, 'pink-bunny');

  field.update(200, fit);
  field.observePlayers([player(1, 0.78, 0.35), player(2, 0.24, 0.35)], fit);
  assert.equal(field.faceEffect(1)?.kind, 'pink-bunny');
  assert.equal(field.faceEffect(1)?.elapsedMs, 0);
  assert.equal(field.faceEffect(2)?.kind, 'princess');
  assert.equal(field.faceEffect(2)?.elapsedMs, 0);
});

test('SpaceGatesField preserves resolved pink-bunny transformation through cooldown and supports demo pointer switching', () => {
  const events: GateEvent[] = [];
  const field = new SpaceGatesField(1, true, event => events.push(event), () => {}, () => 0);
  advance(field, 420);
  assert.equal(field.stats.currentGate?.kind, 'left');

  field.pointer({ x: 260, y: 360 }, fit, false);
  assert.equal(field.faceEffect(1)?.kind, 'princess');

  field.pointer({ x: 960, y: 360 }, fit, false);
  assert.equal(field.faceEffect(1)?.kind, 'pink-bunny');

  advance(field, 5200, 100);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'missed');
  assert.equal(field.stats.currentGate === null, true);
  assert.equal(field.faceEffect(1)?.kind, 'pink-bunny');

  advance(field, 800, 100);
  const nextGate = field.stats.currentGate;
  assert.ok(nextGate);
  assert.equal(nextGate.kind, 'right');
  field.pointer({ x: 960, y: 360 }, fit, false);
  assert.equal(field.faceEffect(1)?.kind, 'princess');
});

test('drawCostumeFace and drawDemoFace render princess and pink-bunny without createRadialGradient', () => {
  const calls: string[] = [];
  const labels: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_target, prop) {
      if (prop === 'createRadialGradient') throw new Error('createRadialGradient forbidden');
      if (prop === 'fillText') return (text: string) => { calls.push('fillText'); labels.push(text); };
      return (..._args: unknown[]) => { calls.push(String(prop)); };
    },
    set() { return true; },
  });

  drawCostumeFace(ctx, { x: 240, y: 200, size: 96, angle: 0 }, { kind: 'princess', alpha: 1, elapsedMs: 120 });
  drawCostumeFace(ctx, { x: 520, y: 200, size: 96, angle: 0 }, { kind: 'pink-bunny', alpha: 1, elapsedMs: 240 });
  drawDemoFace(ctx, 1188, 100, 48, { kind: 'princess', alpha: 1, elapsedMs: 300 });
  drawDemoFace(ctx, 1188, 100, 48, { kind: 'pink-bunny', alpha: 1, elapsedMs: 450 });

  assert.ok(calls.includes('fill') && calls.includes('stroke'));
  assert.ok(labels.some(text => text.includes('小公主') && text.includes('演示')));
  assert.ok(labels.some(text => text.includes('粉色毛兔') && text.includes('演示')));
});
