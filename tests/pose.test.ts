import test from 'node:test';
import assert from 'node:assert/strict';
import type { Landmark, Point, TrackedPlayer } from '../src/types.ts';
import { evaluatePose, POSE_CHALLENGES } from '../src/game/pose-match.ts';
import type { PoseId } from '../src/game/pose-match.ts';
import { PoseSession } from '../src/game/pose-session.ts';

type Shape = [Point, Point, Point, Point];
const shapes: Record<PoseId, Shape> = {
  airplane: [{ x: -1.15, y: 0 }, { x: 1.15, y: 0 }, { x: -1.9, y: 0 }, { x: 1.9, y: 0 }],
  star: [{ x: -1.1, y: -0.6 }, { x: 1.1, y: -0.6 }, { x: -1.7, y: -1.2 }, { x: 1.7, y: -1.2 }],
  cactus: [{ x: -1.1, y: 0 }, { x: 1.1, y: 0 }, { x: -1.1, y: -0.8 }, { x: 1.1, y: -0.8 }],
  roof: [{ x: -1.1, y: -0.55 }, { x: 1.1, y: -0.55 }, { x: -0.1, y: -1.25 }, { x: 0.1, y: -1.25 }],
  hug: [{ x: -0.75, y: 0.65 }, { x: 0.75, y: 0.65 }, { x: 0.35, y: 0.25 }, { x: -0.35, y: 0.25 }],
  wave: [{ x: -1.1, y: 0 }, { x: 0.6, y: 0.6 }, { x: -1.1, y: -0.8 }, { x: 0.6, y: 1.2 }],
};

function landmarks(shape: Shape, aspect = 1, scale = 0.12, rotation = 0, mirror = false, center: Point = { x: 0.5, y: 0.5 }): Landmark[] {
  const result: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  const points = [{ x: -0.5, y: 0 }, { x: 0.5, y: 0 }, ...shape];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const x = center.x + (point.x * Math.cos(rotation) - point.y * Math.sin(rotation)) * scale / aspect;
    const y = center.y + (point.x * Math.sin(rotation) + point.y * Math.cos(rotation)) * scale;
    result[index + 11] = { x: mirror ? 1 - x : x, y, visibility: 1 };
  }
  return result;
}

function player(id: number, pose: PoseId = 'airplane', aspect = 1): TrackedPlayer {
  const points = landmarks(shapes[pose], aspect);
  return { id, center: { x: 0.5, y: 0.5 }, shoulderWidth: 0.12 / aspect, landmarks: points, wrists: [{ x: points[15].x, y: points[15].y }, { x: points[16].x, y: points[16].y }], raised: true, bothRaised: true };
}

function hold(session: PoseSession, players: TrackedPlayer[], from: number, duration: number, aspect = 1): void {
  for (let time = from; time <= from + duration; time += 100) session.update(players, time, aspect);
}

test('challenge catalog has the six named upper-body actions in order', () => {
  assert.deepEqual(POSE_CHALLENGES.map(item => item.id), ['airplane', 'star', 'cactus', 'roof', 'hug', 'wave']);
  assert.deepEqual(POSE_CHALLENGES.map(item => item.name), ['小飞机', '小星星', '大力士', '小屋顶', '抱抱熊', '招招手']);
  assert.ok(POSE_CHALLENGES.every(item => item.instruction.trim() && item.shortLabel.trim()));
  assert.equal(Object.isFrozen(POSE_CHALLENGES), true);
  assert.ok(POSE_CHALLENGES.every(Object.isFrozen));
});

test('canonical poses match only their own challenge in either mode', () => {
  for (const gentle of [false, true]) for (const target of POSE_CHALLENGES) for (const source of POSE_CHALLENGES) {
    const result = evaluatePose(target.id, landmarks(shapes[source.id]), gentle);
    assert.equal(result.matched, target.id === source.id, `${target.id} with ${source.id}, gentle=${gentle}`);
    assert.ok(Number.isFinite(result.quality) && result.quality >= 0 && result.quality <= 1);
    assert.ok(result.hint.trim());
    if (result.matched) assert.ok(result.quality > 0);
  }
});

test('pose recognition is invariant under aspect correction, scale, translation, mirroring and small tilt', () => {
  for (const challenge of POSE_CHALLENGES) for (const aspect of [9 / 16, 1, 4 / 3, 16 / 9, 2.4]) for (const mirror of [false, true]) for (const rotation of [-0.2, 0, 0.2]) {
    const points = landmarks(shapes[challenge.id], aspect, 0.075, rotation, mirror, { x: 0.53, y: 0.46 });
    assert.equal(evaluatePose(challenge.id, points, false, aspect).matched, true, `${challenge.id}/${aspect}/${mirror}/${rotation}`);
  }
  for (const scale of [0.04, 0.08, 0.15, 0.2]) for (const challenge of POSE_CHALLENGES) {
    assert.equal(evaluatePose(challenge.id, landmarks(shapes[challenge.id], 1, scale), false).matched, true);
  }
});

test('both wave sides are accepted and require the other hand to be lowered', () => {
  const alternate: Shape = [shapes.wave[1], shapes.wave[0], shapes.wave[3], shapes.wave[2]].map(point => ({ x: -point.x, y: point.y })) as Shape;
  for (const gentle of [false, true]) {
    assert.equal(evaluatePose('wave', landmarks(alternate), gentle).matched, true);
    assert.equal(evaluatePose('wave', landmarks(shapes.cactus), gentle).matched, false);
    assert.equal(evaluatePose('cactus', landmarks(alternate), gentle).matched, false);
  }
});

test('UI demonstration shapes pass the real standard evaluator', () => {
  const demo: Record<PoseId, Shape> = {
    airplane: [{ x: -1.05, y: 0 }, { x: 1.05, y: 0 }, { x: -1.7, y: 0 }, { x: 1.7, y: 0 }],
    star: [{ x: -0.95, y: -0.5 }, { x: 0.95, y: -0.5 }, { x: -1.4, y: -1.05 }, { x: 1.4, y: -1.05 }],
    cactus: [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: -1, y: -0.7 }, { x: 1, y: -0.7 }],
    roof: [{ x: -0.75, y: -0.7 }, { x: 0.75, y: -0.7 }, { x: -0.1, y: -1.4 }, { x: 0.1, y: -1.4 }],
    hug: [{ x: -0.65, y: 0.55 }, { x: 0.65, y: 0.55 }, { x: 0.3, y: 0.25 }, { x: -0.3, y: 0.25 }],
    wave: [{ x: -0.85, y: -0.2 }, { x: 0.75, y: 0.45 }, { x: -0.95, y: -0.9 }, { x: 0.8, y: 1 }],
  };
  for (const id of Object.keys(demo) as PoseId[]) assert.equal(evaluatePose(id, landmarks(demo[id], 16 / 9), false, 16 / 9).matched, true, id);
});

test('gentle airplane and star have separate inclusive height boundaries', () => {
  const straight = (height: number): Shape => [{ x: -1.1, y: height / 2 }, { x: 1.1, y: height / 2 }, { x: -1.7, y: height }, { x: 1.7, y: height }];
  assert.equal(evaluatePose('airplane', landmarks(straight(-0.4)), true).matched, true);
  assert.equal(evaluatePose('airplane', landmarks(straight(-0.40001)), true).matched, false);
  assert.equal(evaluatePose('star', landmarks(straight(-0.45)), true).matched, true);
  assert.equal(evaluatePose('airplane', landmarks(straight(-0.45)), true).matched, false);
  assert.equal(evaluatePose('star', landmarks(straight(-0.4)), true).matched, false);
});

test('gentle cactus rejects the bent V shape and inward roof wrists', () => {
  const bentV: Shape = [{ x: -0.9, y: -0.3 }, { x: 0.9, y: -0.3 }, { x: -0.9, y: -0.6 }, { x: 0.9, y: -0.6 }];
  assert.equal(evaluatePose('star', landmarks(bentV), true).matched, true);
  assert.equal(evaluatePose('cactus', landmarks(bentV), true).matched, false);
  const inward: Shape = [{ x: -0.7, y: 0 }, { x: 0.7, y: 0 }, { x: -0.3, y: -0.5 }, { x: 0.3, y: -0.5 }];
  assert.equal(evaluatePose('roof', landmarks(inward), true).matched, true);
  assert.equal(evaluatePose('cactus', landmarks(inward), true).matched, false);
});

test('invalid or low confidence coordinates cannot match or produce quality', () => {
  for (const index of [11, 12, 13, 14, 15, 16]) for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
    const points = landmarks(shapes.airplane);
    points[index].x = invalid;
    assert.deepEqual(evaluatePose('airplane', points, true).matched, false);
    assert.equal(evaluatePose('airplane', points, true).quality, 0);
  }
  for (const index of [11, 12, 13, 14, 15, 16]) {
    const points = landmarks(shapes.airplane);
    points[index].visibility = 0.499;
    assert.equal(evaluatePose('airplane', points, true).quality, 0);
    points[index].visibility = 0.5;
    assert.equal(evaluatePose('airplane', points, false).matched, true);
  }
  assert.equal(evaluatePose('unknown', landmarks(shapes.airplane), true).quality, 0);
  assert.equal(evaluatePose('airplane', [], true).quality, 0);
  for (const aspect of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(evaluatePose('airplane', landmarks(shapes.airplane), true, aspect).quality, 0);
});

test('degenerate shoulders and each degenerate arm segment are rejected', () => {
  for (const [from, to] of [[11, 12], [11, 13], [12, 14], [13, 15], [14, 16]]) {
    const points = landmarks(shapes.airplane);
    points[to] = { ...points[from] };
    assert.equal(evaluatePose('airplane', points, true).quality, 0);
  }
  assert.equal(evaluatePose('airplane', landmarks(shapes.airplane, 1, 1e-6), true).matched, false);
});

test('session validates and copies player identifiers', () => {
  for (const ids of [[], [1, 1], [0], [-1], [1.5], [Number.NaN], [1, 2, 3]]) assert.throws(() => new PoseSession(ids, true), RangeError);
  assert.throws(() => new PoseSession([1], 1 as unknown as boolean), TypeError);
  const ids = [1, 2];
  const session = new PoseSession(ids, true);
  ids[0] = 99;
  assert.deepEqual(session.snapshot.players.map(item => item.id), [1, 2]);
  assert.deepEqual({ ...session.snapshot, players: [] }, { spaceMode: 'standard', phase: 'playing', stage: 'pose', index: 0, total: 6, target: 'airplane', remainingMs: 20000, elapsedMs: 0, score: 0, completed: 0, results: [], players: [] });
});

test('gentle and standard holds use capture time without advancing round time', () => {
  for (const gentle of [true, false]) {
    const session = new PoseSession([1], gentle);
    const duration = gentle ? 1000 : 1400;
    session.update([player(1)], 0, 1);
    assert.equal(session.snapshot.players[0].progress, 0);
    hold(session, [player(1)], 100, duration - 200);
    assert.equal(session.snapshot.score, 0);
    session.update([player(1)], duration, 1);
    assert.equal(session.snapshot.score, 100);
    assert.equal(session.snapshot.completed, 1);
    assert.equal(session.snapshot.stage, 'celebrate');
    assert.equal(session.snapshot.elapsedMs, 0);
    assert.equal(session.snapshot.remainingMs, gentle ? 20000 : 16000);
    session.update([player(1)], duration + 100, 1);
    assert.equal(session.snapshot.results.length, 1);
  }
});

test('two players hold independently and a completed player can wait for a partner', () => {
  const session = new PoseSession([1, 2], true);
  hold(session, [player(1), player(2, 'hug')], 0, 1000);
  assert.equal(session.snapshot.players[0].ready, true);
  assert.equal(session.snapshot.players[1].ready, false);
  assert.equal(session.snapshot.score, 0);
  for (let time = 1100; time <= 2100; time += 100) session.update([player(2), player(1, 'hug')], time, 1);
  assert.equal(session.snapshot.score, 100);
  assert.ok(session.snapshot.players.every(item => item.ready));
});

test('invalid or repeated capture times cannot reset or grow a hold', () => {
  const session = new PoseSession([1], true);
  hold(session, [player(1)], 0, 500);
  const before = session.snapshot;
  for (const time of [500, 400, Number.NaN, Number.POSITIVE_INFINITY]) {
    session.update([], time, 1);
    assert.deepEqual(session.snapshot, before);
  }
  hold(session, [player(1)], 600, 400);
  assert.equal(session.snapshot.score, 100);
});

test('a gap above 150ms resets incomplete progress but preserves a ready partner', () => {
  const session = new PoseSession([1, 2], true);
  hold(session, [player(1), player(2, 'hug')], 0, 1000);
  session.update([player(1, 'hug'), player(2)], 1100, 1);
  session.update([player(1, 'hug'), player(2)], 1200, 1);
  assert.equal(session.snapshot.players[1].progress, 0.1);
  session.update([player(1, 'hug'), player(2)], 1351, 1);
  assert.equal(session.snapshot.players[0].ready, true);
  assert.equal(session.snapshot.players[1].progress, 0);
  hold(session, [player(1, 'hug'), player(2)], 1451, 900);
  assert.equal(session.snapshot.score, 100);
});

test('the exact 150ms gap remains continuous', () => {
  const session = new PoseSession([1], true);
  for (let time = 0; time <= 900; time += 150) session.update([player(1)], time, 1);
  assert.equal(session.snapshot.players[0].progress, 0.9);
  session.update([player(1)], 1000, 1);
  assert.equal(session.snapshot.score, 100);
});

test('missing or duplicate bound players lose readiness and unknown IDs cannot substitute', () => {
  for (const replacement of [[player(99), player(2, 'hug')], [player(1), player(1), player(2, 'hug')]]) {
    const session = new PoseSession([1, 2], true);
    hold(session, [player(1), player(2, 'hug')], 0, 1000);
    assert.equal(session.snapshot.players[0].ready, true);
    session.update(replacement, 1100, 1);
    assert.equal(session.snapshot.players[0].ready, false);
    assert.equal(session.snapshot.players[0].progress, 0);
    assert.equal(session.snapshot.score, 0);
  }
  const session = new PoseSession([1], true);
  hold(session, [player(99), player(1)], 0, 1000);
  assert.equal(session.snapshot.score, 100);
});

test('a wrong pose or invalid confidence restarts an unfinished hold', () => {
  const session = new PoseSession([1], true);
  hold(session, [player(1)], 0, 500);
  session.update([player(1, 'hug')], 600, 1);
  assert.equal(session.snapshot.players[0].progress, 0);
  session.update([player(1)], 700, 1);
  assert.equal(session.snapshot.players[0].progress, 0);
  const lowConfidence = player(1);
  lowConfidence.landmarks[15].visibility = 0;
  session.update([lowConfidence], 800, 1);
  assert.equal(session.snapshot.players[0].matched, false);
  assert.equal(session.snapshot.players[0].progress, 0);
});

test('pause and resume preserve only completed players and never count paused frames', () => {
  const session = new PoseSession([1, 2], true);
  hold(session, [player(1), player(2, 'hug')], 0, 1000);
  session.update([player(1), player(2)], 1100, 1);
  session.update([player(1), player(2)], 1200, 1);
  session.pause();
  const paused = session.snapshot;
  assert.equal(paused.players[0].ready, true);
  assert.equal(paused.players[1].progress, 0);
  session.pause(); session.advance(30000); session.update([], 3000, 1);
  assert.deepEqual(session.snapshot, paused);
  session.resume();
  session.update([player(1), player(2)], 3100, 1);
  assert.equal(session.snapshot.players[1].progress, 0);
  session.update([player(1), player(2)], 3200, 1);
  session.resume();
  assert.equal(session.snapshot.players[1].progress, 0.1);
  hold(session, [player(1), player(2)], 3300, 800);
  assert.equal(session.snapshot.score, 100);
});

test('advance consumes question and celebration time without creating hold progress', () => {
  const session = new PoseSession([1], false);
  session.advance(15999);
  assert.equal(session.snapshot.remainingMs, 1);
  assert.equal(session.snapshot.players[0].progress, 0);
  session.advance(1);
  assert.equal(session.snapshot.stage, 'celebrate');
  assert.deepEqual(session.snapshot.results, [{ id: 'airplane', status: 'timeout', score: 0 }]);
  session.advance(1199);
  assert.equal(session.snapshot.index, 0);
  assert.equal(session.snapshot.remainingMs, 0);
  session.advance(1);
  assert.equal(session.snapshot.index, 1);
  assert.equal(session.snapshot.target, 'star');
  assert.equal(session.snapshot.remainingMs, 16000);
  assert.equal(session.snapshot.elapsedMs, 17200);
});

test('success freezes question time during celebration and resets all holds for the next action', () => {
  const session = new PoseSession([1], true);
  session.advance(800);
  hold(session, [player(1)], 0, 1000);
  assert.equal(session.snapshot.remainingMs, 19200);
  session.advance(1199);
  assert.equal(session.snapshot.remainingMs, 19200);
  assert.equal(session.snapshot.stage, 'celebrate');
  session.advance(1);
  assert.equal(session.snapshot.stage, 'pose');
  assert.equal(session.snapshot.players[0].ready, false);
  assert.equal(session.snapshot.players[0].progress, 0);
  session.update([player(1, 'star')], 1000, 1);
  assert.equal(session.snapshot.players[0].matched, false);
  session.update([player(1, 'star')], 1100, 1);
  assert.equal(session.snapshot.players[0].matched, true);
  assert.equal(session.snapshot.players[0].progress, 0);
});

test('large advances cross all six timeouts and discard time after the result screen', () => {
  const session = new PoseSession([1], true);
  session.advance(1e9);
  const result = session.snapshot;
  assert.equal(result.phase, 'results');
  assert.equal(result.index, 5);
  assert.equal(result.target, 'wave');
  assert.equal(result.remainingMs, 0);
  assert.equal(result.elapsedMs, 6 * 21200);
  assert.equal(result.score, 0);
  assert.equal(result.results.length, 6);
  assert.ok(result.results.every(item => item.status === 'timeout'));
  session.advance(1000); session.update([player(1)], 1000, 1); session.pause(); session.resume(); session.skip(); session.end();
  assert.deepEqual(session.snapshot, result);
});

test('all six poses can be completed once with cooperative scoring', () => {
  const session = new PoseSession([1, 2], true);
  let time = 0;
  for (const challenge of POSE_CHALLENGES) {
    hold(session, [player(1, challenge.id, 16 / 9), player(2, challenge.id, 16 / 9)], time, 1000, 16 / 9);
    assert.equal(session.snapshot.results.at(-1)?.status, 'matched');
    session.advance(1200);
    time += 1200;
  }
  assert.equal(session.snapshot.phase, 'results');
  assert.equal(session.snapshot.score, 600);
  assert.equal(session.snapshot.completed, 6);
  assert.equal(session.snapshot.results.length, 6);
});

test('paused skip settles once and requires an explicit resume for celebration', () => {
  const session = new PoseSession([1], true);
  session.pause(); session.skip();
  assert.equal(session.snapshot.phase, 'paused');
  assert.equal(session.snapshot.stage, 'celebrate');
  assert.deepEqual(session.snapshot.results, [{ id: 'airplane', status: 'skipped', score: 0 }]);
  const before = session.snapshot;
  session.skip(); session.advance(5000);
  assert.deepEqual(session.snapshot, before);
  session.resume(); session.advance(1200);
  assert.equal(session.snapshot.index, 1);
  assert.equal(session.snapshot.phase, 'playing');
});

test('invalid clock deltas are ignored and end preserves only already settled results', () => {
  const session = new PoseSession([1], true);
  const initial = session.snapshot;
  for (const delta of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    session.advance(delta);
    assert.deepEqual(session.snapshot, initial);
  }
  session.skip(); session.advance(1200); session.advance(100);
  session.end();
  assert.equal(session.snapshot.remainingMs, 0);
  assert.equal(session.snapshot.index, 1);
  assert.equal(session.snapshot.target, 'star');
  assert.equal(session.snapshot.results.length, 1);
  assert.equal(session.snapshot.elapsedMs, 1300);
  const ended = session.snapshot;
  session.end(); session.skip(); session.resume(); session.update([player(1, 'star')], 1000, 1);
  assert.deepEqual(session.snapshot, ended);
});

test('snapshot mutations cannot alter the live session', () => {
  const session = new PoseSession([1], true);
  hold(session, [player(1)], 0, 1000);
  const before = session.snapshot;
  const exposed = session.snapshot;
  exposed.players[0].id = 99;
  exposed.players[0].ready = false;
  exposed.players.length = 0;
  exposed.results[0].score = 0;
  exposed.results.length = 0;
  exposed.score = 0;
  assert.deepEqual(session.snapshot, before);
});
