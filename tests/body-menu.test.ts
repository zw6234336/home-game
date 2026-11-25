import test from 'node:test';
import assert from 'node:assert/strict';
import { BodyMenuController, bodyMenuPose, type BodyMenuAction } from '../src/interaction/body-menu.ts';
import type { Point, TrackedPlayer } from '../src/types.ts';

function player(shape: BodyMenuAction | 'neutral', id = 1, aspect = 1): TrackedPlayer {
  const width = .2;
  const center = { x: .5, y: .4 };
  const point = (x: number, y: number): Point => ({ x: center.x + x * width, y: center.y + y * width * aspect });
  const hands: Record<BodyMenuAction | 'neutral', [Point, Point]> = {
    neutral: [point(-.5, 1), point(.5, 1)],
    confirm: [point(-.1, .5), point(.1, .5)],
    back: [point(.5, .1), point(-.5, .1)],
    next: [point(-1.5, 0), point(.5, 1)],
    previous: [point(-.5, 1), point(1.5, 0)],
  };
  const landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 0 }));
  landmarks[11] = { ...point(-.5, 0), visibility: 1 };
  landmarks[12] = { ...point(.5, 0), visibility: 1 };
  return { id, center, shoulderWidth: width, landmarks, wrists: hands[shape], raised: false, bothRaised: false };
}

function sample(controller: BodyMenuController, players: TrackedPlayer[], time: number, context = 'home') {
  return controller.update({ players, capturedAt: time, now: time + 10, context, aspect: 1 });
}

function stream(controller: BodyMenuController, shape: BodyMenuAction | 'neutral', start: number, end: number, context = 'home', id = 1) {
  const events: BodyMenuAction[] = [];
  for (let time = start; time <= end; time += 50) {
    const result = sample(controller, [player(shape, id)], time, context);
    if (result.activated) events.push(result.activated);
  }
  return events;
}

test('menu gestures use personal shoulder geometry and mirrored screen directions at multiple video aspects', () => {
  for (const aspect of [1, 16 / 9, 4 / 3]) {
    for (const action of ['next', 'previous', 'confirm', 'back'] as const) assert.equal(bodyMenuPose(player(action, 1, aspect), aspect), action);
    assert.equal(bodyMenuPose(player('neutral', 1, aspect), aspect), null);
  }
});

test('menus require an initial neutral release, activate once and require a new release for another action', () => {
  const controller = new BodyMenuController();
  assert.deepEqual(stream(controller, 'confirm', 0, 2000), []);
  stream(controller, 'neutral', 2050, 2400);
  assert.deepEqual(stream(controller, 'confirm', 2450, 4500), ['confirm']);
  assert.deepEqual(stream(controller, 'back', 4550, 6000), []);
  stream(controller, 'neutral', 6050, 6400);
  assert.deepEqual(stream(controller, 'back', 6450, 7800), ['back']);
});

test('two partners cannot add together their hold times', () => {
  const controller = new BodyMenuController();
  stream(controller, 'neutral', 0, 300);
  assert.deepEqual(stream(controller, 'confirm', 350, 850, 'home', 1), []);
  assert.deepEqual(stream(controller, 'confirm', 900, 1400, 'home', 2), []);
  assert.deepEqual(stream(controller, 'confirm', 1450, 1800, 'home', 2), ['confirm']);
});

test('a page or focused target change cannot carry a held confirmation or repeated event into the next screen', () => {
  const controller = new BodyMenuController();
  stream(controller, 'neutral', 0, 300);
  stream(controller, 'confirm', 350, 1000);
  assert.deepEqual(stream(controller, 'confirm', 1050, 2300, 'calibration/start-round'), []);
  stream(controller, 'neutral', 2350, 2700, 'calibration/start-round');
  assert.deepEqual(stream(controller, 'confirm', 2750, 3650, 'calibration/start-round'), ['confirm']);
  assert.deepEqual(stream(controller, 'confirm', 3700, 5000, 'game/pause-dialog'), []);
});

test('duplicate frames do not accumulate time and stale, future or reversed time requires release', () => {
  for (const invalid of ['stale', 'future', 'reverse', 'gap']) {
    const controller = new BodyMenuController();
    stream(controller, 'neutral', 0, 300);
    stream(controller, 'confirm', 350, 800);
    for (let repeat = 0; repeat < 40; repeat++) assert.equal(sample(controller, [player('confirm')], 800).activated, null);
    const capturedAt = invalid === 'reverse' ? 700 : invalid === 'gap' ? 1050 : 850;
    const now = invalid === 'stale' ? 1200 : invalid === 'future' ? 800 : capturedAt + 10;
    controller.update({ players: [player('confirm')], capturedAt, now, context: 'home', aspect: 1 });
    assert.deepEqual(stream(controller, 'confirm', 1300, 2700), []);
  }
});

test('missing wrists and low confidence cannot complete or rearm a held action', () => {
  const controller = new BodyMenuController();
  stream(controller, 'neutral', 0, 300);
  stream(controller, 'confirm', 350, 950);
  const missing = player('confirm'); missing.wrists[0] = null;
  assert.equal(sample(controller, [missing], 1000).activated, null);
  assert.deepEqual(stream(controller, 'confirm', 1050, 1700), []);
  assert.deepEqual(stream(controller, 'confirm', 1750, 1950), []);
  stream(controller, 'neutral', 2000, 2300);
  assert.deepEqual(stream(controller, 'confirm', 2350, 3250), ['confirm']);
  const untrusted = player('neutral'); untrusted.landmarks[11].visibility = 0;
  for (let time = 3300; time <= 3800; time += 50) sample(controller, [untrusted], time);
  assert.deepEqual(stream(controller, 'confirm', 3850, 5000), []);
});

test('simultaneous gestures keep the same owner, and a new owner starts from zero', () => {
  const controller = new BodyMenuController();
  stream(controller, 'neutral', 0, 300);
  for (let time = 350; time <= 900; time += 50) sample(controller, [player('confirm', 2), player('back', 1)], time);
  assert.equal(sample(controller, [player('confirm', 2)], 950).progress, 0);
  assert.deepEqual(stream(controller, 'confirm', 1000, 1750, 'home', 2), []);
  assert.deepEqual(stream(controller, 'confirm', 1800, 1850, 'home', 2), ['confirm']);
});
