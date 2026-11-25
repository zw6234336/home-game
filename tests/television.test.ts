import { Stage } from '../src/ui/stage.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { enterTvFullscreen, exitTvFullscreen, stagePixelRatio } from '../src/platform/television.ts';

test('TV pixel budget preserves CSS geometry while bounding 720p, 1080p and 4K backing stores', () => {
  for (const [width, height] of [[1280, 720], [1920, 1080], [3840, 2160], [7680, 4320]]) {
    const ratio = stagePixelRatio(width, height, 2);
    assert.ok(ratio > 0 && ratio <= 1.5);
    assert.ok(Math.floor(width * ratio) * Math.floor(height * ratio) <= 3_200_000);
    const source = { x: .32, y: .4 };
    assert.ok(Math.abs((source.x * width * ratio) / ratio - source.x * width) < .000001);
  }
  assert.equal(stagePixelRatio(1280, 720, 1), 1);
  assert.throws(() => stagePixelRatio(0, 1080, 1), RangeError);
  assert.throws(() => stagePixelRatio(1920, NaN, 1), RangeError);
});

test('native fullscreen success, existing session and exit are observable without duplicate requests', async () => {
  let requests = 0;
  let exits = 0;
  const element = {} as Element;
  const host = {
    fullscreenEnabled: true,
    fullscreenElement: null as Element | null,
    documentElement: { async requestFullscreen(options?: FullscreenOptions) { requests++; assert.equal(options?.navigationUI, 'hide'); host.fullscreenElement = element; } },
    async exitFullscreen() { exits++; host.fullscreenElement = null; },
  };
  assert.equal(await enterTvFullscreen(host), true);
  assert.equal(await enterTvFullscreen(host), true);
  assert.equal(requests, 1);
  assert.equal(await exitTvFullscreen(host), true);
  assert.equal(await exitTvFullscreen(host), true);
  assert.equal(exits, 1);
});

test('unsupported or rejected fullscreen returns a usable fallback result', async () => {
  let requests = 0;
  const host = {
    fullscreenEnabled: false,
    fullscreenElement: null as Element | null,
    documentElement: { async requestFullscreen() { requests++; throw new Error('Requires a real user activation'); } },
    async exitFullscreen() { throw new Error('Denied'); },
  };
  assert.equal(await enterTvFullscreen(host), false);
  assert.equal(requests, 0);
  host.fullscreenEnabled = true;
  assert.equal(await enterTvFullscreen(host), false);
  assert.equal(requests, 1);
  host.fullscreenElement = {} as Element;
  assert.equal(await exitTvFullscreen(host), false);
  assert.notEqual(host.fullscreenElement, null);
});


test('demo avatar moves below the TV HUD and restores its ordinary position', context => {
  const image = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const density = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class { src = ''; complete = false; naturalWidth = 0; } });
  Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
  context.after(() => {
    if (image) Object.defineProperty(globalThis, 'Image', image); else Reflect.deleteProperty(globalThis, 'Image');
    if (density) Object.defineProperty(globalThis, 'devicePixelRatio', density); else Reflect.deleteProperty(globalThis, 'devicePixelRatio');
  });
  const labels: { value: string; x: number; y: number }[] = [];
  const ctx = {
    setTransform() {}, fillRect() {}, save() {}, restore() {}, scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, translate() {}, arc() {},
    fillText(value: string, x: number, y: number) { labels.push({ value, x, y }); },
  } as unknown as CanvasRenderingContext2D;
  const canvas = { clientWidth: 1280, clientHeight: 720, width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const stage = new Stage(canvas, { demoFaces: true });
  const crop = { x: 0, y: 0, width: 1, height: 1 };
  stage.draw(null, crop, [], null, null, 100);
  const ordinary = labels.at(-1)!;
  stage.setTelevisionPresentation(true);
  stage.draw(null, crop, [], null, null, 120);
  const television = labels.at(-1)!;
  assert.equal(ordinary.value, '变身演示');
  assert.equal(television.value, ordinary.value);
  assert.equal(television.x, ordinary.x);
  assert.ok(television.y - ordinary.y >= 120);
  assert.ok(television.y < 720 - 100);
  stage.setTelevisionPresentation(false);
  stage.draw(null, crop, [], null, null, 140);
  assert.deepEqual(labels.at(-1), ordinary);
});
