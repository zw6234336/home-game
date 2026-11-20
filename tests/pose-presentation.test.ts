import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSE_CHALLENGES, evaluatePose } from '../src/game/pose-match.ts';
import { demoPosePlayers } from '../src/ui/pose-art.ts';

test('the poses shown by demonstration controls pass the actual matcher for both partners', () => {
  for (const challenge of POSE_CHALLENGES) {
    for (const gentle of [false, true]) {
      const players = demoPosePlayers([41, 73], challenge.id, [true, false]);
      assert.deepEqual(players.map(player => player.id), [41, 73]);
      assert.equal(evaluatePose(challenge.id, players[0].landmarks, gentle, 1).matched, true, challenge.id);
      assert.equal(evaluatePose(challenge.id, players[1].landmarks, gentle, 1).matched, false, challenge.id);
      const both = demoPosePlayers([41, 73], challenge.id, [true, true]);
      assert.equal(evaluatePose(challenge.id, both[1].landmarks, gentle, 1).matched, true, challenge.id);
    }
  }
});
