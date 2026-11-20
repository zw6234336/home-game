import test from 'node:test';
import assert from 'node:assert/strict';
import { AnomalyLog } from '../src/platform/anomaly-log.ts';
import { Calibration } from '../src/game/calibration.ts';
import { GestureNavigation } from '../src/ui/navigation.ts';
import type { TrackedPlayer, VisionFrame } from '../src/types.ts';

function tracked(wristY: number, wristX = 0.5, shoulderY = 0.6, width = 0.25): TrackedPlayer {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  landmarks[11] = { x: 0.5 - width / 2, y: shoulderY, visibility: 1 };
  landmarks[12] = { x: 0.5 + width / 2, y: shoulderY, visibility: 1 };
  landmarks[15] = { x: wristX, y: wristY, visibility: 1 };
  landmarks[16] = { x: 0.7, y: 0.9, visibility: 1 };
  const raised = wristY < shoulderY - Math.max(0.03, width * 0.15);
  return { id: 1, center: { x: 0.5, y: shoulderY }, shoulderWidth: width, landmarks, wrists: [landmarks[15], landmarks[16]], raised, bothRaised: false };
}

function frameAt(capturedAt: number, handJitterX = 0.95): VisionFrame {
  const landmarks = Array.from({ length: 21 }, () => ({ x: handJitterX, y: 0.1, visibility: 1 }));
  return {
    sequence: 1,
    capturedAt,
    completedAt: capturedAt + 10,
    inferenceMs: 10,
    poses: [],
    hands: [{ landmarks, handedness: 'Left' }],
    handsCapturedAt: capturedAt,
  };
}

test('AnomalyLog aggregates counts, throttles repeated recent entries and excludes private fields', () => {
  const log = new AnomalyLog(4, 500);
  log.record('stale_frame', 'age_over_150ms', 'game', 100);
  log.record('stale_frame', 'age_over_150ms', 'game', 200);
  log.record('stale_frame', 'age_over_150ms', 'game', 700);
  log.record('gesture_dwell_reset', 'hand_lowered', 'calibration', 800);
  const snap = log.snapshot();
  assert.equal(snap.total, 4);
  assert.equal(snap.counts['stale_frame:age_over_150ms'], 3);
  assert.equal(snap.counts['gesture_dwell_reset:hand_lowered'], 1);
  assert.equal(snap.recent.length, 3);
  assert.equal(snap.recent[0].atMs, 0);
  assert.equal(snap.recent[1].atMs, 600);
  assert.ok(log.summary().includes('过期帧丢弃 ×3'));
  const serialized = JSON.stringify(snap);
  assert.ok(serialized.length < 1024);
  for (const forbidden of ['"id"', '"playerId"', '"landmarks"', '"deviceId"', '"image"', '"x"', '"y"']) {
    assert.ok(!serialized.includes(forbidden));
  }
});

test('Calibration reports non-PII diagnostic reasons across holding, soft jitter and hard invalidation', () => {
  const cal = new Calibration(1);
  cal.update([], 0);
  assert.equal(cal.lastDiagnostic(), 'no_player');
  cal.update([tracked(0.75)], 100);
  assert.equal(cal.lastDiagnostic(), 'hand_not_raised');
  for (let t = 200; t <= 2200; t += 100) cal.update([tracked(0.3)], t);
  assert.equal(cal.lastDiagnostic(), 'ready');
  cal.adapt([tracked(0.3, 0.5, 0.6, 0.25 * 1.15)], 2300);
  assert.equal(cal.lastDiagnostic(), 'soft_scale_jitter');
  cal.adapt([tracked(0.3, 0.5, 0.6, 0.25)], 2400);
  assert.equal(cal.lastDiagnostic(), 'ok');
  cal.adapt([tracked(0.3, 0.5, 0.6, 0.25 * 1.9)], 2500);
  assert.equal(cal.lastDiagnostic(), 'hard_jump');
});

test('GestureNavigation keeps pointer steady across hand frames, sustains lower-button reach and edge jitter, and confirms dwell', () => {
  const events: { code: string; reason: string }[] = [];
  let clicks = 0;
  const cursorStyle: Record<string, string> = {};
  const cursor = {
    parentElement: null as unknown,
    style: Object.assign(cursorStyle, { setProperty(key: string, value: string) { cursorStyle[key] = value; } }),
  };
  const button = {
    isConnected: true,
    disabled: false,
    dataset: { action: 'start-round', gestureId: 'calibration//start-round/0' } as Record<string, string>,
    getBoundingClientRect: () => ({ left: 450, right: 650, top: 930, bottom: 990, width: 200, height: 60 }),
    closest: (selector: string) => selector === 'button[data-action]' ? button : null,
    click: () => { clicks += 1; },
  };
  const body = { append(node: { parentElement: unknown }) { node.parentElement = body; } };
  const prevDocument = (globalThis as Record<string, unknown>).document;
  const prevWidth = (globalThis as Record<string, unknown>).innerWidth;
  const prevHeight = (globalThis as Record<string, unknown>).innerHeight;
  (globalThis as Record<string, unknown>).innerWidth = 1000;
  (globalThis as Record<string, unknown>).innerHeight = 1000;
  (globalThis as Record<string, unknown>).document = {
    body,
    querySelector(selector: string) { return selector === '#gesture-cursor' ? cursor : null; },
    elementFromPoint(x: number, y: number) {
      const rect = button.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom ? button : null;
    },
  };
  try {
    const nav = new GestureNavigation((code, reason) => events.push({ code, reason }));
    nav.update([tracked(0.55, 0.5, 0.6, 0.25)], frameAt(0), 10, undefined, 1);
    for (let t = 50; t <= 1250; t += 50) {
      const jitterX = t % 100 === 0 ? 0.515 : 0.485;
      nav.update([tracked(0.61, jitterX, 0.6, 0.25)], frameAt(t, 0.05), t + 10, undefined, 1);
    }
    assert.equal(clicks, 1);
    assert.ok(events.some(event => event.code === 'gesture_activate' && event.reason === 'start-round'));
    nav.update([tracked(0.45, 0.5, 0.6, 0.25)], frameAt(1350), 1360, undefined, 1);
    assert.equal(clicks, 1);
    nav.update([tracked(0.75, 0.5, 0.6, 0.25)], frameAt(1400), 1410, undefined, 1);
    assert.equal(cursor.style.display, 'none');
  } finally {
    (globalThis as Record<string, unknown>).document = prevDocument;
    (globalThis as Record<string, unknown>).innerWidth = prevWidth;
    (globalThis as Record<string, unknown>).innerHeight = prevHeight;
  }
});
