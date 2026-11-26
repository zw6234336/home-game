import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CameraSession,
  ensureLocalPs4Camera,
  isOv580StereoFrame,
  isPs4CameraLabel,
  isWideStereoFrame,
  pickPreferredCameraId,
  stereoCropPreset,
} from '../src/platform/camera.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}

function setup() {
  const requests: ReturnType<typeof deferred<MediaStream>>[] = [];
  const plays: ReturnType<typeof deferred<void>>[] = [];
  const video = { srcObject: null, muted: false, playsInline: false, pause() {}, play() { const request = deferred<void>(); plays.push(request); return request.promise; } };
  Object.defineProperty(globalThis, 'document', { value: { createElement: () => video }, configurable: true });
  Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia() { const request = deferred<MediaStream>(); requests.push(request); return request.promise; } } }, configurable: true });
  const session = new CameraSession(() => {});
  const stream = () => {
    const track = { readyState: 'live', stop() { this.readyState = 'ended'; }, addEventListener() {}, removeEventListener() {}, getSettings: () => ({}) };
    return { track, media: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream };
  };
  return { session, requests, plays, stream };
}

test('a camera permission resolving after stop closes every returned track', async () => {
  const env = setup();
  const first = env.session.start(); env.session.stop();
  const stream = env.stream(); env.requests[0].resolve(stream.media);
  assert.equal(await first, false);
  assert.equal(stream.track.readyState, 'ended');
  assert.equal(env.plays.length, 0);
});

test('late play failure from an old connection cannot stop a newer camera', async () => {
  const env = setup();
  const one = env.stream(); const two = env.stream();
  const first = env.session.start(); env.requests[0].resolve(one.media); await Promise.resolve();
  const second = env.session.start(); env.requests[1].resolve(two.media); await Promise.resolve();
  env.plays[0].reject(new Error('old playback aborted'));
  await assert.rejects(first, /old playback/);
  env.plays[1].resolve();
  assert.equal(await second, true);
  assert.equal(two.track.readyState, 'live');
  env.session.stop();
  assert.equal(two.track.readyState, 'ended');
});

test('wide stereo cameras upgrade from low height to full native stereo resolution while standard webcams stay unchanged', async () => {
  const env = setup();
  const applied: MediaTrackConstraints[] = [];
  const stereoTrack = {
    readyState: 'live',
    stop() { this.readyState = 'ended'; },
    addEventListener() {},
    removeEventListener() {},
    getCapabilities: () => ({ width: { min: 898, max: 3448 }, height: { min: 200, max: 808 } }),
    getSettings: () => ({ width: 1748, height: 408 }),
    async applyConstraints(next: MediaTrackConstraints) { applied.push(next); },
  };
  const startStereo = env.session.start('ps4-ov580');
  env.requests[0].resolve({ getTracks: () => [stereoTrack], getVideoTracks: () => [stereoTrack] } as unknown as MediaStream);
  await Promise.resolve();
  await Promise.resolve();
  env.plays[0].resolve();
  assert.equal(await startStereo, true);
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0], { width: { ideal: 3448 }, height: { ideal: 808 }, frameRate: { ideal: 30, max: 60 } });

  const appliedStandard: MediaTrackConstraints[] = [];
  const standardTrack = {
    readyState: 'live',
    stop() { this.readyState = 'ended'; },
    addEventListener() {},
    removeEventListener() {},
    getCapabilities: () => ({ width: { min: 640, max: 1920 }, height: { min: 480, max: 1080 } }),
    getSettings: () => ({ width: 1280, height: 720 }),
    async applyConstraints(next: MediaTrackConstraints) { appliedStandard.push(next); },
  };
  const startStandard = env.session.start('builtin');
  env.requests[1].resolve({ getTracks: () => [standardTrack], getVideoTracks: () => [standardTrack] } as unknown as MediaStream);
  await Promise.resolve();
  await Promise.resolve();
  env.plays[1].resolve();
  assert.equal(await startStandard, true);
  assert.equal(appliedStandard.length, 0);
  env.session.stop();
});

test('stereoCropPreset extracts clean single-eye and zoomed windows for OV580 and generic stereo frames', () => {
  assert.equal(isWideStereoFrame(3448, 808), true);
  assert.equal(isWideStereoFrame(1280, 720), false);
  assert.equal(isOv580StereoFrame(3448, 808), true);
  assert.equal(isOv580StereoFrame(1748, 408), true);
  assert.equal(isOv580StereoFrame(898, 200), true);
  assert.equal(isOv580StereoFrame(2560, 720), false);
  const left = stereoCropPreset(3448, 808, 'left');
  const right = stereoCropPreset(3448, 808, 'right');
  const near = stereoCropPreset(3448, 808, 'left-near');
  const full = stereoCropPreset(3448, 808, 'full');
  assert.ok(Math.abs(left.x * 3448 - 48) < 0.01);
  assert.ok(Math.abs(left.width * 3448 - 1280) < 0.01);
  assert.ok(Math.abs(left.height * 808 - 800) < 0.01);
  assert.ok(Math.abs(right.x * 3448 - 1328) < 0.01);
  assert.ok(Math.abs(right.width * 3448 - 1280) < 0.01);
  assert.ok(Math.abs(near.width * 3448 - 960) < 0.01);
  assert.ok(Math.abs(near.height * 808 - 600) < 0.01);
  assert.deepEqual(full, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(stereoCropPreset(2560, 720, 'left'), { x: 0, y: 0, width: 0.5, height: 1 });
  assert.deepEqual(stereoCropPreset(2560, 720, 'right'), { x: 0.5, y: 0, width: 0.5, height: 1 });
});

test('PS4 camera label matching, preference selection, and backend ensure endpoint fallback', async () => {
  assert.equal(isPs4CameraLabel('USB Camera-OV580'), true);
  assert.equal(isPs4CameraLabel('PlayStation(R) Camera'), true);
  assert.equal(isPs4CameraLabel('FaceTime高清相机'), false);

  assert.equal(
    pickPreferredCameraId([
      { deviceId: 'facetime-1', label: 'FaceTime高清相机' },
      { deviceId: 'ov580-1', label: 'USB Camera-OV580' },
    ]),
    'ov580-1',
  );
  assert.equal(pickPreferredCameraId([{ deviceId: 'facetime-1', label: 'FaceTime高清相机' }]), undefined);

  const ok = await ensureLocalPs4Camera(async (input, init) => {
    assert.equal(input, '/api/ps4eye/ensure');
    assert.equal(init?.method, 'POST');
    return {
      ok: true,
      async json() {
        return { state: 'initialized', ready: true, initializedNow: true, message: 'ok' };
      },
    } as Response;
  });
  assert.deepEqual(ok, { state: 'initialized', ready: true, initializedNow: true, message: 'ok' });

  const failedStatus = await ensureLocalPs4Camera(async () => ({ ok: false, async json() { return {}; } }) as Response);
  assert.equal(failedStatus, null);

  const threw = await ensureLocalPs4Camera(async () => { throw new Error('offline'); });
  assert.equal(threw, null);
});
