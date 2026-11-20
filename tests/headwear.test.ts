import test from 'node:test';
import assert from 'node:assert/strict';
import { headwearAnchor, HeadwearTracker } from '../src/interaction/headwear.ts';
import { drawUnicornPony } from '../src/ui/unicorn.ts';
import type { Rect, TrackedPlayer } from '../src/types.ts';

const fit: Rect = { x: 0, y: 0, width: 1000, height: 600 };

function person(options: { x?: number; y?: number; width?: number; tilt?: number; face?: boolean } = {}): TrackedPlayer {
  const x = options.x ?? 0.5;
  const y = options.y ?? 0.55;
  const width = options.width ?? 0.24;
  const tilt = options.tilt ?? 0;
  const face = options.face ?? true;
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  landmarks[11] = { x: x - width / 2, y, visibility: 1 };
  landmarks[12] = { x: x + width / 2, y, visibility: 1 };
  if (face) {
    landmarks[0] = { x, y: y - width * 0.65, visibility: 1 };
    landmarks[2] = { x: x + width * 0.12, y: y - width * 0.78 - tilt, visibility: 1 };
    landmarks[5] = { x: x - width * 0.12, y: y - width * 0.78 + tilt, visibility: 1 };
    landmarks[7] = { x: x + width * 0.24, y: y - width * 0.74 - tilt, visibility: 1 };
    landmarks[8] = { x: x - width * 0.24, y: y - width * 0.74 + tilt, visibility: 1 };
  }
  return { id: 1, center: { x, y }, shoulderWidth: width, landmarks, wrists: [null, null], raised: false, bothRaised: false };
}

test('headwearAnchor places the unicorn above the eyes, scales with body size, and follows head tilt', () => {
  const upright = headwearAnchor(person(), fit)!;
  assert.ok(upright !== null);
  assert.ok(Math.abs(upright.x - 500) < 1);
  assert.ok(upright.y < (0.55 - 0.24 * 0.78) * 600);
  assert.ok(Math.abs(upright.angle) < 1e-6);
  const closer = headwearAnchor(person({ width: 0.38 }), fit)!;
  assert.ok(closer.size > upright.size);
  const tilted = headwearAnchor(person({ tilt: 0.04 }), fit)!;
  assert.ok(tilted.angle > 0.05 && tilted.angle <= 0.55);
  assert.ok(tilted.x > upright.x);
  const shouldersOnly = headwearAnchor(person({ face: false }), fit)!;
  assert.ok(shouldersOnly !== null && shouldersOnly.y < 0.55 * 600);
  const empty = { ...person({ face: false }), landmarks: [] };
  assert.equal(headwearAnchor(empty, fit), null);
});

test('HeadwearTracker smooths micro-jitter and resets after gaps or large jumps', () => {
  const tracker = new HeadwearTracker();
  const first = tracker.update(person({ x: 0.5 }), fit, 100)!;
  const jittered = tracker.update(person({ x: 0.501 }), fit, 133)!;
  assert.ok(Math.abs(jittered.x - first.x) < 0.5);
  const jumped = tracker.update(person({ x: 0.1 }), fit, 166)!;
  assert.ok(Math.abs(jumped.x - 900) < 1);
  const afterGap = tracker.update(person({ x: 0.7 }), fit, 500)!;
  assert.ok(Math.abs(afterGap.x - 300) < 1);
});

test('drawUnicornPony draws vector strokes and fills without using createRadialGradient', () => {
  let radialUsed = false;
  let fills = 0;
  let strokes = 0;
  const ctx = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    ellipse() {},
    arc() {},
    fill() { fills += 1; },
    stroke() { strokes += 1; },
    createRadialGradient() { radialUsed = true; return { addColorStop() {} }; },
  } as unknown as CanvasRenderingContext2D;
  drawUnicornPony(ctx, { x: 500, y: 180, size: 120, angle: 0.1 }, 0, 1000);
  drawUnicornPony(ctx, { x: 250, y: 200, size: 96, angle: -0.1 }, 1, 1000);
  assert.equal(radialUsed, false);
  assert.ok(fills > 20 && strokes > 15);
});
