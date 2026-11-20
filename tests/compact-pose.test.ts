import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePose, POSE_COMPACT_CHALLENGES } from '../src/game/pose-match.ts';
import { PoseSession } from '../src/game/pose-session.ts';
import { demoPosePlayers, poseIllustration } from '../src/ui/pose-art.ts';

test('compact illustrations and both partner controls use six recognisable distinct small poses', () => {
  for (const gentle of [false, true]) for (const target of POSE_COMPACT_CHALLENGES) {
    const visible = demoPosePlayers([7, 11], target.id, [true, true], 'compact');
    for (const player of visible) for (const challenge of POSE_COMPACT_CHALLENGES) {
      assert.equal(evaluatePose(challenge.id, player.landmarks, gentle, 1, 'compact').matched, challenge.id === target.id, target.id + '/' + challenge.id);
    }
    for (const player of demoPosePlayers([7, 11], target.id, [false, false], 'compact')) assert.equal(evaluatePose(target.id, player.landmarks, gentle, 1, 'compact').matched, false);
    if (target.id !== 'hug') assert.notEqual(poseIllustration(target.id, true, 'compact'), poseIllustration(target.id));
  }
});

test('compact partners can complete all six cards independently and keep their chosen profile', () => {
  const session = new PoseSession([7, 11], true, 'compact');
  let time = 0;
  for (const challenge of POSE_COMPACT_CHALLENGES) {
    assert.equal(session.snapshot.spaceMode, 'compact');
    assert.equal(session.snapshot.target, challenge.id);
    for (let sample = 0; sample <= 10; sample++) {
      session.update(demoPosePlayers([7, 11], challenge.id, [true, false], 'compact'), time, 1);
      time += 100;
    }
    assert.equal(session.snapshot.players[0].ready, true);
    assert.equal(session.snapshot.players[1].ready, false);
    for (let sample = 0; sample <= 10; sample++) {
      session.update(demoPosePlayers([7, 11], challenge.id, [false, true], 'compact'), time, 1);
      time += 100;
    }
    assert.equal(session.snapshot.stage, 'celebrate');
    session.advance(1200);
  }
  assert.equal(session.snapshot.phase, 'results');
  assert.equal(session.snapshot.score, 600);
  assert.equal(session.snapshot.completed, 6);
});

test('a missing compact wrist cannot be invented to complete a card', () => {
  const session = new PoseSession([7], true, 'compact');
  const players = demoPosePlayers([7], 'airplane', [true], 'compact');
  players[0].landmarks[15].visibility = 0;
  players[0].wrists[0] = null;
  for (let time = 0; time < 3000; time += 100) session.update(players, time, 1);
  assert.equal(session.snapshot.score, 0);
  assert.equal(session.snapshot.players[0].progress, 0);
});
