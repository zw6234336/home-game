import test from 'node:test';
import assert from 'node:assert/strict';
import { HeartCatchField, type BombHitEvent, type HeartCatchEvent } from '../src/game/hearts.ts';
import { faceAnchor } from '../src/interaction/headwear.ts';
import { drawSootFace } from '../src/ui/soot-face.ts';
import { createRound, hit, penalty } from '../src/game/round.ts';
import type { ReachZone, Rect, TrackedPlayer } from '../src/types.ts';

const fit: Rect = { x: 0, y: 0, width: 1000, height: 600 };
const zone: ReachZone = { playerId: 1, x: 0.2, y: 0.3, width: 0.6, height: 0.5 };

function mockCanvas() {
  let radialUsed = false;
  let paths = 0;
  const ctx = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    setLineDash() {},
    beginPath() { paths += 1; },
    closePath() {},
    moveTo() {},
    lineTo() {},
    rect() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    ellipse() {},
    arc() {},
    fill() {},
    stroke() {},
    strokeText() {},
    fillText() {},
    createRadialGradient() { radialUsed = true; return { addColorStop() {} }; },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, stats: () => ({ radialUsed, paths }) };
}

test('HeartCatchField spreads drops across wide lanes and catches hearts with a shoulder-width basket', context => {
  context.mock.method(Math, 'random', () => 0.25);
  let round = createRound();
  const caught: HeartCatchEvent[] = [];
  const positions: number[] = [];
  const field = new HeartCatchField(
    [zone],
    true,
    event => {
      const next = hit(round, event.id, event.points);
      if (next === round) return false;
      round = next;
      caught.push(event);
      return true;
    },
    () => {},
  );
  for (let step = 0; step < 50; step += 1) {
    field.update(180, fit);
    const sweepX = 0.1 + ((step * 7) % 10) * 0.085;
    field.hands([{ playerId: 1, left: { x: Math.max(0.02, sweepX - 0.08), y: 0.45 }, right: { x: Math.min(0.98, sweepX + 0.08), y: 0.45 }, shoulderWidth: 0.18 }], fit, step * 180);
  }
  assert.ok(caught.length >= 2);
  assert.equal(caught[0].kind, 'gold');
  assert.equal(caught[0].points, 30);
  assert.ok(round.score >= 60);

  const probe = new HeartCatchField([zone], true, () => false, () => {});
  const { ctx } = mockCanvas();
  const drawnX: number[] = [];
  const origTranslate = ctx.translate;
  ctx.translate = (x: number, y: number) => {
    if (y > 0 && y < 600) drawnX.push(x);
    origTranslate.call(ctx, x, y);
  };
  for (let i = 0; i < 6; i += 1) probe.update(900, fit);
  probe.draw(ctx, fit);
  for (const x of drawnX) positions.push(x / fit.width);
  assert.ok(positions.some(x => x < 0.3));
  assert.ok(positions.some(x => x > 0.7));
});

test('HeartCatchField keeps basket width proportional to shoulder width rather than full arm span', context => {
  context.mock.method(Math, 'random', () => 0.25);
  const caught: HeartCatchEvent[] = [];
  const field = new HeartCatchField([zone], true, event => { caught.push(event); return true; }, () => {});
  field.update(200, fit);
  for (let step = 0; step < 30; step += 1) {
    field.update(100, fit);
    field.hands([{ playerId: 1, left: { x: 0.05, y: 0.45 }, right: { x: 0.95, y: 0.45 }, shoulderWidth: 0.14 }], fit, step * 100);
  }
  assert.ok(!caught.some(event => event.id === 'heart-1'));
});

test('HeartCatchField bombs transform only the catcher for active game time and dodging does not penalize', context => {
  context.mock.method(Math, 'random', () => 0.05);
  let round = hit(createRound(), 'seed-1', 30);
  const bombs: BombHitEvent[] = [];
  let misses = 0;
  const field = new HeartCatchField(
    [zone],
    true,
    () => true,
    () => { misses += 1; },
    event => {
      const next = penalty(round, event.id, event.points);
      if (next === round) return false;
      round = next;
      bombs.push(event);
      return true;
    },
  );
  field.update(200, fit);
  for (let step = 0; step < 65; step += 1) field.update(100, fit);
  assert.equal(misses, 0);
  assert.equal(bombs.length, 0);

  const live = new HeartCatchField(
    [zone],
    true,
    () => true,
    () => {},
    event => {
      round = penalty(round, event.id, event.points);
      bombs.push(event);
      return true;
    },
  );
  live.update(200, fit);
  let hitAt = 0;
  for (let step = 0; step < 30; step += 1) {
    live.update(100, fit);
    hitAt = 1000 + step * 100;
    live.hands([{ playerId: 1, left: { x: 0.08, y: 0.42 }, right: { x: 0.22, y: 0.42 }, shoulderWidth: 0.2 }], fit, hitAt);
    if (bombs.length > 0) break;
  }
  assert.equal(bombs.length, 1);
  assert.equal(round.score, 10);
  assert.equal(round.combo, 0);
  assert.deepEqual(live.faceEffect(1), { kind: 'soot', alpha: 1, elapsedMs: 0 });
  assert.equal(live.faceEffect(2), null);
  live.clearTrails();
  assert.equal(live.faceEffect(1)?.elapsedMs, 0);
  live.update(4000, fit);
  assert.ok(live.faceEffect(1)!.alpha > 0 && live.faceEffect(1)!.alpha < 1);
  live.update(500, fit);
  assert.equal(live.faceEffect(1), null);

  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  landmarks[0] = { x: 0.5, y: 0.34, visibility: 1 };
  landmarks[2] = { x: 0.53, y: 0.3, visibility: 1 };
  landmarks[5] = { x: 0.47, y: 0.3, visibility: 1 };
  landmarks[11] = { x: 0.4, y: 0.5, visibility: 1 };
  landmarks[12] = { x: 0.6, y: 0.5, visibility: 1 };
  const player: TrackedPlayer = { id: 1, center: { x: 0.5, y: 0.5 }, shoulderWidth: 0.2, landmarks, wrists: [null, null], raised: false, bothRaised: false };
  const face = faceAnchor(player, fit)!;
  assert.ok(face !== null && Math.abs(face.x - 500) < 1);
  const { ctx, stats } = mockCanvas();
  live.draw(ctx, fit);
  drawSootFace(ctx, face, 1, 2000);
  assert.equal(stats().radialUsed, false);
  assert.ok(stats().paths > 10);
});
