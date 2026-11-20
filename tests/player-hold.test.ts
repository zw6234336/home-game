import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerHold } from '../src/game/player-hold.ts';

test('alternating raised hands across players never shares a timer', () => {
  const hold = new PlayerHold();
  for (let time = 0; time <= 1500; time += 100) {
    assert.equal(hold.update([{ id: 1, bothRaised: time < 800 }, { id: 2, bothRaised: time >= 800 }], time), false);
  }
  for (let time = 1600; time < 2300; time += 100) assert.equal(hold.update([{ id: 2, bothRaised: true }], time), false);
  assert.equal(hold.update([{ id: 2, bothRaised: true }], 2300), true);
  assert.equal(hold.update([{ id: 2, bothRaised: true }], 2400), false);
});

test('disappearing or changing player cannot reuse an armed pause timer', () => {
  const hold = new PlayerHold();
  for (let time = 0; time < 1500; time += 100) hold.update([{ id: 1, bothRaised: true }], time);
  assert.equal(hold.update([{ id: 2, bothRaised: true }], 1500), false);
  hold.reset();
  assert.equal(hold.update([{ id: 2, bothRaised: true }], 1600), false);
});

function samplePlayer(id: number, bothRaised: boolean, missing: 'none' | 'wrist' | 'shoulder' = 'none') {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.4, visibility: 0 }));
  landmarks[11] = { x: 0.4, y: 0.4, visibility: missing === 'shoulder' ? 0 : 1 };
  landmarks[12] = { x: 0.6, y: 0.4, visibility: missing === 'shoulder' ? 0 : 1 };
  landmarks[15] = { x: 0.35, y: bothRaised ? 0.2 : 0.65, visibility: missing === 'wrist' ? 0 : 1 };
  landmarks[16] = { x: 0.65, y: bothRaised ? 0.2 : 0.65, visibility: missing === 'wrist' ? 0 : 1 };
  const wrists: [{ x: number; y: number } | null, { x: number; y: number } | null] = missing === 'wrist' ? [null, null] : [landmarks[15], landmarks[16]];
  return { id, bothRaised, landmarks, wrists };
}

test('requireRelease ignores hands held from start until a trusted release is seen', () => {
  const hold = new PlayerHold(1500, true);
  for (let time = 0; time <= 3000; time += 100) {
    assert.equal(hold.update([samplePlayer(1, true)], time), false);
  }
  assert.equal(hold.update([samplePlayer(1, false, 'wrist')], 3100), false);
  assert.equal(hold.update([samplePlayer(1, false, 'shoulder')], 3200), false);
  assert.equal(hold.update([samplePlayer(2, false)], 3300), false);
  for (let time = 3400; time <= 5400; time += 100) {
    assert.equal(hold.update([samplePlayer(1, true)], time), false);
  }
  assert.equal(hold.update([samplePlayer(1, false)], 5500), false);
  for (let time = 5600; time < 7100; time += 100) {
    assert.equal(hold.update([samplePlayer(1, true)], time), false);
  }
  assert.equal(hold.update([samplePlayer(1, true)], 7100), true);
  assert.equal(hold.update([samplePlayer(1, true)], 7200), false);
  hold.reset();
  for (let time = 7300; time <= 9300; time += 100) {
    assert.equal(hold.update([samplePlayer(1, true)], time), false);
  }
});

test('requireRelease keeps two players independent and resets on clock reversal', () => {
  const hold = new PlayerHold(1500, true);
  assert.equal(hold.update([samplePlayer(1, false), samplePlayer(2, true)], 0), false);
  for (let time = 100; time < 1600; time += 100) {
    assert.equal(hold.update([samplePlayer(1, true), samplePlayer(2, true)], time), false);
  }
  assert.equal(hold.update([samplePlayer(1, true), samplePlayer(2, true)], 1600), true);
  for (let time = 1700; time <= 3300; time += 100) {
    assert.equal(hold.update([samplePlayer(1, true), samplePlayer(2, true)], time), false);
  }
  assert.equal(hold.update([samplePlayer(1, true), samplePlayer(2, false)], 3400), false);
  assert.equal(hold.update([samplePlayer(2, true)], 3300), false);
  for (let time = 3400; time <= 5200; time += 100) {
    assert.equal(hold.update([samplePlayer(2, true)], time), false);
  }
});
