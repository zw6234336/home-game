import assert from 'node:assert/strict';
import test from 'node:test';
import type { CropRect, VisionConfig, VisionFrame, VisionStatus } from '../src/types.ts';
import { FrameGate } from '../src/vision/frame-gate.ts';
import { InferenceEngine } from '../src/vision/inference-engine.ts';
import type { HandModel, ModelFactory, PoseModel } from '../src/vision/inference-engine.ts';
import { VisionPipeline } from '../src/vision/pipeline.ts';
import { captureGeometry, checkedConfig, checkedCrop, qualityProfile } from '../src/vision/profiles.ts';
import type { Delegate, FrameRequest, WorkerRequest, WorkerResponse } from '../src/vision/protocol.ts';
import { browserVisionRuntime, retireWorker } from '../src/vision/platform/runtime.ts';
import type { VisionRuntime, VisionWorker } from '../src/vision/platform/runtime.ts';
import { installLocalWorkerNetwork, localFetch } from '../src/vision/platform/local-network.ts';

const config: VisionConfig = { quality: 'quality', numPoses: 2, hands: true };
const crop: CropRect = { x: 0, y: 0, width: 1, height: 1 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class Bitmap {
  closed = 0;

  close() {
    this.closed++;
  }

  get image(): ImageBitmap {
    return this as unknown as ImageBitmap;
  }
}

class Pose implements PoseModel {
  closed = 0;
  timestamps: number[] = [];
  error: Error | null = null;

  detect(_image: ImageBitmap, timestamp: number) {
    this.timestamps.push(timestamp);
    if (this.error) throw this.error;
    return [{ landmarks: [{ x: 0.4, y: 0.5, visibility: 1 }] }];
  }

  close() {
    this.closed++;
  }
}

class Hands implements HandModel {
  closed = 0;
  timestamps: number[] = [];

  detect(_image: ImageBitmap, timestamp: number) {
    this.timestamps.push(timestamp);
    return [{ landmarks: [{ x: 0.5, y: 0.5, visibility: 1 }], handedness: 'Right' }];
  }

  close() {
    this.closed++;
  }
}

class Factory implements ModelFactory {
  poses: { model: Pose; config: VisionConfig; delegate: Delegate }[] = [];
  hands: { model: Hands; delegate: Delegate }[] = [];
  poseFailure: Delegate[] = [];
  handsFailure: Delegate[] = [];
  pendingPose: ReturnType<typeof deferred<PoseModel>> | null = null;
  pendingHands: ReturnType<typeof deferred<HandModel>> | null = null;

  async createPose(nextConfig: VisionConfig, delegate: Delegate): Promise<PoseModel> {
    if (this.poseFailure.includes(delegate)) throw new Error(`${delegate} pose failed`);
    if (this.pendingPose) return this.pendingPose.promise;
    const model = new Pose();
    this.poses.push({ model, config: { ...nextConfig }, delegate });
    return model;
  }

  async createHands(delegate: Delegate): Promise<HandModel> {
    if (this.handsFailure.includes(delegate)) throw new Error(`${delegate} hands failed`);
    if (this.pendingHands) return this.pendingHands.promise;
    const model = new Hands();
    this.hands.push({ model, delegate });
    return model;
  }
}

function request(bitmap: Bitmap, capturedAt = 1000, hands = true, generation = 1): FrameRequest {
  return { type: 'frame', generation, token: capturedAt, capturedAt, hands, bitmap: bitmap.image };
}

class FakeWorker implements VisionWorker {
  onmessage: VisionWorker['onmessage'] = null;
  onerror: VisionWorker['onerror'] = null;
  onmessageerror: VisionWorker['onmessageerror'] = null;
  messages: { message: WorkerRequest; transfer: Transferable[] }[] = [];
  terminated = 0;
  postError: Error | null = null;

  postMessage(message: WorkerRequest, transfer: Transferable[] = []) {
    if (this.postError && message.type === 'frame') throw this.postError;
    this.messages.push({ message, transfer });
  }

  terminate() {
    this.terminated++;
  }

  emit(message: WorkerResponse) {
    this.onmessage?.(new MessageEvent('message', { data: message }));
  }

  get generation() {
    const initialized = this.messages.find(item => item.message.type === 'initialize')?.message;
    assert.equal(initialized?.type, 'initialize');
    return (initialized as Extract<WorkerRequest, { type: 'initialize' }>).generation;
  }

  get frames() {
    return this.messages.filter(item => item.message.type === 'frame').map(item => item.message as FrameRequest);
  }
}

class Runtime implements VisionRuntime {
  time = 1000;
  workers: FakeWorker[] = [];
  bitmaps: ReturnType<typeof deferred<ImageBitmap>>[] = [];
  scheduled = new Set<(mediaTime: number) => void>();
  deadlines = new Map<() => void, number>();
  draws: unknown[][] = [];
  canvases: HTMLCanvasElement[] = [];

  now() {
    return this.time;
  }

  createWorker() {
    const worker = new FakeWorker();
    this.workers.push(worker);
    return worker;
  }

  createCanvas() {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: (...args: unknown[]) => this.draws.push(args) }),
    } as unknown as HTMLCanvasElement;
    this.canvases.push(canvas);
    return canvas;
  }

  createBitmap() {
    const bitmap = deferred<ImageBitmap>();
    this.bitmaps.push(bitmap);
    return bitmap.promise;
  }

  scheduleFrame(_video: HTMLVideoElement, callback: (mediaTime: number) => void) {
    this.scheduled.add(callback);
    return () => { this.scheduled.delete(callback); };
  }

  deadline(callback: () => void, milliseconds: number) {
    this.deadlines.set(callback, milliseconds);
    return () => { this.deadlines.delete(callback); };
  }

  tick(mediaTime: number, now = this.time) {
    this.time = now;
    const callbacks = [...this.scheduled];
    this.scheduled.clear();
    for (const callback of callbacks) callback(mediaTime);
  }
}

function pipelineFixture() {
  const runtime = new Runtime();
  const frames: VisionFrame[] = [];
  const statuses: VisionStatus[] = [];
  const errors: Error[] = [];
  const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080, currentTime: 0 } as HTMLVideoElement;
  const pipeline = new VisionPipeline({ onFrame: frame => frames.push(frame), onStatus: status => statuses.push(status), onError: error => errors.push(error) }, runtime);
  return { pipeline, runtime, video, frames, statuses, errors };
}

async function start(fixture: ReturnType<typeof pipelineFixture>, nextConfig = config) {
  const started = fixture.pipeline.start(fixture.video, nextConfig, crop);
  const worker = fixture.runtime.workers.at(-1)!;
  worker.emit({ type: 'ready', generation: worker.generation, delegate: 'GPU' });
  await started;
  return worker;
}

function result(worker: FakeWorker, frame = worker.frames.at(-1)!, overrides: Partial<Extract<WorkerResponse, { type: 'result' }>> = {}) {
  worker.emit({ type: 'result', generation: frame.generation, token: frame.token, poses: [{ landmarks: [] }], hands: [{ landmarks: [], handedness: 'Right' }], handsCapturedAt: frame.capturedAt, inferenceMs: 10, delegate: 'GPU', ...overrides });
}

test('FrameGate enforces one active token and leaves newer work intact on mismatched completion', () => {
  const gate = new FrameGate();
  const token = gate.begin(100)!;
  assert.equal(gate.begin(101), null);
  assert.equal(gate.complete(token + 1, 100, 110), false);
  assert.equal(gate.begin(111), null);
  assert.equal(gate.complete(token, 100, 110), true);
  const next = gate.begin(120)!;
  assert.notEqual(next, token);
  assert.equal(gate.complete(token, 100, 121), false);
  assert.equal(gate.begin(122), null);
  assert.equal(gate.complete(next, 120, 123), true);
});

test('FrameGate accepts the exact age boundary, releases expired work and rejects future or nonfinite clocks', () => {
  const gate = new FrameGate();
  for (const [capturedAt, now, accepted] of [[100, 250, true], [100, 250.001, false], [100, 99, false], [NaN, 100, false], [100, Infinity, false], [100, 100, true]] as const) {
    const token = gate.begin(100)!;
    assert.equal(gate.complete(token, capturedAt, now), accepted);
  }
  assert.equal(gate.begin(NaN), null);
  assert.equal(gate.begin(Infinity), null);
  assert.throws(() => new FrameGate(-1), RangeError);
  assert.throws(() => new FrameGate(NaN), RangeError);
});

test('FrameGate reset invalidates every earlier generation without letting it release current work', () => {
  const gate = new FrameGate();
  const prior: number[] = [];
  for (let index = 0; index < 500; index++) {
    const token = gate.begin(index)!;
    assert.equal(typeof token, 'number');
    for (const old of prior.slice(-5)) assert.equal(gate.complete(old, index, index), false);
    assert.equal(gate.begin(index), null);
    prior.push(token);
    gate.reset();
    assert.equal(gate.complete(token, index, index), false);
  }
  assert.equal(new Set(prior).size, prior.length);
});

test('quality and normalized crop contracts retain aspect ratio without upscaling or mutation', () => {
  assert.deepEqual(qualityProfile('quality'), { longEdge: 960, framesPerSecond: 30, modelPath: '/models/pose_landmarker_full.task' });
  assert.equal(qualityProfile('balanced').framesPerSecond, 24);
  assert.equal(qualityProfile('fast').longEdge, 480);
  assert.deepEqual(captureGeometry(1920, 1080, { x: 0.25, y: 0, width: 0.5, height: 1 }, 960), { sourceX: 480, sourceY: 0, sourceWidth: 960, sourceHeight: 1080, width: 853, height: 960 });
  assert.equal(captureGeometry(320, 240, crop, 960).width, 320);
  const copy = checkedCrop(crop);
  copy.x = 0.5;
  assert.equal(crop.x, 0);
  for (const bad of [{ ...crop, x: NaN }, { ...crop, width: 0 }, { ...crop, x: -0.1 }, { ...crop, x: 0.1 }, { ...crop, height: Infinity }]) assert.throws(() => checkedCrop(bad), RangeError);
  assert.throws(() => captureGeometry(0, 100, crop, 960), RangeError);
  assert.throws(() => checkedConfig({ ...config, quality: 'unknown' as VisionConfig['quality'] }), RangeError);
  assert.throws(() => checkedConfig({ ...config, numPoses: 3 as VisionConfig['numPoses'] }), RangeError);
});

test('inference closes partial GPU initialization before retrying every model on CPU', async () => {
  const factory = new Factory();
  factory.handsFailure = ['GPU'];
  const engine = new InferenceEngine(factory, () => 0);
  assert.equal(await engine.initialize(config, 1), 'CPU');
  assert.equal(factory.poses[0].model.closed, 1);
  assert.equal(factory.poses[1].delegate, 'CPU');
  assert.equal(factory.hands[0].delegate, 'CPU');
  engine.dispose();
  engine.dispose();
  assert.equal(factory.poses[1].model.closed, 1);
  assert.equal(factory.hands[0].model.closed, 1);
});

test('inference reports dual initialization failure and releases models arriving after cancellation', async () => {
  const factory = new Factory();
  factory.poseFailure = ['GPU', 'CPU'];
  const engine = new InferenceEngine(factory, () => 0);
  await assert.rejects(engine.initialize(config, 1), /GPU 和 CPU/);
  factory.poseFailure = [];
  factory.pendingPose = deferred<PoseModel>();
  const initialized = engine.initialize(config, 2);
  engine.dispose();
  const late = new Pose();
  factory.pendingPose.resolve(late);
  assert.equal(await initialized, null);
  assert.equal(late.closed, 1);
  assert.equal(factory.hands.length, 0);
});

test('inference uses fresh hand samples at no more than 12 Hz and closes every bitmap', async () => {
  const factory = new Factory();
  let clock = 500000;
  const engine = new InferenceEngine(factory, () => { clock += 6; return clock; });
  await engine.initialize(config, 1);
  for (const [time, enabled, expected] of [[1000, true, 1], [1030, true, 0], [1084, true, 1], [1200, false, 0], [1300, true, 1]] as const) {
    const bitmap = new Bitmap();
    const frame = await engine.infer(request(bitmap, time, enabled));
    assert.equal(frame?.hands.length, expected);
    assert.equal(frame?.handsCapturedAt, expected ? time : 0);
    assert.equal(frame?.inferenceMs, 6);
    assert.equal(bitmap.closed, 1);
  }
  assert.equal(factory.hands[0].model.timestamps.length, 3);
  engine.dispose();
});

test('inference initializes hands on demand and rejects concurrent work instead of queueing', async () => {
  const factory = new Factory();
  const engine = new InferenceEngine(factory, () => 0);
  await engine.initialize({ ...config, hands: false }, 1);
  assert.equal(factory.hands.length, 0);
  factory.pendingHands = deferred<HandModel>();
  const first = new Bitmap();
  const second = new Bitmap();
  const inFlight = engine.infer(request(first));
  assert.equal(await engine.infer(request(second, 1010)), null);
  assert.equal(second.closed, 1);
  assert.equal(factory.poses[0].model.timestamps.length, 0);
  const hand = new Hands();
  factory.pendingHands.resolve(hand);
  assert.equal((await inFlight)?.hands.length, 1);
  assert.equal(first.closed, 1);
  engine.dispose();
  assert.equal(hand.closed, 1);
});

test('inference falls back consistently when lazily enabled GPU hands fail', async () => {
  const factory = new Factory();
  const engine = new InferenceEngine(factory, () => 0);
  await engine.initialize({ ...config, hands: false }, 1);
  factory.handsFailure = ['GPU'];
  const bitmap = new Bitmap();
  assert.equal((await engine.infer(request(bitmap)))?.delegate, 'CPU');
  assert.equal(factory.poses[0].model.closed, 1);
  assert.equal(factory.poses[1].delegate, 'CPU');
  assert.equal(bitmap.closed, 1);
  engine.dispose();
});

test('inference cancellation during hand creation closes late models and never produces old output', async () => {
  const factory = new Factory();
  const engine = new InferenceEngine(factory, () => 0);
  await engine.initialize({ ...config, hands: false }, 1);
  factory.pendingHands = deferred<HandModel>();
  const bitmap = new Bitmap();
  const inFlight = engine.infer(request(bitmap));
  engine.dispose();
  const late = new Hands();
  factory.pendingHands.resolve(late);
  assert.equal(await inFlight, null);
  assert.equal(bitmap.closed, 1);
  assert.equal(late.closed, 1);
  assert.equal(factory.poses[0].model.timestamps.length, 0);
});

test('inference releases failed and stale frames, then remains able to process fresh work', async () => {
  const factory = new Factory();
  const engine = new InferenceEngine(factory, () => 0);
  await engine.initialize(config, 1);
  const stale = new Bitmap();
  assert.equal(await engine.infer(request(stale, 1000, true, 0)), null);
  assert.equal(stale.closed, 1);
  const invalid = new Bitmap();
  await assert.rejects(engine.infer(request(invalid, NaN)), RangeError);
  assert.equal(invalid.closed, 1);
  const failed = new Bitmap();
  factory.poses[0].model.error = new Error('detection failed');
  await assert.rejects(engine.infer(request(failed)), /detection failed/);
  assert.equal(failed.closed, 1);
  factory.poses[0].model.error = null;
  const good = new Bitmap();
  assert.equal((await engine.infer(request(good)))?.poses.length, 1);
  assert.equal(good.closed, 1);
  assert.ok(factory.poses[0].model.timestamps[1] > factory.poses[0].model.timestamps[0]);
  engine.dispose();
});

test('pipeline crops the source and permits only one capture or inference at a time', async () => {
  const fixture = pipelineFixture();
  const worker = await start(fixture);
  fixture.pipeline.setCrop({ x: 0.25, y: 0, width: 0.5, height: 1 });
  fixture.runtime.tick(1, 1000);
  fixture.runtime.tick(2, 1040);
  assert.equal(fixture.runtime.bitmaps.length, 1);
  assert.deepEqual(fixture.runtime.draws[0].slice(1), [480, 0, 960, 1080, 0, 0, 853, 960]);
  const bitmap = new Bitmap();
  fixture.runtime.bitmaps[0].resolve(bitmap.image);
  await settle();
  assert.equal(worker.frames.length, 1);
  assert.deepEqual(worker.messages.at(-1)?.transfer, [bitmap.image]);
  assert.equal(bitmap.closed, 0);
  fixture.runtime.tick(3, 1080);
  assert.equal(fixture.runtime.bitmaps.length, 1);
  result(worker);
  assert.equal(fixture.frames.length, 1);
  assert.equal(fixture.frames[0].capturedAt, 1000);
  assert.equal(fixture.frames[0].completedAt, 1080);
  fixture.runtime.tick(4, 1120);
  assert.equal(fixture.runtime.bitmaps.length, 2);
  fixture.pipeline.stop();
  fixture.runtime.bitmaps[1].resolve(new Bitmap().image);
  await settle();
});

test('pipeline drops slow capture before transfer and rejects stale inference without scoring', async () => {
  const fixture = pipelineFixture();
  const worker = await start(fixture);
  fixture.runtime.tick(1, 1000);
  const slow = new Bitmap();
  fixture.runtime.time = 1151;
  fixture.runtime.bitmaps[0].resolve(slow.image);
  await settle();
  assert.equal(slow.closed, 1);
  assert.equal(worker.frames.length, 0);
  fixture.runtime.tick(2, 1200);
  fixture.runtime.bitmaps[1].resolve(new Bitmap().image);
  await settle();
  fixture.runtime.time = 1351;
  result(worker);
  assert.equal(fixture.frames.length, 0);
  assert.equal(fixture.pipeline.stats.dropped, 2);
  assert.match(fixture.statuses.at(-1)!.message, /丢弃/);
  fixture.runtime.tick(3, 1400);
  fixture.runtime.bitmaps[2].resolve(new Bitmap().image);
  await settle();
  fixture.runtime.time = 1550;
  result(worker);
  assert.equal(fixture.frames.length, 1);
  assert.equal(fixture.pipeline.stats.completed, 1);
  fixture.pipeline.stop();
});

test('crop changes invalidate a submitted frame while preserving physical backpressure', async () => {
  const fixture = pipelineFixture();
  const worker = await start(fixture);
  fixture.runtime.tick(1, 1000);
  fixture.runtime.bitmaps[0].resolve(new Bitmap().image);
  await settle();
  fixture.pipeline.setCrop({ x: 0, y: 0, width: 0.5, height: 1 });
  fixture.runtime.tick(2, 1040);
  assert.equal(fixture.runtime.bitmaps.length, 1);
  result(worker);
  assert.equal(fixture.frames.length, 0);
  fixture.runtime.tick(3, 1080);
  fixture.runtime.bitmaps[1].resolve(new Bitmap().image);
  await settle();
  result(worker, worker.frames[0]);
  fixture.runtime.tick(4, 1120);
  assert.equal(fixture.runtime.bitmaps.length, 2);
  result(worker);
  assert.equal(fixture.frames.length, 1);
  fixture.pipeline.stop();
});

test('crop changes during bitmap creation close the obsolete image before a new capture', async () => {
  const fixture = pipelineFixture();
  const worker = await start(fixture);
  fixture.runtime.tick(1);
  fixture.pipeline.setCrop({ x: 0.5, y: 0, width: 0.5, height: 1 });
  fixture.runtime.tick(2, 1040);
  assert.equal(fixture.runtime.bitmaps.length, 1);
  const obsolete = new Bitmap();
  fixture.runtime.bitmaps[0].resolve(obsolete.image);
  await settle();
  assert.equal(obsolete.closed, 1);
  assert.equal(worker.frames.length, 0);
  fixture.runtime.tick(3, 1080);
  assert.equal(fixture.runtime.bitmaps.length, 2);
  fixture.pipeline.stop();
  fixture.runtime.bitmaps[1].resolve(new Bitmap().image);
  await settle();
});

test('stop and restart isolate delayed bitmap promises, callbacks and worker results', async () => {
  const fixture = pipelineFixture();
  const firstWorker = await start(fixture);
  const oldHandler = firstWorker.onmessage!;
  fixture.runtime.tick(1);
  fixture.pipeline.stop();
  assert.equal(fixture.runtime.scheduled.size, 0);
  assert.equal(fixture.runtime.canvases[0].width, 0);
  const secondWorker = await start(fixture);
  oldHandler(new MessageEvent('message', { data: { type: 'ready', generation: firstWorker.generation, delegate: 'CPU' } }));
  const late = new Bitmap();
  fixture.runtime.bitmaps[0].resolve(late.image);
  await settle();
  assert.equal(late.closed, 1);
  assert.equal(firstWorker.frames.length, 0);
  assert.equal(fixture.pipeline.stats.delegate, 'GPU');
  fixture.runtime.tick(2, 1040);
  fixture.runtime.bitmaps[1].resolve(new Bitmap().image);
  await settle();
  oldHandler(new MessageEvent('message', { data: { type: 'result', generation: firstWorker.generation, token: secondWorker.frames[0].token, poses: [], hands: [], handsCapturedAt: 0, inferenceMs: 0, delegate: 'GPU' } }));
  assert.equal(fixture.frames.length, 0);
  result(secondWorker);
  assert.equal(fixture.frames.length, 1);
  firstWorker.emit({ type: 'disposed' });
  assert.equal(firstWorker.terminated, 1);
  fixture.pipeline.stop();
});

test('stopping initialization rejects its promise and late readiness cannot start capture', async () => {
  const fixture = pipelineFixture();
  const pending = fixture.pipeline.start(fixture.video, config, crop);
  const rejection = assert.rejects(pending, { name: 'AbortError' });
  const worker = fixture.runtime.workers[0];
  const handler = worker.onmessage!;
  fixture.pipeline.stop();
  handler(new MessageEvent('message', { data: { type: 'ready', generation: worker.generation, delegate: 'GPU' } }));
  await rejection;
  assert.equal(fixture.runtime.scheduled.size, 0);
  assert.equal(fixture.pipeline.stats.delegate, null);
});

test('pipeline strips hands when disabled or their sample does not belong to this frame', async () => {
  const fixture = pipelineFixture();
  const worker = await start(fixture);
  fixture.runtime.tick(1);
  fixture.runtime.bitmaps[0].resolve(new Bitmap().image);
  await settle();
  fixture.pipeline.setHands(false);
  result(worker);
  assert.deepEqual(fixture.frames[0].hands, []);
  assert.equal(fixture.frames[0].handsCapturedAt, 0);
  fixture.pipeline.setHands(true);
  fixture.runtime.tick(2, 1040);
  fixture.runtime.bitmaps[1].resolve(new Bitmap().image);
  await settle();
  result(worker, undefined, { handsCapturedAt: 1000 });
  assert.deepEqual(fixture.frames[1].hands, []);
  fixture.pipeline.stop();
});

test('pipeline skips repeated decoded frames and applies the chosen capture cadence', async () => {
  const fixture = pipelineFixture();
  const worker = await start(fixture, { ...config, quality: 'fast' });
  fixture.runtime.tick(1);
  fixture.runtime.bitmaps[0].resolve(new Bitmap().image);
  await settle();
  result(worker);
  fixture.runtime.tick(1, 1100);
  assert.equal(fixture.runtime.bitmaps.length, 1);
  fixture.runtime.tick(2, 1100);
  fixture.runtime.bitmaps[1].resolve(new Bitmap().image);
  await settle();
  result(worker);
  fixture.runtime.tick(3, 1149);
  assert.equal(fixture.runtime.bitmaps.length, 2);
  fixture.runtime.tick(4, 1150);
  assert.equal(fixture.runtime.bitmaps.length, 3);
  assert.equal(fixture.runtime.canvases[0].width, 480);
  fixture.pipeline.stop();
  fixture.runtime.bitmaps[2].resolve(new Bitmap().image);
  await settle();
});

test('pipeline closes untransferred images and cancels scheduling when transfer fails', async () => {
  const fixture = pipelineFixture();
  const worker = await start(fixture);
  worker.postError = new Error('transfer failed');
  fixture.runtime.tick(1);
  const bitmap = new Bitmap();
  fixture.runtime.bitmaps[0].resolve(bitmap.image);
  await settle();
  assert.equal(bitmap.closed, 1);
  assert.equal(fixture.runtime.scheduled.size, 0);
  assert.equal(fixture.errors[0].message, 'transfer failed');
  assert.equal(fixture.pipeline.stats.dropped, 1);
});

test('pipeline surfaces initialization timeout and worker errors while allowing recovery', async () => {
  const fixture = pipelineFixture();
  const first = fixture.pipeline.start(fixture.video, config, crop);
  const rejected = assert.rejects(first, /加载超时/);
  const deadline = [...fixture.runtime.deadlines].find(([, duration]) => duration === 45000)![0];
  deadline();
  await rejected;
  assert.equal(fixture.errors.length, 1);
  const worker = await start(fixture);
  worker.emit({ type: 'error', generation: worker.generation, message: 'inference failed' });
  assert.equal(fixture.errors.at(-1)!.message, 'inference failed');
  assert.equal(fixture.runtime.scheduled.size, 0);
  assert.equal(fixture.statuses.at(-1)!.state, 'stopped');
});

test('browser scheduler prefers video frame callbacks and cancels their exact handle', () => {
  let callback: VideoFrameRequestCallback | null = null;
  let cancelled = -1;
  const video = {
    requestVideoFrameCallback: (listener: VideoFrameRequestCallback) => { callback = listener; return 42; },
    cancelVideoFrameCallback: (handle: number) => { cancelled = handle; },
  } as unknown as HTMLVideoElement;
  const samples: number[] = [];
  const cancel = browserVisionRuntime().scheduleFrame(video, time => samples.push(time));
  const listener = callback as unknown as VideoFrameRequestCallback;
  listener(100, { mediaTime: 4 } as VideoFrameCallbackMetadata);
  assert.deepEqual(samples, [4]);
  cancel();
  assert.equal(cancelled, 42);
});

test('worker retirement requests graceful cleanup and bounds workers that never acknowledge', () => {
  const runtime = new Runtime();
  const graceful = new FakeWorker();
  retireWorker(graceful, runtime);
  assert.deepEqual(graceful.messages[0].message, { type: 'dispose' });
  assert.equal(graceful.terminated, 0);
  graceful.emit({ type: 'disposed' });
  assert.equal(graceful.terminated, 1);
  assert.equal(runtime.deadlines.size, 0);
  const stuck = new FakeWorker();
  retireWorker(stuck, runtime);
  const [[deadline, duration]] = runtime.deadlines;
  assert.equal(duration, 2000);
  deadline();
  deadline();
  assert.equal(stuck.terminated, 1);
  assert.equal(stuck.onmessage, null);
});

test('vision worker network boundary permits local models and rejects telemetry before dispatch', async () => {
  const requests: string[] = [];
  const fetcher = localFetch(async input => {
    requests.push(String(input));
    return new Response('local asset');
  }, 'http://127.0.0.1:5173/src/vision/inference.worker.ts');
  assert.equal(await (await fetcher('/models/pose_landmarker_full.task')).text(), 'local asset');
  await fetcher(new URL('http://127.0.0.1:5173/wasm/vision_wasm_module_internal.wasm'));
  for (const url of ['https://odml.pa.googleapis.com/v1/log', 'http://127.0.0.1:5174/models/pose.task', 'data:text/plain,external']) {
    await assert.rejects(fetcher(url), /禁止外部网络请求/);
  }
  await assert.rejects(fetcher(new Request('https://example.com/upload', { method: 'POST', body: 'test' })), /禁止外部网络请求/);
  assert.equal(requests.length, 2);
});

test('vision worker boundary covers XHR and classic loader fallbacks without changing native module errors', async () => {
  const calls: { type: string; url: string; owner: unknown }[] = [];
  const prototype = {
    open(method: string, url: string | URL) { calls.push({ type: method, url: String(url), owner: this }); },
  };
  const scope = {
    location: { href: 'http://127.0.0.1:5173/worker.js' },
    fetch: async function (input: RequestInfo | URL) {
      calls.push({ type: 'fetch', url: String(input), owner: this });
      return new Response('ok');
    },
    XMLHttpRequest: { prototype },
    importScripts: function (...urls: string[]) {
      calls.push({ type: 'import', url: urls.join(','), owner: this });
      throw new TypeError('Module scripts do not support importScripts');
    },
  };
  installLocalWorkerNetwork(scope);
  await scope.fetch('/models/local.task');
  prototype.open('GET', '/wasm/local.wasm');
  assert.equal(calls[0].owner, scope);
  assert.equal(calls[1].owner, prototype);
  assert.throws(() => scope.importScripts('/wasm/local.js'), TypeError);
  assert.equal(calls[2].owner, scope);
  assert.throws(() => prototype.open('GET', 'https://example.com/remote.wasm'), { name: 'SecurityError' });
  assert.throws(() => scope.importScripts('https://example.com/remote.js'), { name: 'SecurityError' });
  assert.equal(calls.length, 3);
});
