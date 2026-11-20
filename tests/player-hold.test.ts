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
