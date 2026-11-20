import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerRoster } from '../src/interaction/roster.ts';
import { PlayerTracker } from '../src/interaction/tracker.ts';
import { Calibration } from '../src/game/calibration.ts';
import type { PoseObservation } from '../src/types.ts';

function pose(x: number, y = 0.5, width = 0.16, raised = false): PoseObservation {
  const landmarks = Array.from({ length: 33 }, () => ({ x, y, visibility: 0 }));
  landmarks[11] = { x: x - width / 2, y, visibility: 1 };
  landmarks[12] = { x: x + width / 2, y, visibility: 1 };
  landmarks[23] = { x: x - width * 0.4, y: Math.min(0.95, y + width * 1.4), visibility: 1 };
  landmarks[24] = { x: x + width * 0.4, y: Math.min(0.95, y + width * 1.4), visibility: 1 };
  landmarks[15] = { x: x - width * 0.65, y: raised ? y - width * 0.5 : y + width * 0.5, visibility: 1 };
  landmarks[16] = { x: x + width * 0.65, y: y + width * 0.5, visibility: 1 };
  return { landmarks };
}

test('PlayerRoster selects a raising solo player over a sitting bystander and keeps them locked during gameplay', () => {
  const roster = new PlayerRoster();
  const tracker = new PlayerTracker(1);
  const calibration = new Calibration(1);
  const sitting = pose(0.25, 0.58, 0.22, false);
  const active = pose(0.65, 0.46, 0.16, true);
  let ready = false;
  for (let t = 0; t <= 2200; t += 100) {
    const selected = roster.select([sitting, active], 1, t);
    const players = tracker.update(selected, t);
    ready = ready ? calibration.adapt(players, t) : calibration.update(players, t);
    if (ready) roster.lock(players);
  }
  assert.equal(ready, true);
  for (let t = 2300; t <= 4000; t += 100) {
    const wavingBystander = pose(0.25 + (t % 200 === 0 ? 0.02 : 0), 0.56, 0.22, true);
    const passerby = pose(0.88, 0.52, 0.15, true);
    const playerMoving = pose(0.65, 0.46, 0.16, false);
    const selected = roster.select([wavingBystander, passerby, playerMoving], 1, t);
    const players = tracker.update(selected, t);
    assert.equal(players.length, 1);
    assert.ok(Math.abs(players[0].center.x - 0.65) < 0.03);
    assert.equal(calibration.adapt(players, t), true);
  }
});

test('PlayerRoster shields a locked player from a known bystander during brief occlusion', () => {
  const roster = new PlayerRoster();
  const tracker = new PlayerTracker(1);
  const calibration = new Calibration(1);
  let ready = false;
  for (let t = 0; t <= 2200; t += 100) {
    const selected = roster.select([pose(0.2, 0.6, 0.2, false), pose(0.65, 0.48, 0.16, true)], 1, t);
    const players = tracker.update(selected, t);
    ready = ready ? calibration.adapt(players, t) : calibration.update(players, t);
    if (ready) roster.lock(players);
  }
  assert.equal(ready, true);
  for (let t = 2300; t <= 2500; t += 100) {
    const selected = roster.select([pose(0.2, 0.6, 0.2, true)], 1, t);
    assert.equal(selected.length, 0);
    const players = tracker.update(selected, t);
    calibration.adapt(players, t);
  }
  const recovered = roster.select([pose(0.2, 0.6, 0.2, false), pose(0.65, 0.48, 0.16, false)], 1, 2600);
  const players = tracker.update(recovered, 2600);
  assert.equal(players.length, 1);
  assert.equal(calibration.adapt(players, 2600), true);
});

test('PlayerRoster supports two-player calibration and gameplay with a third sitting bystander', () => {
  const roster = new PlayerRoster();
  const tracker = new PlayerTracker(2);
  const calibration = new Calibration(2);
  let ready = false;
  for (let t = 0; t <= 2200; t += 100) {
    const selected = roster.select([pose(0.15, 0.62, 0.22, false), pose(0.42, 0.5, 0.16, true), pose(0.75, 0.55, 0.14, false)], 2, t);
    const players = tracker.update(selected, t);
    ready = calibration.update(players, t);
    roster.syncConfirmed(calibration.verifiedPlayers(players));
  }
  assert.equal(calibration.readyCount(), 1);
  for (let t = 2300; t <= 4500; t += 100) {
    const selected = roster.select([pose(0.15, 0.62, 0.22, false), pose(0.42, 0.5, 0.16, false), pose(0.75, 0.55, 0.14, true)], 2, t);
    const players = tracker.update(selected, t);
    ready = ready ? calibration.adapt(players, t) : calibration.update(players, t);
    if (ready) roster.lock(players);
    else roster.syncConfirmed(calibration.verifiedPlayers(players));
  }
  assert.equal(ready, true);
  for (let t = 4600; t <= 6000; t += 100) {
    const selected = roster.select([pose(0.15, 0.62, 0.22, true), pose(0.92, 0.5, 0.18, true), pose(0.42, 0.5, 0.16, false), pose(0.75, 0.55, 0.14, false)], 2, t);
    const players = tracker.update(selected, t);
    assert.equal(players.length, 2);
    assert.equal(calibration.adapt(players, t), true);
  }
});

test('PlayerRoster still forwards a genuine hard scale jump when no bystander exists', () => {
  const roster = new PlayerRoster();
  const tracker = new PlayerTracker(1);
  const calibration = new Calibration(1);
  let ready = false;
  for (let t = 0; t <= 2200; t += 100) {
    const selected = roster.select([pose(0.5, 0.45, 0.12, true)], 1, t);
    const players = tracker.update(selected, t);
    ready = ready ? calibration.adapt(players, t) : calibration.update(players, t);
    if (ready) roster.lock(players);
  }
  assert.equal(ready, true);
  for (let t = 2300; t <= 2600; t += 100) {
    const jumped = roster.select([pose(0.5, 0.45, 0.216, false)], 1, t);
    assert.equal(jumped.length, 1);
    const players = tracker.update(jumped, t);
    assert.equal(players.length, 1);
    assert.equal(calibration.adapt(players, t), false);
  }
});
