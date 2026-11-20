import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReachZone, Rect } from '../src/types.ts';
import { BubbleField } from '../src/game/field.ts';
import { toStage } from '../src/interaction/geometry.ts';

const fit: Rect = { x: 0, y: 0, width: 1000, height: 1000 };
const zone: ReachZone = { playerId: 1, x: 0.4, y: 0.4, width: 0.2, height: 0.2 };

function circles(field: BubbleField, transform = fit) {
  const output: { x: number; y: number; radius: number }[] = [];
  const gradient = { addColorStop() {} };
  const context = {
    createRadialGradient: () => gradient,
    beginPath() {},
    arc(x: number, y: number, radius: number, start: number, end: number) { if (start === 0 && end === Math.PI * 2) output.push({ x, y, radius }); },
    fill() {},
    stroke() {},
    fillText() {},
  } as unknown as CanvasRenderingContext2D;
  field.draw(context, transform);
  return output;
}

test('changing zones retires outside bubbles without hits or misses and affects new births', context => {
  context.mock.method(Math, 'random', () => 0.5);
  const hits: string[] = [];
  let misses = 0;
  const input = [{ ...zone }];
  const field = new BubbleField(input, true, id => { hits.push(id); return true; }, () => { misses++; });
  input[0].x = 0;
  field.update(100, fit);
  assert.deepEqual(circles(field).map(({ x, y }) => ({ x, y })), [{ x: 500, y: 500 }]);
  field.setZones([{ playerId: 1, x: 0.7, y: 0.1, width: 0.2, height: 0.2 }]);
  assert.deepEqual(circles(field), []);
  assert.deepEqual(hits, []);
  assert.equal(misses, 0);
  field.update(1100, fit);
  const fresh = circles(field)[0];
  assert.ok(fresh.x >= 100 && fresh.x <= 300);
  assert.ok(fresh.y >= 100 && fresh.y <= 300);
  field.setZones([]);
  assert.deepEqual(circles(field), []);
  assert.equal(misses, 0);
});

test('retained bubbles keep source position, identity and age across area updates', context => {
  context.mock.method(Math, 'random', () => 0.5);
  const attempted: string[] = [];
  let misses = 0;
  const field = new BubbleField([zone], true, id => { attempted.push(id); return false; }, () => { misses++; });
  field.update(100, fit);
  const before = circles(field)[0];
  field.pointer(before, fit);
  const next = { playerId: 1, x: 0.45, y: 0.45, width: 0.1, height: 0.1 };
  field.setZones([next]);
  next.x = 0;
  assert.deepEqual(circles(field), [before]);
  assert.equal(attempted.length, 1);
  field.pointer(before, fit);
  assert.equal(attempted[0], attempted[1]);
  field.update(8400, fit);
  assert.deepEqual(circles(field), []);
  assert.equal(misses, 1);
});

test('significant area reassignment clears old sweeps but identical zones preserve real movement', context => {
  context.mock.method(Math, 'random', () => 0.5);
  const hits: string[] = [];
  const field = new BubbleField([zone], true, id => { hits.push(id); return true; }, () => {});
  field.update(100, fit);
  field.hands([{ id: '1-left', point: { x: 0.32, y: 0.5 } }], 0, fit);
  field.setZones([{ ...zone, x: 0.35, width: 0.3 }]);
  field.hands([{ id: '1-left', point: { x: 0.68, y: 0.5 } }], 50, fit);
  assert.deepEqual(hits, []);
  field.setZones([{ ...zone, x: 0.35, width: 0.3 }]);
  field.hands([{ id: '1-left', point: { x: 0.32, y: 0.5 } }], 100, fit);
  assert.equal(hits.length, 1);
});

test('continuous small zone adaptation preserves a real source sweep', context => {
  context.mock.method(Math, 'random', () => 0.5);
  const hits: string[] = [];
  const field = new BubbleField([zone], true, id => { hits.push(id); return true; }, () => {});
  field.update(100, fit);
  field.hands([{ id: '1-left', point: { x: 0.32, y: 0.5 } }], 0, fit);
  field.setZones([{ ...zone, x: zone.x + 0.002, width: zone.width * 1.005 }]);
  field.hands([{ id: '1-left', point: { x: 0.68, y: 0.5 } }], 50, fit);
  assert.equal(hits.length, 1);
});

test('stationary source hands cannot create a sweep through a translated or zoomed bubble', context => {
  context.mock.method(Math, 'random', () => 0.5);
  const hits: string[] = [];
  const field = new BubbleField([zone], true, id => { hits.push(id); return true; }, () => {});
  field.update(100, fit);
  const hand = { id: '1-left', point: { x: 0.7, y: 0.5 } };
  field.hands([hand], 0, fit);
  field.hands([hand], 50, { ...fit, x: -300 });
  assert.deepEqual(hits, []);
  const compact = { x: 300, y: 300, width: 200, height: 200 };
  field.hands([hand], 100, compact);
  assert.deepEqual(hits, []);
  assert.equal(circles(field, compact)[0].radius, circles(field)[0].radius / 5);
});

test('a real source sweep remains valid while the displayed framing changes', context => {
  context.mock.method(Math, 'random', () => 0.5);
  const hits: string[] = [];
  const field = new BubbleField([zone], true, id => { hits.push(id); return true; }, () => {});
  field.update(100, fit);
  const old = { x: 0.32, y: 0.5 };
  field.hands([{ id: '1-left', point: old }], 0, fit);
  old.x = 0.9;
  field.hands([{ id: '1-left', point: { x: 0.68, y: 0.5 } }], 50, { x: -100, y: -100, width: 1400, height: 1400 });
  assert.equal(hits.length, 1);
  assert.deepEqual(circles(field), []);
});

test('invalid hands and clocks clear their motion instead of creating later sweep hits', context => {
  context.mock.method(Math, 'random', () => 0.5);
  const hits: string[] = [];
  const field = new BubbleField([zone], true, id => { hits.push(id); return true; }, () => {});
  field.update(100, fit);
  field.hands([{ id: '1-left', point: { x: 0.32, y: 0.5 } }], 0, fit);
  field.hands([{ id: '1-left', point: { x: NaN, y: 0.5 } }], 20, fit);
  field.hands([{ id: '1-left', point: { x: 0.68, y: 0.5 } }], 40, fit);
  assert.deepEqual(hits, []);
  field.hands([{ id: '1-left', point: { x: 0.5, y: 0.5 } }], NaN, fit);
  assert.deepEqual(hits, []);
  field.pointer(toStage({ x: 0.5, y: 0.5 }, fit), fit);
  assert.equal(hits.length, 1);
});
