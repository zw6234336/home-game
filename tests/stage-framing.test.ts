import assert from 'node:assert/strict';
import test from 'node:test';
import type { CropRect, TrackedPlayer, VisionFrame } from '../src/types.ts';
import { Stage } from '../src/ui/stage.ts';
import { framingFit, toStage } from '../src/interaction/geometry.ts';

test('stage applies one mirrored framing to video and overlays without changing the camera ROI', context => {
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const originalRatio = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class { src = ''; complete = false; naturalWidth = 0; } });
  Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
  context.after(() => {
    if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage);
    else Reflect.deleteProperty(globalThis, 'Image');
    if (originalRatio) Object.defineProperty(globalThis, 'devicePixelRatio', originalRatio);
    else Reflect.deleteProperty(globalThis, 'devicePixelRatio');
  });
  const draws: unknown[][] = [];
  const translations: number[][] = [];
  const arcs: number[][] = [];
  const ctx = {
    setTransform() {}, fillRect() {}, save() {}, restore() {}, scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    translate: (...values: number[]) => translations.push(values),
    drawImage: (...values: unknown[]) => draws.push(values),
    arc: (...values: number[]) => arcs.push(values),
  } as unknown as CanvasRenderingContext2D;
  const canvas = { clientWidth: 800, clientHeight: 600, width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const video = { videoWidth: 1280, videoHeight: 720, readyState: 4 } as HTMLVideoElement;
  const crop: CropRect = { x: 0.25, y: 0, width: 0.5, height: 1 };
  const source: TrackedPlayer = { id: 1, center: { x: 0.5, y: 0.5 }, shoulderWidth: 0.2, landmarks: [], wrists: [{ x: 0.25, y: 0.4 }, null], raised: false, bothRaised: false };
  const frame: VisionFrame = { sequence: 1, capturedAt: 100, completedAt: 110, inferenceMs: 10, poses: [], hands: [], handsCapturedAt: 0 };
  const stage = new Stage(canvas);
  stage.draw(video, crop, [source], frame, null, 110);
  const initial = { ...stage.fit };
  const view = { x: 0.1, y: 0.2, width: 0.7, height: 0.7 };
  stage.setFraming(view);
  view.x = 0.2;
  assert.deepEqual(stage.fit, initial);
  stage.draw(video, crop, [source], frame, null, 110);
  const expected = framingFit(640, 720, 800, 600, { x: 0.1, y: 0.2, width: 0.7, height: 0.7 });
  assert.deepEqual(stage.fit, expected);
  assert.deepEqual(draws.at(-1)!.slice(1, 5), [320, 0, 640, 720]);
  assert.deepEqual(draws.at(-1)!.slice(5), [0, 0, expected.width, expected.height]);
  assert.deepEqual(translations.at(-1), [expected.x + expected.width, expected.y]);
  const wrist = toStage(source.wrists[0]!, expected);
  assert.deepEqual(arcs.at(-1)!.slice(0, 2), [wrist.x, wrist.y]);
  assert.throws(() => stage.setFraming({ x: 0, y: 0, width: NaN, height: 1 }), RangeError);
  assert.deepEqual(stage.fit, expected);
});

test('skyStage shifts far-away players toward the bottom to leave upper sky play space without createRadialGradient', context => {
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const originalRatio = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class { src = ''; complete = false; naturalWidth = 0; } });
  Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
  context.after(() => {
    if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage);
    else Reflect.deleteProperty(globalThis, 'Image');
    if (originalRatio) Object.defineProperty(globalThis, 'devicePixelRatio', originalRatio);
    else Reflect.deleteProperty(globalThis, 'devicePixelRatio');
  });
  let radialUsed = false;
  const ctx = {
    setTransform() {}, fillRect() {}, save() {}, restore() {}, scale() {}, translate() {}, drawImage() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, ellipse() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { radialUsed = true; return { addColorStop() {} }; },
  } as unknown as CanvasRenderingContext2D;
  const canvas = { clientWidth: 1280, clientHeight: 720, width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const video = { videoWidth: 1280, videoHeight: 720, readyState: 4 } as HTMLVideoElement;
  const crop: CropRect = { x: 0, y: 0, width: 1, height: 1 };
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  landmarks[11] = { x: 0.46, y: 0.42, visibility: 1 };
  landmarks[12] = { x: 0.54, y: 0.42, visibility: 1 };
  const farPlayer: TrackedPlayer = { id: 1, center: { x: 0.5, y: 0.46 }, shoulderWidth: 0.08, landmarks, wrists: [{ x: 0.44, y: 0.48 }, { x: 0.56, y: 0.48 }], raised: false, bothRaised: false };
  const frame: VisionFrame = { sequence: 1, capturedAt: 100, completedAt: 110, inferenceMs: 10, poses: [], hands: [], handsCapturedAt: 0 };
  const stage = new Stage(canvas, { skyStage: true });
  stage.draw(null, crop, [], null, null, 100);
  assert.equal(stage.fit.y, 0);
  stage.draw(video, crop, [farPlayer], frame, null, 600);
  assert.equal(stage.fit.x, 0);
  assert.equal(stage.fit.width, 1280);
  assert.ok(stage.fit.y >= 180 && stage.fit.y <= 720 * 0.34 + 1);
  const handStageY = toStage(farPlayer.wrists[0]!, stage.fit).y;
  assert.ok(handStageY >= 720 * 0.72 && handStageY <= 720 * 0.85);
  assert.equal(radialUsed, false);
});
