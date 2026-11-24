import test from 'node:test';
import assert from 'node:assert/strict';
import type { Landmark, PoseObservation, StereoMeasurement, TrackedPlayer } from '../src/types.ts';
import { stereoCropPreset } from '../src/platform/camera.ts';
import {
  computeStereoLayout,
  extractTorsoColorSignature,
  matchDisparityZncc,
  measurePoseFromBuffers,
  rgbaToLuma,
  signatureSimilarity,
  type StereoBuffer,
} from '../src/vision/stereo-depth.ts';
import { FreeMotionTracker } from '../src/interaction/free-tracker.ts';

function pose(x: number, y = 0.4, width = 0.14, wristY = y - 0.12): PoseObservation {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  landmarks[0] = { x, y: Math.max(0.05, y - width * 0.65), visibility: 1 };
  landmarks[11] = { x: Math.max(0.02, x - width / 2), y, visibility: 1 };
  landmarks[12] = { x: Math.min(0.98, x + width / 2), y, visibility: 1 };
  landmarks[13] = { x: Math.max(0.02, x - width * 0.65), y: Math.min(0.96, y + width * 0.4), visibility: 1 };
  landmarks[14] = { x: Math.min(0.98, x + width * 0.65), y: Math.min(0.96, y + width * 0.4), visibility: 1 };
  landmarks[15] = { x: Math.max(0.02, x - width * 0.8), y: Math.max(0.02, Math.min(0.98, wristY)), visibility: 1 };
  landmarks[16] = { x: Math.min(0.98, x + width * 0.8), y: Math.min(0.98, y + width * 0.6), visibility: 1 };
  landmarks[23] = { x: Math.max(0.02, x - width * 0.35), y: Math.min(0.96, y + width * 1.3), visibility: 1 };
  landmarks[24] = { x: Math.min(0.98, x + width * 0.35), y: Math.min(0.96, y + width * 1.3), visibility: 1 };
  return { landmarks };
}

function makeStereoBuffer(width: number, height: number, disparityPx: number, rgb: [number, number, number]): StereoBuffer {
  const rgbaA = new Uint8ClampedArray(width * height * 4);
  const rgbaB = new Uint8ClampedArray(width * height * 4);
  const hash = (ix: number, iy: number): number => {
    const h = Math.imul(ix * 374761393 + iy * 668265263, 1274126177);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967295;
  };
  const pattern = (x: number, y: number): number => {
    const gx = Math.floor(x / 3);
    const gy = Math.floor(y / 3);
    const fx = (x - gx * 3) / 3;
    const fy = (y - gy * 3) / 3;
    const a = hash(gx, gy) * (1 - fx) + hash(gx + 1, gy) * fx;
    const b = hash(gx, gy + 1) * (1 - fx) + hash(gx + 1, gy + 1) * fx;
    return Math.round(35 + (a * (1 - fy) + b * fy) * 185);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const vA = pattern(x, y);
      rgbaA[idx] = Math.min(255, Math.round((vA * rgb[0]) / 255));
      rgbaA[idx + 1] = Math.min(255, Math.round((vA * rgb[1]) / 255));
      rgbaA[idx + 2] = Math.min(255, Math.round((vA * rgb[2]) / 255));
      rgbaA[idx + 3] = 255;

      const srcX = x - disparityPx;
      const x0 = Math.floor(srcX);
      const frac = srcX - x0;
      const vB = (pattern(x0, y) * (1 - frac) + pattern(x0 + 1, y) * frac) * 0.9 + 14;
      rgbaB[idx] = Math.min(255, Math.round((vB * rgb[0]) / 255));
      rgbaB[idx + 1] = Math.min(255, Math.round((vB * rgb[1]) / 255));
      rgbaB[idx + 2] = Math.min(255, Math.round((vB * rgb[2]) / 255));
      rgbaB[idx + 3] = 255;
    }
  }
  const lumaA = new Uint8Array(width * height);
  const lumaB = new Uint8Array(width * height);
  rgbaToLuma(rgbaA, lumaA);
  rgbaToLuma(rgbaB, lumaB);
  return { width, height, lumaA, lumaB, rgbaA, rgbaB };
}

test('computeStereoLayout detects OV580 stereo frames and rejects standard single-lens webcams', () => {
  const hd = computeStereoLayout(3448, 808);
  assert.ok(hd);
  assert.equal(hd.leftX, 48);
  assert.equal(hd.rightX, 1328);
  assert.equal(hd.eyeWidth, 1280);
  assert.equal(hd.eyeHeight, 800);
  assert.ok(computeStereoLayout(1748, 408));
  assert.ok(computeStereoLayout(2560, 720));
  assert.equal(computeStereoLayout(1280, 720), null);
});

test('ZNCC disparity matching recovers sub-pixel stereo depth despite lens brightness differences', () => {
  const bufPos = makeStereoBuffer(240, 150, 7.5, [220, 180, 160]);
  const resPos = matchDisparityZncc(bufPos.lumaA, bufPos.lumaB, 240, 150, 0.5, 0.5, 0.545, 0.085, 0);
  assert.ok(resPos);
  assert.ok(Math.abs(resPos.disparityPx - 7.5) < 0.35, `got disparity ${resPos.disparityPx}`);
  assert.ok(resPos.confidence > 0.85);
  const expectedDepth = (0.085 * 240 * 0.545) / 7.5;
  assert.ok(Math.abs(resPos.depthMeters - expectedDepth) < 0.12);

  const bufNeg = makeStereoBuffer(240, 150, -5.0, [160, 210, 220]);
  const resNeg = matchDisparityZncc(bufNeg.lumaA, bufNeg.lumaB, 240, 150, 0.5, 0.5, 0.545, 0.085, 0);
  assert.ok(resNeg);
  assert.ok(Math.abs(resNeg.disparityPx + 5.0) < 0.35);
});

test('measurePoseFromBuffers maps left and left-near crops to invariant physical shoulder width', () => {
  const layout = computeStereoLayout(3448, 808)!;
  const nearBuf = makeStereoBuffer(240, 150, 9.0, [230, 80, 80]);
  const farBuf = makeStereoBuffer(240, 150, 4.5, [230, 80, 80]);
  const leftCrop = stereoCropPreset(3448, 808, 'left');
  const nearCrop = stereoCropPreset(3448, 808, 'left-near');
  const nearMeasure = measurePoseFromBuffers(pose(0.5, 0.4, 0.18), leftCrop, 3448, 808, layout, nearBuf, 1);
  const farMeasure = measurePoseFromBuffers(pose(0.5, 0.4, 0.09), leftCrop, 3448, 808, layout, farBuf, 1);
  const zoomedMeasure = measurePoseFromBuffers(pose(0.5, 0.4, 0.24), nearCrop, 3448, 808, layout, nearBuf, 1);
  assert.ok(nearMeasure.realShoulderMeters && farMeasure.realShoulderMeters && zoomedMeasure.realShoulderMeters);
  assert.ok(Math.abs(nearMeasure.realShoulderMeters - farMeasure.realShoulderMeters) < 0.04);
  assert.ok(Math.abs(nearMeasure.realShoulderMeters - zoomedMeasure.realShoulderMeters) < 0.04);
  assert.ok(signatureSimilarity(nearMeasure.appearance, farMeasure.appearance) > 0.9);
});

test('torso color signatures distinguish different outfits while matching the same outfit', () => {
  const red = makeStereoBuffer(240, 150, 6, [240, 50, 50]);
  const blue = makeStereoBuffer(240, 150, 6, [50, 80, 240]);
  const sigRedA = extractTorsoColorSignature(red.rgbaA, 240, 150, 0.5, 0.5, 0.06, 0.08);
  const sigRedB = extractTorsoColorSignature(red.rgbaB, 240, 150, 0.5, 0.5, 0.06, 0.08);
  const sigBlue = extractTorsoColorSignature(blue.rgbaA, 240, 150, 0.5, 0.5, 0.06, 0.08);
  assert.ok(signatureSimilarity(sigRedA, sigRedB) > 0.85);
  assert.ok(signatureSimilarity(sigRedA, sigBlue) < 0.35);
});

test('FreeMotionTracker maintains player identity across lateral sprints, squats, depth moves, and brief absence', () => {
  const tracker = new FreeMotionTracker(1);
  const shirt = [0.9, 0.1, 0, 0, 0, 0, 0, 0, 0.2, 0, 0, 0];
  const m = (depthMeters: number, realShoulderMeters = 0.4): StereoMeasurement => ({
    depthMeters,
    depthConfidence: 0.88,
    realShoulderMeters,
    disparityPx: 11 / depthMeters,
    appearance: shirt,
  });
  let players: TrackedPlayer[] = [];
  for (let t = 0; t <= 2100; t += 100) {
    players = tracker.update([pose(0.5, 0.35, 0.14)], [m(2.0)], t);
  }
  assert.equal(tracker.isCalibrated(), true);
  assert.equal(tracker.isLocked, true);
  const id = players[0].id;

  const trajectory: Array<[number, number, number, number, number]> = [
    [2200, 0.18, 0.38, 0.14, 2.0],
    [2300, 0.82, 0.34, 0.24, 1.15],
    [2400, 0.65, 0.68, 0.1, 2.9],
    [2500, 0.3, 0.22, 0.18, 1.6],
  ];
  for (const [t, x, y, width, depth] of trajectory) {
    const next = tracker.update([pose(x, y, width, y + 0.1)], [m(depth)], t);
    assert.equal(next.length, 1);
    assert.equal(next[0].id, id);
    const zones = tracker.zones(next, true, false);
    assert.equal(zones.length, 1);
    assert.equal(zones[0].playerId, id);
    assert.ok(zones[0].x >= 0 && zones[0].x + zones[0].width <= 1);
  }

  assert.deepEqual(tracker.update([], [], 2700), []);
  const returned = tracker.update([pose(0.75, 0.45, 0.11)], [m(2.6)], 3900);
  assert.equal(returned.length, 1);
  assert.equal(returned[0].id, id);
});

test('FreeMotionTracker filters far background bystanders by stereo depth and preserves duo identities on crossover', () => {
  const tracker = new FreeMotionTracker(2);
  const redShirt = [0.98, 0, 0, 0, 0, 0, 0, 0, 0.1, 0, 0, 0];
  const blueShirt = [0, 0, 0, 0, 0, 0.98, 0, 0, 0.1, 0, 0, 0];
  const grayShirt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.98, 0, 0];
  const mk = (depth: number, shoulder: number, appearance: number[]): StereoMeasurement => ({
    depthMeters: depth,
    depthConfidence: 0.9,
    realShoulderMeters: shoulder,
    disparityPx: 11 / depth,
    appearance,
  });
  let players: TrackedPlayer[] = [];
  for (let t = 0; t <= 2100; t += 100) {
    players = tracker.update(
      [pose(0.3, 0.35, 0.16), pose(0.7, 0.48, 0.11), pose(0.5, 0.4, 0.08, 0.55)],
      [mk(1.8, 0.42, redShirt), mk(1.9, 0.29, blueShirt), mk(3.8, 0.4, grayShirt)],
      t,
    );
  }
  assert.equal(tracker.isCalibrated(), true);
  assert.equal(players.length, 2);
  const adultId = players.find(p => p.center.x < 0.5)!.id;
  const childId = players.find(p => p.center.x > 0.5)!.id;

  const crossed = tracker.update(
    [pose(0.72, 0.35, 0.15, 0.5), pose(0.28, 0.5, 0.12, 0.6), pose(0.5, 0.38, 0.09, 0.55)],
    [mk(1.9, 0.42, redShirt), mk(1.8, 0.29, blueShirt), mk(3.9, 0.4, grayShirt)],
    2600,
  );
  assert.equal(crossed.length, 2);
  assert.equal(crossed.find(p => p.id === adultId)!.center.x > 0.5, true);
  assert.equal(crossed.find(p => p.id === childId)!.center.x < 0.5, true);
});
