import test from 'node:test';
import assert from 'node:assert/strict';
import { gameArtCatalog, treasureForTier, type GameArt } from '../src/art/catalog.ts';
import { FaceEffects } from '../src/game/costumes.ts';
import { GameArtCache, gameArt } from '../src/platform/game-art.ts';
import { drawCostumeFace, drawTreasure } from '../src/ui/storybook-art.ts';
import { faceAnchor, HeadwearTracker } from '../src/interaction/headwear.ts';
import type { TrackedPlayer } from '../src/types.ts';

test('costumes stay with the catcher, freeze without active time, fade and clean up', () => {
  const effects = new FaceEffects();
  assert.equal(effects.trigger(4, 0.1), 'soot');
  assert.equal(effects.trigger(7, 0.5), 'donkey');
  assert.equal(effects.trigger(9, 0.9), 'piglet');
  for (let frame = 0; frame < 600; frame++) assert.deepEqual(effects.get(7), { kind: 'donkey', alpha: 1, elapsedMs: 0 });
  assert.equal(effects.get(6), null);
  effects.advance(3300);
  assert.equal(effects.get(7)?.alpha, 1);
  effects.advance(600);
  assert.equal(effects.get(7)?.alpha, 0.5);
  effects.prune(new Set([7, 9]));
  assert.equal(effects.get(4), null);
  effects.advance(600);
  assert.equal(effects.get(7), null);
  assert.equal(effects.get(9), null);
  assert.equal(new FaceEffects().get(7), null);
});

test('invalid deltas do not poison face effects and a fresh hit restarts only its own timer', () => {
  const effects = new FaceEffects();
  effects.trigger(1, 0.5);
  effects.trigger(2, 0.9);
  effects.advance(3500);
  for (const delta of [NaN, Infinity, -100, 0]) effects.advance(delta);
  assert.equal(effects.get(1)?.elapsedMs, 3500);
  effects.trigger(1, 0.1);
  assert.equal(effects.get(1)?.elapsedMs, 0);
  assert.equal(effects.get(2)?.elapsedMs, 3500);
  effects.advance(1000);
  assert.equal(effects.get(2), null);
  assert.equal(effects.get(1)?.kind, 'soot');
});

test('treasure skins preserve all three score tiers while leaving hearts in the rain', () => {
  const tiers = { pink: 10, big: 20, gold: 30 } as const;
  const seen = new Set();
  for (const tier of Object.keys(tiers) as (keyof typeof tiers)[]) {
    let hearts = 0;
    for (let serial = 1; serial <= 24; serial++) {
      const art = treasureForTier(tier, serial);
      if (art) {
        seen.add(art);
        assert.equal(gameArtCatalog[art].points, tiers[tier]);
      } else hearts++;
    }
    assert.ok(hearts > 0);
  }
  assert.equal(seen.size, 4);
});

test('art cache shares one preload, isolates an asset failure, and does no work during get', async () => {
  const calls: string[] = [];
  const image = {} as CanvasImageSource;
  const cache = new GameArtCache(async url => {
    calls.push(url);
    if (url.includes('donkey')) throw new Error('missing asset');
    return image;
  });
  const first = cache.preload();
  assert.equal(cache.preload(), first);
  await first;
  assert.equal(calls.length, 7);
  assert.equal(cache.get('donkey'), null);
  assert.equal(cache.get('piglet'), image);
  for (let frame = 0; frame < 600; frame++) cache.get('slipper');
  await cache.preload();
  assert.equal(calls.length, 7);
});

test('face images rotate and scale at the tracked face; an unavailable sprite signals fallback', context => {
  const image = {} as CanvasImageSource;
  const transforms: number[][] = [];
  const draws: unknown[][] = [];
  const ctx = {
    save() {}, restore() {},
    translate(...args: number[]) { transforms.push(args); },
    rotate(...args: number[]) { transforms.push(args); },
    drawImage(...args: unknown[]) { draws.push(args); },
  } as unknown as CanvasRenderingContext2D;
  context.mock.method(gameArt, 'get', (name: GameArt) => name === 'donkey' || name === 'piglet' ? image : null);
  const face = { x: 420, y: 180, size: 80, angle: 0.25 };
  drawCostumeFace(ctx, face, { kind: 'donkey', alpha: 0.5, elapsedMs: 3900 });
  drawCostumeFace(ctx, face, { kind: 'piglet', alpha: 1, elapsedMs: 0 });
  assert.deepEqual(transforms.slice(0, 2), [[420, 180], [0.25]]);
  assert.equal(draws.length, 2);
  assert.ok(draws.every(draw => draw[0] === image && draw.slice(1).every(Number.isFinite)));
  assert.equal(drawTreasure(ctx, 'slipper', 40, 40, 25, 0, 10), false);
});

test('face masks require visible face landmarks and do not keep a stale smoothed face', () => {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  landmarks[11] = { x: 0.4, y: 0.55, visibility: 1 };
  landmarks[12] = { x: 0.6, y: 0.55, visibility: 1 };
  const player: TrackedPlayer = { id: 1, center: { x: 0.5, y: 0.55 }, shoulderWidth: 0.2, landmarks, wrists: [null, null], raised: false, bothRaised: false };
  const fit = { x: 0, y: 0, width: 1000, height: 600 };
  const tracker = new HeadwearTracker(faceAnchor);
  assert.equal(tracker.update(player, fit, 100), null);
  landmarks[0] = { x: 0.5, y: 0.3, visibility: 1 };
  assert.ok(tracker.update(player, fit, 130));
  landmarks[0].visibility = 0;
  assert.equal(tracker.update(player, fit, 160), null);
});
