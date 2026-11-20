import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraSession } from '../src/platform/camera.ts';

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
